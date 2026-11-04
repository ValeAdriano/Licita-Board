-- Cadastro de conta de teste: só com o banco marcado como dev; nunca SUPERADMIN; empresa fictícia isolada.
begin;
set local search_path = tap;
select plan(9);

select throws_ok($$ select core.cadastrar_conta_teste('a@teste.local', 'A', '$argon2id$v=19$m=19456,t=2,p=1$x$y') $$,
  '42501', null, 'sem a marca de desenvolvimento no banco, recusa');

set local vv.ambiente = 'dev';
select throws_ok($$ select core.cadastrar_conta_teste('a@teste.local', 'A', 'texto-puro') $$, '22023', null, 'recusa senha que não é hash argon2id');
select lives_ok($$ select core.cadastrar_conta_teste('a@teste.local', 'Pessoa A', '$argon2id$v=19$m=19456,t=2,p=1$x$y') $$, 'com a marca, cria a conta');
select is((select superadmin from core.usuarios where email = 'a@teste.local'), false, 'nunca nasce SUPERADMIN');
select isnt((select email_verificado_em from core.usuarios where email = 'a@teste.local'), null, 'e-mail já verificado');
select is((select papel from core.vinculos v join core.usuarios u on u.id = v.usuario_id where u.email = 'a@teste.local'), 'ADMIN_EMPRESA', 'vínculo ADMIN_EMPRESA');
select is((select count(*)::int from core.permissoes p join core.vinculos v on v.id = p.vinculo_id join core.usuarios u on u.id = v.usuario_id
            where u.email = 'a@teste.local' and p.acao = 'administrar_permissoes'), (select count(*)::int from core.modulos), 'todas as permissões em todos os módulos');
select throws_ok($$ select core.cadastrar_conta_teste('a@teste.local', 'Outra', '$argon2id$v=19$m=19456,t=2,p=1$x$y') $$, '23505', null, 'e-mail repetido é recusado');
select lives_ok($$ select core.cadastrar_conta_teste('b@teste.local', 'Pessoa B', '$argon2id$v=19$m=19456,t=2,p=1$x$y') $$, 'cada conta ganha a sua empresa fictícia');

select * from finish();
rollback;
