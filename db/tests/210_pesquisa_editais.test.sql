-- Fase 04 · pesquisa de editais: dado público só para quem tem editais/visualizar e sem escrita pela API;
-- oportunidades e importações isoladas por empresa (A x B); triagem sem apagar; importação só de host permitido.
begin;
set local search_path = tap;
select plan(25);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver_a');
select tests.vincular('so_ver_a', 'A', 'OPERADOR', array['editais:visualizar']);
select tests.criar_usuario('sem_ed');
select tests.vincular('sem_ed', 'A', 'OPERADOR', array['empresas:visualizar']);

-- Dado público e resultados de A e de B, criados como dono.
insert into pub.orgaos (cnpj, razao_social, uf) values ('11222333000181', 'Prefeitura Fictícia', 'PR');
insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo)
select (select id from ops.fontes where slug = 'pncp'), 'FICTICIO-1', (select id from pub.orgaos), 'Aquisição de cadeiras', repeat('a', 64);
insert into pub.edital_itens (edital_id, numero_item, descricao, quantidade) select id, 1, 'Cadeira escolar', 100 from pub.editais;
insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao)
select tests.empresa_id(l), e.id, i.id, 80, 'alta', 'v0', 1 from pub.editais e, pub.edital_itens i, unnest(array['A', 'B']) l;
create temp table op (letra text primary key, id uuid);
grant all on op to vv_api;
insert into op select l, (select id from priv.oportunidades where empresa_id = tests.empresa_id(l)) from unnest(array['A', 'B']) l;
update ops.fontes set ativa = true where slug = 'pncp';

-- =============================================================== dado público
select tests.autenticar_como('usuario_a');
select is((select count(*)::int from pub.editais), 1, 'quem tem editais/visualizar lê o edital público');
select is((select count(*)::int from pub.edital_itens), 1, '... e os itens');
select throws_ok($$ insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo) select fonte_id, 'X-1', orgao_id, 'x', repeat('b', 64) from pub.editais $$,
  '42501', null, 'a API não escreve em pub.editais');
select throws_ok($$ update pub.editais set objeto = 'alterado' $$, '42501', null, 'a API não altera edital público');
select tests.sair();

select tests.autenticar_como('sem_ed');
select is((select count(*)::int from pub.editais), 0, 'sem editais/visualizar não lê o dado público');
select throws_ok($$ select * from ops.estado_das_fontes() $$, '42501', null, 'nem o estado das fontes');
select tests.sair();

-- =============================================================== A x B em priv.oportunidades
select tests.autenticar_como('usuario_a');
select is((select count(*)::int from priv.oportunidades), 1, 'A vê só a oportunidade de A');
select is((select count(*)::int from priv.oportunidades where empresa_id = tests.empresa_id('B')), 0, 'A não vê a de B');
select throws_ok($$ update priv.oportunidades set nota = 100 $$, '42501', null, 'a API não altera a nota');
select throws_ok($$ delete from priv.oportunidades $$, '42501', null, 'ninguém apaga oportunidade (baixa relevância não some)');
select lives_ok($$ select priv.triar_oportunidade(tests.empresa_id('A'), (select id from op where letra = 'A'), 'interesse', null) $$, 'A faz triagem da sua oportunidade');
select throws_ok($$ select priv.triar_oportunidade(tests.empresa_id('A'), (select id from op where letra = 'B'), 'interesse', null) $$,
  'P0002', null, 'A não faz triagem da oportunidade de B (nem a descobre)');
select throws_ok($$ select priv.triar_oportunidade(tests.empresa_id('B'), (select id from op where letra = 'B'), 'interesse', null) $$,
  '42501', null, 'A não age em nome da empresa B');
select throws_ok($$ select priv.triar_oportunidade(tests.empresa_id('A'), (select id from op where letra = 'A'), 'descartada_pelo_usuario', '') $$,
  '23514', null, 'descartar exige motivo');
select tests.sair();

select tests.autenticar_como('so_ver_a');
select throws_ok($$ select priv.triar_oportunidade(tests.empresa_id('A'), (select id from op where letra = 'A'), 'vista', null) $$,
  '42501', null, 'quem só visualiza não faz triagem');
select tests.sair();

-- =============================================================== importação
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.solicitar_importacao(tests.empresa_id('A'), 'url', 'https://site-qualquer.example/edital.pdf', null) $$,
  '22023', null, 'URL de host fora da lista das fontes é recusada (SSRF)');
select throws_ok($$ select priv.solicitar_importacao(tests.empresa_id('A'), 'url', 'http://pncp.gov.br/edital', null) $$,
  '22023', null, 'http sem TLS é recusado');
select lives_ok($$ select priv.solicitar_importacao(tests.empresa_id('A'), 'url', 'https://pncp.gov.br/app/editais/11222333000181/2026/1', null) $$,
  'URL de fonte permitida é aceita e enfileirada');
select throws_ok($$ select priv.solicitar_importacao(tests.empresa_id('B'), 'url', 'https://pncp.gov.br/x', null) $$,
  '42501', null, 'A não importa em nome de B');
select is((select count(*)::int from priv.importacoes), 1, 'A vê só as importações de A');
select tests.sair();

-- =============================================================== pesquisa manual e fontes
select tests.autenticar_como('usuario_a');
select throws_ok($$ select ops.solicitar_coleta_manual(tests.empresa_id('A'), 'pncp', current_date - 40, current_date, 'PR') $$,
  '22023', null, 'período maior que 31 dias é recusado');
select lives_ok($$ select ops.solicitar_coleta_manual(tests.empresa_id('A'), 'pncp', current_date - 2, current_date, 'PR') $$, 'pesquisa manual é aceita');
select is((select count(*)::int from ops.fontes), 0, 'quem não é SUPERADMIN não lê ops.fontes');
select tests.sair();

-- =============================================================== worker enfileira só jobs da pesquisa
set local role vv_worker;
select lives_ok($$ select ops.enfileirar_pesquisa('coletar_fonte', null, '{}', 'teste:coleta:1') $$, 'o worker enfileira job da pesquisa');
select throws_ok($$ select ops.enfileirar_pesquisa('email_recuperacao', null, '{}', 'teste:forjado') $$, '42501', null, 'o worker não forja job de recuperação de senha');
reset role;

select * from finish();
rollback;
