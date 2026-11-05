-- Sugestões de peças: pedir só enfileira, limites, aceitar abre a peça em triagem ligada ao prazo, intempestiva não aceita, descarte justificado, A x B.
begin;
set local search_path = tap;
select plan(13);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal)
  select empresa_id, id, 'esclarecimento', now() + interval '5 days' from priv.acompanhamentos;
insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida)
  select empresa_id, id, 'esclarecimento', 'Dúvida sobre a marca', 'O edital exige marca específica?' from priv.acompanhamentos;
insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida, status)
  select empresa_id, id, 'impugnacao', 'Direcionamento de marca', 'Cláusula 7.2 direciona a marca', 'intempestiva' from priv.acompanhamentos;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'x', priv.pedir_sugestoes_pecas(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A'))) $$, 'pede as sugestões');
select throws_ok($$ select priv.pedir_sugestoes_pecas(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A'))) $$, '22023', null, 'uma busca por vez');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'sugerir_pecas' and empresa_id = tests.empresa_id('A')), 1, 'o pedido enfileira o worker (a API não chama a IA)');
insert into priv.sugestoes_execucoes (empresa_id, acompanhamento_id, status) select empresa_id, id, 'concluida' from priv.acompanhamentos, generate_series(1, 2);
update priv.sugestoes_execucoes set status = 'concluida';
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.pedir_sugestoes_pecas(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A'))) $$, '54000', null, 'limite diário (custo)');
select lives_ok($$ insert into g select 'peca', priv.aceitar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') and tipo = 'esclarecimento')) $$, 'aceita a sugestão');
select is((select p.tipo || ':' || p.status from priv.pecas p where p.id = (select id from g where nome = 'peca')), 'esclarecimento:triagem', 'abre a peça em triagem');
select is((select p.evento_id from priv.pecas p where p.id = (select id from g where nome = 'peca')), (select id from priv.agenda_eventos where tipo = 'esclarecimento' and empresa_id = tests.empresa_id('A')), 'ligada ao prazo da agenda');
select throws_ok($$ select priv.aceitar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') and tipo = 'esclarecimento')) $$, '22023', null, 'não aceita duas vezes');
select throws_ok($$ select priv.aceitar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') and tipo = 'impugnacao')) $$, '22023', null, 'intempestiva não se aceita');
select throws_ok($$ select priv.descartar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') and tipo = 'impugnacao'), 'curta') $$, '22023', null, 'descarte exige justificativa');
select lives_ok($$ select priv.descartar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') and tipo = 'impugnacao'), 'Prazo vencido, não cabe mais impugnar') $$, 'descarta com justificativa');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.pedir_sugestoes_pecas(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A'))) $$, '42501', null, 'só visualizar não pede sugestões');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.aceitar_sugestao(tests.empresa_id('A'), (select id from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') limit 1)) $$, '42501', null, 'B não aceita sugestão de A');

select * from finish();
rollback;
