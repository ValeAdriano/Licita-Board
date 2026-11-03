-- Matriz de permissões: salvar papel + ativo + permissões numa operação com um step-up.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar', 'empresas:editar']);
create temp table tk (nome text primary key, id uuid);
grant all on tk to vv_api;

select tests.autenticar_como('usuario_a', 'aal2', 3600);
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'OPERADOR', true, array['empresas:visualizar'], null) $$,
  '42501', null, 'salvar exige step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 10);
insert into tk values ('t1', core.iniciar_step_up('alterar_permissoes'));
select lives_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'CLIENTE', true, array['empresas:visualizar'], (select id from tk where nome = 't1')) $$,
  'virar CLIENTE e tirar a escrita na mesma operação funciona (permissões antes do papel)');
select results_eq(
  $$ select v.papel, (select array_agg(p.modulo || ':' || p.acao) from core.permissoes p where p.vinculo_id = v.id)
       from core.vinculos v where v.id = tests.vinculo_id('operador_a', 'A') $$,
  $$ values ('CLIENTE'::text, array['empresas:visualizar']::text[]) $$, 'papel e permissões gravados juntos');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 9);
insert into tk values ('t2', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'CLIENTE', true, array['empresas:editar'], (select id from tk where nome = 't2')) $$,
  '23514', null, 'CLIENTE com escrita é recusado antes de consumir o token');
select lives_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'OPERADOR', false, array['empresas:visualizar'], (select id from tk where nome = 't2')) $$,
  'token não foi gasto pela tentativa recusada; desativar o vínculo funciona');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 8);
insert into tk values ('t3', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('usuario_a', 'A'), 'OPERADOR', true, array['empresas:visualizar'], (select id from tk where nome = 't3')) $$,
  '23514', 'a empresa ficaria sem nenhum administrador de permissões', 'único admin não se rebaixa');
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('usuario_b', 'B'), 'OPERADOR', true, array['empresas:visualizar'], (select id from tk where nome = 't3')) $$,
  '42501', null, 'ADMIN de A não altera vínculo de B');
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'OPERADOR', true, null, (select id from tk where nome = 't3')) $$,
  '22023', null, 'lista nula é recusada');
select tests.sair();

-- CLIENTE → OPERADOR com escrita numa operação (papel antes das permissões novas)
select tests.autenticar_como('usuario_a', 'aal2', 7);
insert into tk values ('t4', core.iniciar_step_up('alterar_permissoes'));
select lives_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'CLIENTE', true, array['empresas:visualizar'], (select id from tk where nome = 't4')) $$,
  'volta a CLIENTE');
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal2', 6);
insert into tk values ('t5', core.iniciar_step_up('alterar_permissoes'));
select lives_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'OPERADOR', true, array['empresas:visualizar', 'empresas:editar'], (select id from tk where nome = 't5')) $$,
  'CLIENTE vira OPERADOR com escrita numa operação só');
select tests.sair();

-- Teto de concessão: ninguém amplia o próprio vínculo; só concede o que tem
select tests.criar_usuario('admin_limitado');
select tests.vincular('admin_limitado', 'A', 'ADMIN_EMPRESA',
  array['empresas:visualizar', 'empresas:editar', 'permissoes:administrar_permissoes']);
select tests.autenticar_como('admin_limitado', 'aal2', 10);
insert into tk values ('l1', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('admin_limitado', 'A'), 'ADMIN_EMPRESA', true,
       array['empresas:visualizar', 'empresas:editar', 'permissoes:administrar_permissoes', 'precos:ver_custos_margens'],
       (select id from tk where nome = 'l1')) $$,
  '42501', 'ninguém amplia as próprias permissões; peça a outro administrador', 'admin não se dá permissão nova');
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('operador_a', 'A'), 'OPERADOR', true,
       array['empresas:visualizar', 'empresas:editar', 'precos:ver_custos_margens'], (select id from tk where nome = 'l1')) $$,
  '42501', 'só é possível conceder permissões que você mesmo tem nesta empresa', 'admin não concede o que não tem');
select tests.sair();

-- Reativar vínculo com permissão que o admin não tem também esbarra no teto (T2.4).
select tests.criar_usuario('inativo_custos');
select tests.vincular('inativo_custos', 'A', 'OPERADOR', array['empresas:visualizar', 'precos:ver_custos_margens']);
update core.vinculos set ativo = false where id = tests.vinculo_id('inativo_custos', 'A');
select tests.autenticar_como('admin_limitado', 'aal2', 9);
insert into tk values ('l2', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.salvar_vinculo(tests.vinculo_id('inativo_custos', 'A'), 'OPERADOR', true,
       array['empresas:visualizar', 'precos:ver_custos_margens'], (select id from tk where nome = 'l2')) $$,
  '42501', 'só é possível conceder permissões que você mesmo tem nesta empresa',
  'reativar vínculo não devolve permissão que o admin não tem');
select tests.sair();

select isnt_empty(
  $$ select 1 from core.step_up_tokens where usado_para_alvo like 'salvar_vinculo:%' and usado_para_empresa_id = tests.empresa_id('A') $$,
  'uso do step-up registra o vínculo alterado');

select * from finish();
rollback;
