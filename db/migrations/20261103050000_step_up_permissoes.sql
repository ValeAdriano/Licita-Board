-- Fase 01 · PR 5 · Step-up e alteração de vínculos/permissões só por função (port de
-- supabase/migrations/20261101130000 e do teto de concessão de 20261101160000, no estado final).
-- Spec: docs/specs/fase-01.md §6 (regras 9 e 10) · Prompt 1.4 "Operações críticas" · ADR-012/013
--
-- Fluxo do step-up (revisão 2): a API pede um TOTP novo (core.verificar_totp, que grava mfa_em e
-- mfa_metodo = 'totp' na sessão) e logo chama core.iniciar_step_up(escopo). Exige: sessão viva em aal2,
-- última verificação por TOTP (código de recuperação não serve) há no máximo 2 min, fator verificado há
-- pelo menos 24 h (sessão roubada que cadastra fator novo não faz operação crítica). Cada verificação
-- MFA gera UM token (unique sessao_id + mfa_em), válido por 5 min, uso único, preso à sessão viva.
-- Teto de concessão (T2.4): só se concede o que o autor tem; ninguém amplia o próprio vínculo.
-- SUPERADMIN fica fora do teto. Toda empresa mantém ao menos um administrador de permissões.

-- migrate:up
create table core.step_up_tokens (
  id                     uuid primary key default core.uuid_v7(),
  usuario_id             uuid not null references core.usuarios (id),
  escopo                 text not null check (escopo in (
    'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca'
  )),
  sessao_id              uuid not null references core.sessoes (id) on delete restrict,  -- registro de uso fica
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
-- Sem policy e sem grant: tokens só são lidos/escritos pelas funções.

create trigger step_up_tokens_audit after insert or update on core.step_up_tokens
  for each row execute function audit.registrar('usado_para_empresa_id');
alter table core.step_up_tokens enable always trigger step_up_tokens_audit;

create function core.iniciar_step_up(p_escopo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_s record;
begin
  select s.id, s.usuario_id, s.aal, s.mfa_em, s.mfa_metodo into v_s
    from core.sessoes s where s.id = core.sessao_atual();
  if v_s.id is null or v_s.aal <> 'aal2' then
    raise exception 'step-up exige sessão com MFA (aal2)' using errcode = 'insufficient_privilege';
  end if;
  if v_s.mfa_metodo is distinct from 'totp' or v_s.mfa_em < now() - interval '2 minutes'
     or v_s.mfa_em > now() + interval '30 seconds' then
    raise exception 'step-up exige verificação por TOTP nos últimos 2 minutos' using errcode = 'insufficient_privilege';
  end if;
  if not exists (
    select 1 from core.fatores_mfa f
     where f.usuario_id = v_s.usuario_id and f.verificado_em is not null
       and f.verificado_em <= now() - interval '24 hours'
  ) then
    raise exception 'fator MFA cadastrado há menos de 24 h não autoriza operação crítica'
      using errcode = 'insufficient_privilege';
  end if;

  insert into core.step_up_tokens (usuario_id, escopo, sessao_id, mfa_em, expira_em)
  values (v_s.usuario_id, p_escopo, v_s.id, v_s.mfa_em, now() + interval '5 minutes')
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'esta verificação MFA já foi usada; verifique de novo' using errcode = 'insufficient_privilege';
end;
$$;

-- Valida e consome o token (uso único). Interna: chamada só de dentro de outras funções.
create function core.consumir_step_up(p_token uuid, p_escopo text, p_empresa uuid, p_alvo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update core.step_up_tokens t
     set usado_em = now(), usado_para_empresa_id = p_empresa, usado_para_alvo = left(p_alvo, 200)
   where t.id = p_token
     and t.usuario_id = core.usuario_atual()
     and t.sessao_id = core.sessao_atual()
     and t.escopo = p_escopo
     and t.usado_em is null
     and t.expira_em > now();
  if not found then
    raise exception 'reautenticação (step-up) inválida, expirada ou já usada para %', p_escopo
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Toda empresa mantém ao menos um administrador de permissões ativo (sem lockout). Chamada depois da
-- alteração, com os vínculos da empresa travados antes dela.
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
    raise exception 'a empresa ficaria sem nenhum administrador de permissões' using errcode = 'check_violation';
  end if;
end;
$$;

-- Lista 'modulo:acao' válida para o papel (CLIENTE só visualiza).
create function core.validar_permissoes(p_papel text, p_permissoes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item text;
  v_acoes constant text[] := array[
    'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
    'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar', 'administrar_permissoes'
  ];
begin
  if p_permissoes is null then
    raise exception 'lista de permissões obrigatória' using errcode = 'invalid_parameter_value';
  end if;
  foreach v_item in array p_permissoes loop
    if v_item !~ '^[a-z_]+:[a-z_]+$'
       or not exists (select 1 from core.modulos m where m.slug = split_part(v_item, ':', 1))
       or split_part(v_item, ':', 2) <> all (v_acoes) then
      raise exception 'permissão inválida: %', v_item using errcode = 'invalid_parameter_value';
    end if;
    if p_papel = 'CLIENTE' and split_part(v_item, ':', 2) <> 'visualizar' then
      raise exception 'papel CLIENTE só pode ter a ação visualizar (recebido: %)', v_item using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- Teto de concessão (T2.4). p_vinculo null = convite (vínculo novo).
create function core.validar_teto_concessao(p_empresa uuid, p_vinculo uuid, p_permissoes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_novas text[];
begin
  if core.is_superadmin() then
    return;
  end if;
  select coalesce(array_agg(x), '{}') into v_novas
    from unnest(p_permissoes) x
   where p_vinculo is null or not exists (
     select 1 from core.permissoes p where p.vinculo_id = p_vinculo and p.modulo || ':' || p.acao = x
   );
  if cardinality(v_novas) = 0 then
    return;
  end if;
  if exists (select 1 from core.vinculos v where v.id = p_vinculo and v.usuario_id = core.usuario_atual()) then
    raise exception 'ninguém amplia as próprias permissões; peça a outro administrador'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from unnest(v_novas) x
     where not core.has_permission(p_empresa, split_part(x, ':', 1), split_part(x, ':', 2))
  ) then
    raise exception 'só é possível conceder permissões que você mesmo tem nesta empresa'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Vínculo novo direto: só SUPERADMIN (o caminho normal é o convite com aceite).
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
  values (p_usuario, p_empresa, p_papel, core.usuario_atual())
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
  select v.empresa_id into v_empresa from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_papel is null and p_ativo is null then
    raise exception 'nada a alterar' using errcode = 'invalid_parameter_value';
  end if;
  -- Reativar devolve as permissões do vínculo: vale o teto sobre o conjunto inteiro (T2.4).
  if p_ativo and exists (select 1 from core.vinculos v where v.id = p_vinculo and not v.ativo) then
    perform core.validar_teto_concessao(v_empresa, null, array(
      select p.modulo || ':' || p.acao from core.permissoes p where p.vinculo_id = p_vinculo));
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'atualizar_vinculo:' || p_vinculo);
  perform 1 from core.vinculos where empresa_id = v_empresa for update;
  update core.vinculos set papel = coalesce(p_papel, papel), ativo = coalesce(p_ativo, ativo)
   where id = p_vinculo;
  perform core.garantir_admin(v_empresa);
end;
$$;

-- Substitui o conjunto de permissões do vínculo ('modulo:acao'), respeitando o teto.
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
  select v.empresa_id into v_empresa from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_permissoes is null then
    raise exception 'lista de permissões obrigatória (use array vazio para remover todas)'
      using errcode = 'invalid_parameter_value';
  end if;
  perform core.validar_teto_concessao(v_empresa, p_vinculo, p_permissoes);
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'definir_permissoes:' || p_vinculo);
  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo and (p.modulo || ':' || p.acao) <> all (p_permissoes);
  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), core.usuario_atual()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);
end;
$$;

grant execute on function core.iniciar_step_up(text), core.criar_vinculo(uuid, uuid, text, uuid),
  core.atualizar_vinculo(uuid, text, boolean, uuid), core.definir_permissoes(uuid, text[], uuid) to vv_api;

-- migrate:down
drop function core.definir_permissoes(uuid, text[], uuid), core.atualizar_vinculo(uuid, text, boolean, uuid),
  core.criar_vinculo(uuid, uuid, text, uuid), core.validar_teto_concessao(uuid, uuid, text[]),
  core.validar_permissoes(text, text[]), core.garantir_admin(uuid),
  core.consumir_step_up(uuid, text, uuid, text), core.iniciar_step_up(text);
drop table core.step_up_tokens;
