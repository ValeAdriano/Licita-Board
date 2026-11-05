-- Isolamento A x B de priv.requisitos_item: A lê só o que é seu; a API não tem DML direto (só funções), então escrever, nem na própria
-- empresa nem na de B, é negado (ADR-013, regra 13). As funções de escrita são testadas em 260_analise_tecnica.test.sql.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.requisitos_item where empresa_id = tests.empresa_id('A') $$, 'A lê as linhas da própria empresa');
select is_empty($$ select 1 from priv.requisitos_item where empresa_id = tests.empresa_id('B') $$, 'A não lê linhas de B');
select throws_ok($$ update priv.requisitos_item set nome = nome where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita linhas de B');
select throws_ok($$ delete from priv.requisitos_item where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga linhas de B');
select throws_ok($$ insert into priv.requisitos_item (empresa_id, participacao_id, nome, operador, valor_numero) values (tests.empresa_id('B'), gen_random_uuid(), 'x', '>=', 1) $$, '42501', null, 'A não insere linhas em nome de B');

select * from finish();
rollback;
