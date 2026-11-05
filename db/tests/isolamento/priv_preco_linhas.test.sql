-- Isolamento A x B de priv.preco_linhas: A lê só o que é seu; a API não tem DML direto (só funções), então escrever, nem na própria
-- empresa nem na de B, é negado (ADR-013, regra 13). As funções de escrita são testadas em 270_formacao_precos.test.sql.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_preco();

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.preco_linhas where empresa_id = tests.empresa_id('A') $$, 'A lê as linhas da própria empresa');
select is_empty($$ select 1 from priv.preco_linhas where empresa_id = tests.empresa_id('B') $$, 'A não lê linhas de B');
select throws_ok($$ update priv.preco_linhas set nome = nome where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita linhas de B');
select throws_ok($$ delete from priv.preco_linhas where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga linhas de B');
select throws_ok($$ insert into priv.preco_linhas (empresa_id, precificacao_id, nome, tipo, categoria, forma, valor) values (tests.empresa_id('B'), gen_random_uuid(), 'x', 'frete', 'custo', 'por_unidade', 1) $$, '42501', null, 'A não insere linhas em nome de B');

select * from finish();
rollback;
