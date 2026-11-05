-- Fase 09 · Resultados das disputas por item (spec docs/specs/fase-09.md): os 20 status de participação do Prompt (9.1), o resultado
-- da disputa (9.2), o gatilho para o jurídico (9.3: perdeu/inabilitada/desclassificada abre o evento de intenção de recurso na agenda) e
-- a pesquisa histórica (9.4). ARREMATAÇÃO NÃO É HOMOLOGAÇÃO: são valores diferentes de `resultado_final`. O sistema nunca dá lance nem protocola (regra 17).

-- migrate:up
alter table priv.participacoes drop constraint participacoes_status_check;
alter table priv.participacoes add constraint participacoes_status_check check (status in (
  'avaliando', 'aguardando_analise', 'vai_participar', 'nao_vai', 'proposta_preparada', 'proposta_cadastrada', 'proposta_enviada', 'em_disputa', 'arrematada',
  'habilitacao', 'em_fase_recursal', 'adjudicada', 'homologada', 'contratada', 'vencida', 'perdida', 'inabilitada', 'desclassificada', 'fracassada', 'deserta',
  'revogada', 'anulada', 'cancelada'));

create table priv.resultados_item (
  id                    uuid primary key default core.uuid_v7(),
  empresa_id            uuid not null references core.empresas (id) on delete cascade,
  participacao_id       uuid not null,
  resultado_final       text not null check (resultado_final in ('arrematada', 'adjudicada', 'homologada', 'contratada', 'perdida', 'inabilitada', 'desclassificada',
                                                                'fracassada', 'deserta', 'revogada', 'anulada', 'cancelada')),
  valor_inicial         numeric(18, 4) check (valor_inicial >= 0),
  valor_final           numeric(18, 4) check (valor_final >= 0),
  classificacao         int check (classificacao >= 1),
  melhor_lance          numeric(18, 4) check (melhor_lance >= 0),
  vencedora_cnpj        text check (vencedora_cnpj ~ '^[0-9A-Z]{14}$'),
  vencedora_nome        text check (char_length(vencedora_nome) <= 200),
  vencedora_marca_modelo text check (char_length(vencedora_marca_modelo) <= 200),
  motivo_perda          text check (char_length(motivo_perda) <= 1000),
  situacao_habilitacao  text not null default 'a_confirmar' check (situacao_habilitacao in ('a_confirmar', 'em_analise', 'habilitada', 'inabilitada')),
  ocorrido_em           timestamptz not null default now(),
  gatilho_recursal      boolean not null default false,
  registrado_por        uuid default core.usuario_atual(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  unique (participacao_id),
  unique (id, empresa_id)
);
create index resultados_item_empresa_idx on priv.resultados_item (empresa_id, ocorrido_em desc);

alter table priv.resultados_item enable row level security;
create policy resultados_item_select on priv.resultados_item for select to vv_api using (core.has_permission(empresa_id, 'agenda', 'visualizar'));
grant select on priv.resultados_item to vv_api;
create trigger resultados_item_updated_at before update on priv.resultados_item for each row execute function core.set_updated_at();
create trigger resultados_item_audit after insert or update on priv.resultados_item for each row execute function audit.registrar();
alter table priv.resultados_item enable always trigger resultados_item_audit;

-- Registra (ou corrige) o resultado de um item. Atualiza o status da participação e, se perdeu, foi inabilitada ou desclassificada (ou não ficou
-- em 1º), abre o evento de INTENÇÃO DE RECURSO na agenda (prazo calculado pelo worker; ⚖️ a regra segue não validada pelo jurídico).
create function priv.registrar_resultado(
  p_empresa uuid, p_participacao uuid, p_resultado text, p_valor_inicial numeric, p_valor_final numeric, p_classificacao int, p_melhor_lance numeric,
  p_vencedora_cnpj text, p_vencedora_nome text, p_vencedora_marca_modelo text, p_motivo text, p_habilitacao text, p_quando timestamptz
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_acomp uuid;
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_vencedora_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_gatilho boolean;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select acompanhamento_id into v_acomp from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  if v_cnpj is not null and not core.cnpj_valido(v_cnpj) then
    raise exception 'CNPJ da vencedora inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_resultado in ('perdida', 'inabilitada', 'desclassificada') and char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'informe o motivo (perda, inabilitação ou desclassificação)' using errcode = 'invalid_parameter_value';
  end if;
  v_gatilho := p_resultado in ('perdida', 'inabilitada', 'desclassificada') or coalesce(p_classificacao, 1) > 1;
  insert into priv.resultados_item (empresa_id, participacao_id, resultado_final, valor_inicial, valor_final, classificacao, melhor_lance, vencedora_cnpj, vencedora_nome,
                                    vencedora_marca_modelo, motivo_perda, situacao_habilitacao, ocorrido_em, gatilho_recursal)
  values (p_empresa, p_participacao, p_resultado, p_valor_inicial, p_valor_final, p_classificacao, p_melhor_lance, v_cnpj, nullif(btrim(p_vencedora_nome), ''),
          nullif(btrim(p_vencedora_marca_modelo), ''), nullif(btrim(p_motivo), ''), coalesce(p_habilitacao, 'a_confirmar'), coalesce(p_quando, now()), v_gatilho)
  on conflict (participacao_id) do update set resultado_final = excluded.resultado_final, valor_inicial = excluded.valor_inicial, valor_final = excluded.valor_final,
    classificacao = excluded.classificacao, melhor_lance = excluded.melhor_lance, vencedora_cnpj = excluded.vencedora_cnpj, vencedora_nome = excluded.vencedora_nome,
    vencedora_marca_modelo = excluded.vencedora_marca_modelo, motivo_perda = excluded.motivo_perda, situacao_habilitacao = excluded.situacao_habilitacao,
    ocorrido_em = excluded.ocorrido_em, gatilho_recursal = excluded.gatilho_recursal
  returning id into v_id;
  update priv.participacoes set status = p_resultado where id = p_participacao;
  if v_gatilho then
    perform priv.registrar_fato(p_empresa, v_acomp, 'intencao_recurso', coalesce(p_quando, now()));
  end if;
  return v_id;
end;
$$;
grant execute on function priv.registrar_resultado(uuid, uuid, text, numeric, numeric, int, numeric, text, text, text, text, text, timestamptz) to vv_api;

-- migrate:down
drop function priv.registrar_resultado(uuid, uuid, text, numeric, numeric, int, numeric, text, text, text, text, text, timestamptz);
drop table priv.resultados_item;
alter table priv.participacoes drop constraint participacoes_status_check;
alter table priv.participacoes add constraint participacoes_status_check check (status in (
  'avaliando', 'vai_participar', 'nao_vai', 'proposta_enviada', 'em_disputa', 'arrematada', 'habilitacao', 'vencida', 'perdida', 'desclassificada', 'cancelada'));
