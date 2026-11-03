-- Step-up MFA e alteração de permissões por RPC (Prompt 1.4 "Operações críticas"; RF-01.8).
-- Cada chamada de tests.autenticar_como com p_mfa_ha_seg diferente simula uma nova verificação MFA.
begin;
set local search_path = tap;
select plan(36);

select tests.criar_empresas_ab();
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar']);
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['empresas:visualizar']);
select tests.criar_usuario('super', true);
select tests.criar_usuario('novo_b');
create temp table tk (nome text primary key, id uuid);
grant all on tk to vv_api;

-- =============================================================== iniciar_step_up
select tests.autenticar_como('usuario_a', 'aal2', 3600);
select throws_ok($$ select core.iniciar_step_up('alterar_permissoes') $$, '42501', null,
  'sessão aal2 com MFA de 1 h atrás não inicia step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal1');
select throws_ok($$ select core.iniciar_step_up('alterar_permissoes') $$, '42501', null,
  'step-up exige aal2');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 10, 'sessao-teste', interval '1 hour');
select throws_ok($$ select core.iniciar_step_up('alterar_permissoes') $$, '42501',
  'fator MFA cadastrado há menos de 24 h não autoriza operação crítica',
  'fator cadastrado há 1 h (sessão roubada que cadastrou fator novo) não serve para step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 31);
reset role;
update core.sessoes set mfa_metodo = 'recuperacao' where id = tests.sessao_id('usuario_a');
set local role vv_api;
select throws_ok($$ select core.iniciar_step_up('alterar_permissoes') $$, '42501', null,
  'MFA por código de recuperação não serve para step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', -120, 'futuro');
select throws_ok($$ select core.iniciar_step_up('alterar_permissoes') $$, '42501', null,
  'verificação MFA com horário no futuro não serve');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 30);
select lives_ok($$ insert into tk values ('a1', core.iniciar_step_up('alterar_permissoes')) $$,
  'MFA verificado há 30 s com fator antigo inicia step-up');
select throws_ok($$ select core.iniciar_step_up('exclusao_definitiva') $$, '42501',
  'esta verificação MFA já foi usada; verifique de novo',
  'uma verificação MFA gera um único token');
select throws_ok($$ select core.iniciar_step_up('escopo_inventado') $$, '23514', null,
  'escopo desconhecido é rejeitado');
select throws_ok($$ select 1 from core.step_up_tokens $$, '42501', null,
  'tokens não são legíveis pela API');
select throws_ok(
  $$ insert into core.step_up_tokens (usuario_id, escopo, sessao_id, mfa_em, expira_em)
     values (tests.usuario_id('usuario_a'), 'alterar_permissoes', tests.sessao_id('usuario_a'), now(), now() + interval '1 day') $$,
  '42501', null, 'token não é criado direto pela API');
select throws_ok(
  $$ select core.consumir_step_up((select id from tk where nome = 'a1'), 'alterar_permissoes', null, null) $$,
  '42501', null, 'consumir_step_up não é chamável direto pela API');

-- =============================================================== definir_permissoes
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:editar'], null) $$,
  '42501', null, 'alterar permissão sem token de step-up falha');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 30, 'outra-sessao');
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:editar'],
       (select id from tk where nome = 'a1')) $$,
  '42501', null, 'token de outra sessão do mesmo usuário não vale');
select tests.sair();

select tests.autenticar_como('usuario_b', 'aal2', 30);
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('usuario_b', 'B'), array['empresas:visualizar', 'permissoes:administrar_permissoes'],
       (select id from tk where nome = 'a1')) $$,
  '42501', null, 'token de outro usuário não vale');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 30);
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), null, (select id from tk where nome = 'a1')) $$,
  '22023', null, 'lista nula é rejeitada (não apaga tudo por engano)');
select lives_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'),
       array['empresas:visualizar', 'empresas:editar'], (select id from tk where nome = 'a1')) $$,
  'ADMIN com step-up redefine as permissões do operador');
select results_eq(
  $$ select acao from core.permissoes where vinculo_id = tests.vinculo_id('operador_a', 'A') order by 1 $$,
  $$ values ('editar'::text), ('visualizar'::text) $$,
  'permissões ficaram exatamente como pedido');
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:visualizar'],
       (select id from tk where nome = 'a1')) $$,
  '42501', null, 'token é de uso único');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 29);
insert into tk values ('a2', core.iniciar_step_up('exclusao_definitiva'));
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:visualizar'],
       (select id from tk where nome = 'a2')) $$,
  '42501', null, 'token de outro escopo não vale');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 28);
insert into tk values ('a3', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('usuario_b', 'B'), array['empresas:visualizar'],
       (select id from tk where nome = 'a3')) $$,
  '42501', null, 'ADMIN de A não altera permissões de vínculo de B, mesmo com step-up');
select throws_ok(
  $$ select core.atualizar_vinculo(tests.vinculo_id('usuario_b', 'B'), null, false, (select id from tk where nome = 'a3')) $$,
  '42501', null, 'ADMIN de A não desativa vínculo de B, mesmo com step-up');
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('cliente_a', 'A'), array['empresas:visualizar', 'empresas:editar'],
       (select id from tk where nome = 'a3')) $$,
  '23514', null, 'CLIENTE não recebe permissão de escrita pela RPC');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 27);
insert into tk values ('a4', core.iniciar_step_up('alterar_permissoes'));
select lives_ok(
  $$ select core.atualizar_vinculo(tests.vinculo_id('operador_a', 'A'), 'JURIDICO', null, (select id from tk where nome = 'a4')) $$,
  'ADMIN com step-up muda o papel do operador');
select is((select papel from core.vinculos where id = tests.vinculo_id('operador_a', 'A')), 'JURIDICO',
  'papel alterado');
select tests.sair();

-- =============================================================== lockout: empresa sem admin
select tests.autenticar_como('usuario_a', 'aal2', 26);
insert into tk values ('a5', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('usuario_a', 'A'), array['empresas:visualizar'],
       (select id from tk where nome = 'a5')) $$,
  '23514', 'a empresa ficaria sem nenhum administrador de permissões',
  'único admin não remove a própria administração');
select tests.sair();
select tests.autenticar_como('usuario_a', 'aal2', 25);
insert into tk values ('a6', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.atualizar_vinculo(tests.vinculo_id('usuario_a', 'A'), null, false, (select id from tk where nome = 'a6')) $$,
  '23514', null, 'único admin não desativa o próprio vínculo');
select tests.sair();

-- =============================================================== OPERADOR sem administrar_permissoes
select tests.autenticar_como('operador_a', 'aal2', 10);
insert into tk values ('o1', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['permissoes:administrar_permissoes'],
       (select id from tk where nome = 'o1')) $$,
  '42501', null, 'quem não administra permissões não se autoconcede, mesmo com step-up');
select tests.sair();

-- =============================================================== expiração e logout
select tests.autenticar_como('usuario_a', 'aal2', 24);
insert into tk values ('a7', core.iniciar_step_up('alterar_permissoes'));
select tests.sair();
update core.step_up_tokens set expira_em = now() - interval '1 second' where id = (select id from tk where nome = 'a7');
select tests.autenticar_como('usuario_a', 'aal2', 24);
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:visualizar'],
       (select id from tk where nome = 'a7')) $$,
  '42501', null, 'token expirado não vale');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 23);
insert into tk values ('a8', core.iniciar_step_up('alterar_permissoes'));
select tests.sair();
update core.sessoes set revogada_em = now() where id = tests.sessao_id('usuario_a');  -- "sair de todos"
select throws_ok($$ select core.definir_contexto(tests.token('usuario_a')) $$, '28000', null,
  'logout: a sessão encerrada nem abre contexto (o token de step-up morre com ela)');
select tests.autenticar_como('usuario_a', 'aal2', 23, 'nova-sessao');
select throws_ok(
  $$ select core.definir_permissoes(tests.vinculo_id('operador_a', 'A'), array['empresas:visualizar'],
       (select id from tk where nome = 'a8')) $$,
  '42501', null, 'token da sessão encerrada não vale em outra sessão');
select tests.sair();

-- =============================================================== criar_vinculo
select tests.autenticar_como('usuario_a', 'aal2', 22);
insert into tk values ('a9', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.criar_vinculo(tests.usuario_id('novo_b'), tests.empresa_id('A'), 'OPERADOR', (select id from tk where nome = 'a9')) $$,
  '42501', null, 'ADMIN_EMPRESA não cria vínculo (só SUPERADMIN)');
select tests.sair();

select tests.autenticar_como('super', 'aal2', 3600);
select throws_ok(
  $$ select core.criar_vinculo(tests.usuario_id('novo_b'), tests.empresa_id('B'), 'OPERADOR', null) $$,
  '42501', null, 'SUPERADMIN sem step-up não cria vínculo');
select tests.sair();
select tests.autenticar_como('super', 'aal2', 10);
insert into tk values ('s1', core.iniciar_step_up('alterar_permissoes'));
select lives_ok(
  $$ select core.criar_vinculo(tests.usuario_id('novo_b'), tests.empresa_id('B'), 'OPERADOR', (select id from tk where nome = 's1')) $$,
  'SUPERADMIN com step-up cria vínculo');
select tests.sair();

-- =============================================================== auditoria e anon
select results_eq(
  $$ select usado_para_empresa_id, usado_para_alvo from core.step_up_tokens where id = (select id from tk where nome = 'a4') $$,
  $$ values (tests.empresa_id('A'), 'atualizar_vinculo:' || tests.vinculo_id('operador_a', 'A')) $$,
  'token registra para qual empresa e alvo foi usado');
select isnt_empty(
  $$ select 1 from audit.audit_log where table_name = 'step_up_tokens' and operation = 'UPDATE'
       and empresa_id = tests.empresa_id('A') and new_data ->> 'usado_em' is not null $$,
  'uso do step-up é auditado na empresa onde foi usado');

select ok(not has_function_privilege('vv_worker', 'core.iniciar_step_up(text)', 'execute'),
  'vv_worker não chama iniciar_step_up');

select * from finish();
rollback;
