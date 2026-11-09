-- Isolamento A x B de priv.documentos_posteriores: A lê só o que é seu; escrever só por função (ADR-013, regra 13).
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();

insert into priv.documentos_posteriores (empresa_id, acompanhamento_id, tipo, data_ato, link_publico)
select a.empresa_id, a.id, 'ata_sessao', current_date, 'https://pncp.gov.br/ata/' || a.id
  from priv.acompanhamentos a;

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.documentos_posteriores where empresa_id = tests.empresa_id('A') $$) > 0, 'A lê os documentos posteriores da própria empresa');
select ok(tests.leitura($$ select 1 from priv.documentos_posteriores where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê documentos posteriores de B');
select ok(tests.dml_bloqueado($$ update priv.documentos_posteriores set numero = 'X' where empresa_id = tests.empresa_id('B') $$), 'A não edita documentos posteriores de B');
select ok(tests.dml_bloqueado($$ delete from priv.documentos_posteriores where empresa_id = tests.empresa_id('B') $$), 'A não apaga documentos posteriores de B');
select ok(tests.dml_bloqueado($$ insert into priv.documentos_posteriores (empresa_id, acompanhamento_id, tipo, data_ato, link_publico) values (tests.empresa_id('B'), gen_random_uuid(), 'ata_sessao', current_date, 'https://exemplo.test/x') $$), 'A não insere documentos posteriores em nome de B');

select * from finish();
rollback;
