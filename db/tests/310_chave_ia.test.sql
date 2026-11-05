-- Chave de IA por empresa: só por função com configuracoes/editar, o banco nunca devolve a chave, A x B.
begin;
set local search_path = tap;
select plan(11);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['configuracoes:visualizar']);

select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.salvar_chave_ia(tests.empresa_id('A'), '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb, 'wxyz', 'claude-sonnet-5-5') $$, 'A cadastra a chave (já cifrada)');
select throws_ok($$ select priv.salvar_chave_ia(tests.empresa_id('A'), '{"v":1,"ct":"texto-puro"}'::jsonb, 'wxyz', null) $$, '23514', null, 'o banco só aceita envelope cifrado válido (texto puro é recusado)');
select throws_ok($$ select priv.definir_modelo_ia(tests.empresa_id('A'), 'gpt-9') $$, '23514', null, 'modelo fora da lista é recusado');
select lives_ok($$ select priv.definir_modelo_ia(tests.empresa_id('A'), 'claude-haiku-5-5') $$, 'troca o modelo');
select is((select ultimos4 from priv.empresa_ia), 'wxyz', 'a API lê os 4 últimos caracteres');
select lives_ok($$ select priv.pedir_teste_chave_ia(tests.empresa_id('A')) $$, 'pede o teste da chave');
select is((select teste_status from priv.empresa_ia), 'pendente', 'teste pendente até o worker responder');
select tests.sair();
select is((select count(*)::int from ops.jobs where tipo = 'testar_chave_ia'), 1, 'o teste é do worker (a API não chama o provedor)');
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.salvar_chave_ia(tests.empresa_id('A'), '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb, 'abcd', null) $$, '42501', null, 'só visualizar não troca a chave');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.remover_chave_ia(tests.empresa_id('A')) $$, '42501', null, 'B não remove a chave de A');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok($$ select priv.remover_chave_ia(tests.empresa_id('A')) $$, 'A remove a própria chave');
select * from finish();
rollback;
