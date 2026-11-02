-- Fase 01 · PR 2 · Exclusão definitiva com dupla aprovação.
-- Spec: docs/specs/fase-01.md (RF-01.9) · Prompt Mestre 1.3: "Excluir definitivamente só para
-- SUPERADMIN, com dupla aprovação e registro" e 1.4 (reautenticação).
--
-- Fluxo: SUPERADMIN 1 solicita (step-up) → SUPERADMIN 2, diferente, aprova (step-up) → a exclusão
-- é executada na aprovação. Pedido vale 72 h. Tudo auditado; o registro da aprovação nunca é apagado
-- (trigger ALWAYS bloqueia DELETE/TRUNCATE e só permite sair de 'pendente' uma vez).
-- Alvos permitidos ficam na função core.executar_exclusao (lista fechada, cresce por migration).

create table core.aprovacoes_exclusao (
  id              uuid primary key default core.uuid_v7(),
  alvo_tabela     text not null check (alvo_tabela in ('core.empresas')),
  alvo_id         uuid not null,
  motivo          text not null check (char_length(motivo) between 10 and 2000),
  status          text not null default 'pendente'
                  check (status in ('pendente', 'executada', 'rejeitada', 'expirada')),
  solicitado_por  uuid not null references core.usuarios (id),
  solicitado_em   timestamptz not null default now(),
  expira_em       timestamptz not null default now() + interval '72 hours',
  decidido_por    uuid references core.usuarios (id),
  decidido_em     timestamptz,
  resumo_alvo     jsonb,
  check (decidido_por is null or decidido_por <> solicitado_por)
);

create unique index aprovacoes_exclusao_pendente_uk
  on core.aprovacoes_exclusao (alvo_tabela, alvo_id) where status = 'pendente';

alter table core.aprovacoes_exclusao enable row level security;

create policy aprovacoes_exclusao_select on core.aprovacoes_exclusao for select to authenticated
  using ((select core.is_superadmin()));

revoke all on core.aprovacoes_exclusao from public, anon, authenticated, service_role;
grant select on core.aprovacoes_exclusao to authenticated, service_role;

-- Exclusão de empresa só pelo fluxo de dupla aprovação, nem o worker (service role) apaga direto.
revoke delete, truncate on core.empresas from service_role;

create function core.proteger_aprovacao_exclusao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'registro de aprovação de exclusão não pode ser apagado' using errcode = 'insufficient_privilege';
  end if;
  if old.status <> 'pendente'
     or new.status = 'pendente'
     or (to_jsonb(new) - array['status', 'decidido_por', 'decidido_em'])
        is distinct from (to_jsonb(old) - array['status', 'decidido_por', 'decidido_em']) then
    raise exception 'registro de aprovação só muda uma vez, de pendente para decidido' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger aprovacoes_exclusao_protecao before update or delete on core.aprovacoes_exclusao
  for each row execute function core.proteger_aprovacao_exclusao();
create trigger aprovacoes_exclusao_sem_truncate before truncate on core.aprovacoes_exclusao
  for each statement execute function core.proteger_aprovacao_exclusao();
alter table core.aprovacoes_exclusao enable always trigger aprovacoes_exclusao_protecao;
alter table core.aprovacoes_exclusao enable always trigger aprovacoes_exclusao_sem_truncate;

create trigger aprovacoes_exclusao_audit after insert or update or delete on core.aprovacoes_exclusao
  for each row execute function audit.registrar('-');
alter table core.aprovacoes_exclusao enable always trigger aprovacoes_exclusao_audit;

-- Executa a exclusão física do alvo. Só chamada por core.decidir_exclusao.
create function core.executar_exclusao(p_tabela text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tabela = 'core.empresas' then
    -- Dependentes de core primeiro; dados de priv (Fase 02+) entram aqui por migration.
    delete from core.permissoes where empresa_id = p_id;
    delete from core.vinculos where empresa_id = p_id;
    delete from core.empresas where id = p_id;
    if not found then
      raise exception 'alvo % % não encontrado', p_tabela, p_id using errcode = 'no_data_found';
    end if;
  else
    raise exception 'tabela % não admite exclusão definitiva', p_tabela using errcode = 'insufficient_privilege';
  end if;
end;
$$;

create function core.solicitar_exclusao(p_tabela text, p_id uuid, p_motivo text, p_step_up uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_resumo jsonb;
begin
  if not core.is_superadmin() then
    raise exception 'só SUPERADMIN solicita exclusão definitiva' using errcode = 'insufficient_privilege';
  end if;
  if p_tabela <> all (array['core.empresas']) then
    raise exception 'tabela % não admite exclusão definitiva', p_tabela using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'exclusao_definitiva', null, 'solicitar_exclusao:' || p_tabela || ':' || p_id);

  if p_tabela = 'core.empresas' then
    select jsonb_build_object('razao_social', e.razao_social, 'cnpj', e.cnpj)
      into v_resumo from core.empresas e where e.id = p_id;
  end if;
  if v_resumo is null then
    raise exception 'alvo % % não encontrado', p_tabela, p_id using errcode = 'no_data_found';
  end if;

  update core.aprovacoes_exclusao set status = 'expirada', decidido_em = now()
   where alvo_tabela = p_tabela and alvo_id = p_id and status = 'pendente' and expira_em <= now();

  insert into core.aprovacoes_exclusao (alvo_tabela, alvo_id, motivo, solicitado_por, resumo_alvo)
  values (p_tabela, p_id, p_motivo, auth.uid(), v_resumo)
  returning id into v_id;
  return v_id;
end;
$$;

-- Segundo SUPERADMIN aprova (executa) ou rejeita.
create function core.decidir_exclusao(p_aprovacao uuid, p_aprovar boolean, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ap core.aprovacoes_exclusao;
begin
  if not core.is_superadmin() then
    raise exception 'só SUPERADMIN decide exclusão definitiva' using errcode = 'insufficient_privilege';
  end if;
  if p_aprovar is null then
    raise exception 'informe aprovar (true) ou rejeitar (false)' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_ap from core.aprovacoes_exclusao where id = p_aprovacao for update;
  if v_ap.id is null or v_ap.status <> 'pendente' then
    raise exception 'pedido de exclusão inexistente ou já decidido' using errcode = 'no_data_found';
  end if;
  if v_ap.solicitado_por = auth.uid() then
    raise exception 'quem solicitou não pode aprovar a própria exclusão (dupla aprovação)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_ap.expira_em <= now() then
    raise exception 'pedido de exclusão expirado' using errcode = 'insufficient_privilege';
  end if;
  -- Pedido de conta que perdeu o SUPERADMIN (ou foi desativada) não pode mais ser aprovado.
  if p_aprovar and not exists (
    select 1 from core.usuarios u
     where u.id = v_ap.solicitado_por and u.superadmin and u.ativo and u.deleted_at is null
  ) then
    raise exception 'solicitante não é mais SUPERADMIN ativo; rejeite o pedido' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'exclusao_definitiva', null, 'decidir_exclusao:' || p_aprovacao);

  if p_aprovar then
    perform core.executar_exclusao(v_ap.alvo_tabela, v_ap.alvo_id);
  end if;

  update core.aprovacoes_exclusao
     set status = case when p_aprovar then 'executada' else 'rejeitada' end,
         decidido_por = auth.uid(),
         decidido_em = now()
   where id = p_aprovacao;
end;
$$;

revoke all on function core.proteger_aprovacao_exclusao() from public, anon, authenticated;
revoke all on function core.executar_exclusao(text, uuid),
  core.solicitar_exclusao(text, uuid, text, uuid),
  core.decidir_exclusao(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function core.solicitar_exclusao(text, uuid, text, uuid),
  core.decidir_exclusao(uuid, boolean, uuid) to authenticated;

-- down:
-- drop function core.decidir_exclusao(uuid, boolean, uuid), core.solicitar_exclusao(text, uuid, text, uuid),
--   core.executar_exclusao(text, uuid);
-- drop table core.aprovacoes_exclusao;
-- drop function core.proteger_aprovacao_exclusao();
-- grant delete, truncate on core.empresas to service_role;
