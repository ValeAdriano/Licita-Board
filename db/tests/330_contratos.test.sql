-- Fase 11 · contratos: saldos calculados, empenho/entrega/faturamento acima do saldo recusados, histórico, sigilo do financeiro, A x B.
begin;
set local search_path = tap;
select plan(22);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_contratos');
select tests.vincular('so_contratos', 'A', 'OPERADOR', array['contratos:visualizar', 'contratos:cadastrar', 'contratos:editar']);
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'ct', priv.criar_contrato(tests.empresa_id('A'), null, 'contrato', 'CT-001/2026', 'Prefeitura X', 'Fornecimento de veículos', date '2026-01-01', date '2026-12-31', 'Fulano (gestor)', 'Beltrano (fiscal)', 5000, date '2027-01-31') $$, 'cria o contrato');
select throws_ok($$ select priv.criar_contrato(tests.empresa_id('A'), null, 'contrato', 'CT-002', 'X', 'Obj', date '2026-12-31', date '2026-01-01', null, null, null, null) $$, '23514', null, 'vigência final antes da inicial é recusada');
select lives_ok($$ insert into g select 'item', priv.adicionar_item_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), 1, 'Veículo utilitário', 'UN', 10, 90000.5) $$, 'adiciona item');
select is((select valor_total from priv.contratos where id = (select id from g where nome = 'ct')), 900005.0000, 'o valor do contrato é a soma dos itens (nunca digitado)');
select lives_ok($$ insert into g select 'emp', priv.registrar_empenho(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'empenho', 'EMP-1', date '2026-02-01', date '2026-03-01', null, jsonb_build_array(jsonb_build_object('contrato_item_id', (select id from g where nome = 'item'), 'quantidade', '6'))) $$, 'empenha 6 de 10');
select throws_ok($$ select priv.registrar_empenho(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'empenho', 'EMP-2', date '2026-02-02', null, null, jsonb_build_array(jsonb_build_object('contrato_item_id', (select id from g where nome = 'item'), 'quantidade', '5'))) $$, '22023', null, 'empenhar 5 com saldo 4 é recusado');
select lives_ok($$ select priv.registrar_empenho(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'ordem_fornecimento', 'OF-1', date '2026-02-03', null, null, jsonb_build_array(jsonb_build_object('contrato_item_id', (select id from g where nome = 'item'), 'quantidade', '4'))) $$, 'o saldo restante (4) pode ser empenhado');
select is((select count(*)::int from priv.empenhos where contrato_id = (select id from g where nome = 'ct')), 2, 'dois empenhos no contrato (o recusado não ficou: transação desfeita)');
select lives_ok($$ select priv.mudar_etapa_empenho(tests.empresa_id('A'), (select id from g where nome = 'emp'), 'nota_emitida', 'NF emitida') $$, 'muda a etapa do fornecimento');
select is((select count(*)::int from priv.empenho_etapas where empenho_id = (select id from g where nome = 'emp')), 2, 'cada etapa fica no histórico');
select lives_ok($$ select priv.registrar_entrega(tests.empresa_id('A'), (select id from priv.empenho_itens where empenho_id = (select id from g where nome = 'emp')), 4, date '2026-03-10', 'provisorio', null) $$, 'entrega parcial de 4 dos 6');
select throws_ok($$ select priv.registrar_entrega(tests.empresa_id('A'), (select id from priv.empenho_itens where empenho_id = (select id from g where nome = 'emp')), 3, date '2026-03-11', 'definitivo', null) $$, '22023', null, 'entregar 3 com saldo 2 é recusado');
select lives_ok($$ insert into g select 'nf', priv.registrar_fatura(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'emp'), 'NF-100', date '2026-03-12', 360000.2, 8000, date '2026-04-12') $$, 'fatura parcial');
select throws_ok($$ select priv.registrar_fatura(tests.empresa_id('A'), (select id from g where nome = 'ct'), null, 'NF-101', date '2026-03-13', 600000, 0, date '2026-04-13') $$, '22023', null, 'faturar acima do saldo do contrato (540.004,80) é recusado');
select lives_ok($$ select priv.registrar_pagamento(tests.empresa_id('A'), (select id from g where nome = 'nf'), date '2026-04-20', 352000.2, 'Retenções aplicadas pelo órgão') $$, 'registra o pagamento');
select throws_ok($$ select priv.registrar_pagamento(tests.empresa_id('A'), (select id from g where nome = 'nf'), date '2026-04-21', 999999, null) $$, '22023', null, 'recebido acima do faturado é recusado');
select lives_ok($$ select priv.registrar_evento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'aditivo', date '2026-06-01', 'Aditivo de valor e prazo', 1000000, date '2027-06-30') $$, 'registra aditivo');
select is((select valor_total::text || '/' || vigencia_fim::text from priv.contratos where id = (select id from g where nome = 'ct')), '1000000.0000/2027-06-30', 'o aditivo atualiza o valor e a vigência');
select is((select valor_antes::text || '>' || valor_depois::text from priv.contrato_eventos where contrato_id = (select id from g where nome = 'ct') and tipo = 'aditivo'), '900005.0000>1000000.0000', 'e fica no histórico com o antes e o depois');
select tests.sair();

select tests.autenticar_como('so_contratos');
select is((select count(*)::int from priv.faturas), 0, 'quem só tem contratos não vê o financeiro (sigilo)');
select throws_ok($$ select priv.registrar_fatura(tests.empresa_id('A'), (select id from g where nome = 'ct'), null, 'NF-X', date '2026-03-13', 1, 0, date '2026-04-13') $$, '42501', null, 'e não registra fatura sem financeiro/editar');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.registrar_empenho(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'empenho', 'EMP-B', date '2026-02-01', null, null, '[]'::jsonb) $$, '42501', null, 'B não empenha no contrato de A');
select * from finish();
rollback;
