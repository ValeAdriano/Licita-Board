-- Fase 05 · reavaliação ao retificar o edital (RF-05.9, spec §4.8). O worker compara a última versão notificada com a
-- versão atual do edital, avisa o responsável e os gestores e, se mudou data de propostas/abertura, marca o
-- acompanhamento "abertura a reconfirmar" (a data confirmada pode não valer mais). Só uma PESSOA desmarca, ao confirmar
-- a abertura de novo. A API só lê as colunas novas; quem as grava é o worker.

-- migrate:up
alter table priv.acompanhamentos
  add column retificacao_notificada_versao int,
  add column abertura_reconfirmar boolean not null default false;

grant update (retificacao_notificada_versao, abertura_reconfirmar) on priv.acompanhamentos to vv_worker;

create or replace function priv.confirmar_abertura(p_empresa uuid, p_acomp uuid, p_data timestamptz, p_origem text, p_clausula text,
                                                   p_prazo_esclarecimento timestamptz, p_prazo_impugnacao timestamptz, p_clausula_prazos text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_origem not in ('edital', 'portal', 'manual') then
    raise exception 'origem inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_data is null then
    raise exception 'informe a data de abertura' using errcode = 'invalid_parameter_value';
  end if;
  update priv.acompanhamentos
     set data_abertura = p_data, abertura_origem = p_origem, abertura_confirmada = true, abertura_reconfirmar = false,
         abertura_clausula = nullif(btrim(p_clausula), ''), prazo_esclarecimento_edital = p_prazo_esclarecimento,
         prazo_impugnacao_edital = p_prazo_impugnacao, clausula_prazos = nullif(btrim(p_clausula_prazos), ''),
         confiabilidade = case p_origem when 'edital' then 'alta' when 'portal' then 'media' else 'baixa' end,
         ultima_conferencia_em = now()
   where id = p_acomp and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', p_acomp),
                         'calc:' || p_acomp || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;

-- migrate:down
alter table priv.acompanhamentos drop column abertura_reconfirmar, drop column retificacao_notificada_versao;
-- (priv.confirmar_abertura volta à definição de 20261108100000 ao refazer a migration anterior)
