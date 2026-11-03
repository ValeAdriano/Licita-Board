-- Login em duas etapas, sessões, troca e recuperação de senha (spec fase-01 §4, ADR-012; PR 2a).
begin;
set local search_path = tap;
select plan(31);

select tests.criar_usuario('login_a');
select tests.criar_usuario('login_b');
update core.usuarios set senha_hash = '$argon2id$v=19$m=19456,t=2,p=1$ZmFrZQ$ZmFrZQ'
 where id in (tests.usuario_id('login_a'), tests.usuario_id('login_b'));

create temp table t_login (n int, tentativa uuid, usuario uuid, senha_hash text, motivo text);
grant all on t_login to vv_api;

-- preparar_login ------------------------------------------------------------------------------
set local role vv_api;
insert into t_login select 1, * from core.preparar_login('LOGIN_A@teste.local', '198.51.100.7', tests.kek());
select is((select motivo from t_login where n = 1), 'ok', 'preparar_login libera e-mail válido');
select is((select usuario from t_login where n = 1), tests.usuario_id('login_a'), 'sem diferenciar maiúsculas');
select isnt((select senha_hash from t_login where n = 1), null, 'devolve o hash para a API conferir');
insert into t_login select 2, * from core.preparar_login('ninguem@teste.local', '198.51.100.8', tests.kek());
select is((select (usuario, senha_hash, motivo)::text from t_login where n = 2), '(,,ok)',
  'e-mail inexistente segue o mesmo caminho, sem usuário nem hash');
select ok(not has_column_privilege('vv_api', 'core.usuarios', 'senha_hash', 'select'), 'vv_api não lê senha_hash');
select ok(not has_column_privilege('vv_worker', 'core.usuarios', 'senha_hash', 'select'), 'vv_worker não lê senha_hash');

select throws_ok($$ select * from core.preparar_login('login_a@teste.local', null, 'kek-inventada-pelo-atacante-0123456789') $$,
  '28000', null, 'sem a KEK (SQLi) preparar_login não devolve hash');
select throws_ok($$ select * from core.preparar_login('login_a@teste.local', null, null) $$,
  '28000', null, 'KEK nula também é recusada');
select throws_ok($$ select core.criar_token_recuperacao('login_a@teste.local', repeat('r', 43), null) $$,
  '28000', null, 'sem a KEK não se cria token de recuperação');

-- Bloqueio: toda tentativa conta como falha antes da senha; a 11ª é recusada sem conferir a senha.
reset role;
delete from core.tentativas_login;
set local role vv_api;
select core.preparar_login('login_a@teste.local', ('198.51.100.' || i)::inet, tests.kek()) from generate_series(10, 19) i;
insert into t_login select 3, * from core.preparar_login('login_a@teste.local', '198.51.100.30', tests.kek());
select is((select motivo from t_login where n = 3), 'bloqueado', 'depois de 10 falhas a conta é bloqueada');
select is((select senha_hash from t_login where n = 3), null, 'bloqueado: o hash nem sai do banco');
reset role;
select ok((select bloqueado_ate > now() from core.usuarios where id = tests.usuario_id('login_a')),
  'bloqueio de 15 min gravado');
select is((select count(*)::int from core.tentativas_login where email_hash = core.hash_token('login_a@teste.local')),
  11, 'tentativa guarda o hash do e-mail, não o e-mail');
-- Tentativas recusadas não renovam o bloqueio: com o bloqueio vencido, a conta volta a liberar.
update core.usuarios set bloqueado_ate = now() - interval '1 second' where id = tests.usuario_id('login_a');
update core.tentativas_login set em = em - interval '16 minutes' where liberada;
set local role vv_api;
insert into t_login select 8, * from core.preparar_login('login_a@teste.local', '198.51.100.31', tests.kek());
select is((select motivo from t_login where n = 8), 'ok', 'tentativas recusadas durante o bloqueio não o renovam');
reset role;

-- Limite por IP: mais de 10 tentativas/min do mesmo IP, com qualquer e-mail.
delete from core.tentativas_login;
set local role vv_api;
select core.preparar_login('spray' || i || '@teste.local', '203.0.113.50', tests.kek()) from generate_series(1, 10) i;
insert into t_login select 4, * from core.preparar_login('login_b@teste.local', '203.0.113.50', tests.kek());
select is((select motivo from t_login where n = 4), 'limite_ip', 'o 11º pedido do mesmo IP no minuto é recusado');

-- concluir_login ------------------------------------------------------------------------------
insert into t_login select 5, * from core.preparar_login('login_b@teste.local', '203.0.113.60', tests.kek());
select throws_ok($$ select core.concluir_login((select tentativa from t_login where n = 5),
                     tests.usuario_id('login_a'), repeat('x', 43), null, null, 'web', tests.kek()) $$,
  '28000', null, 'tentativa de um e-mail não cria sessão para outro usuário');
select isnt(core.concluir_login((select tentativa from t_login where n = 5), tests.usuario_id('login_b'),
             'tok-b1' || repeat('x', 40), null, null, 'android', tests.kek()), null, 'senha conferida: nasce a sessão');
select throws_ok($$ select core.concluir_login((select tentativa from t_login where n = 5),
                     tests.usuario_id('login_b'), 'tok-b2' || repeat('x', 40), null, null, 'web', tests.kek()) $$,
  '28000', null, 'a mesma tentativa não cria duas sessões');

-- Sessões --------------------------------------------------------------------------------------
reset role;
create temp table t_b1 as select id from core.sessoes where token_hash = core.hash_token('tok-b1' || repeat('x', 40));
grant select on t_b1 to vv_api;
update core.usuarios set bloqueado_ate = null where id = tests.usuario_id('login_a');
delete from core.tentativas_login;
set local role vv_api;
insert into t_login select 6, * from core.preparar_login('login_a@teste.local', null, tests.kek());
insert into t_login select 7, * from core.preparar_login('login_a@teste.local', null, tests.kek());
select core.concluir_login((select tentativa from t_login where n = 6), tests.usuario_id('login_a'), 'tok-a1' || repeat('x', 40), null, null, 'web', tests.kek());
select core.concluir_login((select tentativa from t_login where n = 7), tests.usuario_id('login_a'), 'tok-a2' || repeat('x', 40), null, null, 'ios', tests.kek());
select core.definir_contexto('tok-a1' || repeat('x', 40));
select is(core.aal_atual(), 'aal1', 'sessão nova nasce aal1');
select is((select count(*)::int from core.minhas_sessoes()), 2, 'minhas_sessoes lista só as do próprio usuário');
select core.encerrar_sessao((select s.id from core.minhas_sessoes() s where not s.atual));
select is((select count(*)::int from core.minhas_sessoes()), 1, 'encerra a outra sessão do próprio usuário');
select core.encerrar_sessao((select id from t_b1));
reset role;
select ok((select revogada_em is null from core.sessoes where token_hash = core.hash_token('tok-b1' || repeat('x', 40))),
  'não encerra sessão de outro usuário');

-- Rotação e troca de senha ------------------------------------------------------------------
set local role vv_api;
select core.definir_contexto('tok-a1' || repeat('x', 40));
select core.rotacionar_sessao('tok-a1' || repeat('x', 40), 'tok-a1-novo' || repeat('x', 40));
select is(core.usuario_atual(), tests.usuario_id('login_a'), 'rotação mantém o contexto com o token novo');
select throws_ok($$ select core.definir_contexto('tok-a1' || repeat('x', 40)) $$, '28000', null,
  'o token antigo deixa de valer');
select core.definir_contexto('tok-a1-novo' || repeat('x', 40));
select throws_ok($$ select core.rotacionar_sessao('palpite', 'tok-roubo' || repeat('x', 40)) $$, '28000', null,
  'rotação exige o token atual em claro (SQL injetado não toma a sessão)');
select core.definir_contexto('tok-a1-novo' || repeat('x', 40));
select core.trocar_senha('$argon2id$v=19$m=19456,t=2,p=1$bm92YQ$bm92YQ');
reset role;
select is((select count(*)::int from audit.audit_log
            where table_name = 'usuarios' and record_id = tests.usuario_id('login_a')
              and 'senha_hash' = any (changed_fields)
              and new_data ->> 'senha_hash' = '[redigido]'
              and coalesce(old_data ->> 'senha_hash', '[redigido]') = '[redigido]'),
  2, 'senha_hash nunca entra na auditoria (redigida antes e depois)');

-- Recuperação de senha -----------------------------------------------------------------------
set local role vv_api;
select is(core.criar_token_recuperacao('ninguem@teste.local', 'rec-x' || repeat('x', 40), tests.kek()), null,
  'e-mail inexistente não gera token (e a API responde igual)');
select is(core.criar_token_recuperacao('Login_B@teste.local', 'rec-b' || repeat('x', 40), tests.kek()), tests.usuario_id('login_b'),
  'e-mail existente gera token');
select ok(core.redefinir_senha('rec-b' || repeat('x', 40), '$argon2id$v=19$m=19456,t=2,p=1$cmVj$cmVj', tests.kek()), 'token certo redefine');
select ok(not core.redefinir_senha('rec-b' || repeat('x', 40), '$argon2id$x', tests.kek()), 'token é de uso único');
reset role;
select ok((select revogada_em is not null from core.sessoes where token_hash = core.hash_token('tok-b1' || repeat('x', 40))),
  'redefinir a senha encerra as sessões do usuário');

select * from finish();
rollback;
