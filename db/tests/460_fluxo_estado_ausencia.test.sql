-- Q-34 + Q-35: em cada função alterada por 20261201100000_fluxo_estado_ausencia, registro ausente (ou de outra empresa)
-- é P0002 (→ 404 na API) e registro existente no estado errado é 22023 (→ 400). Caminhos felizes já têm teste próprio.
begin;
set local search_path = tap;
select plan(48);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_proposta();
select tests.cena_juridico();
select tests.cena_contrato();
select tests.criar_usuario('super_q34', true);
create temp table g (nome text primary key, id uuid);
grant all on g to public;

-- Cena de estados (como superusuário): cada registro de A existe, mas no estado em que a ação é recusada.
with x as (insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida, status, justificativa_descarte)
  values (tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'impugnacao', 'Sugestão Q34', 'Dúvida fictícia', 'descartada', 'Descartada no teste') returning id) insert into g select 'sug', id from x;
with x as (insert into priv.teses (empresa_id, tipo_peca, titulo, texto)
  values (tests.empresa_id('A'), 'impugnacao', 'Tese em rascunho', 'Texto fictício de tese com mais de vinte caracteres') returning id) insert into g select 'tese_rasc', id from x;
with x as (insert into priv.teses (empresa_id, tipo_peca, titulo, texto, status)
  values (tests.empresa_id('A'), 'impugnacao', 'Tese arquivada', 'Texto fictício de tese com mais de vinte caracteres', 'arquivada') returning id) insert into g select 'tese_arq', id from x;
insert into g select 'peca', id from priv.pecas where empresa_id = tests.empresa_id('A');
update priv.pecas set status = 'revisao' where id = (select id from g where nome = 'peca');
insert into g select 'prop', id from priv.propostas where empresa_id = tests.empresa_id('A');
insert into g select 'ct', id from priv.contratos where empresa_id = tests.empresa_id('A');
update priv.contratos set status = 'encerrado' where id = (select id from g where nome = 'ct');
insert into g select 'req', id from priv.requisitos_item where empresa_id = tests.empresa_id('A');
update priv.requisitos_item set confirmado_em = now(), confirmado_por = tests.usuario_id('usuario_a') where id = (select id from g where nome = 'req');
with x as (insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento limit 1), 'Documento Q34') returning id) insert into g select 'doc', id from x;
with x as (insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original, enviado_em)
  values (tests.empresa_id('A'), (select id from g where nome = 'doc'), 1, 'q34-1', 'a.pdf', now()) returning id) insert into g select 'ver_quar', id from x;
with x as (insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original, status_arquivo)
  values (tests.empresa_id('A'), (select id from g where nome = 'doc'), 2, 'q34-2', 'b.pdf', 'liberado') returning id) insert into g select 'ver_lib', id from x;
with x as (insert into priv.documento_pendencias (empresa_id, documento_id, instrucoes, status, resultado, resolvida_em)
  values (tests.empresa_id('A'), (select id from g where nome = 'doc'), 'Atualizar', 'resolvida', 'sucesso', now()) returning id) insert into g select 'pend', id from x;
with x as (insert into pub.edital_arquivos (edital_id, url_origem, status_arquivo)
  values ((select id from pub.editais limit 1), 'https://exemplo.test/q34.pdf', 'quarentena') returning id) insert into g select 'arq', id from x;
with x as (insert into core.aprovacoes_exclusao (alvo_tabela, alvo_id, motivo, solicitado_por, status, decidido_por, decidido_em)
  values ('core.empresas', tests.empresa_id('B'), 'Pedido fictício de teste', tests.usuario_id('usuario_a'), 'rejeitada', tests.usuario_id('super_q34'), now()) returning id) insert into g select 'excl', id from x;

select tests.autenticar_como('usuario_a');
-- Q-34 · descartar sugestão, aprovar tese, usar tese
select throws_ok($$ select priv.descartar_sugestao(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000001', 'Justificativa fictícia') $$, 'P0002', 'sugestão não encontrada', 'descartar: sugestão inexistente é P0002');
select throws_ok($$ select priv.descartar_sugestao(tests.empresa_id('A'), (select id from g where nome = 'sug'), 'Justificativa fictícia') $$, '22023', 'só se descarta uma sugestão nova ou intempestiva', 'descartar: já descartada é 22023');
select throws_ok($$ select priv.aprovar_tese(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000002') $$, 'P0002', 'tese não encontrada', 'aprovar tese: inexistente é P0002');
select throws_ok($$ select priv.aprovar_tese(tests.empresa_id('A'), (select id from g where nome = 'tese_rasc')) $$, '22023', null, 'aprovar tese: sem conferência é 22023');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000003', (select id from g where nome = 'tese_rasc')) $$, 'P0002', 'peça não encontrada', 'usar tese: peça inexistente é P0002');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'peca'), '00000000-0000-7000-8000-000000000004') $$, 'P0002', 'tese não encontrada', 'usar tese: tese inexistente é P0002');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'peca'), (select id from g where nome = 'tese_rasc')) $$, '22023', 'só se usa uma tese aprovada e do mesmo tipo da peça', 'usar tese: tese em rascunho é 22023');
-- Q-35 · teses
select throws_ok($$ select priv.editar_tese(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000005', 'Título', 'Texto fictício com mais de vinte caracteres') $$, 'P0002', 'tese não encontrada', 'editar tese: inexistente é P0002');
select throws_ok($$ select priv.editar_tese(tests.empresa_id('A'), (select id from g where nome = 'tese_arq'), 'Título', 'Texto fictício com mais de vinte caracteres') $$, '22023', 'tese arquivada não se edita', 'editar tese: arquivada é 22023');
select throws_ok($$ select priv.arquivar_tese(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000006') $$, 'P0002', 'tese não encontrada', 'arquivar tese: inexistente é P0002');
select throws_ok($$ select priv.arquivar_tese(tests.empresa_id('A'), (select id from g where nome = 'tese_arq')) $$, '22023', 'a tese já está arquivada', 'arquivar tese: já arquivada é 22023');
-- peças e propostas
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000007', null) $$, 'P0002', 'peça não encontrada', 'minuta IA: peça inexistente é P0002');
select throws_ok($$ select priv.pedir_minuta_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), null) $$, '22023', null, 'minuta IA: peça em revisão é 22023');
select throws_ok($$ select priv.pedir_pdf_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000008') $$, 'P0002', 'peça não encontrada', 'PDF da peça: inexistente é P0002');
select throws_ok($$ select priv.pedir_pdf_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '22023', 'só a peça com documento final tem PDF', 'PDF da peça: sem documento final é 22023');
select throws_ok($$ select priv.pedir_pdf_proposta(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000009') $$, 'P0002', 'proposta não encontrada', 'PDF da proposta: inexistente é P0002');
select throws_ok($$ select priv.pedir_pdf_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop')) $$, '22023', 'só a proposta final tem PDF', 'PDF da proposta: rascunho é 22023');
select throws_ok($$ select priv.salvar_proposta(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000a', null, 60, 30, 12, null, null) $$, 'P0002', 'proposta não encontrada', 'salvar proposta: inexistente é P0002');
-- contratos
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000b', 'reajuste', 'Pedido de reajuste') $$, 'P0002', 'contrato não encontrado', 'pedido contratual: contrato inexistente é P0002');
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'reajuste', 'Pedido de reajuste') $$, '22023', 'só se abre pedido de um contrato ativo', 'pedido contratual: contrato encerrado é 22023');
select throws_ok($$ select priv.registrar_empenho(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000c', 'empenho', 'EMP-Q34', date '2026-02-02', null, null, '[]'::jsonb) $$, 'P0002', 'contrato não encontrado', 'empenho: contrato inexistente é P0002');
select throws_ok($$ select priv.registrar_empenho(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'empenho', 'EMP-Q34', date '2026-02-02', null, null, '[]'::jsonb) $$, '22023', 'só se registra empenho de um contrato ativo', 'empenho: contrato encerrado é 22023');
-- análise
select throws_ok($$ select priv.confirmar_requisito(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000d') $$, 'P0002', 'requisito não encontrado', 'confirmar requisito: inexistente é P0002');
select throws_ok($$ select priv.confirmar_requisito(tests.empresa_id('A'), (select id from g where nome = 'req')) $$, '22023', 'requisito já confirmado', 'confirmar requisito: já confirmado é 22023');
-- documentos
select throws_ok($$ select priv.concluir_upload(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000e') $$, 'P0002', 'versão não encontrada', 'concluir upload: versão inexistente é P0002');
select throws_ok($$ select priv.concluir_upload(tests.empresa_id('A'), (select id from g where nome = 'ver_quar')) $$, '22023', 'versão já enviada ou fora da quarentena', 'concluir upload: já enviada é 22023');
select throws_ok($$ select priv.registrar_download(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000000f') $$, 'P0002', 'versão não encontrada', 'download: versão inexistente é P0002');
select throws_ok($$ select priv.registrar_download(tests.empresa_id('A'), (select id from g where nome = 'ver_quar')) $$, '22023', null, 'download: versão em quarentena é 22023');
select throws_ok($$ select priv.registrar_falha_atualizacao(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000010', 'Falhou') $$, 'P0002', 'pendência não encontrada', 'falha de atualização: pendência inexistente é P0002');
select throws_ok($$ select priv.registrar_falha_atualizacao(tests.empresa_id('A'), (select id from g where nome = 'pend'), 'Falhou') $$, '22023', 'pendência já resolvida', 'falha de atualização: já resolvida é 22023');
select throws_ok($$ select pub.registrar_download_edital('00000000-0000-7000-8000-000000000011') $$, 'P0002', 'arquivo não encontrado', 'download do edital: arquivo inexistente é P0002');
select throws_ok($$ select pub.registrar_download_edital((select id from g where nome = 'arq')) $$, '22023', null, 'download do edital: arquivo em quarentena é 22023');
-- IA (A não cadastrou chave) e pesquisa manual (as fontes do seed nascem desativadas)
select throws_ok($$ select priv.definir_modelo_ia(tests.empresa_id('A'), 'gpt-5-mini') $$, '22023', 'cadastre a chave primeiro', 'modelo IA: sem chave é 22023');
select throws_ok($$ select priv.pedir_teste_chave_ia(tests.empresa_id('A')) $$, '22023', 'cadastre a chave primeiro', 'teste da chave: sem chave é 22023');
select throws_ok($$ select ops.solicitar_coleta_manual(tests.empresa_id('A'), 'fonte-que-nao-existe', current_date - 5, current_date, null) $$, 'P0002', 'fonte inexistente', 'coleta manual: fonte inexistente é P0002');
select throws_ok($$ select ops.solicitar_coleta_manual(tests.empresa_id('A'), 'pncp', current_date - 5, current_date, null) $$, '22023', 'fonte desativada', 'coleta manual: fonte desativada é 22023');
select tests.sair();

-- salvar proposta fora do rascunho (estado mudado como superusuário)
update priv.propostas set status = 'conferencia' where id = (select id from g where nome = 'prop');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.salvar_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop'), null, 60, 30, 12, null, null) $$, '22023', 'só se edita uma proposta em rascunho', 'salvar proposta: em conferência é 22023');
select tests.sair();

-- worker: verificação antivírus
set local role vv_worker;
select throws_ok($$ select priv.registrar_verificacao('00000000-0000-7000-8000-000000000012', 'liberado', 'application/pdf', 1, repeat('a', 64), null) $$, 'P0002', 'versão não encontrada', 'verificação: versão inexistente é P0002');
select throws_ok($$ select priv.registrar_verificacao((select id from g where nome = 'ver_lib'), 'liberado', 'application/pdf', 1, repeat('a', 64), null) $$, '22023', 'versão não está em quarentena', 'verificação: versão já liberada é 22023');
reset role;

-- SUPERADMIN: decisão de exclusão
select tests.autenticar_como('super_q34');
select throws_ok($$ select core.decidir_exclusao('00000000-0000-7000-8000-000000000013', false, null) $$, 'P0002', 'pedido de exclusão inexistente', 'exclusão: pedido inexistente é P0002');
select throws_ok($$ select core.decidir_exclusao((select id from g where nome = 'excl'), false, null) $$, '22023', 'pedido de exclusão já decidido', 'exclusão: pedido já decidido é 22023');
select tests.sair();

-- B, com permissão na própria empresa, apontando ids de A: ausente (P0002), nunca o 22023 de estado
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.descartar_sugestao(tests.empresa_id('B'), (select id from g where nome = 'sug'), 'Justificativa do invasor') $$, 'P0002', null, 'descartar: sugestão de outra empresa é P0002');
select throws_ok($$ select priv.aprovar_tese(tests.empresa_id('B'), (select id from g where nome = 'tese_rasc')) $$, 'P0002', null, 'aprovar tese: de outra empresa é P0002');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('B'), (select id from g where nome = 'peca'), (select id from g where nome = 'tese_rasc')) $$, 'P0002', null, 'usar tese: peça de outra empresa é P0002');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('B'), (select id from priv.pecas where empresa_id = tests.empresa_id('B')), (select id from g where nome = 'tese_rasc')) $$, 'P0002', 'tese não encontrada', 'usar tese: tese de outra empresa é P0002');
select throws_ok($$ select priv.editar_tese(tests.empresa_id('B'), (select id from g where nome = 'tese_arq'), 'Invasor', 'Texto fictício com mais de vinte caracteres') $$, 'P0002', null, 'editar tese: de outra empresa é P0002');
select throws_ok($$ select priv.salvar_proposta(tests.empresa_id('B'), (select id from g where nome = 'prop'), null, 60, 30, 12, null, null) $$, 'P0002', null, 'salvar proposta: de outra empresa é P0002');
select tests.sair();
select is((select status from priv.sugestoes_pecas where id = (select id from g where nome = 'sug')), 'descartada', 'a sugestão de A ficou intacta');

select * from finish();
rollback;
