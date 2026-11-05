-- Minuta por IA: só por função, antes da revisão, uma por vez, limite diário, minuta editada vira ia_revisada, A x B.
begin;
set local search_path = tap;
select plan(9);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.cena_analise();
select tests.cena_juridico();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'm', priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A')), 'Argumentar sobre a cláusula 7.2') $$, 'pede a minuta à IA');
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A')), null) $$, '22023', null, 'uma por vez');
select throws_ok($$ update priv.pecas_ia set status = 'concluida' $$, '42501', null, 'a API não altera o resultado da IA');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'minutar_peca'), 1, 'o pedido enfileira o worker (a API não chama a IA)');
update priv.pecas_ia set status = 'concluida';
insert into priv.pecas_ia (empresa_id, peca_id, status) select empresa_id, peca_id, 'concluida' from priv.pecas_ia, generate_series(1, 4);
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A')), null) $$, '54000', null, 'limite diário (custo)');
select tests.sair();
update priv.pecas set minuta_origem = 'ia', minuta = 'Rascunho da IA' where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.salvar_minuta(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A')), 'Texto revisado pela advogada', 'Cláusula 7.2') $$, 'a pessoa edita o rascunho da IA');
select is((select minuta_origem from priv.pecas where empresa_id = tests.empresa_id('A')), 'ia_revisada', 'fica registrado que nasceu de rascunho da IA e foi revisado');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A')), null) $$, '42501', null, 'só visualizar não pede minuta');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from priv.pecas where empresa_id = tests.empresa_id('A') limit 1), null) $$, '42501', null, 'B não pede minuta de peça de A');
select * from finish();
rollback;
