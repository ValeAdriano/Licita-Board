-- Notificações: cada usuário só vê e só marca as próprias, enquanto tiver acesso ao módulo da
-- empresa; ninguém cria pela API; link só interno.
begin;
set local search_path = tap;
select plan(27);

select tests.criar_empresas_ab();
select tests.criar_usuario('super', true);
insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, link) values
  (tests.usuario_id('usuario_a'), tests.empresa_id('A'), 'documentos', 'certidao_vencendo', 'CND Federal vence em 5 dias', '/documentos'),
  (tests.usuario_id('usuario_a'), tests.empresa_id('A'), 'juridico', 'prazo_juridico', 'Impugnação vence amanhã', '/juridico'),
  (tests.usuario_id('usuario_a'), null, null, 'sistema', 'Bem-vindo', null),
  (tests.usuario_id('usuario_b'), tests.empresa_id('B'), 'agenda', 'prazo_juridico', 'Disputa amanhã', '/agenda');

-- =============================================================== leitura e isolamento
select tests.autenticar_como('usuario_a');
select results_eq($$ select count(*)::int from core.notificacoes $$, $$ values (3) $$, 'A vê só as próprias');
select results_eq(
  $$ select count(*)::int from core.notificacoes where lida_em is null $$,
  $$ values (3) $$, 'contagem de não lidas (consulta do sino)');
select results_eq(
  $$ with u as (update core.notificacoes set lida_em = now() where titulo = 'Disputa amanhã' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$, 'A não marca notificação de B (nem enxerga o id)');
select results_eq(
  $$ with u as (update core.notificacoes set lida_em = now() where titulo = 'Bem-vindo' returning 1) select count(*)::int from u $$,
  $$ values (1) $$, 'A marca a própria como lida');
select throws_ok($$ update core.notificacoes set titulo = 'alterado' $$, '42501', null, 'só lida_em é editável');
select throws_ok($$ update core.notificacoes set usuario_id = tests.usuario_id('usuario_b') $$, '42501', null,
  'notificação não é repassada a outro usuário');
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo) values (tests.usuario_id('usuario_b'), 'sistema', 'phishing') $$,
  '42501', null, 'usuário não cria notificação pela API');
select throws_ok($$ delete from core.notificacoes $$, '42501', null, 'usuário não apaga notificações');
select tests.sair();

select is(
  (select lida_em from core.notificacoes where titulo = 'Disputa amanhã'), null,
  'leitura de B continua intacta');
select ok(
  (select lida_em <= now() from core.notificacoes where titulo = 'Bem-vindo'),
  'lida_em é carimbado pelo servidor');

select tests.autenticar_como('usuario_a');
update core.notificacoes set lida_em = '2099-01-01' where titulo = 'CND Federal vence em 5 dias';
update core.notificacoes set lida_em = null where titulo = 'Bem-vindo';
select tests.sair();
select ok(
  (select lida_em <= now() from core.notificacoes where titulo = 'CND Federal vence em 5 dias'),
  'data de leitura futura vira o instante do servidor');
select isnt(
  (select lida_em from core.notificacoes where titulo = 'Bem-vindo'), null,
  'leitura registrada não é desfeita');

-- =============================================================== revogação vale na hora
delete from core.permissoes
 where vinculo_id = tests.vinculo_id('usuario_a', 'A') and modulo = 'juridico' and acao = 'visualizar';
select tests.autenticar_como('usuario_a');
select is_empty($$ select 1 from core.notificacoes where titulo = 'Impugnação vence amanhã' $$,
  'sem juridico/visualizar, notificação jurídica some');
select isnt_empty($$ select 1 from core.notificacoes where titulo = 'CND Federal vence em 5 dias' $$,
  'notificações de outros módulos continuam');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal1');
select results_eq($$ select titulo from core.notificacoes $$, $$ values ('Bem-vindo'::text) $$,
  'perfil interno sem MFA só vê notificações sem empresa');
select tests.sair();

update core.vinculos set ativo = false where id = tests.vinculo_id('usuario_a', 'A');
select tests.autenticar_como('usuario_a');
select is_empty($$ select 1 from core.notificacoes where empresa_id is not null $$,
  'vínculo desativado: notificações da empresa somem');
select tests.sair();

select tests.autenticar_como('super');
select is_empty($$ select 1 from core.notificacoes $$, 'SUPERADMIN não vê notificações dos outros');
select tests.sair();

-- =============================================================== criação pelo sistema
set local role vv_worker;
select lives_ok(
  $$ insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, link)
     select u.id, e.id, 'agenda', 'disputa_proxima', 'Disputa em 2 dias', '/agenda'
       from core.usuarios u, core.empresas e
      where u.email = 'usuario_b@teste.local' and e.razao_social = 'Empresa Teste B' $$,
  'worker (vv_worker) cria notificação válida');
select throws_ok($$ update core.notificacoes set titulo = 'reescrito' $$, '42501', null,
  'nem o worker reescreve o conteúdo enviado');
reset role;
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo)
     values (tests.usuario_id('usuario_b'), tests.empresa_id('A'), 'agenda', 'prazo_juridico', 'vazamento') $$,
  '23514', 'destinatário não tem vínculo ativo com a empresa da notificação',
  'notificação da empresa A não vai para usuário de B (segunda camada)');
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, empresa_id, tipo, titulo)
     values (tests.usuario_id('usuario_b'), tests.empresa_id('B'), 'agenda', 'sem módulo') $$,
  '23514', null, 'notificação de empresa exige módulo');

-- =============================================================== link só interno
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo, link) values (tests.usuario_id('usuario_a'), 'sistema', 'x', 'https://evil.example/login') $$,
  '23514', null, 'link com domínio é recusado');
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo, link) values (tests.usuario_id('usuario_a'), 'sistema', 'x', '//evil.example/login') $$,
  '23514', null, 'link // (sai do app) é recusado');
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo, link) values (tests.usuario_id('usuario_a'), 'sistema', 'x', '/..//evil') $$,
  '23514', null, 'link com .. é recusado');
select throws_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo, link) values (tests.usuario_id('usuario_a'), 'sistema', 'x', '/%2F%2Fevil') $$,
  '23514', null, 'link com % é recusado');
select lives_ok(
  $$ insert into core.notificacoes (usuario_id, tipo, titulo, link) values (tests.usuario_id('usuario_a'), 'sistema', 'x', '/editais?id=01a1990c-15ac-79f3') $$,
  'caminho interno com query é aceito');

set local role vv_api;
select is_empty($$ select 1 from core.notificacoes $$, 'vv_api sem sessão não lê notificações');
reset role;

select * from finish();
rollback;
