-- Fase 03 · alertas de vencimento (marcos, sem repetir, sem rajada) e pendência "Atualizar documento".
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('op_doc');
select tests.vincular('op_doc', 'A', 'OPERADOR', array['documentos:visualizar', 'documentos:editar']);
select tests.criar_usuario('sem_doc');
select tests.vincular('sem_doc', 'A', 'OPERADOR', array['empresas:visualizar']);
select tests.criar_usuario('op_b');
select tests.vincular('op_b', 'B', 'OPERADOR', array['documentos:visualizar']);

-- Documento de A com versão liberada vencendo em 12 dias (tipo com marcos 30/15/10/5): marco atingido = 15.
insert into priv.documentos (id, empresa_id, tipo_id, descricao)
select '00000000-0000-7000-8000-0000000000a1', tests.empresa_id('A'), id, 'CND Federal' from pub.tipos_documento where slug = 'cnd_federal';
insert into priv.documento_versoes (id, documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade)
values ('00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000a1', tests.empresa_id('A'), 1, 'documentos/x', 'cnd.pdf', 'liberado', date '2026-12-12');

select is(priv.gerar_alertas_documentos(date '2026-11-30'), 1, 'faltando 12 dias, um alerta (marco 15)');
select is((select marco_dias from priv.documento_alertas), 15, 'o marco é o menor já atingido');
select is(priv.gerar_alertas_documentos(date '2026-11-30'), 0, 'rodar de novo no mesmo dia não repete');
select is(priv.gerar_alertas_documentos(date '2026-12-01'), 0, 'faltando 11 dias, ainda o marco 15: nada novo');
select is(priv.gerar_alertas_documentos(date '2026-12-03'), 1, 'faltando 9 dias, cruza o marco 10');
select is(priv.gerar_alertas_documentos(date '2026-12-13'), 1, 'venceu: alerta de vencido (marco 0)');
select is(priv.gerar_alertas_documentos(date '2026-12-20'), 0, 'vencido alerta uma vez só por versão');
select is((select count(*)::int from core.notificacoes where tipo = 'documento_vencimento' and usuario_id = tests.usuario_id('op_doc')), 3, 'quem tem documentos/visualizar recebe cada alerta');
select is((select count(*)::int from core.notificacoes where tipo = 'documento_vencimento' and usuario_id in (tests.usuario_id('sem_doc'), tests.usuario_id('op_b'))), 0, 'sem a permissão, ou de outra empresa, não recebe');

-- Sem vencimento não alerta.
update priv.documentos set sem_vencimento = true where id = '00000000-0000-7000-8000-0000000000a1';
delete from priv.documento_alertas;
select is(priv.gerar_alertas_documentos(date '2027-01-01'), 0, 'documento sem vencimento não alerta');
update priv.documentos set sem_vencimento = false where id = '00000000-0000-7000-8000-0000000000a1';

-- Pendência: abrir, falhar de verdade, reabrir e fechar com sucesso quando um arquivo novo é liberado.
select tests.autenticar_como('op_doc');
select lives_ok($$ select priv.solicitar_atualizacao(tests.empresa_id('A'), '00000000-0000-7000-8000-0000000000a1', 'Emitir no site da Receita') $$, 'abre a pendência');
select throws_ok($$ select priv.solicitar_atualizacao(tests.empresa_id('A'), '00000000-0000-7000-8000-0000000000a1', 'de novo') $$, '23505', null, 'só uma pendência aberta por documento');
select tests.sair();
select tests.autenticar_como('op_b');
select throws_ok($$ select priv.solicitar_atualizacao(tests.empresa_id('A'), '00000000-0000-7000-8000-0000000000a1', 'intruso') $$, '42501', null, 'outra empresa não abre pendência');
select tests.sair();

insert into priv.documento_versoes (id, documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo, validade)
values ('00000000-0000-7000-8000-0000000000b2', '00000000-0000-7000-8000-0000000000a1', tests.empresa_id('A'), 2, 'quarentena/x', 'nova.pdf', 'quarentena', date '2027-06-01');
update priv.documento_versoes set status_arquivo = 'liberado' where id = '00000000-0000-7000-8000-0000000000b2';
select is((select resultado from priv.documento_pendencias), 'sucesso', 'arquivo novo liberado fecha a pendência como sucesso');

select * from finish();
rollback;
