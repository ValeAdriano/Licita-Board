-- Isolamento A x B de priv.proposta_envios: A lê só o que é seu; escrever só por função (registrar/anular), nunca direto (ADR-013, regra 13).
begin;
set local search_path = tap;
select plan(5);

select tests.criar_empresas_ab();
select tests.cena_analise();
select tests.cena_proposta();

with d as (
  insert into priv.documentos (empresa_id, tipo_id, descricao)
  select p.empresa_id, (select id from pub.tipos_documento where slug = 'comprovante_envio_proposta'), 'Comprovante'
    from priv.propostas p
  returning id, empresa_id
), v as (
  insert into priv.documento_versoes (documento_id, empresa_id, versao, arquivo_chave, nome_original, status_arquivo)
  select d.id, d.empresa_id, 1, 'k/' || d.id, 'c.pdf', 'liberado' from d
  returning id, documento_id, empresa_id
)
insert into priv.proposta_envios (empresa_id, proposta_id, proposta_versao, formato, enviado_em, comprovante_documento_id, comprovante_versao_id, registrado_por)
select p.empresa_id,
       p.id,
       p.versao,
       'pdf',
       now() - interval '10 minutes',
       v.documento_id,
       v.id,
       (select u.id from core.usuarios u where u.email like 'usuario_' || lower(case when p.empresa_id = tests.empresa_id('A') then 'a' else 'b' end) || '%' limit 1)
  from priv.propostas p
  join v on v.empresa_id = p.empresa_id;

select tests.autenticar_como('usuario_a');
select ok(tests.leitura($$ select 1 from priv.proposta_envios where empresa_id = tests.empresa_id('A') $$) > 0, 'A lê os envios de proposta da própria empresa');
select ok(tests.leitura($$ select 1 from priv.proposta_envios where empresa_id = tests.empresa_id('B') $$) <= 0, 'A não lê envios de proposta de B');
select ok(tests.dml_bloqueado($$ update priv.proposta_envios set portal = 'X' where empresa_id = tests.empresa_id('B') $$), 'A não edita envios de proposta de B');
select ok(tests.dml_bloqueado($$ delete from priv.proposta_envios where empresa_id = tests.empresa_id('B') $$), 'A não apaga envios de proposta de B');
select ok(tests.dml_bloqueado($$ insert into priv.proposta_envios (empresa_id, proposta_id, proposta_versao, formato, enviado_em, comprovante_documento_id, comprovante_versao_id) values (tests.empresa_id('B'), gen_random_uuid(), 1, 'pdf', now(), gen_random_uuid(), gen_random_uuid()) $$), 'A não insere envios de proposta em nome de B');

select * from finish();
rollback;
