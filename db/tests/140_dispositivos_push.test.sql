-- Web Push (PR 9): dispositivo é do dono; endpoint e chaves nunca saem pela API; só hosts de serviços
-- de push conhecidos (SSRF); limites; takeover só com as mesmas chaves; logout/senha/conta revogam;
-- novo dispositivo avisa por e-mail; notificação enfileira push (só com dispositivo ativo).
begin;
set local search_path = tap;
select plan(53);

select tests.criar_empresas_ab();
delete from ops.jobs;

create temp table pk (nome text primary key, valor text);
grant all on pk to vv_api, vv_worker;
insert into pk select 'ua', tests.usuario_id('usuario_a')::text;
create or replace function pg_temp.k1() returns text language sql as $$ select repeat('A', 87) $$;
create or replace function pg_temp.a1() returns text language sql as $$ select repeat('B', 22) $$;
create or replace function pg_temp.k2() returns text language sql as $$ select repeat('C', 87) $$;
create or replace function pg_temp.a2() returns text language sql as $$ select repeat('D', 22) $$;
grant execute on function pg_temp.k1(), pg_temp.a1(), pg_temp.k2(), pg_temp.a2() to vv_api;

-- ================================================================ A registra e vê o próprio dispositivo
select tests.autenticar_como('usuario_a');
insert into pk select 'a1', core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/abc123', pg_temp.k1(), pg_temp.a1());
select ok((select valor is not null from pk where nome = 'a1'), 'A registra um dispositivo');
select is((select count(*)::int from core.dispositivos_push), 1, 'A vê só o próprio dispositivo');
select throws_ok($$ select endpoint from core.dispositivos_push $$, '42501', null, 'a API não lê o endpoint');
select throws_ok($$ select p256dh from core.dispositivos_push $$, '42501', null, 'a API não lê as chaves');
select throws_ok($$ select auth from core.dispositivos_push $$, '42501', null, 'a API não lê o segredo de autenticação');
select throws_ok($$ select * from core.dispositivos_push $$, '42501', null, 'select * também é recusado');
select throws_ok($$ insert into core.dispositivos_push (usuario_id, endpoint, p256dh, auth)
  values (core.usuario_atual(), 'https://fcm.googleapis.com/x', repeat('A', 87), repeat('B', 22)) $$, '42501', null,
  'inserir direto na tabela não é permitido (só pela função)');
select throws_ok($$ update core.dispositivos_push set revogado_em = null $$, '42501', null, 'update direto não é permitido');
select throws_ok($$ delete from core.dispositivos_push $$, '42501', null, 'delete direto não é permitido');
select is(core.meu_dispositivo_push('https://fcm.googleapis.com/fcm/send/abc123'), (select valor::uuid from pk where nome = 'a1'),
  'o navegador acha o próprio dispositivo pelo endpoint');
select tests.sair();

-- ================================================================ aviso por e-mail do novo dispositivo
reset role;
select ok((select payload -> 'eventos' ? 'dispositivo_push_cadastrado' from ops.jobs
            where tipo = 'email_alerta' and payload ->> 'usuario_id' = tests.usuario_id('usuario_a')::text),
  'registrar dispositivo novo avisa o dono por e-mail');
delete from ops.jobs;

-- ================================================================ B não enxerga nem mexe no de A
select tests.autenticar_como('usuario_b');
select is((select count(*)::int from core.dispositivos_push), 0, 'B não vê dispositivo de A');
select throws_ok($$ select core.revogar_dispositivo_push((select valor::uuid from pk where nome = 'a1')) $$, 'P0002', null,
  'B não revoga dispositivo de A por id');
select lives_ok($$ select core.revogar_dispositivo_push_endpoint('https://fcm.googleapis.com/fcm/send/abc123') $$,
  'B chamar o logout com o endpoint de A não dá erro...');
select is(core.meu_dispositivo_push('https://fcm.googleapis.com/fcm/send/abc123'), null, 'B não identifica o endpoint de A como dele');
-- Takeover: B só sabe a URL (chaves diferentes) -> recusado; A segue dono.
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/abc123', pg_temp.k2(), pg_temp.a2()) $$,
  '42501', null, 'B com a URL e chaves próprias não sequestra o dispositivo de A');
select tests.sair();
reset role;
select is((select count(*)::int from core.dispositivos_push where endpoint = 'https://fcm.googleapis.com/fcm/send/abc123'
            and usuario_id = tests.usuario_id('usuario_a') and revogado_em is null), 1,
  '...e o dispositivo de A segue ativo (logout cruzado não revoga o de outro)');

-- ================================================================ só serviços de push conhecidos (SSRF)
select tests.autenticar_como('usuario_a');
select throws_ok($$ select core.registrar_dispositivo_push('http://fcm.googleapis.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'http é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://evil.example.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'host fora da lista é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com@evil.example.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'usuário na URL é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://127.0.0.1/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'IP é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://[::1]/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'IPv6 é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com:8443/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'porta é recusada');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com.evil.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'sufixo parecido é recusado');
select throws_ok($$ select core.registrar_dispositivo_push('https://evilpush.services.mozilla.com.evil.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'host lookalike da Mozilla é recusado');
select throws_ok($$ select core.registrar_dispositivo_push(E'https://fcm.googleapis.com/x\nHost: evil', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'quebra de linha é recusada');
select throws_ok($$ select core.registrar_dispositivo_push('https://FCM.googleapis.com/x', pg_temp.k1(), pg_temp.a1()) $$, '22023', null, 'maiúsculas no host são recusadas');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/x', 'curta', pg_temp.a1()) $$, '22023', null, 'chave fora do formato é recusada');
select lives_ok($$ select core.registrar_dispositivo_push(h, pg_temp.k1(), pg_temp.a1())
  from unnest(array['https://updates.push.services.mozilla.com/wpush/v2/m1', 'https://web.push.apple.com/a1',
                    'https://wns2-par02p.notify.windows.com/w/?token=w1']) h $$,
  'Mozilla, Apple e Windows são aceitos');

-- ================================================================ limites: 10 ativos e vaga ao revogar
select lives_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/n' || g, pg_temp.k1(), pg_temp.a1())
  from generate_series(1, 6) g $$, 'completa 10 dispositivos ativos (1 + 3 + 6)');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/n11', pg_temp.k1(), pg_temp.a1()) $$,
  '54000', null, 'o 11º é recusado');
select lives_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/n1', pg_temp.k1(), pg_temp.a1()) $$,
  're-registrar um endpoint já ativo no limite funciona');
select lives_ok($$ select core.revogar_dispositivo_push_endpoint('https://fcm.googleapis.com/fcm/send/n1') $$, 'revogar abre vaga');
select lives_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/n11', pg_temp.k1(), pg_temp.a1()) $$, 'e o novo entra');
select tests.sair();

-- ================================================================ logout revoga (idempotente)
select tests.autenticar_como('usuario_a');
select lives_ok($$ select core.revogar_dispositivo_push_endpoint('https://fcm.googleapis.com/fcm/send/abc123') $$, 'revogar pelo endpoint');
select lives_ok($$ select core.revogar_dispositivo_push_endpoint('https://fcm.googleapis.com/fcm/send/abc123') $$, 'revogar de novo não dá erro');
select is(core.meu_dispositivo_push('https://fcm.googleapis.com/fcm/send/abc123'), null, 'dispositivo revogado some');
select tests.sair();

-- ================================================================ MFA e sessão
select tests.autenticar_como('usuario_a', 'aal1');
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/aal1', pg_temp.k1(), pg_temp.a1()) $$,
  '42501', null, 'perfil interno só com a senha (aal1) não registra dispositivo');
select tests.sair();
select throws_ok($$ select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/sem', pg_temp.k1(), pg_temp.a1()) $$,
  '28000', null, 'sem sessão não registra');

-- ================================================================ trocar a senha ou desativar a conta revoga tudo
reset role;
select ok((select count(*) from core.dispositivos_push where usuario_id = tests.usuario_id('usuario_a') and revogado_em is null) > 0,
  'A tem dispositivos ativos antes de trocar a senha');
update core.usuarios set senha_hash = '$argon2id$v=19$m=19456,t=2,p=1$bm92YQ$bm92YQ' where id = tests.usuario_id('usuario_a');
select is((select count(*)::int from core.dispositivos_push where usuario_id = tests.usuario_id('usuario_a') and revogado_em is null), 0,
  'trocar a senha revoga os dispositivos (conta comprometida não segue recebendo avisos)');
select tests.autenticar_como('usuario_b');
select core.registrar_dispositivo_push('https://fcm.googleapis.com/fcm/send/b1', pg_temp.k1(), pg_temp.a1());
select tests.sair();
reset role;
update core.usuarios set ativo = false where id = tests.usuario_id('usuario_b');
select is((select count(*)::int from core.dispositivos_push where usuario_id = tests.usuario_id('usuario_b') and revogado_em is null), 0,
  'desativar a conta revoga os dispositivos');
update core.usuarios set ativo = true where id = tests.usuario_id('usuario_b');

-- ================================================================ fila de push e papel do worker
delete from ops.jobs;
insert into core.notificacoes (usuario_id, tipo, titulo, corpo) values
  (tests.usuario_id('usuario_a'), 'sistema', 'Sem dispositivo ativo', 'x');
select is((select count(*)::int from ops.jobs where tipo = 'push_notificacao'), 0, 'sem dispositivo ativo, a notificação não enfileira push');
update core.dispositivos_push set revogado_em = null where endpoint = 'https://fcm.googleapis.com/fcm/send/n11';
update core.dispositivos_push set usuario_id = tests.usuario_id('usuario_a') where endpoint = 'https://fcm.googleapis.com/fcm/send/n11';
insert into core.notificacoes (usuario_id, tipo, titulo, corpo) values
  (tests.usuario_id('usuario_a'), 'sistema', 'Texto que não pode ir para a fila', 'corpo secreto');
select is((select payload from ops.jobs where tipo = 'push_notificacao'),
  jsonb_build_object('notificacao_id', (select id from core.notificacoes where titulo = 'Texto que não pode ir para a fila'),
                     'usuario_id', (select valor::uuid from pk where nome = 'ua')),
  'a fila leva só ids (notificação e usuário), nunca texto');
select is((select chave_idempotencia from ops.jobs where tipo = 'push_notificacao'),
  'push:' || (select id from core.notificacoes where titulo = 'Texto que não pode ir para a fila'), 'idempotente por notificação');
select is((select tgenabled::text from pg_trigger where tgname = 'notificacoes_push'), 'A', 'o trigger de push vale também em replicação (enable always)');
-- No máximo 5 pushes por hora por usuário (convite/prazo de terceiros não vira enxurrada no celular).
insert into core.notificacoes (usuario_id, tipo, titulo) select tests.usuario_id('usuario_a'), 'sistema', 'spam ' || g from generate_series(1, 8) g;
select is((select count(*)::int from ops.jobs where tipo = 'push_notificacao'), 5, 'no máximo 5 pushes por hora por usuário');
select is((select count(*)::int from core.notificacoes where titulo like 'spam %'), 8, '...mas todas as notificações seguem no app');
set local role vv_worker;
select is((select count(*)::int from core.dispositivos_push where usuario_id = (select valor::uuid from pk where nome = 'ua') and revogado_em is null), 1,
  'o worker (BYPASSRLS) lê os dispositivos ativos');
select lives_ok($$ update core.dispositivos_push set ultimo_envio_em = now(), falhas = 1 where endpoint = 'https://fcm.googleapis.com/fcm/send/n11' $$,
  'o worker atualiza o resultado do envio');
select throws_ok($$ update core.dispositivos_push set endpoint = 'https://fcm.googleapis.com/outro' $$, '42501', null, 'o worker não troca o endpoint');
select throws_ok($$ delete from core.dispositivos_push $$, '42501', null, 'o worker não apaga');
select ok(not has_function_privilege('vv_worker', 'core.registrar_dispositivo_push(text,text,text)', 'execute')
          and not has_function_privilege('vv_worker', 'core.revogar_dispositivo_push(uuid)', 'execute'), 'o worker não executa as funções da API');
reset role;
select * from finish();
rollback;
