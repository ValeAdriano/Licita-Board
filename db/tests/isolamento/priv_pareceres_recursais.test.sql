-- Isolamento A x B de priv.pareceres_recursais e priv.parecer_achados: A lê só o que é seu; a API não tem DML direto (só funções).
begin;
set local search_path = tap;
select plan(8);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_resultado();
insert into priv.pareceres_recursais (empresa_id, participacao_id, concorrente) select empresa_id, participacao_id, 'Concorrente S/A' from priv.resultados_item;
insert into priv.parecer_achados (empresa_id, parecer_id, origem, tipo, descricao) select empresa_id, id, 'manual', 'certidao', 'Certidão vencida' from priv.pareceres_recursais;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.pareceres_recursais where empresa_id = tests.empresa_id('A') $$, 'A lê os pareceres da própria empresa');
select is_empty($$ select 1 from priv.pareceres_recursais where empresa_id = tests.empresa_id('B') $$, 'A não lê pareceres de B');
select isnt_empty($$ select 1 from priv.parecer_achados where empresa_id = tests.empresa_id('A') $$, 'A lê os achados da própria empresa');
select is_empty($$ select 1 from priv.parecer_achados where empresa_id = tests.empresa_id('B') $$, 'A não lê achados de B');
select throws_ok($$ update priv.pareceres_recursais set concorrente = 'x' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita pareceres de B');
select throws_ok($$ delete from priv.parecer_achados where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga achados de B');
select throws_ok($$ insert into priv.parecer_achados (empresa_id, parecer_id, origem, tipo, descricao) values (tests.empresa_id('B'), gen_random_uuid(), 'manual', 'outro', 'xxx') $$, '42501', null, 'A não insere achados em nome de B');
select throws_ok($$ insert into priv.pareceres_recursais (empresa_id, participacao_id, concorrente) values (tests.empresa_id('B'), gen_random_uuid(), 'xx') $$, '42501', null, 'A não insere pareceres em nome de B');

select * from finish();
rollback;
