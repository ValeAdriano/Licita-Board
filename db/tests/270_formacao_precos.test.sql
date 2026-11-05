-- Fase 07 · preços: custos só com ver_custos_margens, escrita por função, alçada (abaixo do mínimo exige justificativa e aprovação), A x B.
begin;
set local search_path = tap;
select plan(16);

select tests.criar_empresas_ab();
select tests.criar_usuario('sem_custos');
select tests.vincular('sem_custos', 'A', 'OPERADOR', array['precos:visualizar', 'precos:editar']);
select tests.criar_usuario('editor');
select tests.vincular('editor', 'A', 'OPERADOR', array['precos:visualizar', 'precos:editar', 'precos:ver_custos_margens']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'novo', priv.criar_precificacao(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), null, 5) $$, 'A cria a precificação do item');
select throws_ok($$ select priv.criar_precificacao(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), null, 5) $$, '23505', null, 'uma precificação por participação e produto');
select lives_ok($$ select priv.adicionar_linha_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'Aquisição', 'aquisicao', 'custo', 'por_unidade', 100, null) $$, 'adiciona custo por unidade');
select lives_ok($$ select priv.adicionar_linha_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'ICMS (teste)', 'tributo', 'percentual', null, null, 12) $$, 'adiciona percentual sobre o preço');
select throws_ok($$ select priv.adicionar_linha_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'Mista', 'frete', 'custo', 'por_unidade', 1, 5) $$, '23514', null, 'custo não pode ter percentual junto');
select throws_ok($$ select priv.salvar_parametros_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 5, 100, 0, 2, 'half_up', null, null, false, null) $$, '23514', null, 'margem de 100% é recusada');
select lives_ok($$ select priv.salvar_parametros_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 5, 20, 10, 2, 'half_up', null, null, false, null) $$, 'salva parâmetros');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'calcular_preco'), 4, 'cada mudança de insumo enfileira o recálculo (a API não calcula)');

-- alçada: simula o resultado do worker (abaixo do mínimo) e tenta aprovar
update priv.precificacoes set calculado_em = now(), abaixo_do_minimo = true where empresa_id = tests.empresa_id('A') and id = (select id from g where nome = 'novo');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'curta') $$, '22023', null, 'abaixo do mínimo exige justificativa de verdade');
select lives_ok($$ select priv.aprovar_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'Cliente estratégico, margem reduzida aprovada pela diretoria') $$, 'aprova abaixo do mínimo com justificativa');
select lives_ok($$ select priv.adicionar_linha_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'Frete', 'frete', 'custo', 'total_lote', 50, null) $$, 'mudar um insumo...');
select is((select aprovado_em from priv.precificacoes where id = (select id from g where nome = 'novo')), null, '...derruba a aprovação comercial');
select tests.sair();

-- sem ver_custos_margens: o banco devolve vazio (sigilo comercial), mas as funções de edição valem
select tests.autenticar_como('sem_custos');
select is((select count(*)::int from priv.precificacoes), 0, 'sem ver_custos_margens não lê custos nem margens');
select tests.sair();
select tests.autenticar_como('editor');
select is((select count(*)::int from priv.precificacoes), 1, 'com ver_custos_margens lê');
select throws_ok($$ select priv.aprovar_preco(tests.empresa_id('A'), (select id from g where nome = 'novo'), 'tentando aprovar sem a permissão') $$, '42501', null, 'editor sem aprovar não aprova');
select tests.sair();

select tests.autenticar_como('usuario_b');
select is((select count(*)::int from priv.precificacoes where empresa_id = tests.empresa_id('A')) + (select count(*)::int from priv.preco_linhas where empresa_id = tests.empresa_id('A')), 0, 'B não vê custos de A');
select * from finish();
rollback;
