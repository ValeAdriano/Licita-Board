-- Isolamento A x B de priv.contrato_notificacoes: A lê só o que é seu; escrever é bloqueado (só o worker grava, por função).
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_contrato();
insert into priv.contrato_notificacoes (empresa_id, tipo, ref_id, marco) select empresa_id, 'vigencia', id, 'proximo' from priv.contratos;

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.contrato_notificacoes where empresa_id = tests.empresa_id('A') $$) > 0, 'A lê as notificações da própria empresa');
select ok(tests.leitura($$ select 1 from priv.contrato_notificacoes where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê notificações de B');
select ok(tests.dml_bloqueado($$ update priv.contrato_notificacoes set empresa_id = empresa_id where empresa_id = tests.empresa_id('B') $$), 'A não edita notificações de B');
select ok(tests.dml_bloqueado($$ delete from priv.contrato_notificacoes where empresa_id = tests.empresa_id('B') $$), 'A não apaga notificações de B');
select ok(tests.dml_bloqueado($$ insert into priv.contrato_notificacoes (empresa_id, tipo, ref_id, marco) values (tests.empresa_id('B'), 'vigencia', gen_random_uuid(), 'novo') $$), 'A não insere notificações em nome de B');

select * from finish();
rollback;
