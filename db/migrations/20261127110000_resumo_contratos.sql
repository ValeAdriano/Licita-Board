-- Relatório diário: quantos resultados "contratada" ainda estão sem contrato cadastrado (estado de agora, não o histórico de avisos).
-- O worker não lê resultados nem contratos: só esta contagem, por função.

-- migrate:up
create function priv.contratadas_sem_contrato(p_empresa uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from priv.resultados_item ri
    join priv.participacoes pa on pa.id = ri.participacao_id and pa.empresa_id = ri.empresa_id
    join priv.acompanhamentos a on a.id = pa.acompanhamento_id
   where ri.empresa_id = p_empresa and ri.resultado_final = 'contratada'
     and not exists (select 1 from priv.contratos c where c.acompanhamento_id = a.id and c.empresa_id = a.empresa_id and c.deleted_at is null)
$$;
revoke all on function priv.contratadas_sem_contrato(uuid) from public;
grant execute on function priv.contratadas_sem_contrato(uuid) to vv_worker;

-- migrate:down
drop function priv.contratadas_sem_contrato(uuid);
