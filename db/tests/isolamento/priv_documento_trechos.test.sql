-- Isolamento A x B de priv.documento_trechos: A lê só o que é seu; escrever (UPDATE, DELETE, INSERT) em nome de B é bloqueado (ADR-013, regra 13).
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_cadastros();

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.documento_trechos where empresa_id = tests.empresa_id('A') $$) <> 0, 'A lê as linhas da própria empresa (ou a API nem tem SELECT)');
select ok(tests.leitura($$ select 1 from priv.documento_trechos where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê linhas de B');
select ok(tests.dml_bloqueado($$ update priv.documento_trechos set texto = texto where empresa_id = tests.empresa_id('B') $$), 'A não edita linhas de B');
select ok(tests.dml_bloqueado($$ delete from priv.documento_trechos where empresa_id = tests.empresa_id('B') $$), 'A não apaga linhas de B');
select ok(tests.dml_bloqueado($$ insert into priv.documento_trechos (empresa_id, documento_id, versao_id, pagina, ordem, texto) values (tests.empresa_id('B'), gen_random_uuid(), gen_random_uuid(), 1, 1, 'x') $$), 'A não insere linhas em nome de B');

select * from finish();
rollback;
