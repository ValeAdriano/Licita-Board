-- Guarda global (ADR-003, negar por padrão). Vale para toda migration futura.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select is_empty(
  $$
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and n.nspname in ('public', 'core', 'pub', 'priv', 'ops', 'audit')
      and not c.relrowsecurity
  $$,
  'toda tabela de public/core/pub/priv/ops/audit tem RLS ligado'
);

select is_empty(
  $$
    select schemaname || '.' || tablename || ' -> ' || policyname
    from pg_policies
    where schemaname in ('core', 'priv', 'ops', 'audit')
      and roles && array['anon', 'public']::name[]
  $$,
  'nenhuma policy de core/priv/ops/audit vale para anon ou public (policy sem TO)'
);

select is_empty(
  $$
    select schemaname || '.' || tablename || ' -> ' || policyname
    from pg_policies
    where schemaname = 'priv'
      and (qual = 'true' or with_check = 'true')
  $$,
  'nenhuma policy de priv é using/with check (true)'
);

select is_empty(
  $$
    select table_schema || '.' || table_name || ' ' || privilege_type
    from information_schema.role_table_grants
    where grantee in ('anon', 'PUBLIC')
      and table_schema in ('core', 'priv', 'ops', 'audit')
  $$,
  'anon/PUBLIC não têm grant em tabelas de core/priv/ops/audit'
);

select is_empty(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef
      and n.nspname in ('public', 'core', 'pub', 'priv', 'ops', 'audit')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  $$,
  'toda função security definer fixa search_path'
);

select * from finish();
rollback;
