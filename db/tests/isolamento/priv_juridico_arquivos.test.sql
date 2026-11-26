-- Isolamento A x B de priv.juridico_arquivos: A lê só o que é seu; a API não tem DML direto (só funções).
begin;
set local search_path = tap;
select plan(6);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_juridico();
select tests.cena_cadastros();
insert into priv.recursos_terceiros (empresa_id, acompanhamento_id, peca_id, recorrente, publicado_em, texto)
  select empresa_id, acompanhamento_id, id, 'Concorrente S/A', now(), repeat('Alegação do recurso. ', 5) from priv.pecas;
insert into priv.juridico_arquivos (empresa_id, recurso_id, documento_id, versao_id, nome, caracteres)
  select r.empresa_id, r.id, v.documento_id, v.id, 'recurso.pdf', 100
    from priv.recursos_terceiros r join priv.documento_versoes v on v.empresa_id = r.empresa_id;

select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from priv.juridico_arquivos where empresa_id = tests.empresa_id('A') $$, 'A lê os arquivos do jurídico da própria empresa');
select is_empty($$ select 1 from priv.juridico_arquivos where empresa_id = tests.empresa_id('B') $$, 'A não lê arquivos do jurídico de B');
select throws_ok($$ update priv.juridico_arquivos set nome = 'x' where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não edita arquivos de B');
select throws_ok($$ update priv.juridico_arquivos set nome = 'x' where empresa_id = tests.empresa_id('A') $$, '42501', null, 'nem os próprios: só por função');
select throws_ok($$ delete from priv.juridico_arquivos where empresa_id = tests.empresa_id('B') $$, '42501', null, 'A não apaga arquivos de B');
select throws_ok($$ insert into priv.juridico_arquivos (empresa_id, recurso_id, documento_id, versao_id, nome, caracteres) values (tests.empresa_id('B'), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'x', 0) $$, '42501', null, 'A não insere em nome de B');

select * from finish();
rollback;
