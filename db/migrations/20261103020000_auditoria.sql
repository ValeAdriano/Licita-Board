-- Fase 01 · PR 1 · Auditoria imutável e helpers (port de supabase/migrations/20261101120000).
-- Spec: docs/specs/fase-01.md (RF-01.1, RF-01.2) · ADR-013
--
-- Mudanças frente à revisão 1:
-- * Autor = core.usuario_atual() (contexto da transação), papel = session_user (vv_api/vv_worker).
-- * IP e user-agent não vêm mais de headers do PostgREST: a API os informa por
--   core.definir_requisicao() na mesma transação, a partir do X-Forwarded-For que só o Caddy local
--   escreve. Continuam sendo indício, não prova. Ficam presos à transação como o resto do contexto
--   (marca app.req_tx): valor de sessão ou requisição sem definir_requisicao grava nulo.
-- * Grants para vv_api/vv_worker no lugar de authenticated/service_role.

-- migrate:up
create function core.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function core.definir_requisicao(p_ip inet, p_user_agent text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('app.ip', coalesce(p_ip::text, ''), true),
          set_config('app.user_agent', left(coalesce(p_user_agent, ''), 500), true),
          set_config('app.req_tx', extract(epoch from now())::text, true);
end;
$$;

create function core.ip_atual()
returns inet
language sql
stable
set search_path = ''
as $$
  select case when core.contexto_valido()
               and current_setting('app.req_tx', true) = extract(epoch from now())::text
              then nullif(current_setting('app.ip', true), '')::inet end
$$;

create function core.user_agent_atual()
returns text
language sql
stable
set search_path = ''
as $$
  select case when core.contexto_valido()
               and current_setting('app.req_tx', true) = extract(epoch from now())::text
              then nullif(current_setting('app.user_agent', true), '') end
$$;

grant execute on function core.ip_atual(), core.user_agent_atual() to vv_api, vv_worker;
grant execute on function core.definir_requisicao(inet, text) to vv_api;

create table audit.audit_log (
  id             uuid primary key default core.uuid_v7(),
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,
  actor_role     text,
  empresa_id     uuid,
  schema_name    text not null,
  table_name     text not null,
  operation      text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  record_id      uuid,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  ip             inet,
  user_agent     text
);

create index audit_log_empresa_idx on audit.audit_log (empresa_id, occurred_at desc);
create index audit_log_registro_idx on audit.audit_log (schema_name, table_name, record_id);
create index audit_log_actor_idx on audit.audit_log (actor_id, occurred_at desc);

alter table audit.audit_log enable row level security;
grant select on audit.audit_log to vv_api, vv_worker;

-- Trigger genérico de auditoria.
--   TG_ARGV[0] = coluna que identifica a empresa (padrão: empresa_id; inexistente = sem empresa).
--   TG_ARGV[1] = colunas com dado pessoal ou segredo, separadas por vírgula: o valor vira
--                '[redigido]' em old_data/new_data (LGPD: o log é imutável, então PII não entra).
create function audit.registrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changed text[];
  v_col text;
  v_empresa_col text := coalesce(tg_argv[0], 'empresa_id');
  v_redigir text[] := string_to_array(coalesce(tg_argv[1], ''), ',');
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_changed
      from jsonb_each(v_new) n
     where n.value is distinct from v_old -> n.key
       and n.key <> 'updated_at';
    if v_changed is null then
      return new;  -- só updated_at mudou: nada a auditar
    end if;
  end if;

  v_row := coalesce(v_new, v_old);

  foreach v_col in array v_redigir loop
    v_col := trim(v_col);
    continue when v_col = '';
    if v_old ? v_col and v_old -> v_col <> 'null'::jsonb then
      v_old := jsonb_set(v_old, array[v_col], '"[redigido]"');
    end if;
    if v_new ? v_col and v_new -> v_col <> 'null'::jsonb then
      v_new := jsonb_set(v_new, array[v_col], '"[redigido]"');
    end if;
  end loop;

  insert into audit.audit_log (
    actor_id, actor_role, empresa_id, schema_name, table_name, operation,
    record_id, old_data, new_data, changed_fields, ip, user_agent
  ) values (
    core.usuario_atual(),
    session_user::text,
    case when v_row ->> v_empresa_col ~* '^[0-9a-f-]{36}$' then (v_row ->> v_empresa_col)::uuid end,
    tg_table_schema,
    tg_table_name,
    tg_op,
    case when v_row ->> 'id' ~* '^[0-9a-f-]{36}$' then (v_row ->> 'id')::uuid end,
    v_old,
    v_new,
    v_changed,
    core.ip_atual(),
    core.user_agent_atual()
  );

  return coalesce(new, old);
end;
$$;

-- Imutabilidade: nem o dono da tabela altera ou apaga registros de auditoria.
create function audit.bloquear_alteracao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit.audit_log é somente inserção (operação % bloqueada)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_imutavel
  before update or delete on audit.audit_log
  for each row execute function audit.bloquear_alteracao();

create trigger audit_log_sem_truncate
  before truncate on audit.audit_log
  for each statement execute function audit.bloquear_alteracao();

-- ALWAYS: continua valendo com session_replication_role = replica. Risco residual: o dono da
-- tabela ainda pode dar DROP TRIGGER (só via migration, que passa por revisão).
alter table audit.audit_log enable always trigger audit_log_imutavel;
alter table audit.audit_log enable always trigger audit_log_sem_truncate;

-- migrate:down
-- O down apaga a trilha de auditoria: só faz sentido em banco de desenvolvimento/CI.
drop table audit.audit_log;
drop function audit.registrar(), audit.bloquear_alteracao();
drop function core.user_agent_atual(), core.ip_atual(), core.definir_requisicao(inet, text),
  core.set_updated_at();
