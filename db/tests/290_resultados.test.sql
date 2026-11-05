-- Fase 09 · resultados: gatilho de intenção de recurso, arrematação ≠ homologação, motivo obrigatório, CNPJ, só por função, A x B.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['agenda:visualizar']);
select tests.cena_analise();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'arrematada', 100000, 92000, 1, 92000, null, null, null, null, 'em_analise', null) $$, 'registra a arrematação (1º lugar)');
select is((select status from priv.participacoes where empresa_id = tests.empresa_id('A')), 'arrematada', 'o status da participação acompanha o resultado');
select is((select gatilho_recursal from priv.resultados_item where empresa_id = tests.empresa_id('A')), false, 'arrematar em 1º não abre gatilho de recurso');
select is((select resultado_final from priv.resultados_item where empresa_id = tests.empresa_id('A')), 'arrematada', 'arrematada e não homologada: são resultados diferentes');
select throws_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'perdida', 100000, 98000, 3, 90000, null, null, null, null, 'a_confirmar', null) $$, '22023', null, 'perdida exige motivo');
select throws_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'perdida', 100000, 98000, 3, 90000, '11111111111111', 'Concorrente', null, 'Preço menor', 'a_confirmar', null) $$, '22023', null, 'CNPJ inválido da vencedora é recusado');
select lives_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'perdida', 100000, 98000, 3, 90000, '11.222.333/0001-81', 'Concorrente Ltda', 'Marca Z Modelo 9', 'Preço final menor que o nosso', 'habilitada', null) $$, 'corrige para perdida com a vencedora');
select is((select vencedora_cnpj from priv.resultados_item where empresa_id = tests.empresa_id('A')), '11222333000181', 'guarda o CNPJ só com os caracteres válidos');
select is((select count(*)::int from priv.resultados_item where empresa_id = tests.empresa_id('A')), 1, 'um resultado por item (a correção atualiza)');
select throws_ok($$ update priv.resultados_item set valor_final = 1 $$, '42501', null, 'não grava direto: só por função');
select tests.sair();
select is((select count(*)::int from priv.agenda_eventos where tipo = 'intencao_recurso' and empresa_id = tests.empresa_id('A')), 1, 'perder abre o evento de intenção de recurso na agenda (gatilho 9.3)');
select is((select count(*)::int from ops.jobs where tipo = 'calcular_prazos'), 1, 'e enfileira o cálculo do prazo (o worker calcula)');

select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'cancelada', null, null, null, null, null, null, null, null, null, null) $$, '42501', null, 'só visualizar não registra resultado');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.registrar_resultado(tests.empresa_id('A'), (select id from priv.participacoes where empresa_id = tests.empresa_id('A')), 'cancelada', null, null, null, null, null, null, null, null, null, null) $$, '42501', null, 'B não registra resultado na empresa de A');
select * from finish();
rollback;
