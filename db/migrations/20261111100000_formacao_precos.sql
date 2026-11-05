-- Fase 07 · Formação de preços (spec docs/specs/fase-07.md). Dinheiro em numeric(18,4); percentuais em numeric(9,4).
--
-- * priv.precificacoes: parâmetros e RESULTADO da precificação de uma participação (item) e produto. O cálculo é do worker
--   (rules/precos.py); a API só grava insumos por função e enfileira. 
-- * priv.preco_linhas: custos (por unidade ou do lote) e percentuais sobre o preço (tributos, comissão...), cada um
--   identificado; tributo só vale como validado quando o responsável marca (🧾 contador).
-- * Custos e margens são sigilo comercial: a leitura exige a ação `ver_custos_margens` do módulo `precos` (7.5).

-- migrate:up
create table priv.precificacoes (
  id                      uuid primary key default core.uuid_v7(),
  empresa_id              uuid not null references core.empresas (id) on delete cascade,
  participacao_id         uuid not null,
  produto_id              uuid,
  quantidade              numeric(18, 4) not null check (quantidade > 0),
  valor_estimado_unit     numeric(18, 4) check (valor_estimado_unit >= 0),
  margem_desejada_pct     numeric(9, 4) not null default 0 check (margem_desejada_pct >= 0 and margem_desejada_pct < 100),
  margem_minima_pct       numeric(9, 4) not null default 0 check (margem_minima_pct >= 0 and margem_minima_pct < 100),
  casas_unitario          int not null default 2 check (casas_unitario between 2 and 6),
  arredondamento          text not null default 'half_up' check (arredondamento in ('half_up', 'truncar')),
  preco_proposto_unit     numeric(18, 4) check (preco_proposto_unit >= 0),
  limite_inexequivel_pct  numeric(9, 4) check (limite_inexequivel_pct > 0 and limite_inexequivel_pct <= 100),
  me_epp                  boolean not null default false,
  modalidade_empate       text check (modalidade_empate in ('pregao', 'outras')),
  -- resultado (só o worker grava)
  custo_direto_unit       numeric(18, 6),
  percentuais_sobre_preco numeric(9, 4),
  preco_minimo_unit       numeric(18, 6),
  preco_oferta_unit       numeric(18, 6),
  preco_final_unit        numeric(18, 6),
  total_proposta          numeric(18, 4),
  margem_bruta_pct        numeric(12, 4),
  margem_liquida_pct      numeric(12, 4),
  diferenca_estimado_pct  numeric(12, 4),
  abaixo_do_minimo        boolean,
  risco_inexequivel       text check (risco_inexequivel in ('OK', 'RISCO', 'NAO_PARAMETRIZADO')),
  erro_calculo            text,
  calculado_em            timestamptz,
  -- aprovação comercial (7.6)
  justificativa_abaixo    text check (char_length(justificativa_abaixo) <= 1000),
  aprovado_por            uuid references core.usuarios (id),
  aprovado_em             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default core.usuario_atual(),
  deleted_at              timestamptz,
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  foreign key (produto_id, empresa_id) references priv.produtos (id, empresa_id),
  check ((aprovado_por is null) = (aprovado_em is null)),
  unique (id, empresa_id)
);
create unique index precificacoes_uk on priv.precificacoes (participacao_id, coalesce(produto_id, '00000000-0000-0000-0000-000000000000')) where deleted_at is null;
create index precificacoes_empresa_idx on priv.precificacoes (empresa_id);

create table priv.preco_linhas (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  precificacao_id  uuid not null,
  nome             text not null check (char_length(nome) between 2 and 120),
  tipo             text not null check (tipo in ('aquisicao', 'frete', 'seguro', 'instalacao', 'acessorio', 'garantia_adicional', 'encargo_financeiro',
                                                'contingencia', 'despesa_administrativa', 'comissao', 'tributo', 'outro')),
  categoria        text not null check (categoria in ('custo', 'percentual')),
  forma            text check (forma in ('por_unidade', 'total_lote')),
  valor            numeric(18, 4) check (valor >= 0),
  percentual       numeric(9, 4) check (percentual >= 0 and percentual < 100),
  validado_por     uuid references core.usuarios (id),
  validado_em      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid default core.usuario_atual(),
  deleted_at       timestamptz,
  foreign key (precificacao_id, empresa_id) references priv.precificacoes (id, empresa_id) on delete cascade,
  check ((categoria = 'custo' and forma is not null and valor is not null and percentual is null)
      or (categoria = 'percentual' and forma is null and valor is null and percentual is not null)),
  check ((validado_por is null) = (validado_em is null))
);
create index preco_linhas_prec_idx on priv.preco_linhas (precificacao_id) where deleted_at is null;
create index preco_linhas_empresa_idx on priv.preco_linhas (empresa_id);

alter table priv.precificacoes enable row level security;
alter table priv.preco_linhas enable row level security;
do $$
declare t text;
begin
  foreach t in array array['precificacoes', 'preco_linhas'] loop
    execute format('create policy %I on priv.%I for select to vv_api using (core.has_permission(empresa_id, ''precos'', ''ver_custos_margens''))', t || '_select', t);
    execute format('grant select on priv.%I to vv_api', t);
    execute format('create trigger %I after insert or update on priv.%I for each row execute function audit.registrar()', t || '_audit', t);
    execute format('alter table priv.%I enable always trigger %I', t, t || '_audit');
  end loop;
end $$;
create trigger precificacoes_updated_at before update on priv.precificacoes for each row execute function core.set_updated_at();

grant select on priv.precificacoes, priv.preco_linhas to vv_worker;
grant update (custo_direto_unit, percentuais_sobre_preco, preco_minimo_unit, preco_oferta_unit, preco_final_unit, total_proposta, margem_bruta_pct,
              margem_liquida_pct, diferenca_estimado_pct, abaixo_do_minimo, risco_inexequivel, erro_calculo, calculado_em, aprovado_por, aprovado_em)
  on priv.precificacoes to vv_worker;

-- Pede o recálculo (interna). Quem muda insumo derruba a aprovação: o preço aprovado deixa de ser o preço calculado.
create function priv.recalcular_preco(p_empresa uuid, p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('calcular_preco', p_empresa, jsonb_build_object('precificacao_id', p_id),
                        'preco:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
$$;
revoke all on function priv.recalcular_preco(uuid, uuid) from public;

create function priv.criar_precificacao(p_empresa uuid, p_participacao uuid, p_produto uuid, p_quantidade numeric)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_item record;
begin
  if not core.has_permission(p_empresa, 'precos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select i.quantidade, i.valor_unitario_estimado into v_item
    from priv.participacoes p join pub.edital_itens i on i.id = p.item_id
   where p.id = p_participacao and p.empresa_id = p_empresa and p.deleted_at is null;
  if not found then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  if p_produto is not null and not exists (select 1 from priv.produtos where id = p_produto and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'produto não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.precificacoes (empresa_id, participacao_id, produto_id, quantidade, valor_estimado_unit)
  values (p_empresa, p_participacao, p_produto, coalesce(p_quantidade, v_item.quantidade, 1), v_item.valor_unitario_estimado)
  returning id into v_id;
  perform priv.recalcular_preco(p_empresa, v_id);
  return v_id;
end;
$$;

create function priv.salvar_parametros_preco(
  p_empresa uuid, p_id uuid, p_quantidade numeric, p_margem_desejada numeric, p_margem_minima numeric, p_casas int, p_arredondamento text,
  p_preco_proposto numeric, p_limite_inexequivel numeric, p_me_epp boolean, p_modalidade text
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'precos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.precificacoes
     set quantidade = p_quantidade, margem_desejada_pct = p_margem_desejada, margem_minima_pct = p_margem_minima, casas_unitario = p_casas,
         arredondamento = p_arredondamento, preco_proposto_unit = p_preco_proposto, limite_inexequivel_pct = p_limite_inexequivel,
         me_epp = coalesce(p_me_epp, false), modalidade_empate = p_modalidade,
         aprovado_por = null, aprovado_em = null, justificativa_abaixo = null
   where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'precificação não encontrada' using errcode = 'no_data_found';
  end if;
  perform priv.recalcular_preco(p_empresa, p_id);
end;
$$;

create function priv.adicionar_linha_preco(p_empresa uuid, p_id uuid, p_nome text, p_tipo text, p_categoria text, p_forma text, p_valor numeric, p_percentual numeric)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_linha uuid;
begin
  if not core.has_permission(p_empresa, 'precos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.precificacoes where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'precificação não encontrada' using errcode = 'no_data_found';
  end if;
  insert into priv.preco_linhas (empresa_id, precificacao_id, nome, tipo, categoria, forma, valor, percentual)
  values (p_empresa, p_id, btrim(p_nome), p_tipo, p_categoria, p_forma, p_valor, p_percentual) returning id into v_linha;
  update priv.precificacoes set aprovado_por = null, aprovado_em = null, justificativa_abaixo = null where id = p_id;
  perform priv.recalcular_preco(p_empresa, p_id);
  return v_linha;
end;
$$;

create function priv.remover_linha_preco(p_empresa uuid, p_linha uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prec uuid;
begin
  if not core.has_permission(p_empresa, 'precos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.preco_linhas set deleted_at = now() where id = p_linha and empresa_id = p_empresa and deleted_at is null returning precificacao_id into v_prec;
  if not found then
    raise exception 'linha não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.precificacoes set aprovado_por = null, aprovado_em = null, justificativa_abaixo = null where id = v_prec;
  perform priv.recalcular_preco(p_empresa, v_prec);
end;
$$;

-- 🧾 O responsável (quem aprova preços) marca a linha como validada (ex.: alíquota conferida pelo contador).
create function priv.validar_linha_preco(p_empresa uuid, p_linha uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'precos', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.preco_linhas set validado_por = core.usuario_atual(), validado_em = now() where id = p_linha and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'linha não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Aprovação comercial (7.6): precisa de resultado calculado sem erro; abaixo do mínimo só com justificativa (>= 10 caracteres).
create function priv.aprovar_preco(p_empresa uuid, p_id uuid, p_justificativa text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'precos', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select calculado_em, erro_calculo, abaixo_do_minimo into v from priv.precificacoes where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'precificação não encontrada' using errcode = 'no_data_found';
  end if;
  if v.calculado_em is null or v.erro_calculo is not null then
    raise exception 'só se aprova um preço calculado sem erro' using errcode = 'invalid_parameter_value';
  end if;
  if v.abaixo_do_minimo and char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'preço abaixo do mínimo exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.precificacoes
     set aprovado_por = core.usuario_atual(), aprovado_em = now(), justificativa_abaixo = case when v.abaixo_do_minimo then btrim(p_justificativa) end
   where id = p_id;
end;
$$;

grant execute on function priv.criar_precificacao(uuid, uuid, uuid, numeric),
  priv.salvar_parametros_preco(uuid, uuid, numeric, numeric, numeric, int, text, numeric, numeric, boolean, text),
  priv.adicionar_linha_preco(uuid, uuid, text, text, text, text, numeric, numeric), priv.remover_linha_preco(uuid, uuid),
  priv.validar_linha_preco(uuid, uuid), priv.aprovar_preco(uuid, uuid, text) to vv_api;

create or replace function ops.enfileirar_pesquisa(p_tipo text, p_empresa uuid, p_payload jsonb, p_chave text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tipo not in ('coletar_fonte', 'detalhar_edital', 'baixar_arquivo_edital', 'verificar_arquivo_edital',
                    'extrair_texto', 'indexar_trechos', 'avaliar_relevancia', 'importar_edital',
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos', 'email_agenda', 'analisar_item', 'calcular_preco') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.aprovar_preco(uuid, uuid, text), priv.validar_linha_preco(uuid, uuid), priv.remover_linha_preco(uuid, uuid),
  priv.adicionar_linha_preco(uuid, uuid, text, text, text, text, numeric, numeric),
  priv.salvar_parametros_preco(uuid, uuid, numeric, numeric, numeric, int, text, numeric, numeric, boolean, text),
  priv.criar_precificacao(uuid, uuid, uuid, numeric), priv.recalcular_preco(uuid, uuid);
drop table priv.preco_linhas, priv.precificacoes;
