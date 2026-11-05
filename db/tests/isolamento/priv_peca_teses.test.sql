-- Isolamento A x B de priv.teses e priv.peca_teses: A lê só o que é seu; a API não tem DML direto (só funções).
begin;
set local search_path = tap;
select plan(8);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_juridico();
insert into priv.teses (empresa_id, tipo_peca, titulo, texto) select empresa_id, 'impugnacao', 'Marca única', repeat('Argumento de teste. ', 3) from priv.pecas;
insert into priv.peca_teses (empresa_id, peca_id, tese_id) select p.empresa_id, p.id, t.id from priv.pecas p join priv.teses t on t.empresa_id = p.empresa_id;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.teses where empresa_id = tests.empresa_id('A') $$, 'A lê as teses da própria empresa');
select is_empty($$ select 1 from priv.teses where empresa_id = tests.empresa_id('B') $$, 'A não lê teses de B');
select isnt_empty($$ select 1 from priv.peca_teses where empresa_id = tests.empresa_id('A') $$, 'A lê os usos da própria empresa');
select is_empty($$ select 1 from priv.peca_teses where empresa_id = tests.empresa_id('B') $$, 'A não lê usos de B');
select throws_ok($$ update priv.teses set titulo = 'x' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita teses de B');
select throws_ok($$ delete from priv.peca_teses where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga usos de B');
select throws_ok($$ insert into priv.teses (empresa_id, tipo_peca, titulo, texto) values (tests.empresa_id('B'), 'recurso', 'xxx', repeat('x', 30)) $$, '42501', null, 'A não insere teses em nome de B');
select throws_ok($$ insert into priv.peca_teses (empresa_id, peca_id, tese_id) values (tests.empresa_id('B'), gen_random_uuid(), gen_random_uuid()) $$, '42501', null, 'A não insere usos em nome de B');

select * from finish();
rollback;
