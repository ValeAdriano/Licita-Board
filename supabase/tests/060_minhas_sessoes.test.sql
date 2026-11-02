-- Tela de sessões ativas: cada usuário vê só as próprias sessões (Prompt 1.1/1.4).
begin;
select plan(8);

select tests.criar_empresas_ab();
-- Sessões criadas pelo helper: duas de A, uma de B.
select tests.autenticar_como('usuario_a', 'aal2', 3600, 'notebook');
select tests.sair();
select tests.autenticar_como('usuario_b', 'aal2', 3600, 'celular-b');
select tests.sair();
update auth.sessions set user_agent = 'Firefox no notebook', ip = '203.0.113.7'
 where id = tests.sessao_id('usuario_a', 'notebook');

select tests.autenticar_como('usuario_a', 'aal2', 3600, 'celular');
select results_eq(
  $$ select count(*)::int from core.minhas_sessoes() $$,
  $$ values (2) $$,
  'A vê as duas sessões dele');
select is_empty(
  $$ select 1 from core.minhas_sessoes() where id = tests.sessao_id('usuario_b', 'celular-b') $$,
  'A não vê sessões de B');
select results_eq(
  $$ select atual from core.minhas_sessoes() where id = tests.sessao_id('usuario_a', 'celular') $$,
  $$ values (true) $$,
  'a sessão do JWT vem marcada como atual');
select results_eq(
  $$ select dispositivo, ip from core.minhas_sessoes() where id = tests.sessao_id('usuario_a', 'notebook') $$,
  $$ values ('Firefox no notebook'::text, '203.0.113.7'::text) $$,
  'dispositivo e IP aparecem para o próprio usuário');
select tests.sair();

-- Perfil interno (ADMIN_EMPRESA) com só a senha (aal1) não vê IP/dispositivo
select tests.autenticar_como('usuario_a', 'aal1', 0, 'celular');
select is_empty($$ select 1 from core.minhas_sessoes() $$, 'perfil interno em aal1 não lista sessões');
select tests.sair();

-- CLIENTE com aal1 vê as próprias
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['empresas:visualizar']);
select tests.autenticar_como('cliente_a', 'aal1', 0, 'tablet');
select isnt_empty($$ select 1 from core.minhas_sessoes() $$, 'CLIENTE em aal1 vê as próprias sessões');
select tests.sair();

-- Sessão vencida não aparece
update auth.sessions set not_after = now() - interval '1 minute' where id = tests.sessao_id('usuario_a', 'notebook');
select tests.autenticar_como('usuario_a', 'aal2', 3600, 'celular');
select is_empty(
  $$ select 1 from core.minhas_sessoes() where id = tests.sessao_id('usuario_a', 'notebook') $$,
  'sessão vencida (not_after) não aparece');
select tests.sair();

set local role anon;
select throws_ok($$ select * from core.minhas_sessoes() $$, '42501', null, 'anon não lista sessões');
reset role;

select * from finish();
rollback;
