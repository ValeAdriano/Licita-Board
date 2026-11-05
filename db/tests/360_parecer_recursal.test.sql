-- Parecer de viabilidade recursal: só com gatilho recursal; achados e recomendação por função; recurso só com evidência conferida; A x B.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.cena_analise();
select tests.cena_resultado();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.abrir_parecer(tests.empresa_id('A'), (select participacao_id from priv.resultados_item where empresa_id = tests.empresa_id('A')), 'Concorrente S/A', null) $$, '22023', null, 'sem gatilho recursal (a empresa ganhou) não abre parecer');
select tests.sair();
update priv.resultados_item set resultado_final = 'perdida', motivo_perda = 'Perdeu no lance', gatilho_recursal = true;
select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'p', priv.abrir_parecer(tests.empresa_id('A'), (select participacao_id from priv.resultados_item where empresa_id = tests.empresa_id('A')), 'Concorrente S/A', 'Proposta da concorrente: marca XPTO, atestado de 10 unidades, certidão vencida em 01/10/2026.') $$, 'abre o parecer');
select lives_ok($$ insert into g select 'a', priv.salvar_achado(tests.empresa_id('A'), (select id from g where nome = 'p'), null, 'certidao', 'Certidão negativa vencida na data da sessão', 'certidão vencida em 01/10/2026', null, null, null, 'forte') $$, 'registra um achado');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'validar_parecer' and empresa_id = tests.empresa_id('A')), 2, 'cada alteração enfileira a conferência da evidência (a API não confere)');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.registrar_recomendacao(tests.empresa_id('A'), (select id from g where nome = 'p'), 'recorrer', 'curta') $$, '22023', null, 'a recomendação exige justificativa');
select lives_ok($$ select priv.registrar_recomendacao(tests.empresa_id('A'), (select id from g where nome = 'p'), 'recorrer', 'Certidão vencida comprovada pela própria proposta') $$, 'registra a recomendação');
select throws_ok($$ select priv.abrir_peca_recurso(tests.empresa_id('A'), (select id from g where nome = 'p')) $$, '22023', null, 'sem evidência conferida pelo worker não abre o recurso');
select tests.sair();
update priv.pareceres_recursais set validacao = '[]'::jsonb, validada_em = now(), bloqueado = false;
select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'peca', priv.abrir_peca_recurso(tests.empresa_id('A'), (select id from g where nome = 'p')) $$, 'com a evidência conferida abre a peça de recurso');
select is((select tipo || ':' || status from priv.pecas where id = (select id from g where nome = 'peca')), 'recurso:triagem', 'a peça nasce em triagem');
select throws_ok($$ select priv.abrir_peca_recurso(tests.empresa_id('A'), (select id from g where nome = 'p')) $$, '22023', null, 'não abre duas vezes');
select tests.sair();
update priv.pareceres_recursais set analise_dia = current_date, analise_qtd = 3;
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.pedir_analise_vencedora(tests.empresa_id('A'), (select id from g where nome = 'p')) $$, '54000', null, 'limite diário de análises pela IA (custo)');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.salvar_achado(tests.empresa_id('A'), (select id from g where nome = 'p'), null, 'outro', 'Invasor', null, null, null, null, null) $$, '42501', null, 'só visualizar não altera achados');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.remover_achado(tests.empresa_id('A'), (select id from g where nome = 'a')) $$, '42501', null, 'B não remove achado de A');
select throws_ok($$ select priv.registrar_recomendacao(tests.empresa_id('A'), (select id from g where nome = 'p'), 'nao_recorrer', 'Tentativa de B no parecer de A') $$, '42501', null, 'B não registra recomendação em parecer de A');

select * from finish();
rollback;
