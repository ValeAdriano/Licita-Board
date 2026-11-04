-- Exclusão definitiva só por SUPERADMIN, com dupla aprovação e step-up (Prompt 1.3/1.4; RF-01.9).
-- Cada tests.autenticar_como com p_mfa_ha_seg diferente simula uma nova verificação MFA.
begin;
set local search_path = tap;
select plan(30);

select tests.criar_empresas_ab();
insert into core.empresas (razao_social, cnpj) values ('Empresa Teste C', '11444777000161');
select tests.criar_usuario('super1', true);
select tests.criar_usuario('super2', true);
create temp table tk (nome text primary key, id uuid);
grant all on tk to vv_api;

insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo)
values (tests.usuario_id('usuario_a'), tests.empresa_id('A'), 'documentos', 'certidao_vencendo', 'Notificação da empresa A');

-- =============================================================== quem pode pedir
select tests.autenticar_como('usuario_a', 'aal2', 10);
insert into tk values ('adm', core.iniciar_step_up('exclusao_definitiva'));
select throws_ok(
  $$ select core.solicitar_exclusao('core.empresas', tests.empresa_id('A'), 'Encerramento do contrato', (select id from tk where nome = 'adm')) $$,
  '42501', null, 'ADMIN_EMPRESA não solicita exclusão definitiva');
select throws_ok($$ delete from core.empresas where id = tests.empresa_id('A') $$, '42501', null,
  'exclusão direta pela API é bloqueada');
select throws_ok(
  $$ select core.decidir_exclusao(gen_random_uuid(), true, null) $$,
  '42501', null, 'ADMIN_EMPRESA não decide exclusão');
select throws_ok($$ select core.executar_exclusao('core.empresas', tests.empresa_id('A')) $$, '42501', null,
  'executar_exclusao não é chamável pela API');
select tests.sair();

select ok(not has_function_privilege('vv_worker', 'core.solicitar_exclusao(text,uuid,text,uuid)', 'execute'),
  'vv_worker não solicita exclusão');
set local role vv_worker;
select throws_ok($$ delete from core.empresas where razao_social = 'Empresa Teste C' $$, '42501', 'permission denied for table empresas',
  'nem o worker apaga empresa fora do fluxo');
reset role;

-- =============================================================== SUPERADMIN 1 solicita
select tests.autenticar_como('super1', 'aal2', 10);
select throws_ok(
  $$ select core.solicitar_exclusao('core.empresas', tests.empresa_id('A'), 'Encerramento do contrato', null) $$,
  '42501', null, 'solicitar sem step-up falha');
insert into tk values ('s1', core.iniciar_step_up('exclusao_definitiva'));
insert into tk values ('pedido_a', core.solicitar_exclusao('core.empresas', tests.empresa_id('A'),
  'Encerramento do contrato a pedido do cliente', (select id from tk where nome = 's1')));
select isnt_empty(
  $$ select 1 from core.aprovacoes_exclusao where id = (select id from tk where nome = 'pedido_a') and status = 'pendente' $$,
  'pedido fica pendente');
select throws_ok(
  $$ insert into core.aprovacoes_exclusao (alvo_tabela, alvo_id, motivo, solicitado_por)
     values ('core.empresas', tests.empresa_id('B'), 'Pedido forjado direto', tests.usuario_id('super1')) $$,
  '42501', null, 'pedido não é criado direto pela API, nem por SUPERADMIN');
select throws_ok(
  $$ update core.aprovacoes_exclusao set status = 'executada' where id = (select id from tk where nome = 'pedido_a') $$,
  '42501', null, 'pedido não é alterado direto pela API');
select tests.sair();

select tests.autenticar_como('super1', 'aal2', 9);
insert into tk values ('s1b', core.iniciar_step_up('exclusao_definitiva'));
select throws_ok(
  $$ select core.solicitar_exclusao('core.vinculos', tests.vinculo_id('usuario_a', 'A'), 'Teste de alvo proibido',
       (select id from tk where nome = 's1b')) $$,
  '42501', 'tabela core.vinculos não admite exclusão definitiva',
  'tabela fora da lista não admite exclusão, mesmo com step-up válido');
select throws_ok(
  $$ select core.solicitar_exclusao('core.empresas', tests.empresa_id('A'), 'Pedido duplicado', (select id from tk where nome = 's1b')) $$,
  '23505', null, 'só um pedido pendente por alvo');
select throws_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_a'), true, (select id from tk where nome = 's1b')) $$,
  '42501', null, 'quem solicitou não aprova o próprio pedido');
select tests.sair();

select tests.autenticar_como('super1', 'aal2', 8);
insert into tk values ('s1c', core.iniciar_step_up('exclusao_definitiva'));
insert into tk values ('pedido_b', core.solicitar_exclusao('core.empresas', tests.empresa_id('B'),
  'Empresa cadastrada em duplicidade', (select id from tk where nome = 's1c')));
select tests.sair();
select tests.autenticar_como('super1', 'aal2', 7);
insert into tk values ('s1d', core.iniciar_step_up('exclusao_definitiva'));
insert into tk values ('pedido_c', core.solicitar_exclusao('core.empresas', tests.empresa_id('C'),
  'Pedido que vai expirar sem decisão', (select id from tk where nome = 's1d')));
select tests.sair();

-- =============================================================== SUPERADMIN 2 decide
select tests.autenticar_como('super2', 'aal2', 3600);
select throws_ok($$ select core.iniciar_step_up('exclusao_definitiva') $$, '42501', null,
  'aprovador também precisa de MFA recente');
select throws_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_a'), true, null) $$,
  '42501', null, 'aprovar sem step-up falha');
select throws_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_a'), null, null) $$,
  '22023', null, 'decisão nula é rejeitada');
select tests.sair();

select tests.autenticar_como('super2', 'aal2', 10);
insert into tk values ('s2', core.iniciar_step_up('exclusao_definitiva'));
select lives_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_a'), true, (select id from tk where nome = 's2')) $$,
  'segundo SUPERADMIN aprova com step-up');
select tests.sair();

select tests.autenticar_como('super2', 'aal2', 9);
insert into tk values ('s2b', core.iniciar_step_up('exclusao_definitiva'));
select lives_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_b'), false, (select id from tk where nome = 's2b')) $$,
  'segundo SUPERADMIN rejeita com step-up');
select tests.sair();

-- =============================================================== resultado
select is_empty(
  $$ select 1 from core.empresas where razao_social = 'Empresa Teste A'
     union all select 1 from core.vinculos v where not exists (select 1 from core.empresas e where e.id = v.empresa_id)
     union all select 1 from core.permissoes p where not exists (select 1 from core.empresas e where e.id = p.empresa_id) $$,
  'empresa aprovada foi excluída com vínculos e permissões');
select is_empty($$ select 1 from core.notificacoes where titulo = 'Notificação da empresa A' $$,
  'notificações da empresa excluída vão junto (cascade)');
select isnt_empty($$ select 1 from core.empresas where razao_social = 'Empresa Teste B' $$,
  'empresa com pedido rejeitado continua existindo');
select results_eq(
  $$ select status, decidido_por from core.aprovacoes_exclusao
      where id in (select id from tk where nome in ('pedido_a', 'pedido_b')) order by status $$,
  $$ values ('executada'::text, tests.usuario_id('super2')), ('rejeitada'::text, tests.usuario_id('super2')) $$,
  'aprovação e rejeição registram quem decidiu');
select isnt_empty(
  $$ select 1 from audit.audit_log where table_name = 'empresas' and operation = 'DELETE'
       and old_data ->> 'razao_social' = 'Empresa Teste A' $$,
  'exclusão fica na auditoria com a linha anterior');

-- =============================================================== solicitante revogado e expiração
update core.usuarios set superadmin = false where id = tests.usuario_id('super1');
select tests.autenticar_como('super2', 'aal2', 8);
insert into tk values ('s2c', core.iniciar_step_up('exclusao_definitiva'));
select throws_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_c'), true, (select id from tk where nome = 's2c')) $$,
  '42501', 'solicitante não é mais SUPERADMIN ativo; rejeite o pedido',
  'pedido de quem perdeu o SUPERADMIN não pode ser aprovado');
select tests.sair();

alter table core.aprovacoes_exclusao disable trigger aprovacoes_exclusao_protecao;
update core.aprovacoes_exclusao set expira_em = now() - interval '1 second' where id = (select id from tk where nome = 'pedido_c');
alter table core.aprovacoes_exclusao enable always trigger aprovacoes_exclusao_protecao;
select tests.autenticar_como('super2', 'aal2', 7);
insert into tk values ('s2d', core.iniciar_step_up('exclusao_definitiva'));
select throws_ok(
  $$ select core.decidir_exclusao((select id from tk where nome = 'pedido_c'), true, (select id from tk where nome = 's2d')) $$,
  '42501', 'pedido de exclusão expirado', 'pedido expirado (72 h) não pode ser aprovado');
select tests.sair();

-- =============================================================== imutabilidade do registro
select throws_ok($$ delete from core.aprovacoes_exclusao $$, '42501', null,
  'registro de aprovação não é apagado nem pelo dono');
select throws_ok(
  $$ update core.aprovacoes_exclusao set status = 'pendente' where id = (select id from tk where nome = 'pedido_a') $$,
  '42501', null, 'decisão registrada não volta a pendente');
select throws_ok(
  $$ update core.aprovacoes_exclusao set motivo = 'outro motivo qualquer' where id = (select id from tk where nome = 'pedido_c') $$,
  '42501', null, 'motivo do pedido não é reescrito');

-- =============================================================== guarda para FKs futuras
-- FKs com ON DELETE CASCADE se resolvem sozinhas; as demais precisam de tratamento explícito.
select results_eq(
  $$ select conrelid::regclass::text from pg_constraint
      where contype = 'f' and confrelid = 'core.empresas'::regclass and confdeltype <> 'c' order by 1 $$,
  $$ values ('core.empresa_cnaes'::text), ('core.empresa_contas'), ('core.empresa_contatos'), ('core.empresa_enquadramentos'), ('core.vinculos') $$,
  'toda FK sem cascade para core.empresas é tratada em core.executar_exclusao (atualize a função e este teste juntos)');
select results_eq(
  $$ select conrelid::regclass::text from pg_constraint
      where contype = 'f' and confrelid = 'core.empresas'::regclass and confdeltype = 'c' order by 1 $$,
  $$ values ('core.convites'::text), ('core.notificacoes'::text), ('core.procuracoes'::text), ('core.representantes'::text), ('core.revelacoes_dados'::text), ('ops.jobs'::text) $$,
  'lista fechada de FKs com cascade para core.empresas (nova cascade exige decisão explícita aqui)');

select * from finish();
rollback;
