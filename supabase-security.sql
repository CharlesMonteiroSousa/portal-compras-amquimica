-- Run in the Supabase SQL Editor after creating the users in Authentication.
-- Then add one profile row per Auth user using that user's UUID.
-- Disable public sign-ups in Auth; provision accounts administratively with new passwords.
-- To find UUIDs for profile rows, run: select id, email from auth.users;
-- Example: insert into public.profiles (id, nome, perfil, setor)
--          values ('AUTH-USER-UUID', 'Nome', 'PF', 'Química');
-- Promote the first administrator only from the SQL Editor:
-- insert into public.profiles (id, nome, perfil, setor)
-- select id, 'Administrador', 'ADMIN', null from auth.users
-- where lower(email) = lower('admin@empresa.com')
-- on conflict (id) do update set perfil = 'ADMIN', setor = null;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  perfil text not null,
  setor text
);

alter table public.profiles drop constraint if exists profiles_perfil_check;
alter table public.profiles drop constraint if exists profiles_role_sector_check;
alter table public.profiles
  add constraint profiles_perfil_check check (perfil in ('ADMIN', 'MON', 'PF'));
alter table public.profiles
  add constraint profiles_role_sector_check check (
    (perfil in ('ADMIN', 'MON') and setor is null) or
    (perfil = 'PF' and setor in ('Embalagem', 'Química'))
  );

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select p
  from public.profiles as p
  where p.id = (select auth.uid())
  limit 1
$$;

revoke all on function public.current_profile() from public;
grant execute on function public.current_profile() to anon, authenticated;

alter table public.requisicoes enable row level security;
revoke all on public.requisicoes from anon, authenticated;
grant select on public.requisicoes to authenticated;
grant insert (
  codigo, solicitante, pontofocal, setor, numnf, destinacao,
  vencimento, urgencia, status, url_nf, cancelado
) on public.requisicoes to authenticated;
grant update (
  status, pedido_totvs, cancelado, motivo_exclusao,
  cancelado_por, data_cancelamento
) on public.requisicoes to authenticated;

drop policy if exists requisicoes_authenticated_read on public.requisicoes;
create policy requisicoes_authenticated_read
  on public.requisicoes as permissive for select to authenticated
  using (true);

drop policy if exists requisicoes_read_by_profile on public.requisicoes;
create policy requisicoes_read_by_profile
  on public.requisicoes as restrictive for select to authenticated
  using (
    (select (public.current_profile()).perfil) = 'MON'
    or setor = (select (public.current_profile()).setor)
  );

drop policy if exists requisicoes_authenticated_insert on public.requisicoes;
create policy requisicoes_authenticated_insert
  on public.requisicoes as permissive for insert to authenticated
  with check (true);

drop policy if exists requisicoes_insert_by_profile on public.requisicoes;
create policy requisicoes_insert_by_profile
  on public.requisicoes as restrictive for insert to authenticated
  with check (
    (select (public.current_profile()).perfil) = 'PF'
    and setor = (select (public.current_profile()).setor)
    and pontofocal = (select (public.current_profile()).nome)
    and status = 'Pendente'
    and coalesce(cancelado, false) = false
  );

drop policy if exists requisicoes_authenticated_update on public.requisicoes;
create policy requisicoes_authenticated_update
  on public.requisicoes as permissive for update to authenticated
  using (true)
  with check (true);

drop policy if exists requisicoes_update_by_profile on public.requisicoes;
create policy requisicoes_update_by_profile
  on public.requisicoes as restrictive for update to authenticated
  using (
    (select (public.current_profile()).perfil) = 'MON'
    or (
      (select (public.current_profile()).perfil) = 'PF'
      and setor = (select (public.current_profile()).setor)
      and status = 'Pendente'
      and coalesce(cancelado, false) = false
    )
  )
  with check (
    (select (public.current_profile()).perfil) = 'MON'
    or (
      (select (public.current_profile()).perfil) = 'PF'
      and setor = (select (public.current_profile()).setor)
      and cancelado = true
      and nullif(trim(motivo_exclusao), '') is not null
      and cancelado_por = (select (public.current_profile()).nome)
    )
  );

create or replace function public.guard_requisicoes_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  select * into v_profile from public.current_profile();
  if v_profile.id is null then
    raise exception 'Perfil de acesso não encontrado';
  end if;

  if v_profile.perfil = 'MON' then
    if (to_jsonb(new) - array[
         'status', 'pedido_totvs', 'cancelado', 'motivo_exclusao',
         'cancelado_por', 'data_cancelamento'
       ])
       is distinct from (to_jsonb(old) - array[
         'status', 'pedido_totvs', 'cancelado', 'motivo_exclusao',
         'cancelado_por', 'data_cancelamento'
       ]) then
      raise exception 'Compradores só podem atualizar status, pedido TOTVS ou cancelar requisições';
    end if;
    if (new.cancelado, new.motivo_exclusao, new.cancelado_por, new.data_cancelamento)
       is distinct from
       (old.cancelado, old.motivo_exclusao, old.cancelado_por, old.data_cancelamento) then
      if coalesce(old.cancelado, false)
         or new.cancelado is distinct from true
         or nullif(trim(new.motivo_exclusao), '') is null
         or new.cancelado_por is distinct from v_profile.nome
         or new.data_cancelamento is null then
        raise exception 'Dados de exclusão inválidos';
      end if;
      new.data_cancelamento := now();
    end if;
    if new.status not in ('Pendente', 'Bloqueado por alçada', 'Concluído') then
      raise exception 'Status inválido';
    end if;
    if coalesce(new.pedido_totvs, '') !~ '^[0-9]*$' then
      raise exception 'Número de pedido TOTVS inválido';
    end if;
    if new.status in ('Bloqueado por alçada', 'Concluído')
       and nullif(trim(new.pedido_totvs), '') is null then
      raise exception 'Informe o número do pedido TOTVS';
    end if;
    return new;
  end if;

  if v_profile.perfil = 'PF'
     and old.setor = v_profile.setor
     and old.status = 'Pendente'
     and coalesce(old.cancelado, false) = false
     and new.cancelado = true
     and nullif(trim(new.motivo_exclusao), '') is not null
     and new.cancelado_por = v_profile.nome
     and new.data_cancelamento is not null
     and (to_jsonb(new) - array['cancelado', 'motivo_exclusao', 'cancelado_por', 'data_cancelamento'])
         is not distinct from
         (to_jsonb(old) - array['cancelado', 'motivo_exclusao', 'cancelado_por', 'data_cancelamento']) then
    new.data_cancelamento := now();
    return new;
  end if;

  raise exception 'Operação não permitida para este perfil';
end;
$$;

drop trigger if exists guard_requisicoes_update on public.requisicoes;
create trigger guard_requisicoes_update
  before update on public.requisicoes
  for each row execute function public.guard_requisicoes_update();

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('notas-fiscais', 'notas-fiscais', false, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update
set public = false,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

drop policy if exists notas_fiscais_authenticated_read on storage.objects;
create policy notas_fiscais_authenticated_read
  on storage.objects as permissive for select to authenticated
  using (bucket_id = 'notas-fiscais');

drop policy if exists notas_fiscais_read_by_profile on storage.objects;
create policy notas_fiscais_read_by_profile
  on storage.objects as restrictive for select to public
  using (
    bucket_id <> 'notas-fiscais'
    or (
      auth.uid() is not null
      and (
        (select (public.current_profile()).perfil) = 'MON'
        or (
          (select (public.current_profile()).perfil) = 'PF'
          and (storage.foldername(name))[1] = case (select (public.current_profile()).setor)
            when 'Embalagem' then 'embalagem'
            when 'Química' then 'quimica'
            else ''
          end
        )
      )
    )
  );

drop policy if exists notas_fiscais_authenticated_insert on storage.objects;
create policy notas_fiscais_authenticated_insert
  on storage.objects as permissive for insert to authenticated
  with check (bucket_id = 'notas-fiscais');

drop policy if exists notas_fiscais_insert_by_profile on storage.objects;
create policy notas_fiscais_insert_by_profile
  on storage.objects as restrictive for insert to public
  with check (
    bucket_id <> 'notas-fiscais'
    or (
      auth.uid() is not null
      and (select (public.current_profile()).perfil) = 'PF'
      and (storage.foldername(name))[1] = case (select (public.current_profile()).setor)
        when 'Embalagem' then 'embalagem'
        when 'Química' then 'quimica'
        else ''
      end
    )
  );

drop policy if exists notas_fiscais_no_update on storage.objects;
create policy notas_fiscais_no_update
  on storage.objects as restrictive for update to public
  using (bucket_id <> 'notas-fiscais')
  with check (bucket_id <> 'notas-fiscais');

drop policy if exists notas_fiscais_no_delete on storage.objects;
create policy notas_fiscais_no_delete
  on storage.objects as restrictive for delete to public
  using (bucket_id <> 'notas-fiscais');
