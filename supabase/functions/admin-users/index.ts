import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://portal-compras-amquimica-one.vercel.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
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

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Requisição inválida." }, 400);
  }

  if (payload.action === "permanently-delete-request") {
    if (!profile || profile.perfil !== "MON") {
      return jsonResponse({ error: "Apenas compradores podem excluir requisições permanentemente." }, 403);
    }

    const codigo = typeof payload.codigo === "string" ? payload.codigo.trim() : "";
    if (!codigo || codigo.length > 100) {
      return jsonResponse({ error: "Código de requisição inválido." }, 400);
    }

    const { data: requisicao, error: requestError } = await adminClient
      .from("requisicoes")
      .select("codigo, setor, url_nf, cancelado")
      .eq("codigo", codigo)
      .maybeSingle();
    if (requestError) {
      console.error("Falha ao localizar requisição para exclusão permanente:", requestError);
      return jsonResponse({ error: "Não foi possível localizar a requisição." }, 500);
    }
    if (!requisicao) return jsonResponse({ error: "Requisição não encontrada." }, 404);
    if (requisicao.cancelado !== true) {
      return jsonResponse({ error: "Somente requisições canceladas podem ser excluídas permanentemente." }, 409);
    }

    if (requisicao.url_nf) {
      const expectedFolder = requisicao.setor === "Embalagem" ? "embalagem" :
        requisicao.setor === "Química" ? "quimica" : "";
      let filePath: string | null = null;
      const storedValue = requisicao.url_nf;
      if (typeof storedValue === "string" && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(storedValue)) {
        filePath = storedValue;
      } else if (typeof storedValue === "string") {
        try {
          const fileUrl = new URL(storedValue, supabaseUrl);
          const marker = "/storage/v1/object/";
          const objectIndex = fileUrl.pathname.indexOf(marker);
          if (fileUrl.origin === new URL(supabaseUrl).origin && objectIndex !== -1) {
            const parts = fileUrl.pathname.slice(objectIndex + marker.length).split("/");
            if ((parts[0] === "public" || parts[0] === "sign") &&
                parts[1] === "notas-fiscais" && parts.length === 4) {
              filePath = parts.slice(2).map((part) => decodeURIComponent(part)).join("/");
            }
          }
        } catch (error) {
          console.error("Caminho do anexo inválido na requisição:", error);
        }
      }

      if (!filePath || !expectedFolder ||
          !new RegExp("^" + expectedFolder + "/[a-zA-Z0-9_.-]+$").test(filePath) ||
          filePath.split("/").some((part) => part === "." || part === "..")) {
        return jsonResponse({ error: "O caminho do arquivo da Nota Fiscal é inválido; a requisição foi mantida." }, 400);
      }

      const { error: storageError } = await adminClient.storage
        .from("notas-fiscais")
        .remove([filePath]);
      if (storageError) {
        console.error("Falha ao remover anexo do Storage:", storageError);
        return jsonResponse({ error: "Não foi possível excluir o arquivo da Nota Fiscal; a requisição foi mantida." }, 500);
      }
    }

    const { data: deletedRequest, error: deleteRequestError } = await adminClient
      .from("requisicoes")
      .delete()
      .eq("codigo", codigo)
      .eq("cancelado", true)
      .select("codigo")
      .maybeSingle();
    if (deleteRequestError) {
      console.error("Falha ao excluir requisição cancelada:", deleteRequestError);
      return jsonResponse({ error: "O arquivo foi removido, mas não foi possível excluir o registro da requisição." }, 500);
    }
    if (!deletedRequest) return jsonResponse({ error: "A requisição não está mais disponível para exclusão." }, 404);

    return jsonResponse({ success: true });
  }

  if (!profile || profile.perfil !== "ADMIN") {
    return jsonResponse({ error: "Apenas administradores podem gerenciar usuários." }, 403);
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
        id: user.id,
        email: user.email || "",
        nome: userProfile?.nome || "",
        perfil: userProfile?.perfil || "",
        setor: userProfile?.setor || "",
        created_at: user.created_at,
      };
    }).sort((a, b) => a.email.localeCompare(b.email));

    return jsonResponse({ users: result });
  }

  if (payload.action === "delete-user") {
    const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
      return jsonResponse({ error: "Identificador de conta inválido." }, 400);
    }
    if (userId === authData.user.id) {
      return jsonResponse({ error: "Não é permitido excluir a própria conta." }, 400);
    }

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("perfil")
      .eq("id", userId)
      .maybeSingle();
    if (targetProfileError) {
      console.error("Falha ao verificar perfil da conta:", targetProfileError);
      return jsonResponse({ error: "Não foi possível verificar a conta selecionada." }, 500);
    }
    if (targetProfile?.perfil === "ADMIN") {
      const { data: administrators, error: administratorsError } = await adminClient
        .from("profiles")
        .select("id")
        .eq("perfil", "ADMIN");
      if (administratorsError) {
        console.error("Falha ao verificar quantidade de administradores:", administratorsError);
        return jsonResponse({ error: "Não foi possível verificar os administradores." }, 500);
      }
      if ((administrators || []).length <= 1) {
        return jsonResponse({ error: "Não é possível excluir o último administrador do sistema." }, 409);
      }
    }

    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      console.error("Falha ao excluir conta Auth:", deleteUserError);
      return jsonResponse({ error: "Não foi possível excluir a conta selecionada." }, 500);
    }
    return jsonResponse({ success: true });
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
