-- Guarda global: nenhuma tabela dos schemas do app pode existir sem RLS (ADR-003, negar por padrão).
begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

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
    where schemaname in ('priv', 'audit')
      and 'anon' = any (roles)
  $$,
  'nenhuma policy de priv/audit é concedida ao papel anon'
);

select * from finish();
rollback;
