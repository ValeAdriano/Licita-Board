-- Fase 06 · análise técnica: só por função, com permissão do módulo `analises`, isolada A x B, sem classificação pela API.
begin;
set local search_path = tap;
select plan(15);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['analises:visualizar']);
select tests.criar_usuario('editor');
select tests.vincular('editor', 'A', 'OPERADOR', array['analises:visualizar', 'analises:editar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'req', priv.criar_requisito(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')),
  'Torque mínimo', 'minimo', null, '>=', 350, null, null, (select id from pub.unidades where simbolo = 'N·m'), true, 'torque mínimo de 350 N·m', 12) $$, 'A cria um requisito');
select throws_ok($$ select priv.criar_requisito(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')),
  'Sem valor', 'minimo', null, '>=', null, null, null, null, true, null, null) $$, '23514', null, 'operador numérico exige valor');
select lives_ok($$ select priv.analisar_item(tests.empresa_id('A'), (select participacao_id from priv.analises_item where empresa_id = tests.empresa_id('A')),
  (select produto_id from priv.analises_item where empresa_id = tests.empresa_id('A'))) $$, 'A pede a análise de um produto');
select throws_ok($$ select priv.aprovar_analise(tests.empresa_id('A'), (select id from priv.analises_item where empresa_id = tests.empresa_id('A'))) $$, '22023', null, 'não aprova análise sem resultado/pendente');
select throws_ok($$ update priv.analise_linhas set resultado = 'ATENDE' $$, '42501', null, 'a API não grava classificação');
select throws_ok($$ select priv.conferir_ficha(tests.empresa_id('A'), (select id from priv.analise_linhas where empresa_id = tests.empresa_id('A')), null, null, 'x', null) $$, '22023', null, 'conferir a ficha exige documento, página e trecho');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'analisar_item'), 2, 'criar requisito e pedir análise enfileiram o worker');

-- só visualizar não escreve; editor edita mas não aprova
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.criar_requisito(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')),
  'X', 'minimo', null, '>=', 1, null, null, null, true, null, null) $$, '42501', null, 'só visualizar não cria requisito');
select is((select count(*)::int from priv.requisitos_item), 2, 'mas vê os requisitos da empresa');
select tests.sair();
update priv.analises_item set resumo = 'COMPATÍVEL' where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('editor');
select throws_ok($$ select priv.aprovar_analise(tests.empresa_id('A'), (select id from priv.analises_item where empresa_id = tests.empresa_id('A'))) $$, '42501', null, 'editor sem aprovar não aprova');
select tests.sair();

select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.aprovar_analise(tests.empresa_id('A'), (select id from priv.analises_item where empresa_id = tests.empresa_id('A'))) $$, 'quem aprova registra a aprovação técnica');
select is((select aprovado_resumo from priv.analises_item where empresa_id = tests.empresa_id('A')), 'COMPATÍVEL', 'registra o resumo aprovado');
select tests.sair();

select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.aprovar_analise(tests.empresa_id('A'), (select id from g where nome = 'req')) $$, '42501', null, 'B não aprova análise de A');
select throws_ok($$ select priv.criar_requisito(tests.empresa_id('A'), gen_random_uuid(), 'X', 'minimo', null, '>=', 1, null, null, null, true, null, null) $$, '42501', null, 'B não cria requisito na empresa de A');
select is((select count(*)::int from priv.requisitos_item where empresa_id = tests.empresa_id('A')), 0, 'B não vê requisitos de A');
select tests.sair();

select * from finish();
rollback;
