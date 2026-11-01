-- Fase 01 · PR 1 · Schemas, helpers e auditoria imutável.
-- Spec: docs/specs/fase-01.md (RF-01.1, RF-01.2) · ADR-003

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
create schema if not exists core;   -- identidade e acesso
create schema if not exists pub;    -- dados públicos compartilhados (escrita só pelo worker)
create schema if not exists priv;   -- dados privados por empresa
create schema if not exists ops;    -- operação: fontes, execuções, jobs
create schema if not exists audit;  -- trilha de auditoria imutável

revoke all on schema core, pub, priv, ops, audit from public;
grant usage on schema core, pub, priv to authenticated;
grant usage on schema core, pub, priv, ops, audit to service_role;
grant usage on schema audit to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- UUID v7 (ordenável por tempo). Postgres 17 não tem uuidv7() nativo.
create function core.uuid_v7()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

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

grant execute on function core.uuid_v7() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------
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

revoke all on audit.audit_log from public, anon, authenticated, service_role;
grant select on audit.audit_log to authenticated, service_role;

-- IP do cliente, como INDÍCIO (não prova): headers do gateway primeiro; o 1º valor de
-- x-forwarded-for é controlado pelo cliente e só é usado na falta dos outros.
create function audit.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_raw text;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  v_raw := coalesce(
    v_headers ->> 'cf-connecting-ip',
    v_headers ->> 'x-real-ip',
    split_part(v_headers ->> 'x-forwarded-for', ',', 1)
  );
  if v_raw is null or trim(v_raw) = '' then
    return null;
  end if;
  return trim(v_raw)::inet;
exception when others then
  return null;
end;
$$;

create function audit.request_user_agent()
returns text
language sql
stable
set search_path = ''
as $$
  select left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'user-agent', 500);
$$;

-- Trigger genérico de auditoria.
--   TG_ARGV[0] = coluna que identifica a empresa (padrão: empresa_id; inexistente = sem empresa).
--   TG_ARGV[1] = colunas com dado pessoal, separadas por vírgula: o valor é substituído por
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
    auth.uid(),
    coalesce(auth.role(), session_user::text),
    case when v_row ->> v_empresa_col ~* '^[0-9a-f-]{36}$' then (v_row ->> v_empresa_col)::uuid end,
    tg_table_schema,
    tg_table_name,
    tg_op,
    case when v_row ->> 'id' ~* '^[0-9a-f-]{36}$' then (v_row ->> 'id')::uuid end,
    v_old,
    v_new,
    v_changed,
    audit.request_ip(),
    audit.request_user_agent()
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

revoke all on function audit.registrar() from public, anon, authenticated;
revoke all on function audit.bloquear_alteracao() from public, anon, authenticated;

-- down:
-- drop table audit.audit_log;
-- drop function audit.registrar(), audit.bloquear_alteracao(), audit.request_ip(), audit.request_user_agent();
-- drop function core.set_updated_at(), core.uuid_v7();
-- drop schema audit, ops, priv, pub, core;
