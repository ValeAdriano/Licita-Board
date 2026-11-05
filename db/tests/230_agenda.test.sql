-- Fase 05 · agenda: isolamento A x B, justificativa obrigatória, histórico imutável, abertura só por função.
begin;
set local search_path = tap;
select plan(16);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['agenda:visualizar', 'editais:visualizar']);

insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ('11222333000181', 'Órgão Fictício', 'PR', '4106902');
insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo, data_encerramento_propostas)
select (select id from ops.fontes where slug = 'pncp'), 'AG-1', (select id from pub.orgaos), 'Objeto', repeat('a', 64), timestamptz '2026-12-10 09:00-03';
insert into pub.edital_itens (edital_id, numero_item, descricao) select id, n, 'Item ' || n from pub.editais, generate_series(1, 3) n;
insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao)
select tests.empresa_id('A'), edital_id, id, 50, 'media', 't', 1 from pub.edital_itens where numero_item = 1;
create temp table g (nome text primary key, id uuid);
grant all on g to vv_api;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'acomp', priv.acompanhar_edital(tests.empresa_id('A'), (select id from pub.editais)) $$, 'A acompanha o edital');
select is((select count(*)::int from priv.acompanhamentos), 1, 'A vê o seu acompanhamento');
select is((select abertura_confirmada from priv.acompanhamentos), false, 'a abertura nasce SUGERIDA, não confirmada');
select is((select priv.acompanhar_edital(tests.empresa_id('A'), (select id from pub.editais))), (select id from g where nome = 'acomp'), 'acompanhar de novo é idempotente');
select throws_ok($$ update priv.acompanhamentos set data_abertura = now() $$, '42501', null, 'a data de abertura não se altera por update direto');
select lives_ok($$ select priv.confirmar_abertura(tests.empresa_id('A'), (select id from g where nome = 'acomp'), timestamptz '2026-12-15 10:00-03', 'edital', 'item 4.1', null, null, null) $$, 'confirma a abertura por função');
select lives_ok($$ select priv.promover_oportunidade(tests.empresa_id('A'), (select id from priv.oportunidades)) $$, 'promove a oportunidade a participação');
select is((select count(*)::int from priv.participacoes), 1, 'uma linha por item (não por edital)');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'calcular_prazos'), 2, 'cada mudança enfileira o recálculo');

select tests.autenticar_como('usuario_b');
select is((select count(*)::int from priv.acompanhamentos), 0, 'B não vê acompanhamento de A');
select throws_ok($$ select priv.confirmar_abertura(tests.empresa_id('A'), (select id from g where nome = 'acomp'), now(), 'manual', null, null, null, null) $$, '42501', null, 'B não age na empresa de A');
select tests.sair();

select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.acompanhar_edital(tests.empresa_id('A'), (select id from pub.editais)) $$, '42501', null, 'só visualizar não acompanha');
select tests.sair();

-- Evento calculado pelo worker (como dono) e regras de justificativa.
insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, data_limite_legal)
select tests.empresa_id('A'), (select id from g where nome = 'acomp'), 'impugnacao', timestamptz '2026-12-10 23:59-03';
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.override_prazo(tests.empresa_id('A'), (select id from priv.agenda_eventos), timestamptz '2026-12-11 23:59-03', 'curto') $$, '22023', null, 'override sem justificativa de verdade é recusado');
select lives_ok($$ select priv.override_prazo(tests.empresa_id('A'), (select id from priv.agenda_eventos), timestamptz '2026-12-11 23:59-03', 'Edital fixa o prazo na cláusula 9.2') $$, 'override com justificativa vale');
select throws_ok($$ select priv.mudar_status_evento(tests.empresa_id('A'), (select id from priv.agenda_eventos), 'dispensado', null) $$, '22023', null, 'dispensar exige justificativa');
select throws_ok($$ delete from priv.agenda_evento_historico $$, '42501', null, 'histórico não se apaga');
select tests.sair();

select * from finish();
rollback;
