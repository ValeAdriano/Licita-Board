-- Fase 08 · Bloco 8.7: Registro do comprovante de envio da proposta ao portal (CA-6 a CA-11).
begin;
set local search_path = tap;
select plan(18);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['propostas:visualizar', 'documentos:visualizar']);
select tests.cena_analise();
select tests.cena_preco();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

-- Prepara preço aprovado e duas propostas em A (v1 final e v2 rascunho)
update priv.precificacoes
   set calculado_em = now(), preco_final_unit = 125, total_proposta = 1250, aprovado_em = now(), aprovado_por = tests.usuario_id('usuario_a')
 where empresa_id = tests.empresa_id('A');

select tests.autenticar_como('usuario_a');
insert into g select 'v1', priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, null, 'Curitiba');
insert into g select 'v2', priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, null, 'Curitiba');
select tests.sair();

-- Documentos de teste: doc_errado (outro tipo), doc_quarentena (comprovante em quarentena), doc_ok (comprovante liberado) e doc_b (de B)
with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'cnd_federal'), 'CND errada')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256)
  select id, tests.empresa_id('A'), 1, 'docs/errado.pdf', 'errado.pdf', 'liberado', repeat('1', 64) from d
)
insert into g select 'doc_errado', id from d;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'), 'Comprovante em quarentena')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo)
  select id, tests.empresa_id('A'), 1, 'docs/quar.pdf', 'quar.pdf', 'quarentena' from d
)
insert into g select 'doc_quarentena', id from d;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('A'), (select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'), 'Comprovante liberado')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256)
  select id, tests.empresa_id('A'), 1, 'docs/ok.pdf', 'comprovante.pdf', 'liberado', repeat('2', 64) from d
  returning id
)
insert into g select 'doc_ok', d.id from d union all select 'ver_ok', v.id from v;

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  values (tests.empresa_id('B'), (select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'), 'Comprovante B')
  returning id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, sha256)
  select id, tests.empresa_id('B'), 1, 'docs/b.pdf', 'b.pdf', 'liberado', repeat('3', 64) from d
)
insert into g select 'doc_b', id from d;

-- CA-6: proposta rascunho recusada antes de ser final
select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v2'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_ok'), null) $$,
  '22023', null, 'CA-6: rascunho não aceita registro de envio'
);
select tests.sair();

-- Torna v1 final com hashes de docx e pdf
update priv.propostas
   set status = 'final',
       arquivo_chave = 'propostas/v1.docx',
       arquivo_sha256 = repeat('a', 64),
       arquivo_pdf_chave = 'propostas/v1.pdf',
       arquivo_pdf_sha256 = repeat('b', 64),
       gerado_em = now()
 where id = (select id from g where nome = 'v1');

-- CA-7: sem comprovante liberado da própria empresa e do tipo certo, o registro é recusado
select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_errado'), null) $$,
  '22023', null, 'CA-7: tipo de documento errado é recusado (22023)'
);
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_quarentena'), null) $$,
  '22023', null, 'CA-7: comprovante em quarentena é recusado (22023)'
);
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_b'), null) $$,
  'P0002', null, 'CA-7/CA-11: documento de outra empresa retorna P0002 (404)'
);
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() + interval '1 hour', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_ok'), null) $$,
  '22023', null, 'data de envio futura é recusada (22023)'
);

-- Permissão: quem só visualiza não registra
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-1', (select id from g where nome = 'doc_ok'), null) $$,
  '42501', null, 'sem propostas/aprovar não registra envio'
);
select tests.sair();

-- CA-8 e CA-9: registro válido guarda versão, hash do formato e versão do comprovante, e move participação para proposta_cadastrada
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ insert into g select 'env1', priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-2026-001', (select id from g where nome = 'doc_ok'), 'Enviado sem ressalvas', 'recibo_portal') $$,
  'registra envio da proposta final'
);
select is(
  (select proposta_versao || ':' || proposta_sha256 || ':' || (comprovante_versao_id = (select id from g where nome = 'ver_ok'))::text
     from priv.proposta_envios where id = (select id from g where nome = 'env1')),
  '1:' || repeat('b', 64) || ':true',
  'CA-8: guarda versão exata, hash do PDF e versão exata do comprovante'
);
select is(
  (select status from priv.participacoes where empresa_id = tests.empresa_id('A')),
  'proposta_cadastrada',
  'CA-9: move a participação para proposta_cadastrada'
);
select tests.sair();

-- CA-9: se a participação já estiver em status posterior (ex: arrematada), novo envio não regride o status
update priv.participacoes set status = 'arrematada' where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ insert into g select 'env2', priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '2 minutes', 'docx', 'Compras.gov.br', 'REC-2026-002', (select id from g where nome = 'doc_ok'), 'Reenvio dentro do prazo') $$,
  'permite novo envio (histórico preservado)'
);
select is(
  (select status from priv.participacoes where empresa_id = tests.empresa_id('A')),
  'arrematada',
  'CA-9: não regride status mais avançado da participação'
);

-- CA-8 / RF-08.10: imutabilidade e anulação com motivo >= 10 caracteres
select throws_ok(
  $$ select priv.anular_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'env1'), 'curto') $$,
  '22023', null, 'motivo curto (< 10 caracteres) é recusado'
);
select lives_ok(
  $$ select priv.anular_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'env1'), 'Substituído pelo envio REC-2026-002 no portal') $$,
  'anula o envio com motivo válido'
);
select throws_ok(
  $$ select priv.anular_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'env1'), 'Tentativa de anular de novo') $$,
  '22023', null, 'não anula duas vezes'
);
select tests.sair();

-- Gatilho de imutabilidade no banco mesmo como superusuário fora da anulação única
select throws_ok(
  $$ update priv.proposta_envios set portal = 'Outro' where id = (select id from g where nome = 'env2') $$,
  '42501', null, 'CA-8: UPDATE fora da anulação é recusado pelo gatilho de imutabilidade'
);

-- CA-11: isolamento A x B nas funções
select tests.autenticar_como('usuario_b');
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-X', (select id from g where nome = 'doc_b'), null) $$,
  '42501', null, 'B não registra envio na empresa de A'
);
select throws_ok(
  $$ select priv.registrar_envio_proposta(tests.empresa_id('B'), (select id from g where nome = 'v1'), now() - interval '5 minutes', 'pdf', 'Compras.gov.br', 'REC-X', (select id from g where nome = 'doc_b'), null) $$,
  'P0002', null, 'B passando sua própria empresa com proposta de A recebe P0002 (404)'
);
select throws_ok(
  $$ select priv.anular_envio_proposta(tests.empresa_id('B'), (select id from g where nome = 'env2'), 'Motivo invasor com mais de dez letras') $$,
  'P0002', null, 'B não anula envio de A (P0002 -> 404)'
);

select * from finish();
rollback;
