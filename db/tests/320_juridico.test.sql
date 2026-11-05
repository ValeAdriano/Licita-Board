-- Fase 10 · jurídico: base verificada, fluxo da peça com permissões, aprovação só de quem aprova, final imutável, protocolo humano, A x B.
begin;
set local search_path = tap;
select plan(22);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.criar_usuario('redator');
select tests.vincular('redator', 'A', 'JURIDICO', array['juridico:visualizar', 'juridico:elaborar_peca', 'agenda:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('redator');
select lives_ok($$ insert into g select 'base', priv.cadastrar_base_juridica(tests.empresa_id('A'), 'lei', '14.133/2021', null, 'art. 165', 'Lei 14.133/2021, art. 165', 'Dos recursos', date '2021-04-01', 'https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm') $$, 'a pessoa jurídica cadastra uma entrada da base');
select throws_ok($$ select priv.cadastrar_base_juridica(tests.empresa_id('A'), 'lei', '1/2000', null, null, 'Sem link seguro', null, null, 'http://inseguro.exemplo') $$, '23514', null, 'o link oficial precisa ser https');
select throws_ok($$ select priv.cadastrar_base_juridica(tests.empresa_id('A'), 'acordao', null, 'TCU', null, 'Acórdão sem número', null, null, 'https://x.gov.br') $$, '23514', null, 'acórdão sem número é recusado');
select is((select verificada_em from priv.base_juridica where id = (select id from g where nome = 'base')), null, 'a entrada nasce NÃO verificada');
select throws_ok($$ select priv.verificar_base_juridica(tests.empresa_id('A'), (select id from g where nome = 'base')) $$, '42501', null, 'quem só redige não verifica a base');
select lives_ok($$ insert into g select 'peca', priv.criar_peca(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'impugnacao', 'Impugnação ao edital', null) $$, 'cria a peça (triagem)');
select throws_ok($$ select priv.descartar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'curta') $$, '22023', null, 'descartar exige justificativa');
select lives_ok($$ select priv.salvar_minuta(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'Violação do art. 165 da Lei 14.133/2021.', 'Cláusula 7.2, página 12') $$, 'salva a minuta');
select is((select status from priv.pecas where id = (select id from g where nome = 'peca')), 'minuta', 'status minuta');
select throws_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '22023', null, 'sem validação do worker não vai à revisão');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'processar_peca'), 1, 'salvar a minuta enfileira a conferência de citações (worker)');

update priv.pecas set validada_em = now(), bloqueada = false where id = (select id from g where nome = 'peca');
select tests.autenticar_como('redator');
select lives_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, 'validada e sem bloqueio vai à revisão');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), null) $$, '42501', null, 'quem só redige não aprova (aprovar_peca)');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), (select tests.step_up('usuario_a', 'aprovar_peca'))) $$, 'quem tem aprovar_peca aprova');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), '2026/123', now(), null) $$, '22023', null, 'não protocola sem o documento final');
select tests.sair();

update priv.pecas set status = 'final', arquivo_chave = 'pecas/x.docx', arquivo_sha256 = repeat('c', 64), gerado_em = now() where id = (select id from g where nome = 'peca');
select throws_ok($$ update priv.pecas set minuta = 'alterada depois do final' where id = (select id from g where nome = 'peca') $$, '42501', null, 'o conteúdo da final é imutável');
select tests.autenticar_como('redator');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'x', now(), null) $$, '22023', null, 'protocolo exige número');
select lives_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), '2026/123', now(), 'Comprovante do portal') $$, 'a pessoa protocola e registra o comprovante');
select lives_ok($$ select priv.registrar_resultado_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'parcialmente_deferido', 'Item 3 acolhido', null) $$, 'registra o resultado');
select throws_ok($$ select priv.devolver_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '42501', null, 'devolver exige aprovar_peca');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.criar_peca(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'recurso', 'x', null) $$, '42501', null, 'só visualizar não cria peça');
select tests.sair();
select tests.autenticar_como('usuario_b');
select is((select count(*)::int from priv.pecas where empresa_id = tests.empresa_id('A')) + (select count(*)::int from priv.base_juridica where empresa_id = tests.empresa_id('A')), 0, 'B não vê peças nem base de A');
select * from finish();
rollback;
