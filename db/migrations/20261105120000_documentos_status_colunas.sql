-- Fase 03 · A view de status lia x.* de priv.documento_versoes, mas vv_api só tem grant por coluna (sem
-- arquivo_chave). Passa a ler só as colunas que precisa.

-- migrate:up
create or replace view priv.documentos_status with (security_invoker = true) as
select d.id as documento_id, d.empresa_id, d.tipo_id, v.id as versao_id, v.validade,
  case
    when d.em_atualizacao then 'em_atualizacao'
    when v.id is null then 'pendente'
    when d.sem_vencimento or v.validade is null then 'valido'
    when v.validade < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    when v.validade <= (now() at time zone 'America/Sao_Paulo')::date + (select max(a) from unnest(t.antecedencias) a) then 'a_vencer'
    else 'valido'
  end as status
from priv.documentos d
join pub.tipos_documento t on t.id = d.tipo_id
left join lateral (select x.id, x.validade from priv.documento_versoes x
                    where x.documento_id = d.id and x.status_arquivo = 'liberado' order by x.versao desc limit 1) v on true
where d.deleted_at is null;

-- migrate:down
-- (a definição anterior lia x.*; mantida a atual, que é equivalente para quem tem acesso)
