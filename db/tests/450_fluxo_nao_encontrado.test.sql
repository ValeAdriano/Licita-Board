-- Q-31b: pagamento de fatura, encerrar contrato e abrir parecer distinguem ausência (P0002 → 404 na API) de validação
-- real (22023 → 400). Registro de outra empresa conta como ausente; caminho feliz inalterado.
begin;
set local search_path = tap;
select plan(15);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_resultado();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
insert into g select 'ct', priv.criar_contrato(tests.empresa_id('A'), null, 'contrato', 'CT-Q31B', 'Órgão fictício', 'Objeto fictício', date '2026-01-01', date '2026-12-31', null, null, null, null);
select priv.adicionar_item_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), 1, 'Item fictício', 'UN', 10, 100);
insert into g select 'nf', priv.registrar_fatura(tests.empresa_id('A'), (select id from g where nome = 'ct'), null, 'NF-Q31B', date '2026-03-01', 500, 0, date '2026-04-01');

-- pagamento
select throws_ok($$ select priv.registrar_pagamento(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000001', date '2026-04-02', 1, null) $$, 'P0002', 'fatura não encontrada', 'pagamento: fatura inexistente é P0002');
select throws_ok($$ select priv.registrar_pagamento(tests.empresa_id('A'), (select id from g where nome = 'nf'), date '2026-04-02', 500.0001, null) $$, '22023', 'valor recebido acima do faturado', 'pagamento: recebido acima do faturado continua 22023');
select lives_ok($$ select priv.registrar_pagamento(tests.empresa_id('A'), (select id from g where nome = 'nf'), date '2026-04-02', 500, 'Pago integral') $$, 'pagamento: caminho feliz');
select is((select valor_recebido from priv.faturas where id = (select id from g where nome = 'nf')), 500.0000, 'pagamento: valor recebido gravado');

-- encerrar
select throws_ok($$ select priv.encerrar_contrato(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000002', 'encerrado') $$, 'P0002', 'contrato não encontrado', 'encerrar: contrato inexistente é P0002');
select lives_ok($$ select priv.encerrar_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'encerrado') $$, 'encerrar: caminho feliz');
select throws_ok($$ select priv.encerrar_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'rescindido') $$, '22023', 'só se encerra um contrato ativo', 'encerrar: contrato já encerrado continua 22023');

-- abrir parecer (a cena tem a empresa como arrematante: sem gatilho recursal)
select throws_ok($$ select priv.abrir_parecer(tests.empresa_id('A'), '00000000-0000-7000-8000-000000000003', 'Concorrente S/A', null) $$, 'P0002', 'participação não encontrada', 'parecer: participação inexistente é P0002');
select throws_ok($$ select priv.abrir_parecer(tests.empresa_id('A'), (select participacao_id from priv.resultados_item where empresa_id = tests.empresa_id('A')), 'Concorrente S/A', null) $$, '22023', null, 'parecer: sem gatilho recursal continua 22023');
select tests.sair();
update priv.resultados_item set resultado_final = 'perdida', motivo_perda = 'Perdeu no lance', gatilho_recursal = true;
insert into g select 'part_a', participacao_id from priv.resultados_item where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.abrir_parecer(tests.empresa_id('A'), (select id from g where nome = 'part_a'), 'Concorrente S/A', null) $$, 'parecer: caminho feliz com gatilho recursal');
select tests.sair();

-- B, com permissão na própria empresa, apontando ids de A: ausente (P0002), e nada muda em A
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.registrar_pagamento(tests.empresa_id('B'), (select id from g where nome = 'nf'), date '2026-05-01', 1, 'Invasor') $$, 'P0002', null, 'pagamento: fatura de outra empresa é P0002');
select throws_ok($$ select priv.encerrar_contrato(tests.empresa_id('B'), (select id from g where nome = 'ct'), 'rescindido') $$, 'P0002', null, 'encerrar: contrato de outra empresa é P0002');
select throws_ok($$ select priv.abrir_parecer(tests.empresa_id('B'), (select id from g where nome = 'part_a'), 'Invasor', null) $$, 'P0002', null, 'parecer: participação de outra empresa é P0002');
select tests.sair();
select is((select valor_recebido::text || '/' || ocorrencia from priv.faturas where id = (select id from g where nome = 'nf')), '500.0000/Pago integral', 'a fatura de A ficou intacta');
select is((select count(*)::int from priv.pareceres_recursais where empresa_id = tests.empresa_id('B')), 0, 'B não abriu parecer');

select * from finish();
rollback;
