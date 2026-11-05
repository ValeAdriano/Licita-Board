-- Isolamento A x B de priv.sugestoes_execucoes e priv.sugestoes_pecas: A lê só o que é seu; a API não tem DML direto (só funções).
begin;
set local search_path = tap;
select plan(8);

select tests.criar_empresas_ab();
select tests.cena_analise();
insert into priv.sugestoes_execucoes (empresa_id, acompanhamento_id) select empresa_id, id from priv.acompanhamentos;
insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida) select empresa_id, id, 'esclarecimento', 'Dúvida sobre a marca', 'O edital exige marca específica?' from priv.acompanhamentos;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.sugestoes_pecas where empresa_id = tests.empresa_id('A') $$, 'A lê as sugestões da própria empresa');
select is_empty($$ select 1 from priv.sugestoes_pecas where empresa_id = tests.empresa_id('B') $$, 'A não lê sugestões de B');
select isnt_empty($$ select 1 from priv.sugestoes_execucoes where empresa_id = tests.empresa_id('A') $$, 'A lê as execuções da própria empresa');
select is_empty($$ select 1 from priv.sugestoes_execucoes where empresa_id = tests.empresa_id('B') $$, 'A não lê execuções de B');
select throws_ok($$ update priv.sugestoes_pecas set titulo = 'x' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita sugestões de B');
select throws_ok($$ delete from priv.sugestoes_pecas where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga sugestões de B');
select throws_ok($$ insert into priv.sugestoes_pecas (empresa_id, acompanhamento_id, tipo, titulo, duvida) values (tests.empresa_id('B'), gen_random_uuid(), 'impugnacao', 'xxx', 'xxx') $$, '42501', null, 'A não insere sugestões em nome de B');
select throws_ok($$ insert into priv.sugestoes_execucoes (empresa_id, acompanhamento_id) values (tests.empresa_id('B'), gen_random_uuid()) $$, '42501', null, 'A não insere execuções em nome de B');

select * from finish();
rollback;
