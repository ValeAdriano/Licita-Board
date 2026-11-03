-- Contexto do usuário (ADR-013): só vale dentro da transação que chamou core.definir_contexto.
begin;
create schema if not exists tap;
create extension if not exists pgtap with schema tap;
set local search_path = tap;
select plan(11);

-- O comportamento não depende do papel; os grants de vv_api são conferidos no fim.

select is(core.usuario_atual(), null, 'sem contexto, usuário é nulo');
select is(core.aal_atual(), 'aal0', 'sem contexto, aal é aal0');

-- Forjar direto (sem a marca da transação) não vale.
select set_config('app.usuario_id', '0190f7a8-0000-7000-8000-000000000001', true);
select set_config('app.aal', 'aal2', true);
select is(core.usuario_atual(), null, 'app.usuario_id forjado sem definir_contexto é ignorado');
select is(core.aal_atual(), 'aal0', 'app.aal forjado sem definir_contexto é ignorado');

-- Marca com valor de outra transação também não vale.
select set_config('app.tx', '1', true);
select is(core.usuario_atual(), null, 'app.tx de outra transação é ignorado');

select core.definir_contexto('0190f7a8-0000-7000-8000-000000000002', '0190f7a8-0000-7000-8000-0000000000aa', 'aal2');
select is(core.usuario_atual(), '0190f7a8-0000-7000-8000-000000000002'::uuid, 'definir_contexto define o usuário');
select is(core.sessao_atual(), '0190f7a8-0000-7000-8000-0000000000aa'::uuid, 'definir_contexto define a sessão');
select is(core.aal_atual(), 'aal2', 'definir_contexto define o aal');

select throws_ok(
  $$ select core.definir_contexto('0190f7a8-0000-7000-8000-000000000002', null, 'superadmin') $$,
  '22023', 'aal inválido', 'aal fora de aal1/aal2 é recusado'
);

select ok(has_function_privilege('vv_api', 'core.definir_contexto(uuid, uuid, text)', 'execute'),
  'vv_api pode definir o contexto');
select ok(not has_function_privilege('vv_worker', 'core.definir_contexto(uuid, uuid, text)', 'execute'),
  'vv_worker não define contexto de usuário');

select * from finish();
rollback;
