-- MFA TOTP conferido no banco e códigos de recuperação (spec fase-01 decisões 1 e 7; PR 2b).
begin;
set local search_path = tap;
select plan(30);

-- Vetores da RFC 6238 (SHA-1, segredo ASCII "12345678901234567890"), 6 dígitos.
select is(core.totp(convert_to('12345678901234567890', 'UTF8'), 1), '287082', 'RFC 6238: T = 59 s');
select is(core.totp(convert_to('12345678901234567890', 'UTF8'), 37037036), '081804', 'RFC 6238: T = 1111111109 s');

-- Códigos esperados calculados como superusuário (vv_api não executa core.totp).
select tests.criar_usuario('mfa_a');
select tests.criar_usuario('mfa_b');
create temp table t_mfa as
  select s.segredo, tests.kek() as kek,
         core.totp(s.segredo, p.passo - 1) as anterior, core.totp(s.segredo, p.passo) as atual,
         core.totp(s.segredo, p.passo + 1) as proximo, core.totp(s.segredo, p.passo + 2) as longe
    from (select convert_to('segredo-de-teste-com-mais-de-20-bytes', 'UTF8') as segredo) s,
         (select floor(extract(epoch from now()) / 30)::bigint as passo) p;
grant select on t_mfa to vv_api;

select ok(not has_function_privilege('vv_api', 'core.totp(bytea,bigint)', 'execute'), 'vv_api não calcula TOTP');
select ok(not has_table_privilege('vv_api', 'core.fatores_mfa', 'select'), 'vv_api não lê os fatores');
select ok(not has_function_privilege('vv_api', 'core.registrar_kek(integer,text)', 'execute'), 'vv_api não registra KEK');

select throws_ok($$ select core.conferir_kek(null) $$, '28000', null, 'KEK nula é recusada');

-- KEK inventada (o que um SQLi teria) não serve nem para o primeiro cadastro.
select tests.autenticar_como('mfa_b', 'aal1', 's1');
select throws_ok($$ select core.cadastrar_totp((select segredo from t_mfa), 'kek-inventada-pelo-atacante-0123456789') $$,
  '28000', 'chave-mestra inválida', 'KEK que não bate com o verificador é recusada no cadastro');
select tests.sair();

-- Cadastro e confirmação ---------------------------------------------------------------------
select tests.autenticar_como('mfa_a', 'aal1', 's1');
select ok(not core.tem_mfa(), 'usuário começa sem MFA');
select lives_ok($$ select core.cadastrar_totp((select segredo from t_mfa), (select kek from t_mfa)) $$,
  'sessão aal1 sem fator cadastra o primeiro TOTP');
select throws_ok($$ select core.confirmar_totp((select atual from t_mfa), 'kek-inventada-pelo-atacante-0123456789') $$,
  '28000', 'chave-mestra inválida', 'KEK errada também não confirma');
select ok(not core.confirmar_totp('000000', (select kek from t_mfa)), 'código errado não confirma');
select ok(not core.confirmar_totp((select longe from t_mfa), (select kek from t_mfa)), 'passo +2 fica fora da janela');
select ok(core.confirmar_totp((select anterior from t_mfa), (select kek from t_mfa)), 'passo -1 (janela) confirma');
select is(core.aal_atual(), 'aal2', 'confirmar eleva a sessão a aal2');
select tests.sair();
select ok((select segredo_cifrado <> (select segredo from t_mfa) from core.fatores_mfa
            where usuario_id = tests.usuario_id('mfa_a')), 'segredo é guardado cifrado');
select ok((select count(*) > 0 from audit.audit_log where table_name = 'fatores_mfa'
            and new_data ->> 'segredo_cifrado' = '[redigido]'), 'cadastro de fator é auditado, sem o segredo');

-- Login seguinte: replay ---------------------------------------------------------------------
select tests.autenticar_como('mfa_a', 'aal1', 's2');
select ok(not core.verificar_totp((select anterior from t_mfa), (select kek from t_mfa)),
  'o mesmo código não serve duas vezes (replay)');
select ok(core.verificar_totp((select atual from t_mfa), (select kek from t_mfa)), 'código seguinte é aceito');
select tests.sair();

-- Sessão aal1 ou aal2 antiga não troca o autenticador ---------------------------------------
select tests.autenticar_como('mfa_a', 'aal1', 's3');
select throws_ok($$ select core.cadastrar_totp((select segredo from t_mfa), (select kek from t_mfa)) $$,
  '42501', null, 'com fator verificado, trocar o autenticador exige MFA recente');
select throws_ok($$ select core.trocar_senha('$argon2id$v=19$x') $$, '42501', null,
  'quem tem MFA não troca a senha em aal1');

-- Força bruta: 4 erros não encerram; o 5º encerra a sessão ---------------------------------
select core.verificar_totp('000000', (select kek from t_mfa)) from generate_series(1, 4);
select isnt(core.usuario_atual(), null, '4 códigos errados ainda mantêm a sessão');
select core.verificar_totp('000000', (select kek from t_mfa));
select is(core.usuario_atual(), null, 'o 5º código errado encerra a sessão');
select tests.sair();

-- Limite por usuário: novas sessões não renovam o crédito ----------------------------------
select tests.autenticar_como('mfa_a', 'aal1', 's4');
select core.verificar_totp('000000', (select kek from t_mfa)) from generate_series(1, 4);
select tests.sair();
select tests.autenticar_como('mfa_a', 'aal1', 's5');
select core.verificar_totp('000000', (select kek from t_mfa));
select tests.sair();
select ok((select mfa_bloqueado_ate > now() from core.usuarios where id = tests.usuario_id('mfa_a')),
  '10 erros do usuário em 15 min bloqueiam o MFA, mesmo em sessões diferentes');
select throws_ok($$ select core.definir_contexto(tests.token('mfa_a', 's5')) $$, '28000', null,
  'o bloqueio encerra todas as sessões do usuário');
update core.usuarios set mfa_bloqueado_ate = null, falhas_mfa = 0 where id = tests.usuario_id('mfa_a');

-- Troca de autenticador com MFA recente ----------------------------------------------------
select tests.garantir_sessao('mfa_a', 'aal2', 's8', 10);
select core.definir_contexto(tests.token('mfa_a', 's8'));
set local role vv_api;
select lives_ok($$ select core.cadastrar_totp(convert_to('outro-segredo-de-teste-com-20-bytes', 'UTF8'), tests.kek()) $$,
  'com MFA recente, cadastra um autenticador novo');
select tests.sair();
create temp table t_mfa2 as
  select core.totp(convert_to('outro-segredo-de-teste-com-20-bytes', 'UTF8'), floor(extract(epoch from now()) / 30)::bigint) as atual;
grant select on t_mfa2 to vv_api;
select core.definir_contexto(tests.token('mfa_a', 's8'));
set local role vv_api;
select ok(core.confirmar_totp((select atual from t_mfa2), tests.kek()), 'confirma o novo e substitui o anterior');
select tests.sair();

-- Códigos de recuperação -------------------------------------------------------------------
select tests.garantir_sessao('mfa_a', 'aal2', 's6', 10);
select core.definir_contexto(tests.token('mfa_a', 's6'));
set local role vv_api;
select throws_ok($$ select core.gerar_codigos_recuperacao(array_fill('REPETIDO-REPETIDO-REPETIDO'::text, array[10])) $$,
  '22023', null, 'exige 10 códigos distintos');
select lives_ok($$ select core.gerar_codigos_recuperacao(array(
    select 'REC-RECUPERACAO-' || lpad(i::text, 8, '0') from generate_series(1, 10) i)) $$,
  'gera os 10 códigos com MFA recente');
select tests.sair();

select tests.autenticar_como('mfa_a', 'aal1', 's7');
select ok(core.usar_codigo_recuperacao('rec-recuperacao-00000003'), 'código de recuperação vale (sem diferenciar maiúsculas)');
select ok(not core.usar_codigo_recuperacao('REC-RECUPERACAO-00000003'), 'código usado não vale de novo');
select tests.sair();

select * from finish();
rollback;
