-- Fase 01 · PR 2 · Step-up MFA e alteração de permissões só por RPC.
-- Spec: docs/specs/fase-01.md (RF-01.8) · Prompt Mestre 1.4 "Operações críticas" · ADR-002
--
-- Fluxo do step-up:
--   1. Front pede novo desafio MFA (supabase.auth.mfa.challengeAndVerify): o JWT novo traz
--      amr = [{"method": "totp", "timestamp": <agora>}] e session_id.
--   2. Front chama core.iniciar_step_up(escopo). Exige: verificação TOTP há no máximo 2 min,
--      sessão viva em auth.sessions, e o fator verificado cadastrado há pelo menos 24 h
--      (uma sessão roubada pode cadastrar fator novo; esse fator não serve para step-up).
--      Cada verificação MFA gera UM token (unique sessao_id + mfa_em), válido por 5 min.
--   3. A RPC crítica chama core.consumir_step_up(token, escopo, empresa, alvo): uso único,
--      mesma sessão (ainda viva), registra para qual empresa/alvo o token foi usado.
-- Só o método TOTP é aceito. WebAuthn/telefone, se habilitados, falham fechado até nova migration.

-- ---------------------------------------------------------------------------
-- Tokens
-- ---------------------------------------------------------------------------
create table core.step_up_tokens (
  id                     uuid primary key default core.uuid_v7(),
  usuario_id             uuid not null references core.usuarios (id),
  escopo                 text not null check (escopo in (
    'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final',
    'aprovar_peca'
  )),
  sessao_id              uuid not null,
  mfa_em                 timestamptz not null,
  created_at             timestamptz not null default now(),
  expira_em              timestamptz not null,
  usado_em               timestamptz,
  usado_para_empresa_id  uuid,
  usado_para_alvo        text,
  unique (sessao_id, mfa_em)  -- uma verificação MFA = um token
);

create index step_up_tokens_usuario_idx on core.step_up_tokens (usuario_id, created_at desc);

alter table core.step_up_tokens enable row level security;
-- Sem policy e sem grant para authenticated: tokens só são lidos/escritos pelas funções.
revoke all on core.step_up_tokens from public, anon, authenticated;
grant all on core.step_up_tokens to service_role;

create trigger step_up_tokens_audit after insert or update on core.step_up_tokens
  for each row execute function audit.registrar('usado_para_empresa_id');
alter table core.step_up_tokens enable always trigger step_up_tokens_audit;

-- Instante da última verificação TOTP desta sessão (claim amr), ou null.
create function core.ultima_verificacao_mfa()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select to_timestamp(max((a ->> 'timestamp')::numeric))
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
   where a ->> 'method' = 'totp';
$$;

-- Sessão do JWT ainda existe e não expirou (logout global apaga as sessões).
create function core.sessao_viva(p_sessao uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.sessions s
     where s.id = p_sessao
       and s.user_id = auth.uid()
       and (s.not_after is null or s.not_after > now())
  );
$$;

create function core.iniciar_step_up(p_escopo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_mfa timestamptz := core.ultima_verificacao_mfa();
  v_sessao uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or not core.mfa_ok() or v_sessao is null then
    raise exception 'step-up exige sessão com MFA (aal2)' using errcode = 'insufficient_privilege';
  end if;
  if v_mfa is null or v_mfa < now() - interval '2 minutes' or v_mfa > now() + interval '30 seconds' then
    raise exception 'step-up exige verificação MFA nos últimos 2 minutos' using errcode = 'insufficient_privilege';
  end if;
  if not core.sessao_viva(v_sessao) then
    raise exception 'sessão encerrada' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1
      from auth.sessions s
      join auth.mfa_factors f on f.id = s.factor_id
     where s.id = v_sessao
       and f.user_id = auth.uid()
       and f.status = 'verified'
       and f.created_at <= now() - interval '24 hours'
  ) then
    raise exception 'fator MFA cadastrado há menos de 24 h não autoriza operação crítica'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.step_up_tokens (usuario_id, escopo, sessao_id, mfa_em, expira_em)
  values (auth.uid(), p_escopo, v_sessao, v_mfa, now() + interval '5 minutes')
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'esta verificação MFA já foi usada; verifique de novo' using errcode = 'insufficient_privilege';
end;
$$;

-- Valida e consome o token (uso único). Chamada só de dentro de outras funções.
create function core.consumir_step_up(p_token uuid, p_escopo text, p_empresa uuid, p_alvo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  update core.step_up_tokens t
     set usado_em = now(),
         usado_para_empresa_id = p_empresa,
         usado_para_alvo = left(p_alvo, 200)
   where t.id = p_token
     and t.usuario_id = auth.uid()
     and t.escopo = p_escopo
     and t.usado_em is null
     and t.expira_em > now()
     and t.sessao_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
     and core.sessao_viva(t.sessao_id)
  returning true into v_ok;

  if v_ok is null then
    raise exception 'reautenticação (step-up) inválida, expirada ou já usada para %', p_escopo
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function core.ultima_verificacao_mfa(), core.sessao_viva(uuid), core.iniciar_step_up(text),
  core.consumir_step_up(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function core.iniciar_step_up(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Alteração de vínculos e permissões: só por RPC com step-up (Prompt 1.4)
-- ---------------------------------------------------------------------------
drop policy vinculos_insert on core.vinculos;
drop policy vinculos_update on core.vinculos;
drop policy permissoes_insert on core.permissoes;
drop policy permissoes_delete on core.permissoes;

revoke insert, update on core.vinculos from authenticated;
revoke insert, delete on core.permissoes from authenticated;

-- Toda empresa mantém ao menos um administrador de permissões ativo (evita lockout).
-- Chamada depois da alteração, com os vínculos da empresa travados (for update) antes dela.
create function core.garantir_admin(p_empresa uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from core.vinculos v
      join core.usuarios u on u.id = v.usuario_id
      join core.permissoes p on p.vinculo_id = v.id
     where v.empresa_id = p_empresa
       and v.ativo and v.deleted_at is null
       and u.ativo and u.deleted_at is null
       and v.papel <> 'CLIENTE'
       and p.modulo = 'permissoes' and p.acao = 'administrar_permissoes'
  ) then
    raise exception 'a empresa ficaria sem nenhum administrador de permissões'
      using errcode = 'check_violation';
  end if;
end;
$$;

-- Vínculo novo: só SUPERADMIN até existir o fluxo de convite com aceite.
create function core.criar_vinculo(p_usuario uuid, p_empresa uuid, p_papel text, p_step_up uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.is_superadmin() then
    raise exception 'só SUPERADMIN cria vínculos' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', p_empresa, 'criar_vinculo:' || p_usuario);

  insert into core.vinculos (usuario_id, empresa_id, papel, created_by)
  values (p_usuario, p_empresa, p_papel, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create function core.atualizar_vinculo(p_vinculo uuid, p_papel text, p_ativo boolean, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa
    from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_papel is null and p_ativo is null then
    raise exception 'nada a alterar' using errcode = 'invalid_parameter_value';
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'atualizar_vinculo:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;
  update core.vinculos
     set papel = coalesce(p_papel, papel),
         ativo = coalesce(p_ativo, ativo)
   where id = p_vinculo;
  perform core.garantir_admin(v_empresa);
end;
$$;

-- Substitui o conjunto de permissões do vínculo. p_permissoes no formato 'modulo:acao'.
create function core.definir_permissoes(p_vinculo uuid, p_permissoes text[], p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa
    from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_permissoes is null then
    raise exception 'lista de permissões obrigatória (use array vazio para remover todas)'
      using errcode = 'invalid_parameter_value';
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'definir_permissoes:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo
     and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), auth.uid()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);
end;
$$;

revoke all on function core.garantir_admin(uuid) from public, anon, authenticated;
revoke all on function core.criar_vinculo(uuid, uuid, text, uuid),
  core.atualizar_vinculo(uuid, text, boolean, uuid),
  core.definir_permissoes(uuid, text[], uuid) from public, anon;
grant execute on function core.criar_vinculo(uuid, uuid, text, uuid),
  core.atualizar_vinculo(uuid, text, boolean, uuid),
  core.definir_permissoes(uuid, text[], uuid) to authenticated;

-- down:
-- drop function core.definir_permissoes(uuid, text[], uuid), core.atualizar_vinculo(uuid, text, boolean, uuid),
--   core.criar_vinculo(uuid, uuid, text, uuid), core.garantir_admin(uuid),
--   core.consumir_step_up(uuid, text, uuid, text), core.iniciar_step_up(text), core.sessao_viva(uuid),
--   core.ultima_verificacao_mfa();
-- drop table core.step_up_tokens;
-- grant insert (usuario_id, empresa_id, papel), update (papel, ativo) on core.vinculos to authenticated;
-- grant insert (vinculo_id, empresa_id, modulo, acao), delete on core.permissoes to authenticated;
-- create policy vinculos_insert on core.vinculos for insert to authenticated with check ((select core.is_superadmin()));
-- create policy vinculos_update on core.vinculos for update to authenticated
--   using (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'))
--   with check (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));
-- create policy permissoes_insert on core.permissoes for insert to authenticated
--   with check (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));
-- create policy permissoes_delete on core.permissoes for delete to authenticated
--   using (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));
