-- Fase 06 · extração por IA: só por função com permissão, limite de custo, uma por vez, confirmação humana, A x B.
begin;
set local search_path = tap;
select plan(10);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['analises:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'e1', priv.pedir_extracao_requisitos(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A'))) $$, 'A pede a extração');
select throws_ok($$ select priv.pedir_extracao_requisitos(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A'))) $$, '22023', null, 'uma extração por vez por item');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'extrair_requisitos'), 1, 'o pedido enfileira o worker (a API não chama a IA)');
-- encerra a pendente e simula 4 anteriores no dia: o 6º pedido bate no limite de custo
update priv.extracoes_ia set status = 'concluida';
insert into priv.extracoes_ia (empresa_id, participacao_id, status) select empresa_id, participacao_id, 'concluida' from priv.extracoes_ia, generate_series(1, 4);
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.pedir_extracao_requisitos(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A'))) $$, '54000', null, 'limite diário por item (controle de custo)');
select throws_ok($$ update priv.extracoes_ia set status = 'concluida' $$, '42501', null, 'a API não altera o resultado da extração');
select tests.sair();

-- requisito sugerido pela IA nasce NÃO confirmado; a pessoa confirma
insert into priv.requisitos_item (empresa_id, participacao_id, nome, operador, valor_numero, origem, modelo_ia, prompt_versao)
select empresa_id, id, 'Sugestão da IA', '>=', 10, 'ia', 'modelo-x', 'req-v1' from priv.participacoes where empresa_id = tests.empresa_id('A');
select is((select confirmado_em from priv.requisitos_item where origem = 'ia' and empresa_id = tests.empresa_id('A')), null, 'sugestão da IA nasce sem confirmação');
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.confirmar_requisito(tests.empresa_id('A'), (select id from priv.requisitos_item where origem = 'ia' and empresa_id = tests.empresa_id('A'))) $$, '42501', null, 'só visualizar não confirma');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.confirmar_requisito(tests.empresa_id('A'), (select id from priv.requisitos_item where origem = 'ia' and empresa_id = tests.empresa_id('A'))) $$, '42501', null, 'B não confirma requisito de A');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.confirmar_requisito(tests.empresa_id('A'), (select id from priv.requisitos_item where origem = 'ia' and empresa_id = tests.empresa_id('A'))) $$, 'quem edita confirma');
select isnt((select confirmado_por from priv.requisitos_item where origem = 'ia' and empresa_id = tests.empresa_id('A')), null, 'registra quem confirmou');
select * from finish();
rollback;
