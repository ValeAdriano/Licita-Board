-- core.signatario_valido: bordas de data (spec fase-02 §3.2 e §4.4; CA-6). Falha segura.
begin;
set local search_path = tap;
select plan(14);

select tests.criar_empresas_ab();
create temp table env as select
  '{"v":1,"dek":"AwMDAwMDAwMDAwMDWs7ANpmNfrFp5lKrYrYW7a/+lBPp+qmFUh025GzZztjAjAvOQqnWWi0Gbe39S6cx","iv":"AgICAgICAgICAgIC","ct":"ZL6oPy96sZSrjNmwOcqy3s2bpYqYxRwVPyjJbhwB7BFbac+93VU="}'::jsonb as e;
create temp table r (nome text primary key, id uuid);
insert into core.representantes (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash)
select tests.empresa_id('A'), v.tipo, v.nome, e, '•••••••0000', v.h
  from env, (values ('SOCIO_ADMINISTRADOR', 'socio', repeat('1', 64)), ('PROCURADOR', 'proc', repeat('2', 64)),
                    ('PROCURADOR', 'sem_validade', repeat('3', 64))) v(tipo, nome, h);
insert into r select nome, id from core.representantes;
grant select on r to vv_api;
insert into core.representante_poderes (representante_id, empresa_id, poder)
select id, tests.empresa_id('A'), 'assinar_proposta' from r where nome = 'socio';
-- procuração: emitida 2026-01-10, validade 2026-06-30, poder assinar_proposta
insert into core.procuracoes (empresa_id, representante_id, data_emissao, data_validade)
select tests.empresa_id('A'), id, date '2026-01-10', date '2026-06-30' from r where nome = 'proc';
insert into core.procuracao_poderes (procuracao_id, empresa_id, poder)
select id, tests.empresa_id('A'), 'assinar_proposta' from core.procuracoes;
-- sem validade
insert into core.procuracoes (empresa_id, representante_id, data_emissao, data_validade)
select tests.empresa_id('A'), id, date '2026-01-10', null from r where nome = 'sem_validade';
insert into core.procuracao_poderes (procuracao_id, empresa_id, poder)
select p.id, tests.empresa_id('A'), 'assinar_proposta' from core.procuracoes p join r on r.id = p.representante_id where r.nome = 'sem_validade';

select tests.autenticar_como('usuario_a');
select ok(core.signatario_valido((select id from r where nome = 'socio'), date '2030-01-01', 'assinar_proposta'), 'sócio-administrador com o poder vale (sem prazo)');
select ok(not core.signatario_valido((select id from r where nome = 'socio'), date '2026-03-01', 'firmar_contrato'), 'sócio sem o poder não vale');
select ok(not core.signatario_valido((select id from r where nome = 'proc'), date '2026-01-09', 'assinar_proposta'), 'véspera da emissão: ainda não vale');
select ok(core.signatario_valido((select id from r where nome = 'proc'), date '2026-01-10', 'assinar_proposta'), 'dia da emissão: vale');
select ok(core.signatario_valido((select id from r where nome = 'proc'), date '2026-06-30', 'assinar_proposta'), 'dia da validade: vale');
select ok(not core.signatario_valido((select id from r where nome = 'proc'), date '2026-07-01', 'assinar_proposta'), 'dia seguinte à validade: vencida');
select ok(not core.signatario_valido((select id from r where nome = 'proc'), date '2026-03-01', 'firmar_contrato'), 'procuração sem o poder pedido não vale');
select ok(not core.signatario_valido((select id from r where nome = 'sem_validade'), date '2026-03-01', 'assinar_proposta'), 'procuração sem validade é inválida (falha segura, ⚖️)');
select lives_ok($$ update core.procuracoes set revogada_em = date '2026-04-01' where representante_id = (select id from r where nome = 'proc') $$, 'ADMIN revoga a procuração a partir de 2026-04-01');
select ok(core.signatario_valido((select id from r where nome = 'proc'), date '2026-03-31', 'assinar_proposta'), 'antes da revogação ainda vale');
select ok(not core.signatario_valido((select id from r where nome = 'proc'), date '2026-04-01', 'assinar_proposta'), 'a partir da revogação não vale');
select lives_ok($$ update core.representantes set ativo = false where nome = 'socio' $$, 'ADMIN desativa o sócio');
select ok(not core.signatario_valido((select id from r where nome = 'socio'), date '2026-03-01', 'assinar_proposta'), 'representante inativo não vale');
select tests.sair();
select tests.autenticar_como('usuario_b');
select ok(not core.signatario_valido((select id from r where nome = 'proc'), date '2026-03-01', 'assinar_proposta'), 'B não enxerga (nem valida) representante de A');
select tests.sair();

select * from finish();
rollback;
