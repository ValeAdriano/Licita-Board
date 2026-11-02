-- Fase 01 · PR 3 · Sessões ativas do próprio usuário (Prompt 1.1 "gerenciamento de sessões").
-- O supabase-js não lista sessões; esta RPC lê auth.sessions só do usuário do JWT.
-- Encerrar sessões continua sendo pelo Auth (signOut scope 'others' / 'global').

-- SUPERADMIN ou qualquer vínculo ativo que não seja CLIENTE: perfil que exige MFA (Prompt 1.4).
create function core.perfil_interno()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from core.usuarios u where u.id = auth.uid() and u.superadmin
  ) or exists (
    select 1 from core.vinculos v
     where v.usuario_id = auth.uid() and v.ativo and v.deleted_at is null and v.papel <> 'CLIENTE'
  );
$$;

revoke all on function core.perfil_interno() from public, anon;
grant execute on function core.perfil_interno() to authenticated;

create function core.minhas_sessoes()
returns table (
  id uuid,
  criada_em timestamptz,
  atualizada_em timestamptz,
  dispositivo text,
  ip text,
  nivel text,
  atual boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id,
         s.created_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at),
         left(s.user_agent, 200),
         host(s.ip),
         s.aal::text,
         s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
    from auth.sessions s
   where s.user_id = auth.uid()
     and (s.not_after is null or s.not_after > now())
     -- IP e dispositivo são dados pessoais: perfil interno só vê com MFA (mesma regra do RLS).
     and (core.mfa_ok() or not core.perfil_interno())
   order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc;
$$;

revoke all on function core.minhas_sessoes() from public, anon;
grant execute on function core.minhas_sessoes() to authenticated;

-- down:
-- drop function core.minhas_sessoes(), core.perfil_interno();
