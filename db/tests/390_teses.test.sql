-- Banco de teses: criar/editar enfileira a conferência; aprovar exige conferência sem bloqueio e quem aprova peças; usar só tese aprovada do mesmo tipo; A x B.
begin;
set local search_path = tap;
select plan(13);

select tests.criar_empresas_ab();
select tests.criar_usuario('redator');
select tests.vincular('redator', 'A', 'JURIDICO', array['juridico:visualizar', 'juridico:elaborar_peca']);
select tests.cena_analise();
select tests.cena_juridico();
insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo)
  select empresa_id, acompanhamento_id, 'recurso', 'Peça de recurso' from priv.pecas where empresa_id = tests.empresa_id('A');
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'imp', id from priv.pecas where empresa_id = tests.empresa_id('A') and tipo = 'impugnacao';
insert into g select 'rec', id from priv.pecas where empresa_id = tests.empresa_id('A') and tipo = 'recurso';

select tests.autenticar_como('redator');
select lives_ok($$ insert into g select 't', priv.criar_tese(tests.empresa_id('A'), 'impugnacao', 'Marca única', 'A exigência de marca específica sem justificativa restringe a competitividade, conforme o art. 165.') $$, 'cria a tese em rascunho');
select throws_ok($$ select priv.aprovar_tese(tests.empresa_id('A'), (select id from g where nome = 't')) $$, '42501', null, 'quem só redige não aprova');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'validar_tese' and empresa_id = tests.empresa_id('A')), 1, 'a criação enfileira a conferência de citações (worker)');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_tese(tests.empresa_id('A'), (select id from g where nome = 't')) $$, '22023', null, 'sem a conferência do worker não aprova');
select tests.sair();
update priv.teses set validada_em = now(), bloqueada = false;
select tests.autenticar_como('redator');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'imp'), (select id from g where nome = 't')) $$, '22023', null, 'tese em rascunho não se usa');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.aprovar_tese(tests.empresa_id('A'), (select id from g where nome = 't')) $$, 'conferida e sem bloqueio, quem aprova peças aprova');
select tests.sair();
select tests.autenticar_como('redator');
select lives_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'imp'), (select id from g where nome = 't')) $$, 'usa a tese aprovada numa peça do mesmo tipo');
select lives_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'imp'), (select id from g where nome = 't')) $$, 'usar de novo é idempotente');
select is((select count(*)::int from priv.peca_teses), 1, 'o uso fica registrado uma vez');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'rec'), (select id from g where nome = 't')) $$, '22023', null, 'tese de impugnação não se usa em recurso');
select lives_ok($$ select priv.editar_tese(tests.empresa_id('A'), (select id from g where nome = 't'), 'Marca única (revisada)', 'Texto revisado da tese, sem nenhuma citação de lei, apenas o argumento de competitividade.') $$, 'editar a tese');
select tests.sair();
select is((select status from priv.teses), 'rascunho', 'editar derruba a aprovação e pede nova conferência');
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.usar_tese(tests.empresa_id('A'), (select id from g where nome = 'imp'), (select id from g where nome = 't')) $$, '42501', null, 'B não usa tese de A');

select * from finish();
rollback;
