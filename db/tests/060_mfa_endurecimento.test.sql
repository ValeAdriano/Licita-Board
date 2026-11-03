-- Endurecimento do MFA (PR 4): pendente por sessão, limite de cadastro, troca de autenticador
-- encerrando outras sessões, bloqueio duro por erros consecutivos e reset por SUPERADMIN.
begin;
set local search_path = tap;
select plan(16);

select tests.criar_usuario('end_a');
select tests.criar_usuario('end_super', true);
create temp table t_seg as
  select convert_to('segredo-endurecimento-com-20-bytes', 'UTF8') as s,
         core.totp(convert_to('segredo-endurecimento-com-20-bytes', 'UTF8'), floor(extract(epoch from now()) / 30)::bigint) as atual;
grant select on t_seg to vv_api;

-- Pendente da sessão 1; a sessão 2 cadastra o próprio e não apaga o da 1.
select tests.autenticar_como('end_a', 'aal1', 3600, 's1');
select isnt(core.cadastrar_totp((select s from t_seg), tests.kek()), null, 'cadastrar devolve o vencimento');
select tests.sair();
select tests.autenticar_como('end_a', 'aal1', 3600, 's2');
select core.cadastrar_totp(convert_to('outro-segredo-da-sessao-dois-20b', 'UTF8'), tests.kek());
select ok(not core.confirmar_totp((select atual from t_seg), tests.kek()),
  'a sessão 2 não confirma o pendente da sessão 1');
select tests.sair();
select tests.autenticar_como('end_a', 'aal1', 3600, 's1');
select ok(core.confirmar_totp((select atual from t_seg), tests.kek()), 'o dono confirma o próprio pendente');
select tests.sair();
select ok((select sessao_id is null from core.fatores_mfa where usuario_id = tests.usuario_id('end_a') and verificado_em is not null),
  'fator verificado não fica preso à sessão (apagar sessão não apaga o fator)');
select is((select count(*)::int from core.fatores_mfa where usuario_id = tests.usuario_id('end_a') and verificado_em is null),
  0, 'confirmar descarta os pendentes das outras sessões');

-- Atacante com a senha: pendente criado ANTES de o dono ter MFA não troca o autenticador depois.
select tests.criar_usuario('end_c');
select tests.autenticar_como('end_c', 'aal1', 3600, 'atacante');
select core.cadastrar_totp(convert_to('segredo-do-atacante-com-20-bytes', 'UTF8'), tests.kek());
select tests.sair();
create temp table t_atk as
  select core.totp(convert_to('segredo-do-atacante-com-20-bytes', 'UTF8'), floor(extract(epoch from now()) / 30)::bigint) as c;
grant select on t_atk to vv_api;
-- o dono cadastra e confirma o dele (marcado direto como verificado para o cenário)
insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek, verificado_em)
values (tests.usuario_id('end_c'), extensions.pgp_sym_encrypt_bytea(convert_to('segredo-do-dono-com-mais-de-20-b', 'UTF8'), tests.kek()), 1, now());
select tests.autenticar_como('end_c', 'aal1', 3600, 'atacante');
select throws_ok($$ select core.confirmar_totp((select c from t_atk), tests.kek()) $$, '42501', null,
  'pendente antigo do atacante não substitui o autenticador do dono sem MFA recente');
select tests.sair();

-- Limite de 5 cadastros em 15 min por usuário.
select tests.criar_usuario('end_b');
select tests.autenticar_como('end_b', 'aal1', 3600, 's1');
select core.cadastrar_totp((select s from t_seg), tests.kek()) from generate_series(1, 5);
select throws_ok($$ select core.cadastrar_totp((select s from t_seg), tests.kek()) $$, '54000', null,
  'o 6º cadastro em 15 min é recusado');
select tests.sair();

-- Trocar de autenticador encerra as outras sessões.
select tests.garantir_sessao('end_a', 'aal2', 'outra', 3600);
select tests.garantir_sessao('end_a', 'aal2', 's3', 10);
select core.definir_contexto(tests.token('end_a', 's3'));
set local role vv_api;
select core.cadastrar_totp(convert_to('terceiro-segredo-de-teste-20bytes', 'UTF8'), tests.kek());
select tests.sair();
create temp table t_seg3 as
  select core.totp(convert_to('terceiro-segredo-de-teste-20bytes', 'UTF8'), floor(extract(epoch from now()) / 30)::bigint) as c;
grant select on t_seg3 to vv_api;
select core.definir_contexto(tests.token('end_a', 's3'));
set local role vv_api;
select ok(core.confirmar_totp((select c from t_seg3), tests.kek()), 'confirma o autenticador novo');
select tests.sair();
select ok((select revogada_em is not null from core.sessoes where id = tests.sessao_id('end_a', 'outra')),
  'trocar de autenticador encerra as outras sessões');

-- Bloqueio duro: 50 erros consecutivos (abaixo do limite por janela) bloqueiam de vez.
update core.usuarios set falhas_mfa_consecutivas = 49, falhas_mfa = 0, ultima_falha_mfa_em = null
 where id = tests.usuario_id('end_a');
select tests.autenticar_como('end_a', 'aal1', 3600, 's4');
select core.verificar_totp('000000', tests.kek());
select tests.sair();
select is((select mfa_bloqueado_ate from core.usuarios where id = tests.usuario_id('end_a')), 'infinity'::timestamptz,
  'a 50ª falha consecutiva bloqueia o MFA sem prazo');

-- Reset por SUPERADMIN com MFA recente (e não de si mesmo).
select tests.garantir_sessao('end_super', 'aal2', 'adm', 3600);
select core.definir_contexto(tests.token('end_super', 'adm'));
set local role vv_api;
select throws_ok($$ select core.resetar_mfa(tests.usuario_id('end_a'), tests.kek()) $$, '42501', null,
  'reset exige MFA recente do SUPERADMIN');
select tests.sair();
select tests.garantir_sessao('end_super', 'aal2', 'adm', 10);
select core.definir_contexto(tests.token('end_super', 'adm'));
set local role vv_api;
select throws_ok($$ select core.resetar_mfa(tests.usuario_id('end_a'), 'kek-inventada-pelo-atacante-0123456789') $$,
  '28000', null, 'reset exige a KEK');
select throws_ok($$ select core.resetar_mfa(null, tests.kek()) $$, '42501', null, 'reset sem alvo é recusado');
select tests.sair();
select tests.criar_usuario('end_super2', true);
select core.definir_contexto(tests.token('end_super', 'adm'));
set local role vv_api;
select throws_ok($$ select core.resetar_mfa(tests.usuario_id('end_super2'), tests.kek()) $$, '42501', null,
  'SUPERADMIN não reseta outro SUPERADMIN pelo app');
select lives_ok($$ select core.resetar_mfa(tests.usuario_id('end_a'), tests.kek()) $$, 'SUPERADMIN com MFA recente reseta');
select tests.sair();
select is((select (mfa_bloqueado_ate, falhas_mfa_consecutivas, senha_hash)::text from core.usuarios where id = tests.usuario_id('end_a')),
  '(,0,)', 'reset desbloqueia, zera o contador e invalida a senha');

select * from finish();
rollback;
