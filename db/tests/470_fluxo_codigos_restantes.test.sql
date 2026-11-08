-- Q-36b + Q-37: em cada função alterada por 20261202100000_fluxo_codigos_restantes, registro ausente (ou de outra
-- empresa, ou sem permissão de administrar no caso de vínculo e convite) é P0002 (→ 404 na API), registro existente no
-- estado errado é 22023 (→ 400) e falta de permissão (ou step-up) continua 42501 (→ 403). Caminhos felizes já têm teste
-- próprio (280, 320, 100, 110).
begin;
set local search_path = tap;
select plan(51);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_proposta();
select tests.cena_juridico();
select tests.criar_usuario('operador_q37');
select tests.vincular('operador_q37', 'A', 'OPERADOR', array['empresas:visualizar', 'permissoes:visualizar']);
create temp table g (nome text primary key, id uuid);
grant all on g to public;

-- Cena (como superusuário): a peça de A descartada (nenhuma ação de fluxo a aceita); a proposta de A em rascunho sem
-- validação (não se confere, não se devolve, não se aprova); um convite pendente e um revogado em A.
insert into g select 'peca', id from priv.pecas where empresa_id = tests.empresa_id('A');
update priv.pecas set status = 'descartada', justificativa_descarte = 'Descartada no teste' where id = (select id from g where nome = 'peca');
insert into g select 'prop', id from priv.propostas where empresa_id = tests.empresa_id('A');
with x as (insert into core.convites (empresa_id, email, papel, permissoes, criado_por)
  values (tests.empresa_id('A'), 'convite.q37@teste.local', 'CLIENTE', array['empresas:visualizar'], tests.usuario_id('usuario_a')) returning id) insert into g select 'conv', id from x;
with x as (insert into core.convites (empresa_id, email, papel, permissoes, criado_por, revogado_em, revogado_por)
  values (tests.empresa_id('A'), 'revogado.q37@teste.local', 'CLIENTE', array['empresas:visualizar'], tests.usuario_id('usuario_a'), now(), tests.usuario_id('usuario_a')) returning id) insert into g select 'conv_rev', id from x;

-- A (com todas as permissões): inexistente é P0002, estado errado é 22023
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000101', null) $$, 'P0002', 'peça não encontrada', 'aprovar peça: inexistente é P0002');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), null) $$, '22023', null, 'aprovar peça: descartada é 22023');
select throws_ok($$ select priv.descartar_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000102', 'Justificativa fictícia') $$, 'P0002', 'peça não encontrada', 'descartar peça: inexistente é P0002');
select throws_ok($$ select priv.descartar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'Justificativa fictícia') $$, '22023', 'só se descarta uma peça sugerida, em triagem ou em minuta', 'descartar peça: já descartada é 22023');
select throws_ok($$ select priv.devolver_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000103') $$, 'P0002', 'peça não encontrada', 'devolver peça: inexistente é P0002');
select throws_ok($$ select priv.devolver_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '22023', null, 'devolver peça: descartada é 22023');
select throws_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000104') $$, 'P0002', 'peça não encontrada', 'enviar à revisão: inexistente é P0002');
select throws_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '22023', null, 'enviar à revisão: descartada é 22023');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000105', 'PROT-1', now(), null) $$, 'P0002', 'peça não encontrada', 'protocolar: inexistente é P0002');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'PROT-1', now(), null) $$, '22023', 'só se protocola uma peça com documento final', 'protocolar: descartada é 22023');
select throws_ok($$ select priv.registrar_resultado_peca(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000106', 'deferido', null, null) $$, 'P0002', 'peça não encontrada', 'resultado: inexistente é P0002');
select throws_ok($$ select priv.registrar_resultado_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'deferido', null, null) $$, '22023', 'só se registra resultado de uma peça protocolada', 'resultado: descartada é 22023');
select throws_ok($$ select priv.salvar_minuta(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000107', 'Minuta fictícia', null) $$, 'P0002', 'peça não encontrada', 'salvar minuta: inexistente é P0002');
select throws_ok($$ select priv.salvar_minuta(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'Minuta fictícia', null) $$, '22023', 'a minuta só se edita antes da aprovação', 'salvar minuta: descartada é 22023');
select throws_ok($$ select priv.aprovar_proposta(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000108', null) $$, 'P0002', 'proposta não encontrada', 'aprovar proposta: inexistente é P0002');
select throws_ok($$ select priv.aprovar_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop'), null) $$, '22023', null, 'aprovar proposta: rascunho é 22023');
select throws_ok($$ select priv.conferir_proposta(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000109') $$, 'P0002', 'proposta não encontrada', 'conferir proposta: inexistente é P0002');
select throws_ok($$ select priv.conferir_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop')) $$, '22023', null, 'conferir proposta: rascunho sem validação é 22023');
select throws_ok($$ select priv.devolver_proposta(tests.empresa_id('A'), '00000000-0000-7000-8000-00000000010a') $$, 'P0002', 'proposta não encontrada', 'devolver proposta: inexistente é P0002');
select throws_ok($$ select priv.devolver_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop')) $$, '22023', null, 'devolver proposta: rascunho é 22023');
-- Q-36b · vínculo e convite
select throws_ok($$ select core.salvar_vinculo('00000000-0000-7000-8000-00000000010b', 'OPERADOR', true, array['empresas:visualizar'], null) $$, 'P0002', 'vínculo não encontrado', 'salvar vínculo: inexistente é P0002');
select throws_ok($$ select core.salvar_vinculo(tests.vinculo_id('operador_q37', 'A'), 'OPERADOR', true, array['empresas:visualizar'], null) $$, '42501', null, 'salvar vínculo: step-up ausente continua 42501');
select throws_ok($$ select core.salvar_vinculo(tests.vinculo_id('operador_q37', 'A'), 'OPERADOR', true, array['empresas:visualizar'], '00000000-0000-7000-8000-00000000010c') $$, '42501', null, 'salvar vínculo: step-up errado continua 42501');
select throws_ok($$ select core.revogar_convite('00000000-0000-7000-8000-00000000010d') $$, 'P0002', 'convite não encontrado', 'revogar convite: inexistente é P0002');
select throws_ok($$ select core.revogar_convite((select id from g where nome = 'conv_rev')) $$, '22023', 'o convite já foi aceito ou revogado', 'revogar convite: já revogado é 22023');
select tests.sair();

-- B, com tudo na própria empresa, apontando ids de A: ausente (P0002), nunca o 22023 de estado
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('B'), (select id from g where nome = 'peca'), null) $$, 'P0002', null, 'aprovar peça: de outra empresa é P0002');
select throws_ok($$ select priv.descartar_peca(tests.empresa_id('B'), (select id from g where nome = 'peca'), 'Justificativa do invasor') $$, 'P0002', null, 'descartar peça: de outra empresa é P0002');
select throws_ok($$ select priv.devolver_peca(tests.empresa_id('B'), (select id from g where nome = 'peca')) $$, 'P0002', null, 'devolver peça: de outra empresa é P0002');
select throws_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('B'), (select id from g where nome = 'peca')) $$, 'P0002', null, 'enviar à revisão: de outra empresa é P0002');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('B'), (select id from g where nome = 'peca'), 'PROT-1', now(), null) $$, 'P0002', null, 'protocolar: de outra empresa é P0002');
select throws_ok($$ select priv.registrar_resultado_peca(tests.empresa_id('B'), (select id from g where nome = 'peca'), 'deferido', null, null) $$, 'P0002', null, 'resultado: de outra empresa é P0002');
select throws_ok($$ select priv.salvar_minuta(tests.empresa_id('B'), (select id from g where nome = 'peca'), 'Minuta do invasor', null) $$, 'P0002', null, 'salvar minuta: de outra empresa é P0002');
select throws_ok($$ select priv.aprovar_proposta(tests.empresa_id('B'), (select id from g where nome = 'prop'), null) $$, 'P0002', null, 'aprovar proposta: de outra empresa é P0002');
select throws_ok($$ select priv.conferir_proposta(tests.empresa_id('B'), (select id from g where nome = 'prop')) $$, 'P0002', null, 'conferir proposta: de outra empresa é P0002');
select throws_ok($$ select priv.devolver_proposta(tests.empresa_id('B'), (select id from g where nome = 'prop')) $$, 'P0002', null, 'devolver proposta: de outra empresa é P0002');
select throws_ok($$ select core.salvar_vinculo(tests.vinculo_id('operador_q37', 'A'), 'OPERADOR', true, array['empresas:visualizar'], null) $$, 'P0002', 'vínculo não encontrado', 'salvar vínculo: de outra empresa é P0002 (antes do step-up)');
select throws_ok($$ select core.revogar_convite((select id from g where nome = 'conv')) $$, 'P0002', 'convite não encontrado', 'revogar convite: de outra empresa é P0002');
select throws_ok($$ select core.revogar_convite((select id from g where nome = 'conv_rev')) $$, 'P0002', 'convite não encontrado', 'revogar convite: já revogado de outra empresa é P0002 (não revela o estado)');
-- B sem permissão na empresa A: 42501 antes de olhar o registro
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), null) $$, '42501', null, 'aprovar peça: sem permissão é 42501');
select throws_ok($$ select priv.descartar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'Justificativa do invasor') $$, '42501', null, 'descartar peça: sem permissão é 42501');
select throws_ok($$ select priv.devolver_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '42501', null, 'devolver peça: sem permissão é 42501');
select throws_ok($$ select priv.enviar_revisao_peca(tests.empresa_id('A'), (select id from g where nome = 'peca')) $$, '42501', null, 'enviar à revisão: sem permissão é 42501');
select throws_ok($$ select priv.protocolar_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'PROT-1', now(), null) $$, '42501', null, 'protocolar: sem permissão é 42501');
select throws_ok($$ select priv.registrar_resultado_peca(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'deferido', null, null) $$, '42501', null, 'resultado: sem permissão é 42501');
select throws_ok($$ select priv.salvar_minuta(tests.empresa_id('A'), (select id from g where nome = 'peca'), 'Minuta do invasor', null) $$, '42501', null, 'salvar minuta: sem permissão é 42501');
select throws_ok($$ select priv.aprovar_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop'), null) $$, '42501', null, 'aprovar proposta: sem permissão é 42501');
select throws_ok($$ select priv.conferir_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop')) $$, '42501', null, 'conferir proposta: sem permissão é 42501');
select throws_ok($$ select priv.devolver_proposta(tests.empresa_id('A'), (select id from g where nome = 'prop')) $$, '42501', null, 'devolver proposta: sem permissão é 42501');
select tests.sair();

-- Operador de A sem permissoes:administrar_permissoes: vínculo e convite da própria empresa são P0002 (não 42501)
select tests.autenticar_como('operador_q37');
select throws_ok($$ select core.salvar_vinculo(tests.vinculo_id('usuario_a', 'A'), 'OPERADOR', true, array['empresas:visualizar'], null) $$, 'P0002', 'vínculo não encontrado', 'salvar vínculo: sem administrar_permissoes é P0002');
select throws_ok($$ select core.revogar_convite((select id from g where nome = 'conv')) $$, 'P0002', 'convite não encontrado', 'revogar convite: sem administrar_permissoes é P0002');
select tests.sair();

select is((select revogado_em from core.convites where id = (select id from g where nome = 'conv')), null, 'o convite pendente de A ficou intacto');

select * from finish();
rollback;
