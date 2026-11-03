-- Requisição de segundo plano (polling) confere a sessão, mas não renova a inatividade (T5.17).
begin;
set local search_path = tap;
select plan(12);

select tests.criar_usuario('fundo_a');
select tests.garantir_sessao('fundo_a', 'aal2');
update core.sessoes set ultimo_uso_em = now() - interval '10 minutes' where id = tests.sessao_id('fundo_a');

set local role vv_api;
select lives_ok($$ select core.definir_contexto(tests.token('fundo_a'), false) $$, 'fundo aceita sessão viva');
select is(core.usuario_atual(), tests.usuario_id('fundo_a'), 'fundo define o usuário normalmente');
reset role;
select ok((select ultimo_uso_em < now() - interval '9 minutes' from core.sessoes where id = tests.sessao_id('fundo_a')),
  'requisição de fundo não renova a inatividade');

set local role vv_api;
select core.definir_contexto(tests.token('fundo_a'));
reset role;
select ok((select ultimo_uso_em > now() - interval '1 minute' from core.sessoes where id = tests.sessao_id('fundo_a')),
  'uso normal (1 argumento) renova');
update core.sessoes set ultimo_uso_em = now() - interval '10 minutes' where id = tests.sessao_id('fundo_a');
set local role vv_api;
select core.definir_contexto(tests.token('fundo_a'), true);
reset role;
select ok((select ultimo_uso_em > now() - interval '1 minute' from core.sessoes where id = tests.sessao_id('fundo_a')),
  'renovar = true (o que a API usa em toda requisição normal) renova');

select ok(has_function_privilege('vv_api', 'core.definir_contexto(text,boolean)', 'execute'), 'vv_api executa a versão nova');
select ok(not has_function_privilege('vv_worker', 'core.definir_contexto(text,boolean)', 'execute'), 'vv_worker não executa');

-- Fundo não ressuscita sessão revogada, expirada ou de usuário inativo.
update core.sessoes set revogada_em = now() where id = tests.sessao_id('fundo_a');
set local role vv_api;
select throws_ok($$ select core.definir_contexto(tests.token('fundo_a'), false) $$, '28000', null, 'fundo recusa sessão revogada');
reset role;
select tests.garantir_sessao('fundo_a', 'aal2');
update core.sessoes set expira_em = now() - interval '1 second' where id = tests.sessao_id('fundo_a');
set local role vv_api;
select throws_ok($$ select core.definir_contexto(tests.token('fundo_a'), false) $$, '28000', null, 'fundo recusa sessão expirada');
reset role;
select tests.garantir_sessao('fundo_a', 'aal2');
update core.usuarios set ativo = false where id = tests.usuario_id('fundo_a');
set local role vv_api;
select throws_ok($$ select core.definir_contexto(tests.token('fundo_a'), false) $$, '28000', null, 'fundo recusa usuário inativo');
reset role;
update core.usuarios set ativo = true where id = tests.usuario_id('fundo_a');
select tests.garantir_sessao('fundo_a', 'aal2');

update core.sessoes set ultimo_uso_em = now() - interval '31 minutes' where id = tests.sessao_id('fundo_a');
set local role vv_api;
select throws_ok($$ select core.definir_contexto(tests.token('fundo_a'), false) $$, '28000', null,
  'fundo não ressuscita sessão inativa');
select throws_ok($$ select core.definir_contexto('token-inventado', false) $$, '28000', null,
  'fundo recusa token sem sessão');
reset role;

select * from finish();
rollback;
