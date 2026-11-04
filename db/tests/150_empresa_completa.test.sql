-- Fase 02 · PR 1: ficha completa da empresa (CNAEs, contatos, enquadramento) com isolamento A x B
-- por tabela, grants por coluna, constraints e auditoria (spec fase-02 §3.1; CA-5, CA-9).
begin;
set local search_path = tap;
select plan(57);

select tests.criar_empresas_ab();
select tests.criar_usuario('operador_a');
select tests.vincular('operador_a', 'A', 'OPERADOR', array['empresas:visualizar']);
select tests.criar_usuario('cliente_a');
select tests.vincular('cliente_a', 'A', 'CLIENTE', array['empresas:visualizar']);

-- Dados de B, criados como dono (sem RLS), para A tentar ler e mexer.
insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('B'), '4511101');
insert into core.empresa_contatos (empresa_id, tipo, valor, rotulo, principal)
  values (tests.empresa_id('B'), 'email', 'b@empresa-b.test', 'Comercial', true);
insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte)
  values (tests.empresa_id('B'), 'EPP', date '2025-01-01', 'declaracao');

-- =============================================================== A edita a própria ficha
select tests.autenticar_como('usuario_a');
select lives_ok(
  $$ update core.empresas set uf = 'SP', cep = '01310100', municipio = 'São Paulo', logradouro = 'Av. Paulista',
            numero = '1000', cnae_principal = '4511101', regime_tributario = 'SIMPLES_NACIONAL',
            inscricao_estadual = '123456789', observacoes = 'Ficha de teste'
      where id = tests.empresa_id('A') $$,
  'A edita endereço, CNAE, regime e inscrições da própria empresa'
);
select results_eq(
  $$ with u as (update core.empresas set uf = 'RJ' where id = tests.empresa_id('B') returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'A não edita a ficha de B'
);
select throws_ok($$ update core.empresas set uf = 'XX' where id = tests.empresa_id('A') $$, '23514', null, 'UF fora das 27 é recusada');
select throws_ok($$ update core.empresas set cep = '1234' where id = tests.empresa_id('A') $$, '23514', null, 'CEP precisa de 8 dígitos');
select throws_ok($$ update core.empresas set cnae_principal = '45111' where id = tests.empresa_id('A') $$, '23514', null, 'CNAE precisa de 7 dígitos');
select throws_ok($$ update core.empresas set regime_tributario = 'INVENTADO' where id = tests.empresa_id('A') $$, '23514', null, 'regime fora da lista é recusado');

-- =============================================================== CNAEs secundários
select lives_ok($$ insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('A'), '4511102') $$, 'A inclui CNAE na própria empresa');
select throws_ok($$ insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('A'), '4511102') $$, '23505', null, 'CNAE repetido na empresa é recusado');
select throws_ok($$ insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('B'), '4511103') $$, '42501', null, 'A não inclui CNAE em nome de B');
select is_empty($$ select 1 from core.empresa_cnaes where empresa_id = tests.empresa_id('B') $$, 'A não lê CNAEs de B');
select results_eq(
  $$ with u as (update core.empresa_cnaes set deleted_at = now() where empresa_id = tests.empresa_id('B') returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'A não apaga CNAE de B'
);
select lives_ok($$ update core.empresa_cnaes set deleted_at = now() where empresa_id = tests.empresa_id('A') $$, 'A remove (soft delete) o próprio CNAE');
select lives_ok($$ insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('A'), '4511102') $$, 'o CNAE removido pode voltar');
select throws_ok($$ delete from core.empresa_cnaes where empresa_id = tests.empresa_id('A') $$, '42501', null, 'sem delete físico para a API');

-- =============================================================== contatos
select lives_ok(
  $$ insert into core.empresa_contatos (empresa_id, tipo, valor, rotulo, principal)
     values (tests.empresa_id('A'), 'email', 'contato@empresa-a.test', 'Licitações', true) $$,
  'A inclui e-mail principal'
);
select lives_ok(
  $$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('A'), 'whatsapp', '5511999990000') $$,
  'A inclui WhatsApp só com dígitos'
);
select throws_ok(
  $$ insert into core.empresa_contatos (empresa_id, tipo, valor, principal) values (tests.empresa_id('A'), 'email', 'outro@empresa-a.test', true) $$,
  '23505', null, 'só um e-mail principal por empresa'
);
select throws_ok($$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('A'), 'email', 'sem-arroba') $$, '23514', null, 'e-mail inválido é recusado');
select throws_ok($$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('A'), 'telefone', '(11) 9999-0000') $$, '23514', null, 'telefone com máscara é recusado (só dígitos)');
select throws_ok($$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('B'), 'email', 'x@y.test') $$, '42501', null, 'A não inclui contato em B');
select is_empty($$ select 1 from core.empresa_contatos where empresa_id = tests.empresa_id('B') $$, 'A não lê contatos de B');
select results_eq(
  $$ with u as (update core.empresa_contatos set valor = 'hack@a.test' where empresa_id = tests.empresa_id('B') returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'A não edita contato de B'
);
select throws_ok($$ update core.empresa_contatos set empresa_id = tests.empresa_id('B') where empresa_id = tests.empresa_id('A') $$, '42501', null, 'contato não muda de empresa (empresa_id fora do grant de update)');

-- =============================================================== enquadramento por data de referência
select lives_ok(
  $$ insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte)
     values (tests.empresa_id('A'), 'EPP', date '2024-01-01', 'declaracao'),
            (tests.empresa_id('A'), 'ME',  date '2025-06-01', 'certidao_junta') $$,
  'A registra enquadramentos com data de referência'
);
select throws_ok(
  $$ insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte) values (tests.empresa_id('A'), 'ME', date '2025-06-01', 'outra') $$,
  '23505', null, 'uma linha por data de referência'
);
select throws_ok(
  $$ insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte) values (tests.empresa_id('A'), 'GIGANTE', date '2026-01-01', 'outra') $$,
  '23514', null, 'porte fora da lista é recusado'
);
select throws_ok(
  $$ insert into core.empresa_enquadramentos (empresa_id, porte, data_referencia, fonte) values (tests.empresa_id('B'), 'ME', date '2026-01-01', 'outra') $$,
  '42501', null, 'A não registra enquadramento em B'
);
select is_empty($$ select 1 from core.empresa_enquadramentos where empresa_id = tests.empresa_id('B') $$, 'A não lê enquadramentos de B');
select is_empty($$ select * from core.enquadramento_em(tests.empresa_id('B'), date '2026-01-01') $$, 'enquadramento_em não devolve a empresa B para A');
select is_empty($$ select * from core.enquadramento_em(tests.empresa_id('A'), date '2023-12-31') $$, 'antes da 1ª data de referência não há enquadramento');
select results_eq($$ select porte from core.enquadramento_em(tests.empresa_id('A'), date '2024-01-01') $$, $$ values ('EPP') $$, 'no dia da referência vale o enquadramento da data');
select results_eq($$ select porte from core.enquadramento_em(tests.empresa_id('A'), date '2025-05-31') $$, $$ values ('EPP') $$, 'véspera da mudança ainda vale o anterior');
select results_eq($$ select porte from core.enquadramento_em(tests.empresa_id('A'), date '2025-06-01') $$, $$ values ('ME') $$, 'no dia da mudança vale o novo');
select throws_ok($$ update core.empresa_enquadramentos set porte = 'DEMAIS' where empresa_id = tests.empresa_id('A') $$, '42501', null, 'enquadramento é histórico: sem update para a API');

-- =============================================================== cruzamentos A x B que faltavam
select throws_ok(
  $$ update core.empresa_enquadramentos set porte = 'ME' where empresa_id = tests.empresa_id('B') $$,
  '42501', null, 'A não edita enquadramento de B (nem tem update na tabela)');
select throws_ok(
  $$ delete from core.empresa_contatos where empresa_id = tests.empresa_id('B') $$,
  '42501', null, 'A não apaga contato de B');
select throws_ok(
  $$ delete from core.empresa_enquadramentos where empresa_id = tests.empresa_id('B') $$,
  '42501', null, 'A não apaga enquadramento de B');
select throws_ok(
  $$ update core.empresa_cnaes set empresa_id = tests.empresa_id('B') where empresa_id = tests.empresa_id('A') $$,
  '42501', null, 'CNAE não muda de empresa (empresa_id fora do grant de update)');
select throws_ok(
  $$ update core.empresa_enquadramentos set empresa_id = tests.empresa_id('B') where empresa_id = tests.empresa_id('A') $$,
  '42501', null, 'enquadramento não muda de empresa');
select throws_ok(
  $$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('A'), 'email', 'CONTATO@empresa-a.test') $$,
  '23505', null, 'o mesmo contato não repete na empresa, nem trocando maiúsculas');
select lives_ok(
  $$ insert into core.empresa_contatos (empresa_id, tipo, valor, principal) values (tests.empresa_id('A'), 'email', 'segundo@empresa-a.test', false) $$,
  'A inclui um segundo e-mail, não principal');
select lives_ok(
  $$ update core.empresa_contatos set principal = false where empresa_id = tests.empresa_id('A') and valor = 'contato@empresa-a.test' $$,
  'o principal pode ser desmarcado');
select lives_ok(
  $$ update core.empresa_contatos set principal = true where empresa_id = tests.empresa_id('A') and valor = 'segundo@empresa-a.test' $$,
  'e outro vira o principal');
-- A marca de exclusão só vale para a empresa marcada, e sozinha não abre nada para vv_api.
select set_config('vv.exclusao_empresa', tests.empresa_id('A')::text, true);
select tests.sair();
select tests.autenticar_como('usuario_a');
select throws_ok(
  $$ delete from core.empresa_enquadramentos where empresa_id = tests.empresa_id('A') $$,
  '42501', null, 'a marca de exclusão não dá delete para vv_api');
select tests.sair();
select set_config('vv.exclusao_empresa', '', true);

-- =============================================================== OPERADOR só visualizar, CLIENTE leitura
select tests.sair();
select tests.autenticar_como('operador_a');
select isnt_empty($$ select 1 from core.empresa_contatos where empresa_id = tests.empresa_id('A') $$, 'OPERADOR com visualizar lê os contatos');
select throws_ok($$ insert into core.empresa_contatos (empresa_id, tipo, valor) values (tests.empresa_id('A'), 'email', 'op@a.test') $$, '42501', null, 'OPERADOR sem editar não inclui contato');
select tests.sair();
select tests.autenticar_como('cliente_a', 'aal1');
select isnt_empty($$ select 1 from core.empresa_cnaes where empresa_id = tests.empresa_id('A') $$, 'CLIENTE lê a ficha com aal1');
select throws_ok($$ insert into core.empresa_cnaes (empresa_id, cnae) values (tests.empresa_id('A'), '4511109') $$, '42501', null, 'CLIENTE não inclui CNAE');

-- =============================================================== histórico imutável e auditoria (como dono)
select tests.sair();
select throws_ok($$ delete from core.empresa_enquadramentos where empresa_id = tests.empresa_id('A') $$, '42501', null, 'nem o dono apaga o histórico de enquadramento');
select throws_ok($$ truncate core.empresa_enquadramentos $$, '42501', null, 'nem o dono trunca o histórico de enquadramento');
select set_config('vv.exclusao_empresa', tests.empresa_id('B')::text, true);
select throws_ok($$ delete from core.empresa_enquadramentos where empresa_id = tests.empresa_id('A') $$, '42501', null, 'a marca de B não abre o histórico de A, nem para o dono');
select set_config('vv.exclusao_empresa', '', true);
set local session_replication_role = replica;
select throws_ok($$ delete from core.empresa_enquadramentos where empresa_id = tests.empresa_id('A') $$, '42501', null, 'o histórico continua protegido em modo replica (trigger ALWAYS)');
set local session_replication_role = origin;
select is(
  (select new_data ->> 'valor' from audit.audit_log
    where table_name = 'empresa_contatos' and operation = 'INSERT' and new_data ->> 'tipo' = 'whatsapp' limit 1),
  '[redigido]', 'valor do contato sai redigido da auditoria (dado pessoal)'
);
select isnt_empty(
  $$ select 1 from audit.audit_log where table_name = 'empresa_enquadramentos' and empresa_id = tests.empresa_id('A') $$,
  'o enquadramento é auditado com a empresa'
);

-- A exclusão definitiva leva junto a ficha completa (inclusive o histórico de enquadramento).
select lives_ok($$ select core.executar_exclusao('core.empresas', tests.empresa_id('B')) $$, 'exclusão definitiva de B executa');
select is(
  (select (select count(*) from core.empresa_cnaes where empresa_id = tests.empresa_id('B'))
        + (select count(*) from core.empresa_contatos where empresa_id = tests.empresa_id('B'))
        + (select count(*) from core.empresa_enquadramentos where empresa_id = tests.empresa_id('B')))::int,
  0, 'CNAEs, contatos e enquadramentos de B sumiram com a empresa');
select isnt_empty($$ select 1 from core.empresa_enquadramentos where empresa_id = tests.empresa_id('A') $$, 'o histórico de A não foi tocado');

select * from finish();
rollback;
