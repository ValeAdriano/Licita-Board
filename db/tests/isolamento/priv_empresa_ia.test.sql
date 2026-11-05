-- Isolamento A x B de priv.empresa_ia: A lê só os metadados da própria chave, NUNCA a coluna cifrada, e não escreve direto (só por função).
begin;
set local search_path = tap;
select plan(6);

select tests.criar_empresas_ab();
insert into priv.empresa_ia (empresa_id, chave_cifrada, ultimos4)
select tests.empresa_id(l), '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb, 'abcd' from unnest(array['A', 'B']) l;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select empresa_id, ultimos4 from priv.empresa_ia where empresa_id = tests.empresa_id('A') $$, 'A lê os metadados da própria chave');
select is_empty($$ select 1 from priv.empresa_ia where empresa_id = tests.empresa_id('B') $$, 'A não lê a linha de B');
select throws_ok($$ select chave_cifrada from priv.empresa_ia where empresa_id = tests.empresa_id('A') $$, '42501', null, 'nem a própria chave cifrada A lê (sem grant na coluna)');
select throws_ok($$ update priv.empresa_ia set modelo = 'claude-sonnet-5-5' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita direto');
select throws_ok($$ delete from priv.empresa_ia where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga direto');
select throws_ok($$ insert into priv.empresa_ia (empresa_id, chave_cifrada, ultimos4) values (tests.empresa_id('B'), '{}', 'xxxx') $$, '42501', null, 'A não insere em nome de B');

select * from finish();
rollback;
