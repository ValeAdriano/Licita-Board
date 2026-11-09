-- Q-26 · Fase 03 (spec fase-03 §10.1): o selo "recalculando" do checklist também acende quando há recálculo na fila.
-- Antes a API só sabia de exigência editada depois do cálculo; versão liberada, documento alterado, abertura mudada ou o
-- pedido "recalcular" deixavam o resultado anterior sem aviso até o worker rodar.
-- * priv.checklist_pendente(empresa, acompanhamento): só um booleano (nada de ops.jobs além disso), security definer,
--   execute só para vv_api. Permissão primeiro (documentos/visualizar; sem ela → no_data_found, 404, padrão das funções
--   de fluxo). O job é filtrado por empresa_id = p_empresa: acompanhamento de outra empresa (ou inexistente) dá false.
-- * Pendente = job checklist_documental 'pendente' ou 'executando' que ainda vai rodar (executando com trava vencida e
--   sem tentativa sobrando vira 'falhou' no próximo pegar_jobs: não conta). 'concluido' e 'falhou' não acendem.
-- * Índice parcial para a consulta (só jobs vivos do tipo; a tabela ops.jobs cresce com o recálculo diário).

-- migrate:up
create index jobs_checklist_pendente_idx on ops.jobs (empresa_id, (payload ->> 'acompanhamento_id'))
  where tipo = 'checklist_documental' and status in ('pendente', 'executando');

create function priv.checklist_pendente(p_empresa uuid, p_acomp uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  return exists (
    select 1 from ops.jobs j
     where j.tipo = 'checklist_documental' and j.empresa_id = p_empresa
       and j.payload ->> 'acompanhamento_id' = p_acomp::text
       and j.status in ('pendente', 'executando')
       and (j.status = 'pendente' or j.travado_ate > now() or j.tentativas < j.max_tentativas));
end;
$$;
revoke all on function priv.checklist_pendente(uuid, uuid) from public;
grant execute on function priv.checklist_pendente(uuid, uuid) to vv_api;

-- migrate:down
drop function priv.checklist_pendente(uuid, uuid);
drop index ops.jobs_checklist_pendente_idx;
