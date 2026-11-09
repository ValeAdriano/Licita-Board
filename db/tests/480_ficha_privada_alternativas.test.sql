-- Fase 06 · Q-14: priv.documento_trechos, priv.registrar_trechos_documento e priv.analisar_alternativas_item.
begin;
set local search_path = tap;
select plan(12);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_cadastros();

create temp table g (nome text primary key, id uuid);
grant all on g to public;

-- A adiciona um segundo produto ativo para testar alternativas (6.4)
insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao, status_comercial)
values (tests.empresa_id('A'), (select id from pub.categorias where slug = 'veiculos'), 'P-A2', 'Segundo produto A', 'ativo');

insert into g select 'ver_a', id from priv.documento_versoes where empresa_id = tests.empresa_id('A') limit 1;
insert into g select 'ver_b', id from priv.documento_versoes where empresa_id = tests.empresa_id('B') limit 1;
insert into g select 'doc_b', id from priv.documentos where empresa_id = tests.empresa_id('B') limit 1;
update priv.documento_versoes set status_arquivo = 'liberado' where id = (select id from g where nome = 'ver_a');

-- API não pode chamar registrar_trechos_documento
select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ select priv.registrar_trechos_documento((select id from g where nome = 'ver_a'), '[]'::jsonb) $$,
  '42501', null, 'vv_api não executa registrar_trechos_documento');

-- A enfileira análise de alternativas do catálogo
select is(
  priv.analisar_alternativas_item(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), null),
  2, 'analisar_alternativas_item enfileira os 2 produtos ativos da empresa A');
select throws_ok(
  $$ select priv.analisar_alternativas_item(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('B')), null) $$,
  'P0002', null, 'participação de outra empresa devolve P0002');
select tests.sair();

-- B não enfileira alternativas em A
select tests.autenticar_como('usuario_b');
select throws_ok(
  $$ select priv.analisar_alternativas_item(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), null) $$,
  '42501', null, 'B sem permissão em A');
select tests.sair();

-- Worker registra os trechos da versão liberada e reenfileira análises que referenciam o documento
update priv.analise_linhas
   set ficha_documento_id = (select documento_id from priv.documento_versoes where id = (select id from g where nome = 'ver_a')),
       ficha_pagina = 2, ficha_trecho = 'Potência máxima de 85 kW',
       ficha_conferida_por = tests.usuario_id('usuario_a'), ficha_conferida_em = now()
 where empresa_id = tests.empresa_id('A');

delete from ops.jobs where tipo = 'analisar_item';
set local role vv_worker;
select is(
  priv.registrar_trechos_documento(
    (select id from g where nome = 'ver_a'),
    '[{"pagina": 1, "ordem": 1, "texto": "Capa da ficha", "origem": "texto"}, {"pagina": 2, "ordem": 1, "texto": "Potência máxima de 85 kW a 3500 rpm", "origem": "ocr"}]'::jsonb
  ),
  2, 'worker grava 2 trechos do documento liberado');
reset role;

select is((select count(*)::int from priv.documento_trechos where versao_id = (select id from g where nome = 'ver_a')), 2, 'trechos substituídos de forma idempotente');
select ok((select count(*)::int from ops.jobs where tipo = 'analisar_item' and empresa_id = tests.empresa_id('A')) >= 1, 'liberar trechos da ficha reenfileira analisar_item');

-- Versão em quarentena é recusada em registrar_trechos_documento
set local role vv_worker;
select throws_ok(
  $$ select priv.registrar_trechos_documento((select id from g where nome = 'ver_b'), '[]'::jsonb) $$,
  '22023', null, 'versão não liberada é recusada');
reset role;

-- Conferir ficha exige documento da própria empresa e reseta ficha_citacao_verificada
update priv.analise_linhas set ficha_citacao_verificada = true where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ select priv.conferir_ficha(
       tests.empresa_id('A'),
       (select id from priv.analise_linhas where empresa_id = tests.empresa_id('A') limit 1),
       (select id from g where nome = 'doc_b'),
       1, 'Trecho válido aqui', null) $$,
  'P0002', null, 'conferir_ficha recusa documento de outra empresa com P0002');
select lives_ok(
  $$ select priv.conferir_ficha(
       tests.empresa_id('A'),
       (select id from priv.analise_linhas where empresa_id = tests.empresa_id('A') limit 1),
       (select id from priv.documentos where empresa_id = tests.empresa_id('A') limit 1),
       2, 'Potência máxima de 85 kW', null) $$,
  'conferir_ficha aceita documento da própria empresa');
select is(
  (select ficha_citacao_verificada from priv.analise_linhas where empresa_id = tests.empresa_id('A') limit 1),
  false, 'conferir_ficha reseta ficha_citacao_verificada até o worker conferir');
select tests.sair();

-- Auditoria registrada em priv.documento_trechos
select isnt_empty(
  $$ select 1 from audit.audit_log where table_name = 'documento_trechos' and operation = 'INSERT' $$,
  'inserção em documento_trechos gera auditoria');

select * from finish();
rollback;
