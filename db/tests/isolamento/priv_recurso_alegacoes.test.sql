-- Isolamento A x B de priv.recurso_alegacoes: A lê só o que é seu; escrever (UPDATE, DELETE, INSERT) em nome de B é bloqueado, seja por falta de DML direto
-- para a API (só funções) ou pela policy da RLS (ADR-013, regra 13). As funções de escrita têm testes próprios nos arquivos numerados.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_juridico();
insert into priv.recursos_terceiros (empresa_id, acompanhamento_id, peca_id, recorrente, publicado_em, texto)
  select empresa_id, acompanhamento_id, id, 'Concorrente S/A', now(), repeat('Alegação do recurso. ', 5) from priv.pecas;
insert into priv.recurso_alegacoes (empresa_id, recurso_id, origem, resumo) select empresa_id, id, 'manual', 'Alegação de teste' from priv.recursos_terceiros;

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.recurso_alegacoes where empresa_id = tests.empresa_id('A') $$) <> 0, 'A lê as linhas da própria empresa (ou a API nem tem SELECT)');
select ok(tests.leitura($$ select 1 from priv.recurso_alegacoes where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê linhas de B');
select ok(tests.dml_bloqueado($$ update priv.recurso_alegacoes set empresa_id = empresa_id where empresa_id = tests.empresa_id('B') $$), 'A não edita linhas de B');
select ok(tests.dml_bloqueado($$ delete from priv.recurso_alegacoes where empresa_id = tests.empresa_id('B') $$), 'A não apaga linhas de B');
select ok(tests.dml_bloqueado($$ insert into priv.recurso_alegacoes (empresa_id) values (tests.empresa_id('B')) $$), 'A não insere linhas em nome de B');

select * from finish();
rollback;
