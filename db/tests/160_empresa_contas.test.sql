-- Fase 02 · PR 3: dados bancários e PIX cifrados (spec fase-02 §3.1 e §4.2; CA-7, CA-9; T4, T4.c, T5.38).
begin;
set local search_path = tap;
select plan(48);

select tests.criar_empresas_ab();
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar']);
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['empresas:visualizar']);
create temp table tk (nome text primary key, id uuid);
create temp table res (nome text primary key, id uuid);
grant all on tk, res to vv_api;

-- Envelope no formato do ADR-017 (os valores vêm do vetor de teste em docs/referencia).
create temp table env as select
  '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb as e;
grant select on env to vv_api;

create function pg_temp.dados(p_pix_hash text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'banco', '001', 'tipoConta', 'corrente', 'titularNome', 'Empresa A Ltda',
    'agencia', (select e from env), 'conta', (select e from env), 'titularDocumento', (select e from env),
    'agenciaMascara', '••••1234', 'contaMascara', '••••5678', 'titularDocumentoMascara', '•••••••0181',
    'pixTipo', case when p_pix_hash is null then null else 'email' end,
    'pixChave', case when p_pix_hash is null then null else (select e from env) end,
    'pixHash', p_pix_hash, 'pixMascara', case when p_pix_hash is null then null else '••••.test' end,
    'principal', true))
$$;
grant execute on function pg_temp.dados(text) to vv_api;

-- Dado de B criado como dono, para A tentar ler e mexer.
insert into core.empresa_contas (empresa_id, banco, tipo_conta, titular_nome, agencia_cifrada, conta_cifrada,
  titular_documento_cifrado, agencia_mascara, conta_mascara, titular_documento_mascara)
select tests.empresa_id('B'), '237', 'corrente', 'Empresa B Ltda', e, e, e, '••••1111', '••••2222', '•••••••3333' from env;
insert into res select 'conta_b', id from core.empresa_contas where empresa_id = tests.empresa_id('B');

-- =============================================================== step-up e permissão
select tests.autenticar_como('usuario_a', 'aal2', 3600);
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(), null) $$,
  '42501', null, 'salvar conta exige step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 20);
insert into tk values ('errado', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(), (select id from tk where nome = 'errado')) $$,
  '42501', null, 'step-up de outro escopo não vale para dados bancários');
select tests.sair();

-- =============================================================== A cria conta com PIX
select tests.autenticar_como('usuario_a', 'aal2', 19);
insert into tk values ('c1', core.iniciar_step_up('dados_bancarios'));
select lives_ok(
  $$ insert into res select 'conta_a', core.salvar_conta(tests.empresa_id('A'), null,
       pg_temp.dados(repeat('a', 64)), (select id from tk where nome = 'c1')) $$,
  'A cria conta com PIX (step-up dados_bancarios)');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(repeat('b', 64)), (select id from tk where nome = 'c1')) $$,
  '42501', null, 'o token é de uso único (reuso recusado)');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 18);
select results_eq(
  $$ select banco, titular_nome, agencia_mascara, conta_mascara, pix_tipo, pix_mascara, principal
       from core.empresa_contas where empresa_id = tests.empresa_id('A') $$,
  $$ values ('001'::text, 'Empresa A Ltda'::text, '••••1234'::text, '••••5678'::text, 'email'::text, '••••.test'::text, true) $$,
  'A lê a conta só com máscara');
select throws_ok($$ select agencia_cifrada from core.empresa_contas $$, '42501', null, 'vv_api não lê o envelope da agência');
select throws_ok($$ select titular_documento_cifrado from core.empresa_contas $$, '42501', null, 'vv_api não lê o envelope do titular');
select throws_ok($$ select pix_chave_cifrada from core.empresa_contas $$, '42501', null, 'vv_api não lê o envelope do PIX');
select throws_ok($$ select pix_hash from core.empresa_contas $$, '42501', null, 'vv_api não lê o hash do PIX (T4.c)');
select throws_ok(
  $$ insert into core.empresa_contas (empresa_id, banco, tipo_conta, titular_nome) values (tests.empresa_id('A'), '001', 'corrente', 'X') $$,
  '42501', null, 'vv_api não insere direto na tabela de contas');
select throws_ok($$ update core.empresa_contas set principal = false $$, '42501', null, 'vv_api não atualiza direto');
select throws_ok($$ delete from core.empresa_contas $$, '42501', null, 'vv_api não apaga direto');
select tests.sair();

-- Aviso aos administradores (e só aos da empresa A).
select is(
  (select count(*)::int from core.notificacoes where tipo = 'dados_bancarios' and usuario_id = tests.usuario_id('usuario_a')),
  1, 'o administrador de A é avisado da alteração (T5.38)');
select is(
  (select count(*)::int from core.notificacoes where tipo = 'dados_bancarios' and usuario_id <> tests.usuario_id('usuario_a')),
  0, 'quem não é administrador de A (nem de outra empresa) não recebe o aviso');

-- =============================================================== PIX repetido, formato e tudo-ou-nada
select tests.autenticar_como('usuario_a', 'aal2', 17);
insert into tk values ('c2', core.iniciar_step_up('dados_bancarios'));
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(repeat('a', 64)), (select id from tk where nome = 'c2')) $$,
  '23505', null, 'o mesmo PIX (mesmo hash) não repete na empresa');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null,
       jsonb_set(pg_temp.dados(), '{agencia}', '"texto-solto"'), (select id from tk where nome = 'c2')) $$,
  '23514', null, 'envelope inválido (não é o formato ADR-017) é recusado');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null,
       pg_temp.dados() || jsonb_build_object('pixTipo', 'email'), (select id from tk where nome = 'c2')) $$,
  '23514', null, 'PIX é tudo ou nada: tipo sem chave, hash e máscara é recusado');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null,
       jsonb_set(pg_temp.dados(), '{banco}', '"1"'), (select id from tk where nome = 'c2')) $$,
  '23514', null, 'banco precisa de 3 dígitos');
select tests.sair();

-- =============================================================== segunda conta tira o posto de principal
select tests.autenticar_como('usuario_a', 'aal2', 16);
insert into tk values ('c3', core.iniciar_step_up('dados_bancarios'));
select lives_ok(
  $$ insert into res select 'conta_a2', core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(), (select id from tk where nome = 'c3')) $$,
  'A cria a segunda conta (nova principal)');
select tests.sair();
select results_eq(
  $$ select count(*)::int, count(*) filter (where principal)::int from core.empresa_contas where empresa_id = tests.empresa_id('A') and deleted_at is null $$,
  $$ values (2, 1) $$, 'só uma conta principal por empresa');

-- =============================================================== editar: só o que veio muda; PIX some só se mandar tipo nulo
select tests.autenticar_como('usuario_a', 'aal2', 15);
insert into tk values ('c4', core.iniciar_step_up('dados_bancarios'));
select lives_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'),
       '{"titularNome": "Empresa A Renomeada Ltda"}'::jsonb, (select id from tk where nome = 'c4')) $$,
  'editar só o nome mantém o resto');
select tests.sair();
select results_eq(
  $$ select titular_nome, agencia_mascara, pix_tipo from core.empresa_contas where id = (select id from res where nome = 'conta_a') $$,
  $$ values ('Empresa A Renomeada Ltda'::text, '••••1234'::text, 'email'::text) $$, 'agência e PIX continuam');
select tests.autenticar_como('usuario_a', 'aal2', 14);
insert into tk values ('c5', core.iniciar_step_up('dados_bancarios'));
select lives_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'),
       '{"pixTipo": null}'::jsonb, (select id from tk where nome = 'c5')) $$,
  'pixTipo nulo remove o PIX inteiro');
select tests.sair();
select results_eq(
  $$ select pix_tipo, pix_mascara from core.empresa_contas where id = (select id from res where nome = 'conta_a') $$,
  $$ values (null::text, null::text) $$, 'PIX removido por inteiro');

-- =============================================================== A x B
select tests.autenticar_como('usuario_a', 'aal2', 13);
insert into tk values ('b1', core.iniciar_step_up('dados_bancarios'));
select is_empty($$ select 1 from core.empresa_contas where empresa_id = tests.empresa_id('B') $$, 'A não lê as contas de B');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('B'), null, pg_temp.dados(), (select id from tk where nome = 'b1')) $$,
  '42501', null, 'A não cria conta em nome de B');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_b'),
       '{"titularNome": "Hack"}'::jsonb, (select id from tk where nome = 'b1')) $$,
  'P0002', null, 'o id da conta de B não funciona pela empresa A');
select throws_ok(
  $$ select core.revelar_conta(tests.empresa_id('B'), (select id from res where nome = 'conta_b'), 'conta', (select id from tk where nome = 'b1')) $$,
  '42501', null, 'A não revela dado de B');
select throws_ok(
  $$ select core.remover_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_b'), (select id from tk where nome = 'b1')) $$,
  'P0002', null, 'o id da conta de B não é removido pela empresa A');
select tests.sair();
select is((select count(*)::int from core.empresa_contas where id = (select id from res where nome = 'conta_b') and deleted_at is null), 1, 'a conta de B segue intacta');

-- =============================================================== revelar: step-up, registro e auditoria
select tests.autenticar_como('usuario_a', 'aal2', 12);
insert into tk values ('r1', core.iniciar_step_up('dados_bancarios'));
select is(
  core.revelar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'), 'agencia', (select id from tk where nome = 'r1')),
  (select e from env), 'revelar devolve o envelope (a API decifra)');
select throws_ok(
  $$ select core.revelar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'), 'agencia', (select id from tk where nome = 'r1')) $$,
  '42501', null, 'revelar também gasta o step-up');
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal2', 11);
insert into tk values ('r2', core.iniciar_step_up('dados_bancarios'));
select throws_ok(
  $$ select core.revelar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'), 'pix_chave', (select id from tk where nome = 'r2')) $$,
  'P0002', null, 'sem PIX cadastrado não há o que revelar');
select throws_ok(
  $$ select core.revelar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'), 'senha', (select id from tk where nome = 'r2')) $$,
  '22023', null, 'só os 4 campos cifrados podem ser revelados');
select is_empty($$ select 1 from core.revelacoes_dados where campo = 'pix_chave' $$, 'tentativa sem valor não gera registro de revelação');
select isnt_empty($$ select 1 from core.revelacoes_dados where campo = 'agencia' and usuario_id = tests.usuario_id('usuario_a') $$,
  'a revelação fica registrada (quem, quê, quando) e A, com auditoria/visualizar, a enxerga');
select tests.sair();
select isnt_empty(
  $$ select 1 from audit.audit_log where table_name = 'revelacoes_dados' and operation = 'INSERT' and empresa_id = tests.empresa_id('A') $$,
  'a revelação também entra na auditoria imutável');
select throws_ok($$ update core.revelacoes_dados set campo = 'x' $$, '42501', null, 'registro de revelação não é reescrito (nem pelo dono)');
select throws_ok($$ delete from core.revelacoes_dados $$, '42501', null, 'registro de revelação não é apagado (nem pelo dono)');

-- =============================================================== quem não pode editar não revela nem altera
select tests.autenticar_como('operador_a', 'aal2', 10);
select isnt_empty($$ select 1 from core.empresa_contas where empresa_id = tests.empresa_id('A') $$, 'OPERADOR com visualizar lê as máscaras');
select throws_ok(
  $$ select core.revelar_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a'), 'agencia', gen_random_uuid()) $$,
  '42501', null, 'OPERADOR sem editar não revela');
select tests.sair();
select tests.autenticar_como('cliente_a', 'aal1');
select isnt_empty($$ select 1 from core.empresa_contas where empresa_id = tests.empresa_id('A') $$, 'CLIENTE lê as máscaras com aal1');
select throws_ok(
  $$ select core.salvar_conta(tests.empresa_id('A'), null, pg_temp.dados(), gen_random_uuid()) $$,
  '42501', null, 'CLIENTE não altera dados bancários');
select tests.sair();

-- =============================================================== auditoria sem dado nenhum e remoção
select is(
  (select count(*)::int from audit.audit_log
    where table_name = 'empresa_contas' and (new_data::text like '%ZL6oPy96%' or new_data::text like '%AwMDAwMD%'
       or new_data::text like '%••••%' or new_data::text like '%Empresa A%')),
  0, 'a auditoria da conta não traz envelope, máscara, hash nem nome do titular');
select tests.autenticar_como('usuario_a', 'aal2', 9);
insert into tk values ('d1', core.iniciar_step_up('dados_bancarios'));
select lives_ok($$ select core.remover_conta(tests.empresa_id('A'), (select id from res where nome = 'conta_a2'), (select id from tk where nome = 'd1')) $$,
  'A remove (soft delete) a conta');
select tests.sair();
select is((select count(*)::int from core.empresa_contas where empresa_id = tests.empresa_id('A') and deleted_at is null), 1, 'a conta removida sai da lista');

-- A exclusão definitiva da empresa leva as contas (e, em cascade, as revelações).
select lives_ok($$ select core.executar_exclusao('core.empresas', tests.empresa_id('B')) $$, 'exclusão definitiva de B executa');
select is((select count(*)::int from core.empresa_contas where empresa_id = tests.empresa_id('B')), 0, 'as contas de B sumiram com a empresa');

select * from finish();
rollback;
