-- Isolamento A x B de priv.relatorio_diario_assinaturas: a API não lê nem escreve a tabela direto (só pelas funções da própria pessoa).
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
insert into priv.relatorio_diario_assinaturas (empresa_id, usuario_id) values (tests.empresa_id('A'), tests.usuario_id('usuario_a')), (tests.empresa_id('B'), tests.usuario_id('usuario_b'));

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.relatorio_diario_assinaturas where empresa_id = tests.empresa_id('A') $$) <= 0, 'a API não lê as assinaturas da própria empresa direto (só pela função)');
select ok(tests.leitura($$ select 1 from priv.relatorio_diario_assinaturas where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê assinaturas de B');
select ok(tests.dml_bloqueado($$ update priv.relatorio_diario_assinaturas set ativo = false where empresa_id = tests.empresa_id('B') $$), 'A não edita assinaturas de B');
select ok(tests.dml_bloqueado($$ delete from priv.relatorio_diario_assinaturas where empresa_id = tests.empresa_id('B') $$), 'A não apaga assinaturas de B');
select ok(tests.dml_bloqueado($$ insert into priv.relatorio_diario_assinaturas (empresa_id, usuario_id) values (tests.empresa_id('B'), tests.usuario_id('usuario_a')) $$), 'A não insere assinaturas em nome de B');

select * from finish();
rollback;
