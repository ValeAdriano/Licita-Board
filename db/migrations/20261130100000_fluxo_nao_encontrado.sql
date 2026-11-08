-- Q-31b · "não encontrado" separado de "validação" em três funções de fluxo.
-- priv.registrar_pagamento, priv.encerrar_contrato (20261118100000_contratos) e priv.abrir_parecer
-- (20261121100000_parecer_recursal) usavam 22023 com a mesma mensagem para registro ausente/de outra empresa e para
-- validação real (valor recebido acima do faturado, contrato não ativo, sem gatilho recursal). A API não conseguia
-- distinguir, e a consulta prévia sob RLS não serve: as rotas pedem financeiro/editar, contratos/editar e
-- juridico/elaborar_peca, enquanto a leitura pede visualizar ou agenda/visualizar (esconderia registro legítimo).
-- Agora a ausência para a empresa levanta no_data_found (P0002, que o ContextoService já traduz para 404) e a
-- validação real continua 22023 (400). Assinatura, security definer, search_path, grants, RLS, has_permission e
-- audit inalterados (create or replace preserva os grants). Os filtros de existência são os mesmos do corpo anterior
-- (fatura e participação sem deleted_at; contrato com deleted_at is null).

-- migrate:up
create or replace function priv.registrar_pagamento(p_empresa uuid, p_fatura uuid, p_pago_em date, p_valor_recebido numeric, p_ocorrencia text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'financeiro', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from priv.faturas where id = p_fatura and empresa_id = p_empresa) then raise exception 'fatura não encontrada' using errcode = 'no_data_found'; end if;
  update priv.faturas set pago_em = p_pago_em, valor_recebido = p_valor_recebido, ocorrencia = coalesce(nullif(btrim(p_ocorrencia), ''), ocorrencia)
   where id = p_fatura and empresa_id = p_empresa and p_valor_recebido <= valor;
  if not found then raise exception 'valor recebido acima do faturado' using errcode = 'invalid_parameter_value'; end if;
end;
$$;

create or replace function priv.encerrar_contrato(p_empresa uuid, p_contrato uuid, p_status text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('encerrado', 'rescindido') then raise exception 'status inválido' using errcode = 'invalid_parameter_value'; end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null) then raise exception 'contrato não encontrado' using errcode = 'no_data_found'; end if;
  update priv.contratos set status = p_status where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo';
  if not found then raise exception 'só se encerra um contrato ativo' using errcode = 'invalid_parameter_value'; end if;
end;
$$;

create or replace function priv.abrir_parecer(p_empresa uuid, p_participacao uuid, p_concorrente text, p_texto text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa) then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.resultados_item where participacao_id = p_participacao and empresa_id = p_empresa and gatilho_recursal) then
    raise exception 'o parecer só se abre quando a empresa não foi a primeira colocada (resultado com gatilho recursal)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pareceres_recursais (empresa_id, participacao_id, concorrente, texto_concorrente)
  values (p_empresa, p_participacao, btrim(p_concorrente), nullif(btrim(p_texto), ''))
  on conflict (participacao_id) do update set concorrente = excluded.concorrente, texto_concorrente = excluded.texto_concorrente, updated_at = now(),
         validacao = null, validada_em = null, bloqueado = true
  returning id into v_id;
  perform priv.enfileirar_parecer(p_empresa, v_id);
  return v_id;
end;
$$;

-- migrate:down
-- Restaura os corpos de 20261118100000_contratos e 20261121100000_parecer_recursal (ausência e validação em 22023).
create or replace function priv.registrar_pagamento(p_empresa uuid, p_fatura uuid, p_pago_em date, p_valor_recebido numeric, p_ocorrencia text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'financeiro', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  update priv.faturas set pago_em = p_pago_em, valor_recebido = p_valor_recebido, ocorrencia = coalesce(nullif(btrim(p_ocorrencia), ''), ocorrencia)
   where id = p_fatura and empresa_id = p_empresa and p_valor_recebido <= valor;
  if not found then raise exception 'fatura não encontrada ou valor recebido acima do faturado' using errcode = 'invalid_parameter_value'; end if;
end;
$$;

create or replace function priv.encerrar_contrato(p_empresa uuid, p_contrato uuid, p_status text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if p_status not in ('encerrado', 'rescindido') then raise exception 'status inválido' using errcode = 'invalid_parameter_value'; end if;
  update priv.contratos set status = p_status where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo';
  if not found then raise exception 'só se encerra um contrato ativo' using errcode = 'invalid_parameter_value'; end if;
end;
$$;

create or replace function priv.abrir_parecer(p_empresa uuid, p_participacao uuid, p_concorrente text, p_texto text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.resultados_item where participacao_id = p_participacao and empresa_id = p_empresa and gatilho_recursal) then
    raise exception 'o parecer só se abre quando a empresa não foi a primeira colocada (resultado com gatilho recursal)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pareceres_recursais (empresa_id, participacao_id, concorrente, texto_concorrente)
  values (p_empresa, p_participacao, btrim(p_concorrente), nullif(btrim(p_texto), ''))
  on conflict (participacao_id) do update set concorrente = excluded.concorrente, texto_concorrente = excluded.texto_concorrente, updated_at = now(),
         validacao = null, validada_em = null, bloqueado = true
  returning id into v_id;
  perform priv.enfileirar_parecer(p_empresa, v_id);
  return v_id;
end;
$$;
