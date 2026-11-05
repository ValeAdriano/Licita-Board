-- Isolamento A x B de priv.entregas: A lê só o que é seu; a API não tem DML direto (só funções), então escrever, nem na própria
-- empresa nem na de B, é negado (ADR-013, regra 13). As funções de escrita são testadas em 330_contratos.test.sql.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_contrato();

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.entregas where empresa_id = tests.empresa_id('A') $$, 'A lê as linhas da própria empresa');
select is_empty($$ select 1 from priv.entregas where empresa_id = tests.empresa_id('B') $$, 'A não lê linhas de B');
select throws_ok($$ update priv.entregas set quantidade = quantidade where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita linhas de B');
select throws_ok($$ delete from priv.entregas where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga linhas de B');
select throws_ok($$ insert into priv.entregas (empresa_id, empenho_item_id, quantidade, entregue_em) values (tests.empresa_id('B'), gen_random_uuid(), 1, date '2026-01-01') $$, '42501', null, 'A não insere linhas em nome de B');

select * from finish();
rollback;
