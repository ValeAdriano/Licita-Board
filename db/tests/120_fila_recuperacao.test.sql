-- Fila de jobs, recuperação de senha por e-mail e alertas de segurança (PR 3b; ADR-014).
begin;
set local search_path = tap;
select plan(25);

select tests.criar_usuario('rec_a');
select tests.criar_usuario('rec_b');
update core.usuarios set senha_hash = '$argon2id$v=19$m=19456,t=2,p=1$YQ$YQ' where id = tests.usuario_id('rec_a');
delete from ops.jobs;

-- Solicitar recuperação ---------------------------------------------------------------------
set local role vv_api;
select throws_ok($$ select core.solicitar_recuperacao('rec_a@teste.local', 'kek-inventada-pelo-atacante-0123456789') $$,
  '28000', null, 'sem a KEK não se pede recuperação');
select lives_ok($$ select core.solicitar_recuperacao('REC_A@teste.local', tests.kek()) $$, 'pedido para conta existente');
select lives_ok($$ select core.solicitar_recuperacao('ninguem@teste.local', tests.kek()) $$,
  'pedido para e-mail inexistente responde igual');
select core.solicitar_recuperacao('rec_a@teste.local', tests.kek());
select ok(not has_table_privilege('vv_api', 'ops.jobs', 'select'), 'vv_api não lê a fila');
select ok(not has_function_privilege('vv_api', 'core.criar_token_recuperacao(text,text,text)', 'execute'),
  'a API perdeu o caminho antigo de criar token (ela veria o token)');
reset role;
select is((select count(*)::int from ops.jobs where tipo = 'email_recuperacao'), 1,
  'no máximo um pedido a cada 5 min (e nenhum para e-mail inexistente)');
select is((select payload from ops.jobs where tipo = 'email_recuperacao'),
  jsonb_build_object('usuario_id', tests.usuario_id('rec_a')), 'payload só com o id, sem token nem e-mail');
update ops.jobs set created_at = now() - interval '6 minutes' where tipo = 'email_recuperacao';
insert into ops.jobs (tipo, payload, created_at)
select 'email_recuperacao', jsonb_build_object('usuario_id', tests.usuario_id('rec_a')), now() - interval '1 hour'
  from generate_series(1, 4);
set local role vv_api;
select core.solicitar_recuperacao('rec_a@teste.local', tests.kek());
reset role;
select is((select count(*)::int from ops.jobs where tipo = 'email_recuperacao'), 5, 'no máximo 5 pedidos por dia');
delete from ops.jobs where tipo = 'email_recuperacao' and created_at < now() - interval '30 minutes';

-- Worker pega, emite o token (só o hash) e conclui ------------------------------------------
create temp table t_job (like ops.jobs);
grant all on t_job to vv_worker;
set local role vv_worker;
insert into t_job select * from ops.pegar_jobs(array['email_recuperacao'], 10);
select is((select count(*)::int from t_job), 1, 'worker pega o job pendente');
select is((select count(*)::int from ops.pegar_jobs(array['email_recuperacao'], 10)), 0,
  'job em execução não é pego de novo (visibilidade)');
select throws_ok(
  $$ select * from core.emitir_token_recuperacao((select id from t_job), gen_random_uuid(), sha256(convert_to('x', 'UTF8'))) $$,
  '42501', null, 'outra execução não emite token para o job');
select throws_ok(
  $$ select * from core.emitir_token_recuperacao(gen_random_uuid(), (select execucao from t_job), sha256(convert_to('x', 'UTF8'))) $$,
  '42501', null, 'sem job de recuperação vivo, o worker não emite token (não forja recuperação)');
select results_eq(
  $$ select email from core.emitir_token_recuperacao((select id from t_job), (select execucao from t_job),
       sha256(convert_to('tok-rec-' || repeat('x', 40), 'UTF8'))) $$,
  $$ values ('rec_a@teste.local'::text) $$, 'worker emite o token do job e recebe o destinatário');
select throws_ok(
  $$ select * from core.emitir_token_recuperacao((select id from t_job), (select execucao from t_job), sha256(convert_to('y', 'UTF8'))) $$,
  '42501', null, 'um token por job');
select ok(not has_table_privilege('vv_worker', 'core.tokens_recuperacao', 'select'), 'worker não lê tokens guardados');
select ops.concluir_job((select id from t_job), gen_random_uuid());
reset role;
select is((select status from ops.jobs where id = (select id from t_job)), 'executando',
  'só a execução dona conclui o job');
set local role vv_worker;
select ops.concluir_job((select id from t_job), (select execucao from t_job));
reset role;
select is((select status from ops.jobs where id = (select id from t_job)), 'concluido', 'job concluído');
set local role vv_api;
select ok(core.redefinir_senha('tok-rec-' || repeat('x', 40), '$argon2id$v=19$m=19456,t=2,p=1$Ym92YQ$Ym92YQ', tests.kek()),
  'o token emitido pelo worker redefine a senha');
reset role;

-- Falha com backoff, desistência e job travado na última tentativa --------------------------
insert into ops.jobs (tipo, payload, max_tentativas) values ('teste_falha', '{}', 2);
create temp table t_f (like ops.jobs);
grant all on t_f to vv_worker;
set local role vv_worker;
insert into t_f select * from ops.pegar_jobs(array['teste_falha'], 1);
select ops.falhar_job((select id from t_f), (select execucao from t_f), 'erro de teste');
reset role;
select ok((select status = 'pendente' and disponivel_em > now() from ops.jobs where tipo = 'teste_falha'),
  'falha volta para a fila com backoff');
update ops.jobs set disponivel_em = now() where tipo = 'teste_falha';
delete from t_f;
set local role vv_worker;
insert into t_f select * from ops.pegar_jobs(array['teste_falha'], 1);
select ops.falhar_job((select id from t_f), (select execucao from t_f), 'erro de teste');
reset role;
select is((select status from ops.jobs where tipo = 'teste_falha'), 'falhou', 'última tentativa marca falhou');
insert into ops.jobs (tipo, payload, max_tentativas, status, tentativas, travado_ate)
values ('teste_travado', '{}', 1, 'executando', 1, now() - interval '1 minute');
set local role vv_worker;
select ops.pegar_jobs(array['outro_tipo'], 1);
reset role;
select is((select status from ops.jobs where tipo = 'teste_travado'), 'falhou',
  'job que venceu o prazo na última tentativa vira falhou (não fica travado)');

-- Alertas de segurança ----------------------------------------------------------------------
select is((select count(*)::int from ops.jobs where tipo = 'email_alerta' and payload -> 'eventos' ? 'senha_alterada'
            and payload ->> 'usuario_id' = tests.usuario_id('rec_a')::text), 1,
  'redefinir a senha enfileira alerta de senha alterada');
delete from ops.jobs where tipo = 'email_alerta';
insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek, verificado_em)
values (tests.usuario_id('rec_b'), '\x00'::bytea, 1, now() - interval '1 day');
select tests.garantir_sessao('rec_b', 'aal1', 'mfa');
delete from ops.jobs where tipo = 'email_alerta';
-- troca de autenticador na mesma transação (remove o antigo, verifica o novo): um único e-mail
insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek, sessao_id)
values (tests.usuario_id('rec_b'), '\x01'::bytea, 1, tests.sessao_id('rec_b', 'mfa'));
delete from core.fatores_mfa where usuario_id = tests.usuario_id('rec_b') and verificado_em is not null;
update core.fatores_mfa set verificado_em = now(), sessao_id = null where usuario_id = tests.usuario_id('rec_b');
select is((select payload -> 'eventos' from ops.jobs where tipo = 'email_alerta'
            and payload ->> 'usuario_id' = tests.usuario_id('rec_b')::text),
  '["autenticador_removido", "autenticador_cadastrado"]'::jsonb,
  'eventos da mesma transação viram um único e-mail');
select is((select count(*)::int from ops.jobs where tipo = 'email_alerta' and payload ? 'email'), 0,
  'alerta não leva e-mail nem dado pessoal no payload');
insert into core.sessoes (usuario_id, token_hash, ip, plataforma)
values (tests.usuario_id('rec_b'), sha256(convert_to('sessao-ip-novo', 'UTF8')), '203.0.113.99', 'web');
select ok(exists (select 1 from ops.jobs where tipo = 'email_alerta' and payload -> 'eventos' ? 'login_novo'
                   and payload ->> 'usuario_id' = tests.usuario_id('rec_b')::text),
  'sessão de IP novo enfileira alerta de login');

select * from finish();
rollback;
