-- Fase 11 · Contratos, empenhos, fornecimento, entregas, financeiro e histórico (spec docs/specs/fase-11.md). Dinheiro numeric(18,4).
-- Saldos NUNCA são digitados: o banco recusa empenho acima do saldo do contrato e entrega acima do empenhado; resumo e alertas saem dos registros.
-- Escrita só por função (permissão `contratos`/`financeiro`), auditada, isolada por empresa.

-- migrate:up
create table priv.contratos (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id uuid,
  tipo             text not null default 'contrato' check (tipo in ('contrato', 'ata')),
  numero           text not null check (char_length(numero) between 1 and 80),
  orgao            text not null check (char_length(orgao) between 2 and 200),
  objeto           text not null check (char_length(objeto) between 3 and 2000),
  valor_total      numeric(18, 4) not null default 0 check (valor_total >= 0),
  vigencia_inicio  date not null,
  vigencia_fim     date not null,
  gestor_orgao     text check (char_length(gestor_orgao) <= 200),
  fiscal_orgao     text check (char_length(fiscal_orgao) <= 200),
  garantia_valor   numeric(18, 4) check (garantia_valor >= 0),
  garantia_ate     date,
  status           text not null default 'ativo' check (status in ('ativo', 'encerrado', 'rescindido')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default core.usuario_atual(),
  deleted_at       timestamptz,
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id),
  check (vigencia_fim >= vigencia_inicio),
  unique (id, empresa_id)
);
create unique index contratos_numero_uk on priv.contratos (empresa_id, numero, tipo) where deleted_at is null;

create table priv.contrato_itens (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  contrato_id    uuid not null,
  numero_item    int not null check (numero_item >= 1),
  descricao      text not null check (char_length(descricao) between 2 and 2000),
  unidade        text check (char_length(unidade) <= 40),
  quantidade     numeric(18, 4) not null check (quantidade > 0),
  valor_unitario numeric(18, 4) not null check (valor_unitario >= 0),
  created_at     timestamptz not null default now(),
  foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id) on delete cascade,
  unique (contrato_id, numero_item),
  unique (id, empresa_id)
);

create table priv.empenhos (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  contrato_id    uuid not null,
  tipo           text not null default 'empenho' check (tipo in ('empenho', 'ordem_fornecimento')),
  numero         text not null check (char_length(numero) between 1 and 80),
  emitido_em     date not null,
  prazo_entrega  date,
  etapa          text not null default 'pedido_recebido' check (etapa in ('pedido_recebido', 'pedido_fornecedor', 'aguardando_producao', 'produto_disponivel', 'faturamento_autorizado',
                                                                            'nota_emitida', 'transporte', 'entrega', 'recebimento_provisorio', 'recebimento_definitivo', 'concluido')),
  responsavel_id uuid references core.usuarios (id),
  observacao     text check (char_length(observacao) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id) on delete cascade,
  unique (contrato_id, numero),
  unique (id, empresa_id)
);

create table priv.empenho_itens (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  empenho_id       uuid not null,
  contrato_item_id uuid not null,
  quantidade       numeric(18, 4) not null check (quantidade > 0),
  foreign key (empenho_id, empresa_id) references priv.empenhos (id, empresa_id) on delete cascade,
  foreign key (contrato_item_id, empresa_id) references priv.contrato_itens (id, empresa_id),
  unique (empenho_id, contrato_item_id),
  unique (id, empresa_id)
);

create table priv.empenho_etapas (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  empenho_id  uuid not null,
  etapa       text not null,
  quando      timestamptz not null default now(),
  por         uuid default core.usuario_atual(),
  observacao  text check (char_length(observacao) <= 1000),
  foreign key (empenho_id, empresa_id) references priv.empenhos (id, empresa_id) on delete cascade
);

create table priv.entregas (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  empenho_item_id  uuid not null,
  quantidade       numeric(18, 4) not null check (quantidade > 0),
  entregue_em      date not null,
  recebimento      text not null default 'provisorio' check (recebimento in ('provisorio', 'definitivo')),
  observacao       text check (char_length(observacao) <= 1000),
  created_at       timestamptz not null default now(),
  created_by       uuid default core.usuario_atual(),
  foreign key (empenho_item_id, empresa_id) references priv.empenho_itens (id, empresa_id) on delete cascade
);

create table priv.faturas (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  contrato_id    uuid not null,
  empenho_id     uuid,
  numero_nf      text not null check (char_length(numero_nf) between 1 and 60),
  emitida_em     date not null,
  valor          numeric(18, 4) not null check (valor > 0),
  retencoes      numeric(18, 4) not null default 0 check (retencoes >= 0),
  vencimento     date not null,
  pago_em        date,
  valor_recebido numeric(18, 4) check (valor_recebido >= 0),
  ocorrencia     text check (char_length(ocorrencia) <= 1000),
  created_at     timestamptz not null default now(),
  created_by     uuid default core.usuario_atual(),
  foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id) on delete cascade,
  foreign key (empenho_id, empresa_id) references priv.empenhos (id, empresa_id),
  check (retencoes <= valor),
  check ((pago_em is null) = (valor_recebido is null)),
  unique (contrato_id, numero_nf)
);

create table priv.contrato_eventos (
  id            uuid primary key default core.uuid_v7(),
  empresa_id    uuid not null references core.empresas (id) on delete cascade,
  contrato_id   uuid not null,
  tipo          text not null check (tipo in ('aditivo', 'apostilamento', 'prorrogacao', 'reajuste', 'reequilibrio', 'ocorrencia')),
  data          date not null,
  descricao     text not null check (char_length(descricao) between 3 and 2000),
  valor_antes   numeric(18, 4),
  valor_depois  numeric(18, 4),
  vigencia_antes date,
  vigencia_depois date,
  registrado_em timestamptz not null default now(),
  registrado_por uuid default core.usuario_atual(),
  foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array['contratos', 'contrato_itens', 'empenhos', 'empenho_itens', 'empenho_etapas', 'entregas', 'contrato_eventos'] loop
    execute format('alter table priv.%I enable row level security', t);
    execute format('create policy %I on priv.%I for select to vv_api using (core.has_permission(empresa_id, ''contratos'', ''visualizar''))', t || '_select', t);
    execute format('grant select on priv.%I to vv_api', t);
    execute format('create index %I on priv.%I (empresa_id)', t || '_empresa_idx', t);
    execute format('create trigger %I after insert or update on priv.%I for each row execute function audit.registrar()', t || '_audit', t);
    execute format('alter table priv.%I enable always trigger %I', t, t || '_audit');
  end loop;
end $$;
alter table priv.faturas enable row level security;
create policy faturas_select on priv.faturas for select to vv_api using (core.has_permission(empresa_id, 'financeiro', 'visualizar'));
grant select on priv.faturas to vv_api;
create index faturas_empresa_idx on priv.faturas (empresa_id);
create trigger faturas_audit after insert or update on priv.faturas for each row execute function audit.registrar();
alter table priv.faturas enable always trigger faturas_audit;
create trigger contratos_updated_at before update on priv.contratos for each row execute function core.set_updated_at();
create trigger empenhos_updated_at before update on priv.empenhos for each row execute function core.set_updated_at();

-- ---------------------------------------------------------------- funções
create function priv.criar_contrato(p_empresa uuid, p_acomp uuid, p_tipo text, p_numero text, p_orgao text, p_objeto text, p_inicio date, p_fim date, p_gestor text, p_fiscal text, p_garantia_valor numeric, p_garantia_ate date)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not core.has_permission(p_empresa, 'contratos', 'cadastrar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  insert into priv.contratos (empresa_id, acompanhamento_id, tipo, numero, orgao, objeto, vigencia_inicio, vigencia_fim, gestor_orgao, fiscal_orgao, garantia_valor, garantia_ate)
  values (p_empresa, p_acomp, p_tipo, btrim(p_numero), btrim(p_orgao), btrim(p_objeto), p_inicio, p_fim, nullif(btrim(p_gestor), ''), nullif(btrim(p_fiscal), ''), p_garantia_valor, p_garantia_ate)
  returning id into v_id;
  return v_id;
end;
$$;

-- Item do contrato; o valor total do contrato é SEMPRE a soma dos itens (nunca digitado).
create function priv.adicionar_item_contrato(p_empresa uuid, p_contrato uuid, p_numero int, p_descricao text, p_unidade text, p_quantidade numeric, p_valor_unitario numeric)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null) then raise exception 'contrato não encontrado' using errcode = 'no_data_found'; end if;
  insert into priv.contrato_itens (empresa_id, contrato_id, numero_item, descricao, unidade, quantidade, valor_unitario)
  values (p_empresa, p_contrato, p_numero, btrim(p_descricao), nullif(btrim(p_unidade), ''), p_quantidade, p_valor_unitario) returning id into v_id;
  update priv.contratos set valor_total = (select coalesce(sum(quantidade * valor_unitario), 0) from priv.contrato_itens where contrato_id = p_contrato) where id = p_contrato;
  return v_id;
end;
$$;

-- Empenho/ordem com seus itens ([{"contrato_item_id": "...", "quantidade": "10"}]). Quantidade acima do SALDO do contrato é recusada.
create function priv.registrar_empenho(p_empresa uuid, p_contrato uuid, p_tipo text, p_numero text, p_emitido date, p_prazo date, p_responsavel uuid, p_itens jsonb)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_it record;
  v_saldo numeric;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo') then
    raise exception 'contrato ativo não encontrado' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'informe ao menos um item' using errcode = 'invalid_parameter_value'; end if;
  insert into priv.empenhos (empresa_id, contrato_id, tipo, numero, emitido_em, prazo_entrega, responsavel_id) values (p_empresa, p_contrato, p_tipo, btrim(p_numero), p_emitido, p_prazo, p_responsavel) returning id into v_id;
  insert into priv.empenho_etapas (empresa_id, empenho_id, etapa) values (p_empresa, v_id, 'pedido_recebido');
  for v_it in select (x ->> 'contrato_item_id')::uuid as item, (x ->> 'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) x loop
    select ci.quantidade - coalesce((select sum(ei.quantidade) from priv.empenho_itens ei where ei.contrato_item_id = ci.id), 0) into v_saldo
      from priv.contrato_itens ci where ci.id = v_it.item and ci.empresa_id = p_empresa and ci.contrato_id = p_contrato;
    if v_saldo is null then raise exception 'item não pertence ao contrato' using errcode = 'invalid_parameter_value'; end if;
    if v_it.qtd is null or v_it.qtd <= 0 or v_it.qtd > v_saldo then raise exception 'quantidade acima do saldo do contrato (saldo %)', v_saldo using errcode = 'invalid_parameter_value'; end if;
    insert into priv.empenho_itens (empresa_id, empenho_id, contrato_item_id, quantidade) values (p_empresa, v_id, v_it.item, v_it.qtd);
  end loop;
  return v_id;
end;
$$;

create function priv.mudar_etapa_empenho(p_empresa uuid, p_empenho uuid, p_etapa text, p_obs text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  update priv.empenhos set etapa = p_etapa, observacao = coalesce(nullif(btrim(p_obs), ''), observacao) where id = p_empenho and empresa_id = p_empresa;
  if not found then raise exception 'empenho não encontrado' using errcode = 'no_data_found'; end if;
  insert into priv.empenho_etapas (empresa_id, empenho_id, etapa, observacao) values (p_empresa, p_empenho, p_etapa, nullif(btrim(p_obs), ''));
end;
$$;

-- Entrega parcial: a soma das entregas de um item de empenho nunca passa do empenhado.
create function priv.registrar_entrega(p_empresa uuid, p_empenho_item uuid, p_quantidade numeric, p_data date, p_recebimento text, p_obs text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_saldo numeric;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  select ei.quantidade - coalesce((select sum(e.quantidade) from priv.entregas e where e.empenho_item_id = ei.id), 0) into v_saldo
    from priv.empenho_itens ei where ei.id = p_empenho_item and ei.empresa_id = p_empresa;
  if v_saldo is null then raise exception 'item de empenho não encontrado' using errcode = 'no_data_found'; end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > v_saldo then raise exception 'entrega acima do saldo empenhado (saldo %)', v_saldo using errcode = 'invalid_parameter_value'; end if;
  insert into priv.entregas (empresa_id, empenho_item_id, quantidade, entregue_em, recebimento, observacao) values (p_empresa, p_empenho_item, p_quantidade, p_data, p_recebimento, nullif(btrim(p_obs), '')) returning id into v_id;
  return v_id;
end;
$$;

create function priv.registrar_fatura(p_empresa uuid, p_contrato uuid, p_empenho uuid, p_nf text, p_emissao date, p_valor numeric, p_retencoes numeric, p_vencimento date)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_saldo numeric;
begin
  if not core.has_permission(p_empresa, 'financeiro', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  select c.valor_total - coalesce((select sum(f.valor) from priv.faturas f where f.contrato_id = c.id), 0) into v_saldo from priv.contratos c where c.id = p_contrato and c.empresa_id = p_empresa and c.deleted_at is null;
  if v_saldo is null then raise exception 'contrato não encontrado' using errcode = 'no_data_found'; end if;
  if p_valor > v_saldo then raise exception 'faturamento acima do saldo do contrato (saldo %)', v_saldo using errcode = 'invalid_parameter_value'; end if;
  insert into priv.faturas (empresa_id, contrato_id, empenho_id, numero_nf, emitida_em, valor, retencoes, vencimento) values (p_empresa, p_contrato, p_empenho, btrim(p_nf), p_emissao, p_valor, coalesce(p_retencoes, 0), p_vencimento) returning id into v_id;
  return v_id;
end;
$$;

-- Pagamento (parcial ou total no mesmo registro: recebido pode ser menor que valor - retenções; a diferença fica como pendente e a ocorrência a explica).
create function priv.registrar_pagamento(p_empresa uuid, p_fatura uuid, p_pago_em date, p_valor_recebido numeric, p_ocorrencia text)
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

-- Aditivo, apostilamento, prorrogação, reajuste, reequilíbrio ou ocorrência: fica no histórico com o efeito no valor e na vigência.
create function priv.registrar_evento_contrato(p_empresa uuid, p_contrato uuid, p_tipo text, p_data date, p_descricao text, p_novo_valor numeric, p_nova_vigencia date)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_c record;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  select valor_total, vigencia_fim into v_c from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null;
  if not found then raise exception 'contrato não encontrado' using errcode = 'no_data_found'; end if;
  if p_nova_vigencia is not null and p_nova_vigencia < v_c.vigencia_fim and p_tipo <> 'ocorrencia' then raise exception 'a nova vigência não pode ser anterior à atual' using errcode = 'invalid_parameter_value'; end if;
  insert into priv.contrato_eventos (empresa_id, contrato_id, tipo, data, descricao, valor_antes, valor_depois, vigencia_antes, vigencia_depois)
  values (p_empresa, p_contrato, p_tipo, p_data, btrim(p_descricao), case when p_novo_valor is not null then v_c.valor_total end, p_novo_valor, case when p_nova_vigencia is not null then v_c.vigencia_fim end, p_nova_vigencia)
  returning id into v_id;
  if p_novo_valor is not null then update priv.contratos set valor_total = p_novo_valor where id = p_contrato; end if;
  if p_nova_vigencia is not null then update priv.contratos set vigencia_fim = p_nova_vigencia where id = p_contrato; end if;
  return v_id;
end;
$$;

create function priv.encerrar_contrato(p_empresa uuid, p_contrato uuid, p_status text)
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

grant execute on function priv.criar_contrato(uuid, uuid, text, text, text, text, date, date, text, text, numeric, date), priv.adicionar_item_contrato(uuid, uuid, int, text, text, numeric, numeric),
  priv.registrar_empenho(uuid, uuid, text, text, date, date, uuid, jsonb), priv.mudar_etapa_empenho(uuid, uuid, text, text), priv.registrar_entrega(uuid, uuid, numeric, date, text, text),
  priv.registrar_fatura(uuid, uuid, uuid, text, date, numeric, numeric, date), priv.registrar_pagamento(uuid, uuid, date, numeric, text),
  priv.registrar_evento_contrato(uuid, uuid, text, date, text, numeric, date), priv.encerrar_contrato(uuid, uuid, text) to vv_api;

-- migrate:down
drop function priv.encerrar_contrato(uuid, uuid, text), priv.registrar_evento_contrato(uuid, uuid, text, date, text, numeric, date), priv.registrar_pagamento(uuid, uuid, date, numeric, text),
  priv.registrar_fatura(uuid, uuid, uuid, text, date, numeric, numeric, date), priv.registrar_entrega(uuid, uuid, numeric, date, text, text), priv.mudar_etapa_empenho(uuid, uuid, text, text),
  priv.registrar_empenho(uuid, uuid, text, text, date, date, uuid, jsonb), priv.adicionar_item_contrato(uuid, uuid, int, text, text, numeric, numeric),
  priv.criar_contrato(uuid, uuid, text, text, text, text, date, date, text, text, numeric, date);
drop table priv.contrato_eventos, priv.faturas, priv.entregas, priv.empenho_etapas, priv.empenho_itens, priv.empenhos, priv.contrato_itens, priv.contratos;
