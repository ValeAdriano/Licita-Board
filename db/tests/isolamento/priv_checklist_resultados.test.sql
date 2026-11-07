-- Isolamento A x B de priv.checklist_resultados: A lê só o que é seu; quem grava é só o worker (priv.registrar_checklist), então a API não
-- escreve nem na própria empresa nem na de B (ADR-013, regra 13). A gravação pelo worker é testada em 430_checklist_documental.test.sql.
begin;
set local search_path = tap;
select plan(6);

select tests.criar_empresas_ab();
select tests.cena_analise();
insert into priv.checklist_exigencias (empresa_id, acompanhamento_id, tipo_id)
select a.empresa_id, a.id, (select id from pub.tipos_documento where slug = 'cnd_federal') from priv.acompanhamentos a;
insert into priv.checklist_resultados (empresa_id, exigencia_id, situacao, data_referencia)
select e.empresa_id, e.id, 'ausente', current_date from priv.checklist_exigencias e;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.checklist_resultados where empresa_id = tests.empresa_id('A') $$, 'A lê as linhas da própria empresa');
select is_empty($$ select 1 from priv.checklist_resultados where empresa_id = tests.empresa_id('B') $$, 'A não lê linhas de B');
select throws_ok($$ update priv.checklist_resultados set situacao = 'valido' where empresa_id = tests.empresa_id('A') $$, '42501', null, 'A API não grava resultado (nem na própria empresa)');
select throws_ok($$ update priv.checklist_resultados set situacao = 'valido' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita linhas de B');
select throws_ok($$ delete from priv.checklist_resultados where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga linhas de B');
select throws_ok($$ insert into priv.checklist_resultados (empresa_id, exigencia_id, situacao, data_referencia)
  values (tests.empresa_id('B'), gen_random_uuid(), 'valido', current_date) $$, '42501', null, 'A não insere linhas em nome de B');

select * from finish();
rollback;
