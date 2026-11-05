-- Recurso de terceiro: inserir lança o prazo de contrarrazões, abre a peça e pede a leitura; alegação sem prova é risco; limites e A x B.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'r', (priv.inserir_recurso_terceiro(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')),
  'Concorrente S/A', '2026-11-10 12:00-03', 'A recorrente alega que a proposta vencedora descumpre a cláusula 7.2 do edital e que a habilitação é irregular.', 'https://exemplo.gov.br/recurso.pdf')->>'id')::uuid $$, 'insere o recurso');
select is((select count(*)::int from priv.agenda_eventos where tipo = 'contrarrazoes' and empresa_id = tests.empresa_id('A')), 1, 'lança o prazo de contrarrazões na agenda');
select is((select p.tipo || ':' || p.status from priv.pecas p join priv.recursos_terceiros r on r.peca_id = p.id), 'contrarrazoes:triagem', 'abre a peça de contrarrazões em triagem');
select is((select p.evento_id from priv.pecas p join priv.recursos_terceiros r on r.peca_id = p.id), (select id from priv.agenda_eventos where tipo = 'contrarrazoes' and empresa_id = tests.empresa_id('A')), 'a peça fica ligada ao prazo');
select is((select leitura_status from priv.recursos_terceiros), 'pendente', 'a leitura pela IA fica pendente');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo in ('ler_recurso', 'calcular_prazos') and empresa_id = tests.empresa_id('A')), 2, 'enfileira a leitura e o cálculo do prazo (a API não chama a IA)');

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'a', priv.adicionar_alegacao(tests.empresa_id('A'), (select id from g where nome = 'r'), 'Proposta descumpre a cláusula 7.2', 'descumpre a cláusula 7.2 do edital') $$, 'adiciona alegação com citação');
select is((select citacao_confere from priv.recurso_alegacoes where origem = 'manual'), true, 'citação literal do recurso é conferida');
select is((select risco from priv.recurso_alegacoes where origem = 'manual'), true, 'alegação sem prova que a refute é ponto de risco');
select lives_ok($$ select priv.decidir_alegacao(tests.empresa_id('A'), (select id from g where nome = 'a'), 'rebater', 'Ficha técnica do fabricante, p. 3', 'Lei 14.133/2021, art. 165') $$, 'decide rebater com prova');
select is((select risco from priv.recurso_alegacoes where origem = 'manual'), false, 'com a prova indicada deixa de ser risco');
select tests.sair();
update priv.recursos_terceiros set leitura_dia = current_date, leitura_qtd = 5;
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.pedir_leitura_recurso(tests.empresa_id('A'), (select id from g where nome = 'r')) $$, '54000', null, 'limite diário de leituras (custo)');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.adicionar_alegacao(tests.empresa_id('A'), (select id from g where nome = 'r'), 'x alegação', null) $$, '42501', null, 'só visualizar não altera alegações');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.decidir_alegacao(tests.empresa_id('A'), (select id from g where nome = 'a'), 'concordar', null, null) $$, '42501', null, 'B não decide alegação de A');

select * from finish();
rollback;
