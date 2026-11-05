-- Feriados próprios e parâmetro D-N por empresa: só por função, com permissão, isolados A x B e recalculando os prazos.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['agenda:visualizar']);
create temp table g (nome text primary key, id uuid);
grant all on g to public;

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'f', priv.cadastrar_feriado_agenda(tests.empresa_id('A'), date '2026-12-08', 'Padroeira (teste)', 'feriado', 'municipio', 'PR', '4106902') $$, 'A cadastra feriado municipal');
select throws_ok($$ select priv.cadastrar_feriado_agenda(tests.empresa_id('A'), date '2026-12-08', 'Repetido', 'feriado', 'municipio', 'PR', '4106902') $$, '23505', null, 'mesmo dia e município não repete');
select throws_ok($$ select priv.cadastrar_feriado_agenda(tests.empresa_id('A'), date '2026-12-09', 'Sem município', 'feriado', 'municipio', 'PR', null) $$, '23514', null, 'município exige código IBGE');
select throws_ok($$ select priv.cadastrar_feriado_agenda(tests.empresa_id('A'), date '2026-12-10', 'Cód. inválido', 'feriado', 'municipio', 'PR', 'abc') $$, '23514', null, 'IBGE inválido recusado');
select throws_ok($$ insert into priv.agenda_feriados (empresa_id, data, nome, abrangencia, uf) values (tests.empresa_id('A'), date '2026-12-11', 'direto', 'uf', 'PR') $$, '42501', null, 'não grava direto na tabela');
select lives_ok($$ select priv.definir_dias_internos(tests.empresa_id('A'), 3) $$, 'A define D-3');
select throws_ok($$ select priv.definir_dias_internos(tests.empresa_id('A'), 11) $$, '22023', null, 'limite 0 a 10');
select is((select dias_internos from priv.agenda_parametros), 3, 'parâmetro gravado');
select tests.sair();

select tests.autenticar_como('usuario_b');
select is((select count(*)::int from priv.agenda_feriados), 0, 'B não vê os feriados de A');
select is((select count(*)::int from priv.agenda_parametros), 0, 'B não vê o parâmetro de A');
select throws_ok($$ select priv.remover_feriado_agenda(tests.empresa_id('A'), (select id from g where nome = 'f')) $$, '42501', null, 'B não remove feriado de A');
select tests.sair();

select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.cadastrar_feriado_agenda(tests.empresa_id('A'), date '2026-12-12', 'Sem permissão', 'feriado', 'uf', 'PR', null) $$, '42501', null, 'só visualizar não cadastra');
select throws_ok($$ select priv.definir_dias_internos(tests.empresa_id('A'), 1) $$, '42501', null, 'só visualizar não muda o parâmetro');
select tests.sair();

select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.remover_feriado_agenda(tests.empresa_id('A'), (select id from g where nome = 'f')) $$, 'A remove (soft delete)');
select tests.sair();

select * from finish();
rollback;
