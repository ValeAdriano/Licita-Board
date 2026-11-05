-- Isolamento A x B de priv.documento_downloads: A lê só o que é seu; escrever (UPDATE, DELETE, INSERT) em nome de B é bloqueado, seja por falta de DML direto
-- para a API (só funções) ou pela policy da RLS (ADR-013, regra 13). As funções de escrita têm testes próprios nos arquivos numerados.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_cadastros();

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.documento_downloads where empresa_id = tests.empresa_id('A') $$) <> 0, 'A lê as linhas da própria empresa (ou a API nem tem SELECT)');
select ok(tests.leitura($$ select 1 from priv.documento_downloads where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê linhas de B');
select ok(tests.dml_bloqueado($$ update priv.documento_downloads set empresa_id = empresa_id where empresa_id = tests.empresa_id('B') $$), 'A não edita linhas de B');
select ok(tests.dml_bloqueado($$ delete from priv.documento_downloads where empresa_id = tests.empresa_id('B') $$), 'A não apaga linhas de B');
select ok(tests.dml_bloqueado($$ insert into priv.documento_downloads (empresa_id) values (tests.empresa_id('B')) $$), 'A não insere linhas em nome de B');

select * from finish();
rollback;
