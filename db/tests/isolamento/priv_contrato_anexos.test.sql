-- Isolamento A x B de priv.contrato_anexos: A lê só o que é seu; escrever só por função (anexar/remover), nunca direto.
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_cadastros();
select tests.cena_contrato();
insert into priv.contrato_anexos (empresa_id, contrato_id, documento_id)
  select c.empresa_id, c.id, (select d.id from priv.documentos d where d.empresa_id = c.empresa_id limit 1) from priv.contratos c;

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.contrato_anexos where empresa_id = tests.empresa_id('A') $$) > 0, 'A lê os anexos da própria empresa');
select ok(tests.leitura($$ select 1 from priv.contrato_anexos where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê anexos de B');
select ok(tests.dml_bloqueado($$ update priv.contrato_anexos set nota = 'x' where empresa_id = tests.empresa_id('B') $$), 'A não edita anexos de B');
select ok(tests.dml_bloqueado($$ delete from priv.contrato_anexos where empresa_id = tests.empresa_id('B') $$), 'A não apaga anexos de B');
select ok(tests.dml_bloqueado($$ insert into priv.contrato_anexos (empresa_id, contrato_id, documento_id) values (tests.empresa_id('B'), gen_random_uuid(), gen_random_uuid()) $$), 'A não insere anexos em nome de B');

select * from finish();
rollback;
