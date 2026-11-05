-- Fase 08 · propostas: só de preço aprovado, sem custos, fluxo com permissões, final imutável, A x B.
begin;
set local search_path = tap;
select plan(17);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_editar');
select tests.vincular('so_editar', 'A', 'OPERADOR', array['propostas:visualizar', 'propostas:cadastrar', 'propostas:editar']);
select tests.cena_analise();
select tests.cena_preco();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, null, null) $$, '22023', null, 'sem preço aprovado não há proposta');
select tests.sair();

-- aprova o preço (resultado do worker simulado): a proposta passa a poder nascer
update priv.precificacoes set calculado_em = now(), preco_final_unit = 125, total_proposta = 1250, aprovado_em = now(), aprovado_por = tests.usuario_id('usuario_a') where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'v1', priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, 'Pagamento em 30 dias', 'Curitiba') $$, 'A cria a proposta de preço aprovado');
select is((select total from priv.propostas where id = (select id from g where nome = 'v1')), 1250.0000, 'o total vem do preço aprovado');
select ok((select conteudo::text not like '%custo%' and conteudo::text not like '%margem%' from priv.propostas where id = (select id from g where nome = 'v1')), 'custos e margens nunca entram na proposta');
select lives_ok($$ insert into g select 'v2', priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, null, null) $$, 'cria a versão seguinte');
select is((select versao from priv.propostas where id = (select id from g where nome = 'v2')), 2, 'a versão incrementa');
select throws_ok($$ select priv.conferir_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1')) $$, '22023', null, 'não confere sem validação do worker');
select tests.sair();

-- worker simulado: validou sem divergência bloqueante
update priv.propostas set validada_em = now(), bloqueada = false where id = (select id from g where nome = 'v1');
select tests.autenticar_como('so_editar');
select lives_ok($$ select priv.conferir_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1')) $$, 'quem edita confere');
select throws_ok($$ select priv.aprovar_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), null) $$, '42501', null, 'sem propostas/aprovar não aprova');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.aprovar_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1'), (select tests.step_up('usuario_a', 'proposta_final'))) $$, 'quem aprova aprova');
select is((select status from priv.propostas where id = (select id from g where nome = 'v1')), 'aprovada', 'status aprovada');
select tests.sair();

-- worker simulado gera o final: depois disso nada muda
update priv.propostas set status = 'final', arquivo_chave = 'propostas/x.docx', arquivo_sha256 = repeat('a', 64), gerado_em = now() where id = (select id from g where nome = 'v1');
select throws_ok($$ update priv.propostas set total = 1 where id = (select id from g where nome = 'v1') $$, '42501', null, 'a proposta final é imutável');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.devolver_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1')) $$, '22023', null, 'não se devolve a final');
select lives_ok($$ select priv.nova_versao_proposta(tests.empresa_id('A'), (select id from g where nome = 'v1')) $$, 'alterar = nova versão (a final fica preservada)');
select is((select count(*)::int from priv.propostas where status = 'final'), 1, 'a versão final anterior segue lá');
select tests.sair();

select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.criar_proposta(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), null, 'inicial', 60, 30, 12, null, null) $$, '42501', null, 'B não cria proposta na empresa de A');
select is((select count(*)::int from priv.propostas where empresa_id = tests.empresa_id('A')), 0, 'B não vê propostas de A');
select * from finish();
rollback;
