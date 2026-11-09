-- Fase 09 · Bloco 9.5: Documentos posteriores à disputa (CA-7 a CA-13).
begin;
set local search_path = tap;
select plan(17);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['agenda:visualizar', 'documentos:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

insert into g select 'ac_a', id from priv.acompanhamentos where empresa_id = tests.empresa_id('A');
insert into g select 'part_a', id from priv.participacoes where empresa_id = tests.empresa_id('A');
insert into g select 'ac_b', id from priv.acompanhamentos where empresa_id = tests.empresa_id('B');

-- Registra resultado inicial como arrematada em A
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from g where nome = 'part_a'), 'arrematada', 1000, 900, 1, 900, null, null, null, null, 'em_analise', now()) $$,
  'registra resultado arrematada'
);
select tests.sair();

-- Prepara documentos: homologação liberada, ata em quarentena, contrato assinado liberado, CND para checklist
with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao, numero)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'homologacao'), 'Termo de Homologação 01', 'HOM-01')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256)
  select id, tests.empresa_id('A'), 1, 'docs/hom.pdf', 'hom.pdf', 'liberado', repeat('4', 64) from d
)
insert into g select 'doc_hom', id from d;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'ata_sessao'), 'Ata em quarentena')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo)
  select id, tests.empresa_id('A'), 1, 'docs/ata.pdf', 'ata.pdf', 'quarentena' from d
)
insert into g select 'doc_ata_q', id from d;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'contrato_assinado'), 'Contrato assinado PDF')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256)
  select id, tests.empresa_id('A'), 1, 'docs/ct.pdf', 'ct.pdf', 'liberado', repeat('5', 64) from d
)
insert into g select 'doc_ct', id from d;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao, numero)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'cnd_federal'), 'CND Federal vigente', 'CND-100')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade, sha256)
  select id, tests.empresa_id('A'), 1, 'docs/cnd1.pdf', 'cnd1.pdf', 'liberado', current_date + 30, repeat('6', 64) from d
  returning id
)
insert into g select 'doc_cnd', d.id from d union all select 'ver_cnd1', v.id from v;

select tests.autenticar_como('usuario_a');

-- Validações de entrada
select throws_ok(
  $$ select priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'ata_sessao', null, current_date, null, (select id from g where nome = 'doc_ata_q'), null, null, null, null) $$,
  '22023', null, 'documento em quarentena é recusado (22023)'
);
select throws_ok(
  $$ select priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'decisao', null, current_date, null, null, 'https://pncp.gov.br/decisao', null, null, null) $$,
  '22023', null, 'decisão sem subtipo é recusada (22023)'
);
select throws_ok(
  $$ select priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'ata_sessao', null, current_date + 2, null, null, 'https://pncp.gov.br/ata', null, null, null) $$,
  '22023', null, 'data do ato futura é recusada (22023)'
);

-- CA-8 e CA-9: anexar homologação e decisão NÃO muda priv.resultados_item nem cria evento na agenda
select lives_ok(
  $$ insert into g select 'dp_hom', priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), (select id from g where nome = 'part_a'), 'homologacao', null, current_date, 'HOM-01', (select id from g where nome = 'doc_hom'), null, null, null, 'Termo publicado no DOU') $$,
  'registra documento de homologação'
);
select lives_ok(
  $$ insert into g select 'dp_dec', priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'decisao', 'recurso', current_date, 'DEC-02', null, 'https://pncp.gov.br/decisao/02', null, null, 'Improcedente') $$,
  'registra decisão de recurso por link público https'
);
select is(
  (select resultado_final || ':' || p.status
     from priv.resultados_item r join priv.participacoes p on p.id = r.participacao_id
    where r.participacao_id = (select id from g where nome = 'part_a')),
  'arrematada:arrematada',
  'CA-8: anexar homologação não altera resultado_final nem status da participação'
);
select is(
  (select count(*)::int from priv.agenda_eventos where acompanhamento_id = (select id from g where nome = 'ac_a')),
  0,
  'CA-9: anexar decisão/homologação não cria evento automático na agenda'
);

-- CA-10: sem contrato cadastrado, aceita documento de tipo contrato; depois que o contrato é criado, recusa novo documento posterior de contrato/ata/empenho
select lives_ok(
  $$ insert into g select 'dp_ct', priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'contrato', null, current_date, 'CT-01', (select id from g where nome = 'doc_ct'), null, null, null, 'Contrato antes do cadastro') $$,
  'CA-10: sem contrato ligado, registra documento posterior do tipo contrato'
);
select tests.sair();

insert into priv.contratos (empresa_id, acompanhamento_id, tipo, numero, orgao, objeto, vigencia_inicio, vigencia_fim)
values (tests.empresa_id('A'), (select id from g where nome = 'ac_a'), 'contrato', 'CT-01/2026', 'Órgão', 'Objeto', current_date, current_date + 365);

select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ select priv.registrar_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), null, 'empenho', null, current_date, 'EMP-01', null, 'https://pncp.gov.br/empenho/1', null, null, null) $$,
  '22023', null, 'CA-10: com contrato ligado ao acompanhamento, recusa contrato/ata/empenho nos documentos posteriores'
);

-- CA-11: foto da habilitação apresentada exige checklist e fixa a versão daquele momento
select throws_ok(
  $$ select priv.registrar_habilitacao_apresentada(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), current_date) $$,
  '22023', null, 'CA-11: sem checklist aplicável recusa foto da habilitação'
);
select tests.sair();

insert into priv.checklist_exigencias (empresa_id, acompanhamento_id, tipo_id, aplicavel)
values (tests.empresa_id('A'), (select id from g where nome = 'ac_a'), (select id from pub.tipos_documento where slug = 'cnd_federal'), true);

select tests.autenticar_como('usuario_a');
select is(
  priv.registrar_habilitacao_apresentada(tests.empresa_id('A'), (select id from g where nome = 'ac_a'), current_date),
  1,
  'CA-11: grava 1 documento na foto da habilitação apresentada'
);
select tests.sair();

-- Nova versão liberada do mesmo documento DEPOIS da foto não altera a versão fixada na foto
insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade, sha256)
values ((select id from g where nome = 'doc_cnd'), tests.empresa_id('A'), 2, 'docs/cnd2.pdf', 'cnd2.pdf', 'liberado', current_date + 180, repeat('7', 64));

select is(
  (select documento_versao_id = (select id from g where nome = 'ver_cnd1')
     from priv.documentos_posteriores
    where acompanhamento_id = (select id from g where nome = 'ac_a') and tipo = 'habilitacao_propria' and deleted_at is null),
  true,
  'CA-11: nova versão do documento não altera a versão fixada na foto da habilitação'
);

-- Remoção (soft delete com motivo)
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ select priv.remover_documento_posterior(tests.empresa_id('A'), (select id from g where nome = 'dp_dec'), 'Anexado por engano no acompanhamento') $$,
  'remove documento posterior com motivo (soft delete)'
);
select is(
  (select deleted_at is not null from priv.documentos_posteriores where id = (select id from g where nome = 'dp_dec')),
  true,
  'registro fica com deleted_at preenchido'
);
select tests.sair();

-- CA-13: isolamento A x B
select tests.autenticar_como('usuario_b');
select throws_ok(
  $$ select priv.registrar_documento_posterior(tests.empresa_id('B'), (select id from g where nome = 'ac_a'), null, 'ata_sessao', null, current_date, null, null, 'https://pncp.gov.br/ata', null, null, null) $$,
  'P0002', null, 'CA-13: B não registra em acompanhamento de A (P0002 -> 404)'
);
select throws_ok(
  $$ select priv.remover_documento_posterior(tests.empresa_id('B'), (select id from g where nome = 'dp_hom'), 'Motivo invasor') $$,
  'P0002', null, 'CA-13: B não remove documento posterior de A (P0002 -> 404)'
);

select * from finish();
rollback;
