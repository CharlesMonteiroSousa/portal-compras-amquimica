import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Configuração da função admin-users incompleta.");
    return jsonResponse({ error: "Configuração do servidor incompleta." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  const tokenMatch = authorization && authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return jsonResponse({ error: "Autenticação obrigatória." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) {
    return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("perfil")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Falha ao verificar perfil administrativo:", profileError);
    return jsonResponse({ error: "Não foi possível verificar as permissões." }, 500);
  }
  if (!profile || profile.perfil !== "ADMIN") {
    return jsonResponse({ error: "Apenas administradores podem gerenciar usuários." }, 403);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Requisição inválida." }, 400);
  }

  if (payload.action === "list") {
    const users: Array<{ id: string; email?: string | null; created_at: string }> = [];
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) {
        console.error("Falha ao listar usuários do Auth:", error);
        return jsonResponse({ error: "Não foi possível listar os usuários." }, 500);
      }
      users.push(...data.users);
      if (data.users.length < 1000) break;
      if (page === 100) {
        return jsonResponse({ error: "Limite de paginação atingido ao listar usuários." }, 500);
      }
    }

    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, nome, perfil, setor");
    if (profilesError) {
      console.error("Falha ao listar perfis:", profilesError);
      return jsonResponse({ error: "Não foi possível carregar os perfis." }, 500);
    }

    const profileById = new Map((profiles || []).map((item) => [item.id, item]));
    const result = users.map((user) => {
      const userProfile = profileById.get(user.id);
      return {
        email: user.email || "",
        nome: userProfile?.nome || "",
        perfil: userProfile?.perfil || "",
        setor: userProfile?.setor || "",
        created_at: user.created_at,
      };
    }).sort((a, b) => a.email.localeCompare(b.email));

    return jsonResponse({ users: result });
  }

  if (payload.action !== "create") {
    return jsonResponse({ error: "Ação não reconhecida." }, 400);
  }

  const nome = typeof payload.nome === "string" ? payload.nome.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const perfil = payload.perfil;
  const setor = payload.setor;

  if (!nome || nome.length > 100) {
    return jsonResponse({ error: "Informe um nome com até 100 caracteres." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ error: "Informe um e-mail válido." }, 400);
  }
  if (password.length < 8) {
    return jsonResponse({ error: "A senha inicial deve ter pelo menos 8 caracteres." }, 400);
  }
  if (perfil !== "MON" && perfil !== "PF") {
    return jsonResponse({ error: "O perfil precisa ser MON ou PF." }, 400);
  }
  let normalizedSector: string | null = null;
  if (perfil === "PF") {
    if (setor !== "Embalagem" && setor !== "Química") {
      return jsonResponse({ error: "Setor inválido para o perfil selecionado." }, 400);
    }
    normalizedSector = setor;
  } else if (setor !== null) {
    return jsonResponse({ error: "O perfil MON não deve ter setor." }, 400);
  }

  const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !createdUser.user) {
    if (createError) console.error("Falha ao criar usuário Auth:", createError);
    return jsonResponse({ error: createError?.message || "Não foi possível criar o usuário." }, 400);
  }

  const { error: insertProfileError } = await adminClient.from("profiles").insert({
    id: createdUser.user.id,
    nome,
    perfil,
    setor: normalizedSector,
  });

  if (insertProfileError) {
    console.error("Falha ao criar perfil; removendo a conta recém-criada:", insertProfileError);
    const { error: rollbackError } = await adminClient.auth.admin.deleteUser(createdUser.user.id);
    if (rollbackError) console.error("Falha ao remover a conta sem perfil:", rollbackError);
    return jsonResponse({ error: "A conta não foi concluída porque o perfil não pôde ser criado." }, 500);
  }

  return jsonResponse({ success: true });
});
