-- Reautenticação (step-up) na aprovação de peça: exige token de uso único do escopo certo, preso à peça; sem a chave de desenvolvimento
-- (vv.mfa) nada dispensa o token; com ela, só quem NÃO tem TOTP dispensa.
begin;
set local search_path = tap;
select plan(9);

select tests.criar_empresas_ab();
select tests.criar_usuario('sem_totp');
select tests.vincular('sem_totp', 'A', 'JURIDICO', array['juridico:visualizar', 'juridico:aprovar_peca']);
select tests.cena_analise();
select tests.cena_juridico();
insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo)
  select empresa_id, acompanhamento_id, 'impugnacao', 'Segunda peça' from priv.pecas where empresa_id = tests.empresa_id('A');
update priv.pecas set status = 'revisao', validada_em = now(), bloqueada = false where empresa_id = tests.empresa_id('A');
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'p1', (select id from priv.pecas where empresa_id = tests.empresa_id('A') order by titulo limit 1);
insert into g select 'p2', (select id from priv.pecas where empresa_id = tests.empresa_id('A') order by titulo desc limit 1);

-- usuario_a tem TOTP (autenticar_como em aal2 cria o fator)
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p1'), null) $$, '42501', null, 'sem token (produção) a aprovação é recusada');
select tests.sair();

insert into core.step_up_tokens (usuario_id, escopo, sessao_id, mfa_em, expira_em)
values (tests.usuario_id('usuario_a'), 'aprovar_peca', tests.sessao_id('usuario_a'), now(), now() + interval '5 minutes'),
       (tests.usuario_id('usuario_a'), 'proposta_final', tests.sessao_id('usuario_a'), now() - interval '1 second', now() + interval '5 minutes'),
       (tests.usuario_id('usuario_a'), 'aprovar_peca', tests.sessao_id('usuario_a'), now() - interval '10 minutes', now() - interval '5 minutes');
insert into g select 'tok_ok', id from core.step_up_tokens where escopo = 'aprovar_peca' and expira_em > now();
insert into g select 'tok_outro', id from core.step_up_tokens where escopo = 'proposta_final';
insert into g select 'tok_vencido', id from core.step_up_tokens where escopo = 'aprovar_peca' and expira_em < now();

select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p1'), (select id from g where nome = 'tok_outro')) $$, '42501', null, 'token de outro escopo não serve');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p1'), (select id from g where nome = 'tok_vencido')) $$, '42501', null, 'token expirado não serve');
select lives_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p1'), (select id from g where nome = 'tok_ok')) $$, 'com o token do escopo certo aprova');
select tests.sair();
select is((select usado_para_alvo from core.step_up_tokens where usado_em is not null), 'peca:' || (select id from g where nome = 'p1'), 'o token fica preso à peça aprovada');

select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p2'), (select id from g where nome = 'tok_ok')) $$, '42501', null, 'o token é de uso único: já foi usado na outra peça');
select tests.sair();

-- chave de desenvolvimento: quem tem TOTP continua precisando do token; quem não tem, dispensa
select set_config('vv.mfa', 'opcional', true);
select tests.autenticar_como('usuario_a');
select throws_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p2'), null) $$, '42501', null, 'com a chave, quem tem TOTP ainda precisa do token');
select tests.sair();
select tests.autenticar_como('sem_totp', 'aal1');
select lives_ok($$ select priv.aprovar_peca(tests.empresa_id('A'), (select id from g where nome = 'p2'), null) $$, 'com a chave, quem não tem TOTP dispensa o token');
select tests.sair();
select is((select count(*)::int from priv.pecas where empresa_id = tests.empresa_id('A') and status = 'aprovada'), 2, 'as duas peças foram aprovadas só pelos caminhos permitidos');

select * from finish();
rollback;
