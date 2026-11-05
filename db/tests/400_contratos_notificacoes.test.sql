-- Alertas do pós-licitação: uma notificação por situação (idempotente), destinatários por permissão, janelas e "contratada sem contrato".
begin;
set local search_path = tap;
select plan(9);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_contratos');
select tests.vincular('so_contratos', 'A', 'OPERADOR', array['contratos:visualizar']);
select tests.cena_analise();
select tests.cena_contrato();
select tests.cena_resultado();
-- hoje fixo: 2026-11-05. Vigência até 31/12 (56 dias: próximo), empenho com prazo vencido, fatura vencida, resultado "contratada" sem contrato ligado.
update priv.empenhos set prazo_entrega = date '2026-11-03';
update priv.resultados_item set resultado_final = 'contratada';
-- a empresa B já encerrou o contrato e recebeu a fatura: não há o que avisar (só o lembrete de cadastrar a contratada)
update priv.contratos set status = 'encerrado' where empresa_id = tests.empresa_id('B');
update priv.faturas set pago_em = date '2026-11-04', valor_recebido = 200 where empresa_id = tests.empresa_id('B');

select is(priv.gerar_alertas_contratos(date '2026-11-05'), 5, 'A gera 4 situações (vigência, entrega, pagamento e contrato a cadastrar); B encerrada só o lembrete de cadastrar');
select is(priv.gerar_alertas_contratos(date '2026-11-05'), 0, 'repetir a rodada não duplica nada');
select is((select count(*)::int from core.notificacoes where usuario_id = tests.usuario_id('usuario_a') and modulo = 'contratos'), 4, 'quem tem tudo recebe as quatro');
select is((select count(*)::int from core.notificacoes where usuario_id = tests.usuario_id('so_contratos') and modulo = 'contratos'), 2, 'quem só vê contratos não recebe pagamento nem "cadastrar"');
select is((select count(*)::int from core.notificacoes where usuario_id = tests.usuario_id('usuario_b') and empresa_id = tests.empresa_id('A')), 0, 'B não recebe nada de A');
select is((select titulo from core.notificacoes where usuario_id = tests.usuario_id('usuario_a') and corpo like '%NF-1%'), 'Pagamento vencida', 'o texto do pagamento vencido');

-- o marco muda de "próximo" para "vencido": nova notificação; contrato cadastrado para a contratada: sem lembrete novo
update priv.contratos set vigencia_fim = date '2026-11-01' where empresa_id = tests.empresa_id('A');
select is(priv.gerar_alertas_contratos(date '2026-11-05'), 1, 'vigência que vence depois de avisar "próximo" gera o aviso de vencido');
select is(priv.gerar_alertas_contratos(date '2026-11-20'), 0, 'o que já foi avisado como vencido não é avisado de novo; contrato encerrado e fatura paga não alertam');
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.gerar_alertas_contratos(current_date) $$, '42501', null, 'a API não executa a rodada de alertas');

select * from finish();
rollback;
