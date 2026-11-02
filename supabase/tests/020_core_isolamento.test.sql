-- Isolamento A x B e controle de acesso nas tabelas de core (Prompt 1.3/1.4; CA-1, CA-2, CA-3).
begin;
select plan(42);

select tests.criar_empresas_ab();
select tests.criar_usuario('operador_b');
select tests.vincular('operador_b', 'B', 'OPERADOR', array[]::text[]);

-- =============================================================== A não enxerga B
select tests.autenticar_como('usuario_a');

select results_eq(
  $$ select razao_social from core.empresas order by 1 $$,
  $$ values ('Empresa Teste A') $$,
  'A lista só a própria empresa'
);
select is_empty(
  $$ select 1 from core.vinculos where empresa_id = tests.empresa_id('B') $$,
  'A não lê vínculos de B'
);
select is_empty(
  $$ select 1 from core.permissoes where empresa_id = tests.empresa_id('B') $$,
  'A não lê permissões de B'
);
select is_empty(
  $$ select 1 from core.usuarios where id = tests.usuario_id('usuario_b') $$,
  'A não lê o perfil do usuário de B'
);
select is_empty(
  $$ select 1 from audit.audit_log where empresa_id = tests.empresa_id('B') $$,
  'A não lê auditoria de B'
);
select isnt_empty(
  $$ select 1 from audit.audit_log where empresa_id = tests.empresa_id('A') $$,
  'A lê a auditoria da própria empresa'
);
select ok(
  not core.has_permission(tests.empresa_id('B'), 'empresas', 'visualizar'),
  'has_permission nega A na empresa B'
);

-- =============================================================== A não altera B
select results_eq(
  $$ with u as (update core.empresas set razao_social = 'Hackeada' where id = tests.empresa_id('B') returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'A não edita a empresa B'
);
select throws_ok(
  $$ update core.vinculos set ativo = false where empresa_id = tests.empresa_id('B') $$,
  '42501', null,
  'vínculo não é alterado direto pela API (só por RPC com step-up)'
);
select throws_ok(
  $$ insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
     values (tests.vinculo_id('usuario_b', 'B'), tests.empresa_id('B'), 'empresas', 'editar') $$,
  '42501', null,
  'permissão não é concedida direto pela API (só por RPC com step-up)'
);
select throws_ok(
  $$ delete from core.permissoes where empresa_id = tests.empresa_id('B') $$,
  '42501', null,
  'permissão não é revogada direto pela API'
);
select tests.sair();
select throws_ok(
  $$ insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
     values (tests.vinculo_id('operador_b', 'B'), tests.empresa_id('A'), 'empresas', 'editar') $$,
  '23503', null,
  'vínculo de B com empresa_id de A é barrado pela FK composta (mesmo para o dono)'
);
select tests.autenticar_como('usuario_a');

-- =============================================================== vínculos: sem cooptar usuários
select throws_ok(
  $$ insert into core.vinculos (usuario_id, empresa_id, papel)
     values (tests.usuario_id('usuario_b'), tests.empresa_id('A'), 'OPERADOR') $$,
  '42501', null,
  'ADMIN_EMPRESA não vincula usuário de outra empresa à sua (vínculo só por SUPERADMIN/convite)'
);
select throws_ok(
  $$ insert into core.vinculos (usuario_id, empresa_id, papel)
     values (tests.usuario_id('usuario_a'), tests.empresa_id('B'), 'ADMIN_EMPRESA') $$,
  '42501', null,
  'A não se vincula à empresa B'
);
select throws_ok(
  $$ update core.vinculos set usuario_id = tests.usuario_id('usuario_b') where id = tests.vinculo_id('usuario_a', 'A') $$,
  '42501', null,
  'vínculo não pode ser repassado a outro usuário'
);
select throws_ok(
  $$ update core.vinculos set empresa_id = tests.empresa_id('B') where id = tests.vinculo_id('usuario_a', 'A') $$,
  '42501', null,
  'vínculo não pode ser movido para outra empresa'
);

-- =============================================================== empresa: colunas protegidas
select throws_ok(
  $$ update core.empresas set cnpj = '11444777000161' where id = tests.empresa_id('A') $$,
  '42501', null,
  'ADMIN_EMPRESA não troca o CNPJ'
);
select throws_ok(
  $$ update core.empresas set deleted_at = now() where id = tests.empresa_id('A') $$,
  '42501', null,
  'ADMIN_EMPRESA não arquiva a empresa'
);
select throws_ok(
  $$ update core.empresas set ativo = false where id = tests.empresa_id('A') $$,
  '42501', null,
  'ADMIN_EMPRESA não desativa a empresa'
);
select throws_ok(
  $$ delete from core.empresas where id = tests.empresa_id('A') $$,
  '42501', null,
  'ninguém apaga empresa pela API'
);
select throws_ok(
  $$ insert into core.empresas (razao_social, cnpj) values ('Nova', '11444777000161') $$,
  '42501', null,
  'ADMIN_EMPRESA não cria empresa (só SUPERADMIN)'
);
select lives_ok(
  $$ update core.empresas set nome_fantasia = 'Fantasia A' where id = tests.empresa_id('A') $$,
  'ADMIN_EMPRESA edita o nome fantasia'
);

-- =============================================================== escalada de privilégio
select throws_ok(
  $$ update core.usuarios set superadmin = true where id = tests.usuario_id('usuario_a') $$,
  '42501', null,
  'usuário não se promove a SUPERADMIN'
);
select lives_ok(
  $$ update core.usuarios set nome = 'Novo nome' where id = tests.usuario_id('usuario_a') $$,
  'usuário edita o próprio nome'
);
select tests.sair();
select throws_ok(
  $$ update core.vinculos set papel = 'CLIENTE' where id = tests.vinculo_id('usuario_a', 'A') $$,
  '23514', null,
  'ADMIN não vira CLIENTE mantendo permissões de escrita (contorno do MFA)'
);

-- =============================================================== MFA (aal2) para perfis internos
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal1');
select is_empty($$ select 1 from core.empresas $$, 'ADMIN_EMPRESA sem MFA (aal1) não lê a empresa');
select results_eq(
  $$ with u as (update core.empresas set nome_fantasia = 'X' returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'ADMIN_EMPRESA sem MFA não escreve'
);

-- =============================================================== CLIENTE
select tests.sair();
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['empresas:visualizar']);
select throws_ok(
  $$ insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
     values (tests.vinculo_id('cliente_a', 'A'), tests.empresa_id('A'), 'empresas', 'editar') $$,
  '23514', null,
  'CLIENTE não recebe ação além de visualizar'
);
select tests.autenticar_como('cliente_a', 'aal1');
select results_eq(
  $$ select razao_social from core.empresas $$,
  $$ values ('Empresa Teste A') $$,
  'CLIENTE lê a própria empresa com aal1'
);
select results_eq(
  $$ with u as (update core.empresas set razao_social = 'X' returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'CLIENTE não altera a empresa'
);

-- Defesa em profundidade: mesmo se um CLIENTE tiver permissão de escrita (dado legado, bug na
-- trigger), sem MFA has_permission só libera visualizar.
select tests.sair();
alter table core.permissoes disable trigger permissoes_cliente;
insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
values (tests.vinculo_id('cliente_a', 'A'), tests.empresa_id('A'), 'empresas', 'editar');
alter table core.permissoes enable trigger permissoes_cliente;
select tests.autenticar_como('cliente_a', 'aal1');
select ok(
  not core.has_permission(tests.empresa_id('A'), 'empresas', 'editar'),
  'CLIENTE sem MFA não ganha escrita nem com permissão gravada'
);

-- =============================================================== OPERADOR, revogação e auditoria
select tests.sair();
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar', 'usuarios:visualizar']);
select tests.autenticar_como('operador_a');
select isnt_empty($$ select 1 from core.empresas $$, 'OPERADOR com visualizar lê a empresa');
select is_empty(
  $$ select 1 from audit.audit_log $$,
  'OPERADOR sem auditoria/visualizar não lê a auditoria nem da própria empresa'
);

select tests.sair();
delete from core.permissoes
 where vinculo_id = tests.vinculo_id('operador_a', 'A') and modulo = 'empresas' and acao = 'visualizar';
select tests.autenticar_como('operador_a');
select is_empty($$ select 1 from core.empresas $$, 'revogação vale na consulta seguinte');

-- =============================================================== inativos e arquivados
select tests.sair();
update core.usuarios set ativo = false where id = tests.usuario_id('usuario_b');
select tests.autenticar_como('usuario_b');
select is_empty($$ select 1 from core.empresas $$, 'usuário inativo não lê nada');

select tests.sair();
update core.empresas set deleted_at = now() where id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select is_empty($$ select 1 from core.empresas $$, 'empresa arquivada não é acessível');

select tests.sair();
update core.empresas set deleted_at = null where id = tests.empresa_id('A');
update core.vinculos set ativo = false where id = tests.vinculo_id('usuario_a', 'A');
select tests.autenticar_como('usuario_a');
select is_empty($$ select 1 from core.empresas $$, 'vínculo inativo não lê nada');

-- =============================================================== anon
select tests.sair();
set local role anon;
select throws_ok($$ select 1 from core.empresas $$, '42501', null, 'anon não acessa core');
select throws_ok($$ select 1 from audit.audit_log $$, '42501', null, 'anon não acessa audit');
reset role;

-- =============================================================== SUPERADMIN
select tests.criar_usuario('super', true);
select tests.autenticar_como('super');
select results_eq(
  $$ select count(*)::int from core.empresas where razao_social like 'Empresa Teste _' $$,
  $$ values (2) $$,
  'SUPERADMIN com MFA lê todas as empresas'
);
select throws_ok(
  $$ update core.usuarios set superadmin = true where id = tests.usuario_id('usuario_a') $$,
  '42501', null,
  'nem SUPERADMIN muda superadmin pela API (só service role/RPC)'
);
select tests.sair();
select tests.autenticar_como('super', 'aal1');
select is_empty($$ select 1 from core.empresas $$, 'SUPERADMIN sem MFA não lê nada');

select tests.sair();
select * from finish();
rollback;
