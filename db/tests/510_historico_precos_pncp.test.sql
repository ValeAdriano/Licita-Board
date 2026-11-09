begin;
set local search_path = tap;
select plan(11);

select tests.criar_empresas_ab();

create temp table g (nome text primary key, id uuid not null);
grant all on g to public;

insert into g select 'fonte', id from ops.fontes where slug = 'pncp';

with o as (
  insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge, municipio)
  values ('00000000000191', 'Município Histórico', 'PR', '4106902', 'Curitiba')
  on conflict (cnpj, unidade_codigo) do update set razao_social = excluded.razao_social
  returning id
), ed as (
  insert into pub.editais (fonte_id, id_externo, orgao_id, numero_edital, objeto, hash_conteudo)
  select (select id from g where nome = 'fonte'), 'PNCP-HP-2026-1', id, 'PE 75/2026', 'Compra de monitores', repeat('a', 64) from o
  returning id
), it as (
  insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade, unidade_medida, valor_unitario_estimado)
  select id, 1, 'Monitor LED 24 polegadas', 10, 'UN', 850.0000 from ed
  returning id, edital_id
)
insert into g
select 'edital', edital_id from it
union all
select 'item', id from it;

-- 1-3: CA-8 (LGPD): vv_worker grava PJ e PF sem dados pessoais; PF com nome ou documento é recusado (23514)
set local role vv_worker;

select throws_ok(
  $$ insert into pub.precos_historicos (
       fonte_id, id_externo, edital_id, edital_item_id, fornecedor_tipo, fornecedor_nome, situacao, hash_conteudo, link_origem
     ) values (
       (select id from g where nome = 'fonte'), 'RES-PF-NOME', (select id from g where nome = 'edital'),
       (select id from g where nome = 'item'), 'pessoa_fisica', 'João da Silva', 'Homologado', repeat('1', 64), 'https://pncp.gov.br/app/editais/1'
     ) $$,
  '23514', null, 'CA-8: fornecedor pessoa_fisica com nome é recusado (LGPD)'
);

select throws_ok(
  $$ insert into pub.precos_historicos (
       fonte_id, id_externo, edital_id, edital_item_id, fornecedor_tipo, fornecedor_cnpj, situacao, hash_conteudo, link_origem
     ) values (
       (select id from g where nome = 'fonte'), 'RES-PF-DOC', (select id from g where nome = 'edital'),
       (select id from g where nome = 'item'), 'pessoa_fisica', '11222333000181', 'Homologado', repeat('1', 64), 'https://pncp.gov.br/app/editais/1'
     ) $$,
  '23514', null, 'CA-8: fornecedor pessoa_fisica com documento é recusado (LGPD)'
);

select lives_ok(
  $$ with ins as (
       insert into pub.precos_historicos (
         fonte_id, id_externo, edital_id, edital_item_id, fornecedor_tipo, situacao, valor_unitario, valor_total, quantidade, unidade_medida, hash_conteudo, link_origem
       ) values (
         (select id from g where nome = 'fonte'), 'RES-PF-ANON', (select id from g where nome = 'edital'),
         (select id from g where nome = 'item'), 'pessoa_fisica', 'Homologado', 790.0000, 7900.0000, 10.0000, 'UN', repeat('2', 64), 'https://pncp.gov.br/app/editais/1'
       ) returning id
     ) insert into g select 'ph_pf', id from ins $$,
  'CA-8: fornecedor pessoa_fisica sem nome e sem documento é aceito'
);

select lives_ok(
  $$ with ins as (
       insert into pub.precos_historicos (
         fonte_id, id_externo, edital_id, edital_item_id, fornecedor_tipo, fornecedor_cnpj, fornecedor_nome, fornecedor_porte,
         beneficio_me_epp, marca, modelo, quantidade, unidade_medida, valor_unitario, valor_total, classificacao, situacao, hash_conteudo, link_origem
       ) values (
         (select id from g where nome = 'fonte'), 'RES-PJ-1', (select id from g where nome = 'edital'),
         (select id from g where nome = 'item'), 'pj', '11222333000181', 'Fornecedora Sul Ltda', 'ME',
         true, 'Dell', 'P2422H', 10.0000, 'UN', 750.5000, 7505.0000, 1, 'Homologado', repeat('3', 64), 'https://pncp.gov.br/app/editais/1'
       ) returning id
     ) insert into g select 'ph_pj', id from ins $$,
  'vv_worker grava resultado de PJ com valores exatos em numeric(18,4)'
);

-- 5-6: versão de histórico é imutável
insert into pub.preco_historico_versoes (preco_historico_id, versao, hash_conteudo, campos_alterados, conteudo)
values ((select id from g where nome = 'ph_pj'), 1, repeat('3', 64), '{valor_unitario}', '{"valor_unitario":"750.5000"}'::jsonb);

select throws_ok(
  $$ update pub.preco_historico_versoes set versao = 2 where preco_historico_id = (select id from g where nome = 'ph_pj') $$,
  '42501', null, 'versão de preço histórico não pode ser alterada'
);

select throws_ok(
  $$ delete from pub.preco_historico_versoes where preco_historico_id = (select id from g where nome = 'ph_pj') $$,
  '42501', null, 'versão de preço histórico não pode ser apagada'
);

reset role;

-- 7-11: vv_api lê com pode_ver_editais, não escreve direto e solicita coleta por edital com limite de 1/hora
select tests.autenticar_como('usuario_a');

select is(
  (select count(*)::int from pub.precos_historicos where edital_id = (select id from g where nome = 'edital')),
  2,
  'vv_api lê preços históricos quando o usuário vê editais'
);

select ok(
  tests.dml_bloqueado($$ delete from pub.precos_historicos where id = (select id from g where nome = 'ph_pj') $$),
  'vv_api não apaga preços históricos diretamente'
);

select lives_ok(
  $$ select ops.solicitar_coleta_resultados_edital(tests.empresa_id('A'), (select id from g where nome = 'edital')) $$,
  'primeira solicitação de coleta de resultados do edital é aceita'
);

select throws_ok(
  $$ select ops.solicitar_coleta_resultados_edital(tests.empresa_id('A'), (select id from g where nome = 'edital')) $$,
  '54000', null, 'segunda solicitação na mesma hora é recusada (54000 -> 429)'
);

select throws_ok(
  $$ select ops.solicitar_coleta_resultados_edital(tests.empresa_id('A'), gen_random_uuid()) $$,
  'P0002', null, 'edital inexistente devolve P0002 (-> 404)'
);

select * from finish();
rollback;
