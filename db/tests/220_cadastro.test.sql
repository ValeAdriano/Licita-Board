-- Autocadastro: só com a chave do banco; nunca SUPERADMIN; cada conta tem a sua empresa; e-mail e CNPJ únicos.
begin;
set local search_path = tap;
select plan(11);

select throws_ok($$ select core.cadastrar_conta('a@teste.local', 'A', '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'Empresa A Ltda', '11222333000181') $$,
  '42501', null, 'sem vv.cadastro=aberto no banco, recusa');

set local vv.cadastro = 'aberto';
select throws_ok($$ select core.cadastrar_conta('a@teste.local', 'A', 'texto-puro', 'Empresa A Ltda', '11222333000181') $$, '22023', null, 'recusa senha que não é hash argon2id');
select lives_ok($$ select core.cadastrar_conta('a@teste.local', 'Pessoa A', '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'Empresa A Ltda', '11222333000181') $$, 'cria a conta e a empresa');
select is((select superadmin from core.usuarios where email = 'a@teste.local'), false, 'nunca nasce SUPERADMIN');
select is((select email_verificado_em from core.usuarios where email = 'a@teste.local'), null, 'e-mail nasce sem verificação');
select is((select papel from core.vinculos v join core.usuarios u on u.id = v.usuario_id where u.email = 'a@teste.local'), 'ADMIN_EMPRESA', 'vínculo ADMIN_EMPRESA');
select is((select count(*)::int from core.permissoes p join core.vinculos v on v.id = p.vinculo_id join core.usuarios u on u.id = v.usuario_id
            where u.email = 'a@teste.local' and p.acao = 'administrar_permissoes'), (select count(*)::int from core.modulos), 'todas as permissões em todos os módulos');
select is((select e.cnpj from core.empresas e join core.vinculos v on v.empresa_id = e.id join core.usuarios u on u.id = v.usuario_id where u.email = 'a@teste.local'), '11222333000181', 'a empresa tem o CNPJ informado');
select throws_ok($$ select core.cadastrar_conta('a@teste.local', 'Outra', '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'Outra Ltda', '12ABC34501DE35') $$, '23505', null, 'e-mail repetido é recusado');
select throws_ok($$ select core.cadastrar_conta('b@teste.local', 'Pessoa B', '$argon2id$v=19$m=19456,t=2,p=1$x$y', 'Empresa B Ltda', '11222333000181') $$, '23505', null, 'CNPJ repetido é recusado (sem criar o usuário)');
select is((select count(*)::int from core.usuarios where email = 'b@teste.local'), 0, 'a recusa do CNPJ desfaz o usuário (mesma transação)');

select * from finish();
rollback;
