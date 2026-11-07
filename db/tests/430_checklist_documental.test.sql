-- Fase 03 · checklist documental por edital (RF-03.10): exigências só por função (documentos/editar), resultado só pelo worker,
-- worker lê documentos só por função, recálculo enfileirado ao salvar, ao mudar a abertura, ao liberar versão e uma vez por dia.
-- Dentro de um teste a transação é uma só: a chave do job (por transação) junta os pedidos; apagamos ops.jobs entre os passos.
begin;
set local search_path = tap;
select plan(28);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['documentos:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'acA', id from priv.acompanhamentos where empresa_id = tests.empresa_id('A');
insert into g select 'acB', id from priv.acompanhamentos where empresa_id = tests.empresa_id('B');
insert into g select 'cnd', id from pub.tipos_documento where slug = 'cnd_federal';
insert into g values ('empA', tests.empresa_id('A')), ('empB', tests.empresa_id('B'));
insert into g select 'balanco', id from pub.tipos_documento where slug = 'balanco';

-- ---------------------------------------------------------------- API (vv_api)
select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'exA', priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'),
  (select id from g where nome = 'cnd'), null, null, null, '  item 8.2 do edital ') $$, 'A cadastra a exigência de CND federal');
select is((select regularidade_fiscal from priv.checklist_exigencias where id = (select id from g where nome = 'exA')), true,
  'regularidade fiscal sugerida pela pasta (fiscal e trabalhista)');
select is((select observacao from priv.checklist_exigencias where id = (select id from g where nome = 'exA')), 'item 8.2 do edital', 'observação aparada');
select is(priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'), (select id from g where nome = 'cnd'),
  true, true, null, null), (select id from g where nome = 'exA'), 'salvar o mesmo tipo atualiza a mesma exigência (uma por tipo)');
select is((select array[conferencia_manual, regularidade_fiscal] from priv.checklist_exigencias where id = (select id from g where nome = 'exA')),
  array[true, true], 'atualiza conferência manual e mantém a regularidade quando não vem');
select lives_ok($$ insert into g select 'exA2', priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'),
  (select id from g where nome = 'balanco'), false, false, false, null) $$, 'A cadastra uma exigência não aplicável');
select throws_ok($$ select priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'), gen_random_uuid(), null, null, null, null) $$,
  '22023', null, 'tipo de documento inexistente');
select throws_ok($$ select priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acB'), (select id from g where nome = 'cnd'), null, null, null, null) $$,
  'P0002', null, 'acompanhamento de B não serve na empresa A');
select throws_ok($$ update priv.checklist_exigencias set aplicavel = false $$, '42501', null, 'a API não edita exigência direto');
select throws_ok($$ select priv.registrar_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'), '[]', current_date, null, false, false) $$,
  '42501', null, 'a API não grava resultado');
select throws_ok($$ select * from priv.checklist_documentos(tests.empresa_id('A')) $$, '42501', null, 'a API não usa a leitura do worker');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'checklist_documental' and payload ->> 'acompanhamento_id' = (select id::text from g where nome = 'acA')), 1,
  'salvar enfileira o recálculo (um job por transação)');

select tests.autenticar_como('so_ver');
select is((select count(*)::int from priv.checklist_exigencias), 2, 'só visualizar vê as exigências da empresa');
select throws_ok($$ select priv.salvar_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'), (select id from g where nome = 'cnd'), null, null, null, null) $$,
  '42501', null, 'só visualizar não cadastra exigência');
select throws_ok($$ select priv.recalcular_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA')) $$, '42501', null, 'só visualizar não pede recálculo');
select tests.sair();

select tests.autenticar_como('usuario_b');
select is((select count(*)::int from priv.checklist_exigencias where empresa_id = tests.empresa_id('A')), 0, 'B não vê exigências de A');
select throws_ok($$ select priv.remover_exigencia_checklist(tests.empresa_id('A'), (select id from g where nome = 'exA')) $$, '42501', null, 'B não remove exigência de A');
select throws_ok($$ select priv.remover_exigencia_checklist(tests.empresa_id('B'), (select id from g where nome = 'exA')) $$, 'P0002', null, 'nem pela própria empresa');
select tests.sair();

-- ---------------------------------------------------------------- worker (vv_worker)
insert into priv.documentos (id, empresa_id, tipo_id, descricao) values
  ('00000000-0000-7000-8000-00000000c001', tests.empresa_id('A'), (select id from g where nome = 'cnd'), 'CND federal A'),
  ('00000000-0000-7000-8000-00000000c002', tests.empresa_id('B'), (select id from g where nome = 'cnd'), 'CND federal B');
insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, validade, status_arquivo) values
  ('00000000-0000-7000-8000-00000000c001', tests.empresa_id('A'), 1, 'documentos/a/1', 'cnd.pdf', date '2026-12-01', 'liberado'),
  ('00000000-0000-7000-8000-00000000c001', tests.empresa_id('A'), 2, 'quarentena/a/2', 'cnd2.pdf', date '2027-06-01', 'quarentena'),
  ('00000000-0000-7000-8000-00000000c002', tests.empresa_id('B'), 1, 'documentos/b/1', 'cnd.pdf', date '2027-01-01', 'liberado');
delete from ops.jobs where tipo = 'checklist_documental';

set local role vv_worker;
select results_eq($$ select documento_id::text, tipo, validade from priv.checklist_documentos((select id from g where nome = 'empA')) $$,
  $$ values ('00000000-0000-7000-8000-00000000c001'::text, 'cnd_federal'::text, date '2026-12-01') $$,
  'o worker recebe só a versão LIBERADA mais recente, só da empresa pedida');
select throws_ok($$ select numero from priv.documentos $$, '42501', null, 'o worker não lê o número nem o arquivo dos documentos');
select throws_ok($$ select priv.registrar_checklist((select id from g where nome = 'empA'), (select id from g where nome = 'acB'), '[]', current_date, null, false, false) $$,
  '42501', null, 'acompanhamento de outra empresa é recusado');
select throws_ok($$ select priv.registrar_checklist((select id from g where nome = 'empA'), (select id from g where nome = 'acA'),
  jsonb_build_array(jsonb_build_object('exigencia_id', (select id from g where nome = 'exA'), 'situacao', 'valido', 'documento_id', '00000000-0000-7000-8000-00000000c002')),
  current_date, null, false, false) $$, '42501', null, 'documento de outra empresa é recusado');
select is(priv.registrar_checklist((select id from g where nome = 'empA'), (select id from g where nome = 'acA'),
  jsonb_build_array(
    jsonb_build_object('exigencia_id', (select id from g where nome = 'exA'), 'situacao', 'vence_antes_da_sessao', 'documento_id', '00000000-0000-7000-8000-00000000c001',
                       'validade', '2026-12-01', 'dias_para_vencer', 24, 'aviso', 'ME/EPP: aviso'),
    jsonb_build_object('exigencia_id', (select id from g where nome = 'exA2'), 'situacao', 'nao_aplicavel')),
  date '2026-11-07', date '2026-12-10', true, true), 2, 'o worker grava o resultado das duas exigências');
reset role;
select is((select array[situacao, validade::text, dias_para_vencer::text, data_sessao::text] from priv.checklist_resultados where exigencia_id = (select id from g where nome = 'exA')),
  array['vence_antes_da_sessao', '2026-12-01', '24', '2026-12-10'], 'resultado gravado com validade, dias e data da sessão');

-- gatilhos de recálculo e rodada diária
update priv.documento_versoes set status_arquivo = 'liberado' where documento_id = '00000000-0000-7000-8000-00000000c001' and versao = 2;
select is((select count(*)::int from ops.jobs where tipo = 'checklist_documental'), 1, 'liberar versão de um tipo exigido enfileira o recálculo');
delete from ops.jobs where tipo = 'checklist_documental';
update priv.acompanhamentos set data_abertura = now() + interval '20 days' where id = (select id from g where nome = 'acA');
update priv.acompanhamentos set data_abertura = now() + interval '20 days' where id = (select id from g where nome = 'acB');
select is((select array_agg(payload ->> 'acompanhamento_id') from ops.jobs where tipo = 'checklist_documental'), array[(select id::text from g where nome = 'acA')],
  'mudar a abertura enfileira só quem tem checklist');
delete from ops.jobs where tipo = 'checklist_documental';
set local role vv_worker;
select is(priv.enfileirar_checklists(date '2026-11-07') + priv.enfileirar_checklists(date '2026-11-07'), 2, 'a rodada diária passa pelo acompanhamento com checklist');
reset role;
select is((select count(*)::int from ops.jobs where tipo = 'checklist_documental'), 1, 'e repetir no mesmo dia não duplica o job');

select * from finish();
rollback;
