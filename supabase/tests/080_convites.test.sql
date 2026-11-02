-- Convite com aceite: só quem administra permissões convida (com step-up e teto de concessão);
-- só a CONTA ligada ao convite aceita (troca de e-mail não dá acesso); convite órfão não vale.
begin;
select plan(32);

select tests.criar_empresas_ab();
select tests.criar_usuario('novo');          -- conta existe, sem vínculo
select tests.criar_usuario('intruso');       -- outro usuário qualquer
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar', 'usuarios:visualizar', 'permissoes:visualizar']);
select tests.criar_usuario('admin_limitado');
select tests.vincular('admin_limitado', 'A', 'ADMIN_EMPRESA',
  array['empresas:visualizar', 'documentos:visualizar', 'permissoes:visualizar', 'permissoes:administrar_permissoes']);
create temp table tk (nome text primary key, id uuid);
grant all on tk to authenticated;

-- =============================================================== quem convida
select tests.autenticar_como('operador_a', 'aal2', 10);
insert into tk values ('o1', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'novo@teste.local', 'OPERADOR', array['empresas:visualizar'], (select id from tk where nome = 'o1')) $$,
  '42501', null, 'quem não administra permissões não convida');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 3600);
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'novo@teste.local', 'OPERADOR', array['empresas:visualizar'], null) $$,
  '42501', null, 'convidar exige step-up');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 10);
insert into tk values ('a1', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('B'), 'novo@teste.local', 'OPERADOR', array['empresas:visualizar'], (select id from tk where nome = 'a1')) $$,
  '42501', null, 'ADMIN de A não convida para a empresa B');
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'novo@teste.local', 'CLIENTE', array['empresas:editar'], (select id from tk where nome = 'a1')) $$,
  '23514', null, 'CLIENTE não é convidado com permissão de escrita');
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'novo@teste.local', 'OPERADOR', array['inexistente:visualizar'], (select id from tk where nome = 'a1')) $$,
  '22023', null, 'módulo inexistente é rejeitado (antes de consumir o token)');
select lives_ok(
  $$ insert into tk values ('convite', core.convidar_usuario(tests.empresa_id('A'), '  Novo@Teste.LOCAL ', 'OPERADOR',
       array['empresas:visualizar', 'documentos:visualizar', 'documentos:cadastrar'], (select id from tk where nome = 'a1'))) $$,
  'ADMIN de A convida com step-up (e-mail normalizado)');
select results_eq(
  $$ select email, papel, usuario_id from core.convites where id = (select id from tk where nome = 'convite') $$,
  $$ values ('novo@teste.local'::text, 'OPERADOR'::text, tests.usuario_id('novo')) $$,
  'convite fica preso à conta existente');
select tests.sair();

select tests.autenticar_como('usuario_a', 'aal2', 9);
insert into tk values ('a2', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'novo@teste.local', 'OPERADOR', array['empresas:visualizar'], (select id from tk where nome = 'a2')) $$,
  '23505', null, 'só um convite pendente por e-mail e empresa');
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'operador_a@teste.local', 'OPERADOR', array['empresas:visualizar'], (select id from tk where nome = 'a2')) $$,
  '23505', null, 'quem já tem vínculo não é convidado de novo');
select lives_ok(
  $$ insert into tk values ('convite_sem_conta', core.convidar_usuario(tests.empresa_id('A'), 'diretor@empresa-a.local', 'ADMIN_EMPRESA',
       array['empresas:visualizar', 'permissoes:administrar_permissoes', 'precos:ver_custos_margens'], (select id from tk where nome = 'a2'))) $$,
  'convidar e-mail sem conta responde igual (não revela cadastro)');
select tests.sair();

-- =============================================================== teto de concessão
select tests.autenticar_como('admin_limitado', 'aal2', 10);
insert into tk values ('l1', core.iniciar_step_up('alterar_permissoes'));
select throws_ok(
  $$ select core.convidar_usuario(tests.empresa_id('A'), 'cumplice@teste.local', 'OPERADOR', array['precos:ver_custos_margens'], (select id from tk where nome = 'l1')) $$,
  '42501', 'só é possível conceder permissões que você mesmo tem nesta empresa',
  'quem não vê custos não convida alguém para ver custos');
select tests.sair();

-- =============================================================== notificação e auditoria
select results_eq(
  $$ select titulo from core.notificacoes where usuario_id = tests.usuario_id('novo') and link = '/convites' $$,
  $$ values ('Você recebeu um convite para acessar uma empresa'::text) $$,
  'aviso in-app tem título fixo (sem texto controlado pela empresa)');
select is_empty(
  $$ select 1 from audit.audit_log where table_name = 'convites' and (new_data ->> 'email') <> '[redigido]' $$,
  'e-mail do convidado é redigido na auditoria');
select is_empty(
  $$ select 1 from core.step_up_tokens where usado_para_alvo like '%@%' $$,
  'step-up registra o id do convite, não o e-mail');

-- =============================================================== quem vê
select tests.autenticar_como('usuario_b');
select is_empty($$ select 1 from core.convites $$, 'ADMIN de B não vê convites de A');
select tests.sair();
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['usuarios:visualizar']);
select tests.autenticar_como('cliente_a', 'aal1');
select is_empty($$ select 1 from core.convites $$, 'quem só vê usuários não vê e-mails de convidados');
select tests.sair();
select tests.autenticar_como('operador_a');
select results_eq($$ select count(*)::int from core.convites $$, $$ values (2) $$, 'quem tem permissoes/visualizar vê os convites');
select throws_ok($$ update core.convites set papel = 'ADMIN_EMPRESA' $$, '42501', null, 'convite não é alterado direto pela API');
select tests.sair();

-- =============================================================== troca de e-mail não pega convite (T2.2)
insert into tk values ('intruso', tests.usuario_id('intruso'));
update auth.users set email = 'diretor@empresa-a.local' where id = (select id from tk where nome = 'intruso');
-- O helper acha usuário pelo e-mail; aqui o JWT é montado à mão com o id guardado.
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from tk where nome = 'intruso'),
  'role', 'authenticated', 'aal', 'aal1')::text, true);
select is_empty($$ select * from core.meus_convites() $$, 'quem troca o e-mail para o do convite não vê o convite');
select throws_ok($$ select core.aceitar_convite((select id from tk where nome = 'convite_sem_conta')) $$, '42501', null,
  'quem troca o e-mail para o do convite não aceita');
select throws_ok($$ select core.aceitar_convite((select id from tk where nome = 'convite')) $$, '42501', null,
  'outro usuário não aceita convite de outra conta');
reset role;

-- =============================================================== conta criada depois do convite
select tests.criar_usuario('diretor_novo');
update auth.users set email = 'diretor_novo@teste.local' where id = tests.usuario_id('diretor_novo');
update core.convites set email = 'conta.criada.depois@teste.local' where id = (select id from tk where nome = 'convite_sem_conta');
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values (gen_random_uuid(), 'conta.criada.depois@teste.local', '{}', now());
select results_eq(
  $$ select usuario_id from core.convites where id = (select id from tk where nome = 'convite_sem_conta') $$,
  $$ select id from auth.users where email = 'conta.criada.depois@teste.local' $$,
  'conta criada com o e-mail do convite fica ligada a ele');

-- =============================================================== aceite
select tests.autenticar_como('novo', 'aal1');
select results_eq($$ select empresa, papel from core.meus_convites() $$, $$ values ('Empresa Teste A'::text, 'OPERADOR'::text) $$,
  'convidado vê o convite');
select lives_ok($$ select core.aceitar_convite((select id from tk where nome = 'convite')) $$, 'convidado aceita');
select throws_ok($$ select core.aceitar_convite((select id from tk where nome = 'convite')) $$, '42501', null,
  'convite não é aceito duas vezes');
select tests.sair();
select results_eq(
  $$ select v.papel, v.created_by from core.vinculos v where v.id = tests.vinculo_id('novo', 'A') $$,
  $$ values ('OPERADOR'::text, tests.usuario_id('usuario_a')) $$, 'vínculo criado com o papel e o autor do convite');
select results_eq(
  $$ select p.modulo || ':' || p.acao from core.permissoes p where p.vinculo_id = tests.vinculo_id('novo', 'A') order by 1 $$,
  $$ values ('documentos:cadastrar'::text), ('documentos:visualizar'::text), ('empresas:visualizar'::text) $$,
  'permissões criadas exatamente como no convite');

-- =============================================================== convite órfão (T2.3)
select tests.criar_usuario('pessoal');
select tests.autenticar_como('admin_limitado', 'aal2', 9);
insert into tk values ('l2', core.iniciar_step_up('alterar_permissoes'));
insert into tk values ('orfao', core.convidar_usuario(tests.empresa_id('A'), 'pessoal@teste.local', 'OPERADOR',
  array['empresas:visualizar'], (select id from tk where nome = 'l2')));
select tests.sair();
update core.vinculos set ativo = false where id = tests.vinculo_id('admin_limitado', 'A');
select tests.autenticar_como('pessoal', 'aal1');
select is_empty($$ select * from core.meus_convites() $$, 'convite de admin desativado não aparece');
select throws_ok($$ select core.aceitar_convite((select id from tk where nome = 'orfao')) $$, '42501', null,
  'convite de admin desativado não é aceito');
select tests.sair();

-- =============================================================== revogar e e-mail não confirmado
select tests.autenticar_como('usuario_b');
select throws_ok($$ select core.revogar_convite((select id from tk where nome = 'convite_sem_conta')) $$, '42501', null,
  'ADMIN de B não revoga convite de A');
select tests.sair();
update auth.users set email_confirmed_at = null where email = 'conta.criada.depois@teste.local';
insert into tk select 'nao_confirmado', id from auth.users where email = 'conta.criada.depois@teste.local';
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', (select id from tk where nome = 'nao_confirmado'),
  'role', 'authenticated', 'aal', 'aal1')::text, true);
select throws_ok($$ select core.aceitar_convite((select id from tk where nome = 'convite_sem_conta')) $$, '42501', null,
  'conta com e-mail não confirmado não aceita');
reset role;
select tests.autenticar_como('usuario_a');
select lives_ok($$ select core.revogar_convite((select id from tk where nome = 'convite_sem_conta')) $$, 'ADMIN de A revoga');
select tests.sair();

select * from finish();
rollback;
