-- Relatório diário: cada pessoa liga/desliga só a PRÓPRIA assinatura e só em empresa onde tem vínculo; a rodada do worker enfileira uma vez por dia.
begin;
set local search_path = tap;
select plan(9);

select tests.criar_empresas_ab();

select tests.autenticar_como('usuario_a');
select is(priv.minha_assinatura_relatorio(tests.empresa_id('A')), false, 'por padrão ninguém recebe (opt-in)');
select lives_ok($$ select priv.definir_relatorio_diario(tests.empresa_id('A'), true) $$, 'liga a própria assinatura');
select is(priv.minha_assinatura_relatorio(tests.empresa_id('A')), true, 'a função reflete a assinatura');
select throws_ok($$ select priv.definir_relatorio_diario(tests.empresa_id('B'), true) $$, '42501', null, 'sem vínculo na empresa B não assina');
select tests.sair();
select tests.autenticar_como('usuario_b');
select is(priv.minha_assinatura_relatorio(tests.empresa_id('A')), false, 'B não enxerga a assinatura de A');
select tests.sair();

select is(priv.enfileirar_relatorios_diarios(date '2026-11-05'), 1, 'a rodada enfileira uma mensagem para a assinatura ativa');
select is(priv.enfileirar_relatorios_diarios(date '2026-11-05'), 1, 'repetir a rodada conta de novo, mas não duplica o job');
select is((select count(*)::int from ops.jobs where tipo = 'relatorio_diario'), 1, 'um único job por pessoa, empresa e dia');
update priv.relatorio_diario_assinaturas set ultimo_envio = date '2026-11-05';
select is(priv.enfileirar_relatorios_diarios(date '2026-11-05'), 0, 'depois do envio, a assinatura não entra mais no mesmo dia');

select * from finish();
rollback;
