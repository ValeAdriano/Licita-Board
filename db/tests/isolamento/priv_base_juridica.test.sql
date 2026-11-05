-- Isolamento A x B de priv.base_juridica: A lê só o que é seu; a API não tem DML direto (só funções), então escrever, nem na própria
-- empresa nem na de B, é negado (ADR-013, regra 13). As funções de escrita são testadas em 320_juridico.test.sql.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_juridico();

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.base_juridica where empresa_id = tests.empresa_id('A') $$, 'A lê as linhas da própria empresa');
select is_empty($$ select 1 from priv.base_juridica where empresa_id = tests.empresa_id('B') $$, 'A não lê linhas de B');
select throws_ok($$ update priv.base_juridica set titulo = titulo where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita linhas de B');
select throws_ok($$ delete from priv.base_juridica where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga linhas de B');
select throws_ok($$ insert into priv.base_juridica (empresa_id, tipo, numero, titulo, link_oficial) values (tests.empresa_id('B'), 'lei', '1/2000', 'xyz', 'https://x.gov.br') $$, '42501', null, 'A não insere linhas em nome de B');

select * from finish();
rollback;
