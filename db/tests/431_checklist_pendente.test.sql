-- Q-26 · Fase 03: priv.checklist_pendente diz só se há recálculo do checklist na fila (job checklist_documental pendente ou
-- em execução) para o acompanhamento DA EMPRESA. Permissão documentos/visualizar; sem ela → P0002 (404). A x B.
begin;
set local search_path = tap;
select plan(13);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['documentos:visualizar']);
select tests.criar_usuario('sem_docs');
select tests.vincular('sem_docs', 'A', 'OPERADOR', array['agenda:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'acA', id from priv.acompanhamentos where empresa_id = tests.empresa_id('A');
insert into g select 'acB', id from priv.acompanhamentos where empresa_id = tests.empresa_id('B');
delete from ops.jobs where tipo = 'checklist_documental';

select tests.autenticar_como('usuario_a');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), false, 'sem job: nada pendente');
select priv.recalcular_checklist(tests.empresa_id('A'), (select id from g where nome = 'acA'));
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), true, 'depois de pedir o recálculo: pendente');
select tests.sair();

select tests.autenticar_como('so_ver');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), true, 'só visualizar também vê o sinal');
select tests.sair();

select tests.autenticar_como('sem_docs');
select throws_ok($$ select priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')) $$,
  'P0002', null, 'sem documentos/visualizar: não encontrado');
select tests.sair();

select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')) $$,
  'P0002', null, 'B não consulta a empresa A');
select is(priv.checklist_pendente(tests.empresa_id('B'), (select id from g where nome = 'acA')), false,
  'B, pela própria empresa, não enxerga o job de A');
select is(priv.checklist_pendente(tests.empresa_id('B'), (select id from g where nome = 'acB')), false, 'nem há job em B');
select tests.sair();

-- ciclo do job (como o worker faria)
update ops.jobs set status = 'executando', tentativas = 1, travado_ate = now() + interval '5 minutes'
 where tipo = 'checklist_documental';
select tests.autenticar_como('usuario_a');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), true, 'em execução: pendente');
select tests.sair();
update ops.jobs set travado_ate = now() - interval '1 minute', tentativas = max_tentativas where tipo = 'checklist_documental';
select tests.autenticar_como('usuario_a');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), false,
  'trava vencida sem tentativa sobrando (vai virar falhou): não conta');
select tests.sair();
update ops.jobs set status = 'concluido', concluido_em = now(), travado_ate = null where tipo = 'checklist_documental';
select tests.autenticar_como('usuario_a');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), false, 'concluído: não pendente');
select tests.sair();
update ops.jobs set status = 'falhou' where tipo = 'checklist_documental';
select tests.autenticar_como('usuario_a');
select is(priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')), false, 'falhou: não pendente');
select tests.sair();

set local role vv_worker;
select throws_ok($$ select priv.checklist_pendente(tests.empresa_id('A'), (select id from g where nome = 'acA')) $$,
  '42501', null, 'o worker não usa a função da API');
reset role;
select is(has_function_privilege('public', 'priv.checklist_pendente(uuid, uuid)', 'execute'), false, 'sem execute para PUBLIC');

select * from finish();
rollback;
