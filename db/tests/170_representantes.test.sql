-- Fase 02 · PR 4: representantes legais, procuradores e advogados (spec fase-02 §3.2; CA-1, CA-9).
begin;
set local search_path = tap;
select plan(38);

select tests.criar_empresas_ab();
-- operador com cadastrar e visualizar (não edita nem arquiva); outro só visualiza; outro só arquiva.
select tests.criar_usuario('op_cad');
select tests.vincular('op_cad', 'A', 'OPERADOR', array['representantes:visualizar', 'representantes:cadastrar']);
select tests.criar_usuario('op_ver');
select tests.vincular('op_ver', 'A', 'OPERADOR', array['representantes:visualizar']);
select tests.criar_usuario('op_arq');
select tests.vincular('op_arq', 'A', 'OPERADOR', array['representantes:visualizar', 'representantes:arquivar']);
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['representantes:visualizar']);
create temp table tk (nome text primary key, id uuid);
create temp table res (nome text primary key, id uuid);
grant all on tk, res to vv_api;
create temp table env as select
  '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb as e;
grant select on env to vv_api;

-- Representante de B, criado como dono.
insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
select tests.empresa_id('B'), 'SOCIO_ADMINISTRADOR', 'Rep de B', e, '•••••••0001', repeat('b', 64) from env;
insert into res select 'rep_b', id from core.representantes where empresa_id = tests.empresa_id('B');

-- =============================================================== A cadastra
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, cargo, email, telefone)
     select tests.empresa_id('A'), 'SOCIO_ADMINISTRADOR', 'Ana Sócia', e, '•••••••2725', repeat('a', 64), 'Sócia-administradora', 'ana@empresa-a.test', '11999990000' from env $$,
  'A cadastra um sócio-administrador');
select lives_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, oab_numero, oab_uf)
     select tests.empresa_id('A'), 'ADVOGADO', 'Bia Advogada', e, '•••••••9999', repeat('c', 64), '123456', 'SP' from env $$,
  'A cadastra um advogado com OAB');
select lives_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'PROCURADOR', 'Caio Procurador', e, '•••••••8888', repeat('d', 64) from env $$,
  'A cadastra um procurador');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'ADVOGADO', 'Sem OAB', e, '•••••••7777', repeat('e', 64) from env $$,
  '23514', null, 'advogado sem OAB é recusado');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, oab_numero, oab_uf)
     select tests.empresa_id('A'), 'PROCURADOR', 'Com OAB indevida', e, '•••••••6666', repeat('f', 64), '1', 'SP' from env $$,
  '23514', null, 'OAB em quem não é advogado é recusada');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'PROCURADOR', 'CPF repetido', e, '•••••••2725', repeat('a', 64) from env $$,
  '23505', null, 'o mesmo CPF (mesma marca) não repete na empresa');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'PROCURADOR', 'Envelope ruim', '"texto"'::jsonb, '•••••••5555', repeat('9', 64) from env $$,
  '23514', null, 'CPF fora do formato de envelope é recusado');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, email)
     select tests.empresa_id('A'), 'PROCURADOR', 'Email ruim', e, '•••••••4444', repeat('8', 64), 'sem-arroba' from env $$,
  '23514', null, 'e-mail inválido é recusado');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('B'), 'PROCURADOR', 'Em nome de B', e, '•••••••3333', repeat('7', 64) from env $$,
  '42501', null, 'A não cadastra representante em B');

-- Leitura: só máscara; nunca o envelope nem a marca.
select results_eq(
  $$ select nome, cpf_mascara, cargo from core.representantes where empresa_id = tests.empresa_id('A') and tipo = 'SOCIO_ADMINISTRADOR' $$,
  $$ values ('Ana Sócia'::text, '•••••••2725'::text, 'Sócia-administradora'::text) $$,
  'A lê o representante com o CPF mascarado');
select throws_ok($$ select cpf_cifrado from core.representantes $$, '42501', null, 'vv_api não lê o envelope do CPF');
select throws_ok($$ select cpf_hash from core.representantes $$, '42501', null, 'vv_api não lê a marca do CPF (T4.c)');

-- =============================================================== A x B
select is_empty($$ select 1 from core.representantes where empresa_id = tests.empresa_id('B') $$, 'A não lê representantes de B');
select results_eq(
  $$ with u as (update core.representantes set nome = 'Hack' where empresa_id = tests.empresa_id('B') returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'A não edita representante de B');
select throws_ok($$ delete from core.representantes where empresa_id = tests.empresa_id('B') $$, '42501', null, 'ninguém apaga representante pela API (nem o da própria empresa)');
select throws_ok(
  $$ update core.representantes set empresa_id = tests.empresa_id('B') where empresa_id = tests.empresa_id('A') $$,
  '42501', null, 'representante não muda de empresa (empresa_id fora do grant de update)');
select lives_ok(
  $$ update core.representantes set cargo = 'Diretora' where nome = 'Ana Sócia' $$, 'A edita o cargo');
select tests.sair();

-- =============================================================== ações separadas: cadastrar, editar, arquivar
select tests.autenticar_como('op_cad');
select results_eq(
  $$ with u as (update core.representantes set cargo = 'X' where empresa_id = tests.empresa_id('A') returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'quem só cadastra não edita');
select lives_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'PROCURADOR', 'Cadastrado pelo operador', e, '•••••••1212', repeat('1', 64) from env $$,
  'quem tem cadastrar cadastra');
select tests.sair();
select tests.autenticar_como('op_ver');
select isnt_empty($$ select 1 from core.representantes where empresa_id = tests.empresa_id('A') $$, 'quem só visualiza lê');
select throws_ok(
  $$ insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
     select tests.empresa_id('A'), 'PROCURADOR', 'Sem permissão', e, '•••••••1313', repeat('2', 64) from env $$,
  '42501', null, 'quem só visualiza não cadastra');
select results_eq(
  $$ with u as (update core.representantes set cargo = 'X' where empresa_id = tests.empresa_id('A') returning 1) select count(*)::int from u $$,
  $$ values (0) $$, 'quem só visualiza não edita');
select tests.sair();
select tests.autenticar_como('op_arq');
select throws_ok(
  $$ update core.representantes set cargo = 'Y' where nome = 'Ana Sócia' $$,
  '42501', null, 'quem só arquiva não edita campos');
select throws_ok(
  $$ update core.representantes set deleted_at = now(), nome = 'Renomeada ao arquivar' where nome = 'Ana Sócia' $$,
  '42501', null, 'arquivar junto de edição exige também editar');
select lives_ok(
  $$ update core.representantes set deleted_at = now() where nome = 'Caio Procurador' $$,
  'quem tem arquivar arquiva (soft delete)');
select tests.sair();
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ update core.representantes set deleted_at = null where nome = 'Caio Procurador' $$,
  'ADMIN (que tem arquivar) desarquiva');
select tests.sair();

-- =============================================================== CLIENTE
select tests.autenticar_como('cliente_a', 'aal1');
select isnt_empty($$ select 1 from core.representantes where empresa_id = tests.empresa_id('A') $$, 'CLIENTE lê com aal1');
select tests.sair();

-- =============================================================== revelar CPF: step-up, registro e envelope
select tests.autenticar_como('usuario_a', 'aal2', 20);
insert into tk values ('s1', core.iniciar_step_up('dados_pessoais'));
select is(
  core.revelar_cpf_representante(tests.empresa_id('A'), (select id from core.representantes where nome = 'Ana Sócia'), (select id from tk where nome = 's1')),
  (select e from env), 'revelar o CPF devolve o envelope (a API decifra)');
select throws_ok(
  $$ select core.revelar_cpf_representante(tests.empresa_id('A'), (select id from core.representantes where nome = 'Ana Sócia'), (select id from tk where nome = 's1')) $$,
  '42501', null, 'o step-up é de uso único');
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal2', 19);
insert into tk values ('s2', core.iniciar_step_up('dados_bancarios'));
select throws_ok(
  $$ select core.revelar_cpf_representante(tests.empresa_id('A'), (select id from core.representantes where nome = 'Ana Sócia'), (select id from tk where nome = 's2')) $$,
  '42501', null, 'step-up de outro escopo não revela CPF');
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal2', 18);
insert into tk values ('s3', core.iniciar_step_up('dados_pessoais'));
select throws_ok(
  $$ select core.revelar_cpf_representante(tests.empresa_id('A'), (select id from res where nome = 'rep_b'), (select id from tk where nome = 's3')) $$,
  'P0002', null, 'o id de B não funciona pela empresa A');
select throws_ok(
  $$ select core.revelar_cpf_representante(tests.empresa_id('B'), (select id from res where nome = 'rep_b'), (select id from tk where nome = 's3')) $$,
  '42501', null, 'A não revela CPF de B');
select tests.sair();
select tests.autenticar_como('op_ver', 'aal2', 17);
select throws_ok(
  $$ select core.revelar_cpf_representante(tests.empresa_id('A'), (select id from core.representantes where nome = 'Ana Sócia'), gen_random_uuid()) $$,
  '42501', null, 'quem não edita não revela');
select tests.sair();
select isnt_empty($$ select 1 from core.revelacoes_dados where tabela = 'representantes' and campo = 'cpf' and empresa_id = tests.empresa_id('A') $$, 'a revelação do CPF fica registrada');
select isnt_empty($$ select 1 from audit.audit_log where table_name = 'revelacoes_dados' and empresa_id = tests.empresa_id('A') $$, 'e na auditoria');

-- =============================================================== auditoria sem dado pessoal
select is(
  (select count(*)::int from audit.audit_log
    where table_name = 'representantes' and (new_data::text like '%Ana%' or new_data::text like '%ZL6oPy96%'
       or new_data::text like '%2725%' or new_data::text like '%ana@empresa%' or new_data::text like '%123456%')),
  0, 'a auditoria não traz nome, CPF, envelope, e-mail nem OAB do representante');

-- A exclusão definitiva leva os representantes (cascade).
select lives_ok($$ select core.executar_exclusao('core.empresas', tests.empresa_id('B')) $$, 'exclusão definitiva de B executa');
select is((select count(*)::int from core.representantes where empresa_id = tests.empresa_id('B')), 0, 'os representantes de B sumiram com a empresa');

select * from finish();
rollback;
