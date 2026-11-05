-- Isolamento A x B de priv.recursos_terceiros e priv.recurso_alegacoes: A lê só o que é seu; a API não tem DML direto (só funções).
begin;
set local search_path = tap;
select plan(8);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_juridico();
insert into priv.recursos_terceiros (empresa_id, acompanhamento_id, peca_id, recorrente, publicado_em, texto)
  select empresa_id, acompanhamento_id, id, 'Concorrente S/A', now(), repeat('Alegação do recurso. ', 5) from priv.pecas;
insert into priv.recurso_alegacoes (empresa_id, recurso_id, origem, resumo) select empresa_id, id, 'manual', 'Alegação de teste' from priv.recursos_terceiros;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.recursos_terceiros where empresa_id = tests.empresa_id('A') $$, 'A lê os recursos da própria empresa');
select is_empty($$ select 1 from priv.recursos_terceiros where empresa_id = tests.empresa_id('B') $$, 'A não lê recursos de B');
select isnt_empty($$ select 1 from priv.recurso_alegacoes where empresa_id = tests.empresa_id('A') $$, 'A lê as alegações da própria empresa');
select is_empty($$ select 1 from priv.recurso_alegacoes where empresa_id = tests.empresa_id('B') $$, 'A não lê alegações de B');
select throws_ok($$ update priv.recursos_terceiros set recorrente = 'x' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita recursos de B');
select throws_ok($$ delete from priv.recurso_alegacoes where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga alegações de B');
select throws_ok($$ insert into priv.recurso_alegacoes (empresa_id, recurso_id, origem, resumo) values (tests.empresa_id('B'), gen_random_uuid(), 'manual', 'x') $$, '42501', null, 'A não insere alegações em nome de B');
select throws_ok($$ insert into priv.recursos_terceiros (empresa_id, acompanhamento_id, peca_id, recorrente, publicado_em, texto) values (tests.empresa_id('B'), gen_random_uuid(), gen_random_uuid(), 'x', now(), repeat('x', 60)) $$, '42501', null, 'A não insere recursos em nome de B');

select * from finish();
rollback;
