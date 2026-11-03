-- Auditoria imutável (Prompt 1.4 Auditoria; CA-4 da Fase 01).
begin;
set local search_path = tap;
select plan(16);

select tests.criar_empresas_ab();

select results_eq(
  $$ select operation, (new_data ->> 'razao_social') from audit.audit_log
      where table_name = 'empresas' and record_id = tests.empresa_id('A') $$,
  $$ values ('INSERT'::text, 'Empresa Teste A'::text) $$,
  'INSERT em empresa é auditado com o valor novo'
);

-- UPDATE feito por usuário, com IP e user-agent informados pela API na mesma transação
select tests.autenticar_como('usuario_a');
select core.definir_requisicao('203.0.113.9', 'teste/1.0');
update core.empresas set nome_fantasia = 'Fantasia A' where id = tests.empresa_id('A');
select tests.sair();

select results_eq(
  $$ select changed_fields, actor_id, empresa_id from audit.audit_log
      where table_name = 'empresas' and operation = 'UPDATE' and record_id = tests.empresa_id('A') $$,
  $$ values (array['nome_fantasia']::text[], tests.usuario_id('usuario_a'), tests.empresa_id('A')) $$,
  'UPDATE registra campos alterados, autor e empresa'
);
select is(
  (select old_data ->> 'razao_social' from audit.audit_log
    where table_name = 'empresas' and operation = 'UPDATE' and record_id = tests.empresa_id('A')),
  'Empresa Teste A',
  'UPDATE guarda a linha anterior completa'
);
select results_eq(
  $$ select host(ip), user_agent from audit.audit_log
      where table_name = 'empresas' and operation = 'UPDATE' and record_id = tests.empresa_id('A') $$,
  $$ values ('203.0.113.9'::text, 'teste/1.0'::text) $$,
  'IP e user-agent informados pela API são gravados'
);

-- IP preso à transação: valor de sessão (pool) e requisição sem definir_requisicao gravam nulo.
select set_config('app.ip', '6.6.6.6', false), set_config('app.user_agent', 'forjado', false);
select tests.autenticar_como('usuario_a');
update core.empresas set nome_fantasia = 'Fantasia A2' where id = tests.empresa_id('A');
select tests.sair();
select set_config('app.ip', '', false), set_config('app.user_agent', '', false);
select results_eq(
  $$ select ip, user_agent from audit.audit_log
      where table_name = 'empresas' and operation = 'UPDATE' and record_id = tests.empresa_id('A')
        and new_data ->> 'nome_fantasia' = 'Fantasia A2' $$,
  $$ values (null::inet, null::text) $$,
  'IP/user-agent de sessão ou sem definir_requisicao não entram na auditoria'
);
select is(core.ip_atual(), null, 'fora de contexto, ip_atual é nulo');

select is(
  (select count(*)::int from audit.audit_log a
    where a.table_name = 'permissoes' and a.empresa_id = tests.empresa_id('A')) > 0,
  true,
  'permissões concedidas são auditadas com a empresa'
);

-- LGPD: dado pessoal de usuário não entra no log imutável
select is(
  (select new_data ->> 'email' from audit.audit_log
    where table_name = 'usuarios' and operation = 'INSERT' and record_id = tests.usuario_id('usuario_a')),
  '[redigido]',
  'e-mail do usuário é redigido na auditoria'
);
select is(
  (select new_data ->> 'superadmin' from audit.audit_log
    where table_name = 'usuarios' and operation = 'INSERT' and record_id = tests.usuario_id('usuario_a')),
  'false',
  'campos não pessoais do usuário continuam auditados'
);

-- Só updated_at mudou: desliga o trigger de updated_at para que o valor mude de fato
alter table core.empresas disable trigger empresas_updated_at;
update core.empresas set updated_at = updated_at - interval '1 day' where id = tests.empresa_id('B');
alter table core.empresas enable trigger empresas_updated_at;
select is(
  (select count(*)::int from audit.audit_log
    where table_name = 'empresas' and operation = 'UPDATE' and record_id = tests.empresa_id('B')),
  0,
  'UPDATE que só muda updated_at não é auditado'
);

-- Imutabilidade
select throws_ok(
  $$ update audit.audit_log set operation = 'DELETE' $$,
  '42501', null,
  'nem o dono da tabela altera auditoria'
);
select throws_ok(
  $$ delete from audit.audit_log $$,
  '42501', null,
  'nem o dono da tabela apaga auditoria'
);
select throws_ok(
  $$ truncate audit.audit_log $$,
  '42501', null,
  'truncate na auditoria é bloqueado'
);
set local session_replication_role = replica;
select throws_ok(
  $$ delete from audit.audit_log $$,
  '42501', null,
  'imutabilidade vale também em modo replica (trigger ALWAYS)'
);
set local session_replication_role = origin;

select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ insert into audit.audit_log (schema_name, table_name, operation) values ('core', 'x', 'INSERT') $$,
  '42501', null,
  'usuário não insere auditoria diretamente'
);
select throws_ok(
  $$ delete from audit.audit_log $$,
  '42501', null,
  'usuário não apaga auditoria'
);
select tests.sair();

select * from finish();
rollback;
