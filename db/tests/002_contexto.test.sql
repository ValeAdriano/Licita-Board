-- Contexto do usuário (ADR-013, PR 2a): só vale com o token de uma sessão viva, na transação que
-- chamou core.definir_contexto. Forjar app.* não serve, nem dentro da transação.
begin;
set local search_path = tap;
select plan(17);

select tests.criar_usuario('ctx_a');
select tests.criar_usuario('ctx_b');

select is(core.usuario_atual(), null, 'sem contexto, usuário é nulo');
select is(core.aal_atual(), 'aal0', 'sem contexto, aal é aal0');

-- Forjar app.* com a marca da transação certa (o que um SQLi conseguiria) não vale sem token.
select set_config('app.usuario_id', tests.usuario_id('ctx_a')::text, true),
       set_config('app.aal', 'aal2', true),
       set_config('app.tx', extract(epoch from now())::text, true);
select is(core.usuario_atual(), null, 'app.usuario_id forjado com marca válida é ignorado');
select is(core.aal_atual(), 'aal0', 'app.aal forjado com marca válida é ignorado');
select set_config('app.sessao_hash', encode(core.hash_token('token-inventado'), 'hex'), true);
select is(core.usuario_atual(), null, 'hash de token inventado não vale');

select throws_ok($$ select core.definir_contexto('token-inventado') $$, '28000', 'sessão inválida',
  'definir_contexto recusa token sem sessão');

select tests.garantir_sessao('ctx_b', 'aal2');
select core.definir_contexto(tests.token('ctx_b'));
select is(core.usuario_atual(), tests.usuario_id('ctx_b'), 'token válido define o usuário');
select is(core.sessao_atual(), tests.sessao_id('ctx_b'), 'token válido define a sessão');
select is(core.aal_atual(), 'aal2', 'aal vem da sessão no banco');

-- Sessão revogada, expirada, inativa ou de usuário bloqueado/inativo deixa de valer na hora.
update core.sessoes set revogada_em = now() where id = tests.sessao_id('ctx_b');
select is(core.usuario_atual(), null, 'sessão revogada perde o contexto na consulta seguinte');
select tests.garantir_sessao('ctx_b', 'aal1');
update core.sessoes set ultimo_uso_em = now() - interval '31 minutes' where id = tests.sessao_id('ctx_b');
select throws_ok($$ select core.definir_contexto(tests.token('ctx_b')) $$, '28000', null,
  'sessão parada há mais de 30 min é recusada');
select tests.garantir_sessao('ctx_b', 'aal1');
update core.sessoes set expira_em = now() - interval '1 second' where id = tests.sessao_id('ctx_b');
select throws_ok($$ select core.definir_contexto(tests.token('ctx_b')) $$, '28000', null,
  'sessão além das 12 h é recusada');
select tests.garantir_sessao('ctx_b', 'aal1');
update core.usuarios set bloqueado_ate = now() + interval '5 minutes' where id = tests.usuario_id('ctx_b');
select lives_ok($$ select core.definir_contexto(tests.token('ctx_b')) $$,
  'bloqueio por falhas de login não derruba a sessão já aberta');

select ok(not has_table_privilege('vv_api', 'core.sessoes', 'select'), 'vv_api não lê core.sessoes');
select ok(current_setting('app.sessao_hash', true) !~ 'token-teste', 'o token cru não fica no contexto');
select ok(has_function_privilege('vv_api', 'core.definir_contexto(text)', 'execute'),
  'vv_api define o contexto pelo token');
select ok(not has_function_privilege('vv_worker', 'core.definir_contexto(text)', 'execute'),
  'vv_worker não define contexto de usuário');

select * from finish();
rollback;
