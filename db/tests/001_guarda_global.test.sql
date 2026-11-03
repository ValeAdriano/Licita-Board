-- Guarda global (ADR-013, negar por padrão). Vale para toda migration futura.
-- "App" = schemas core, pub, priv, ops, audit. "Papéis" = vv_api e vv_worker.
begin;
create schema if not exists tap;
create extension if not exists pgtap with schema tap;
set local search_path = tap;
select plan(18);

-- Relações -------------------------------------------------------------------------------------

select is_empty($$
  select n.nspname || '.' || c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname in ('core', 'pub', 'priv', 'ops', 'audit')
    and not c.relrowsecurity
$$, 'toda tabela dos schemas da aplicação tem RLS ligado');

-- Em qualquer schema: relação acessível pelos papéis é tabela com RLS ou view security_invoker.
select is_empty($$
  select distinct n.nspname || '.' || c.relname || ' (' || c.relkind::text || ')'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace,
       aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('vv_api', 'vv_worker')))
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema', 'tap')
    and n.nspname !~ '^pg_(temp|toast)'
    and not (c.relkind in ('r', 'p') and c.relrowsecurity)
    and not (c.relkind = 'v' and 'security_invoker=true' = any (coalesce(c.reloptions, '{}')))
$$, 'relação acessível por vv_api/vv_worker/PUBLIC é tabela com RLS ou view security_invoker');

select is_empty($$
  select n.nspname || '.' || c.relname || ' ' || a.privilege_type
  from pg_class c join pg_namespace n on n.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where a.grantee in (select oid from pg_roles where rolname in ('vv_api', 'vv_worker'))
    and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')
$$, 'vv_api/vv_worker sem TRUNCATE, TRIGGER ou REFERENCES (ignoram a RLS)');

select is_empty($$
  select n.nspname || '.' || c.relname || coalesce('.' || at.attname, '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_attribute at on at.attrelid = c.oid and at.attacl is not null
  where n.nspname in ('core', 'pub', 'priv', 'ops', 'audit')
    and (exists (select 1 from aclexplode(c.relacl) a where a.grantee = 0)
      or exists (select 1 from aclexplode(at.attacl) a where a.grantee = 0))
$$, 'PUBLIC sem grant em tabela, coluna ou sequence dos schemas da aplicação');

select is_empty($$
  select c.relname || ' ' || a.privilege_type || ' -> ' || a.grantee::regrole
  from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
  where n.nspname = 'audit' and a.grantee <> c.relowner
    and a.privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')
$$, 'ninguém além do dono altera ou apaga audit');

-- Policies -------------------------------------------------------------------------------------

select is_empty($$
  select schemaname || '.' || tablename || ' -> ' || policyname
  from pg_policies
  where schemaname in ('core', 'pub', 'priv', 'ops', 'audit') and 'public' = any (roles)
$$, 'nenhuma policy vale para PUBLIC (policy sem TO)');

select is_empty($$
  select tablename || ' -> ' || policyname
  from pg_policies
  where schemaname = 'priv'
    and (cmd = 'ALL' or roles <> '{vv_api}'
      or coalesce(qual, '') || coalesce(with_check, '') not like '%has_permission(%'
      or (cmd in ('INSERT', 'UPDATE') and with_check is null))
$$, 'policy de priv: por operação, só vv_api, via has_permission, insert/update com with check');

select is_empty($$
  select schemaname || '.' || tablename || ' -> ' || policyname
  from pg_policies
  where coalesce(qual, '') || coalesce(with_check, '') ilike '%current_setting%'
$$, 'policy lê o contexto só por core.usuario_atual/aal_atual, nunca current_setting');

-- Funções --------------------------------------------------------------------------------------

select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('core', 'pub', 'priv', 'ops', 'audit')
    and has_function_privilege('public', p.oid, 'execute')
$$, 'nenhuma função dos schemas da aplicação é executável por PUBLIC');

select is_empty($$
  select n.nspname || '.' || p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema', 'tap')
    and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))
$$, 'toda função security definer fixa search_path vazio');

select is_empty($$
  select p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('core', 'pub', 'priv', 'ops', 'audit')
    and p.prosrc ~ 'app\.(usuario_id|sessao_id|aal|tx|req_tx|ip|user_agent)'
    and p.oid::regprocedure::text not in ('core.contexto_valido()', 'core.usuario_atual()',
      'core.sessao_atual()', 'core.aal_atual()', 'core.definir_contexto(uuid,uuid,text)',
      'core.definir_requisicao(inet,text)', 'core.ip_atual()', 'core.user_agent_atual()')
$$, 'só as funções de contexto leem ou gravam app.*');

-- Donos ----------------------------------------------------------------------------------------

select is_empty($$
  select 'schema ' || nspname from pg_namespace
   where nspname in ('core', 'pub', 'priv', 'ops', 'audit') and nspowner <> 'vv_owner'::regrole
  union all
  select 'rel ' || n.nspname || '.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('core', 'pub', 'priv', 'ops', 'audit') and c.relowner <> 'vv_owner'::regrole
  union all
  select 'func ' || p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('core', 'pub', 'priv', 'ops', 'audit') and p.proowner <> 'vv_owner'::regrole
$$, 'todo objeto dos schemas da aplicação pertence a vv_owner');

select is_empty($$
  select 'schema ' || nspname from pg_namespace
   where nspowner = 'vv_owner'::regrole and nspname in ('public', 'extensions', 'tap')
  union all
  select 'banco ' || datname from pg_database where datdba = 'vv_owner'::regrole
$$, 'vv_owner não é dono do banco nem de public/extensions (onde o superusuário roda código)');

-- Papéis ---------------------------------------------------------------------------------------

select is_empty($$
  select rolname from pg_roles
  where rolname in ('vv_owner', 'vv_api', 'vv_worker')
    and (rolsuper or rolcreaterole or rolcreatedb or rolreplication)
$$, 'papéis da aplicação não são superusuário, não criam papéis/bancos nem replicam');

select is_empty($$
  select m.member::regrole || ' em ' || m.roleid::regrole from pg_auth_members m
  where m.member in (select oid from pg_roles where rolname in ('vv_owner', 'vv_api', 'vv_worker'))
     or m.roleid in (select oid from pg_roles where rolname in ('vv_owner', 'vv_api', 'vv_worker'))
$$, 'papéis da aplicação não são membros de nenhum papel (sem SET ROLE)');

select is_empty($$
  select r.rolname || ' cria em ' || n.nspname
  from pg_namespace n cross join pg_roles r
  where r.rolname in ('vv_api', 'vv_worker') and has_schema_privilege(r.oid, n.oid, 'create')
  union all
  select r.rolname || ' é dono de ' || c.relname
  from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname in ('vv_api', 'vv_worker')
  union all
  select 'vv_api tem TEMP' where has_database_privilege('vv_api', current_database(), 'temporary')
$$, 'vv_api/vv_worker não criam objetos nem são donos de nada; vv_api sem TEMP');

select ok(
  (select not rolbypassrls from pg_roles where rolname = 'vv_api'),
  'vv_api não ignora RLS'
);

select is_empty($$
  select coalesce(setrole::regrole::text, '*') || ': ' || c
  from pg_db_role_setting, unnest(setconfig) c where c like 'app.%'
$$, 'nenhum default de app.* em papel ou banco');

select * from finish();
rollback;
