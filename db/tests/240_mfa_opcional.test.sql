-- 2FA opcional: sem a chave vv.mfa nada muda; com a chave, só quem NÃO tem TOTP passa em aal1.
begin;
set local search_path = tap;
select plan(7);

select tests.criar_empresas_ab();

select tests.autenticar_como('usuario_a', 'aal1');
select is(core.mfa_obrigatorio(), true, 'sem a chave: perfil interno continua obrigado a ter MFA');
select is(core.mfa_ok(), false, 'sem a chave: aal1 não basta');
select tests.sair();

select set_config('vv.mfa', 'opcional', true);
select tests.autenticar_como('usuario_a', 'aal1');
select is(core.mfa_obrigatorio(), false, 'com a chave: MFA deixa de ser obrigatório');
select is(core.mfa_ok(), true, 'com a chave: quem não tem TOTP passa em aal1');
select tests.sair();

-- usuario_b cadastra TOTP (autenticar_como em aal2 cria o fator) e depois cai numa sessão aal1.
select tests.autenticar_como('usuario_b', 'aal2');
select tests.sair();
select tests.garantir_sessao('usuario_b', 'aal1', 'sessao-aal1');
select core.definir_contexto(tests.token('usuario_b', 'sessao-aal1'));
select set_config('role', 'vv_api', true);
select is(core.tem_mfa(), true, 'usuario_b tem TOTP');
select is(core.mfa_ok(), false, 'com a chave, quem TEM TOTP continua precisando de aal2');
select tests.sair();

select set_config('vv.mfa', '', true);
select tests.autenticar_como('usuario_a', 'aal1');
select is(core.mfa_obrigatorio(), true, 'chave vazia = obrigatório de novo');
select tests.sair();

select * from finish();
rollback;
