-- Fase 06 · Análise técnica (núcleo sem IA). Spec: docs/specs/fase-06.md.
--
-- * priv.requisitos_item: o que o edital exige para uma participação (um item), com citação literal e página.
-- * priv.analise_linhas: matriz requisito x produto. QUEM CLASSIFICA É O WORKER (rules/comparacao.py): a API nunca
--   grava resultado. A pessoa só registra a evidência da ficha técnica (conferência) e a ressalva.
-- * priv.analises_item: resumo do item e a aprovação técnica (quem e quando); mudar o resultado invalida a aprovação.
-- Toda gravação é por função (permissão do módulo `analises` e validação no banco); auditoria nas três tabelas.

-- migrate:up
create unique index participacoes_id_empresa_uk on priv.participacoes (id, empresa_id);

create table priv.requisitos_item (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  participacao_id  uuid not null,
  nome             text not null check (char_length(nome) between 2 and 200),
  tipo_exigencia   text not null default 'obrigatorio' check (tipo_exigencia in ('obrigatorio', 'minimo', 'maximo', 'faixa', 'opcional', 'fabrica',
                                                                                'certificacao', 'garantia', 'instalacao', 'assistencia', 'prazo_entrega', 'outro')),
  atributo_id      uuid references pub.atributos_def (id),
  operador         text not null check (operador in ('>=', '<=', '=', 'entre', 'contem', 'sim', 'nao')),
  valor_numero     numeric(30, 12),
  valor_max        numeric(30, 12),
  valor_texto      text check (char_length(valor_texto) <= 500),
  unidade_id       uuid references pub.unidades (id),
  obrigatorio      boolean not null default true,
  citacao_edital   text check (char_length(citacao_edital) <= 2000),
  pagina           int check (pagina >= 1),
  origem           text not null default 'manual' check (origem in ('manual', 'ia')),
  modelo_ia        text check (char_length(modelo_ia) <= 100),
  prompt_versao    text check (char_length(prompt_versao) <= 40),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default core.usuario_atual(),
  deleted_at       timestamptz,
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  check (operador not in ('>=', '<=', '=', 'entre') or valor_numero is not null or (operador = '=' and valor_texto is not null)),
  check (operador <> 'entre' or valor_max is not null),
  check (operador <> 'contem' or valor_texto is not null),
  unique (id, empresa_id)
);
create index requisitos_item_part_idx on priv.requisitos_item (participacao_id) where deleted_at is null;
create index requisitos_item_empresa_idx on priv.requisitos_item (empresa_id);

create table priv.analises_item (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  participacao_id  uuid not null,
  produto_id       uuid not null,
  resumo           text check (resumo in ('COMPATÍVEL', 'COMPATÍVEL COM RESSALVAS', 'PENDENTE', 'REPROVADO')),
  hash_resultado   text,
  calculado_em     timestamptz,
  solicitada_em    timestamptz not null default now(),
  solicitada_por   uuid default core.usuario_atual(),
  aprovado_por     uuid references core.usuarios (id),
  aprovado_em      timestamptz,
  aprovado_resumo  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  foreign key (produto_id, empresa_id) references priv.produtos (id, empresa_id) on delete cascade,
  check ((aprovado_por is null) = (aprovado_em is null)),
  unique (participacao_id, produto_id),
  unique (id, empresa_id)
);
create index analises_item_empresa_idx on priv.analises_item (empresa_id);

create table priv.analise_linhas (
  id                      uuid primary key default core.uuid_v7(),
  empresa_id              uuid not null references core.empresas (id) on delete cascade,
  analise_id              uuid not null,
  requisito_id            uuid not null,
  resultado               text not null check (resultado in ('ATENDE', 'ATENDE COM RESSALVAS', 'A CONFIRMAR', 'NÃO ATENDE')),
  valor_oferecido         text check (char_length(valor_oferecido) <= 200),
  citacao_verificada      boolean not null default false,
  pagina_edital           int check (pagina_edital >= 1),
  ficha_trecho            text check (char_length(ficha_trecho) <= 2000),
  ficha_pagina            int check (ficha_pagina >= 1),
  ficha_documento_id      uuid,
  ficha_conferida_por     uuid references core.usuarios (id),
  ficha_conferida_em      timestamptz,
  ressalva                text check (char_length(ressalva) <= 500),
  justificativa           text,
  pendencia               text,
  calculado_em            timestamptz not null default now(),
  foreign key (analise_id, empresa_id) references priv.analises_item (id, empresa_id) on delete cascade,
  foreign key (requisito_id, empresa_id) references priv.requisitos_item (id, empresa_id) on delete cascade,
  foreign key (ficha_documento_id, empresa_id) references priv.documentos (id, empresa_id),
  check ((ficha_conferida_por is null) = (ficha_conferida_em is null)),
  check (ficha_conferida_por is null or (ficha_trecho is not null and ficha_pagina is not null and ficha_documento_id is not null)),
  unique (analise_id, requisito_id),
  unique (id, empresa_id)
);
create index analise_linhas_empresa_idx on priv.analise_linhas (empresa_id);

alter table priv.requisitos_item enable row level security;
alter table priv.analises_item enable row level security;
alter table priv.analise_linhas enable row level security;
do $$
declare t text;
begin
  foreach t in array array['requisitos_item', 'analises_item', 'analise_linhas'] loop
    execute format('create policy %I on priv.%I for select to vv_api using (core.has_permission(empresa_id, ''analises'', ''visualizar''))', t || '_select', t);
    execute format('grant select on priv.%I to vv_api', t);
    execute format('create trigger %I after insert or update on priv.%I for each row execute function audit.registrar()', t || '_audit', t);
    execute format('alter table priv.%I enable always trigger %I', t, t || '_audit');
  end loop;
end $$;
create trigger requisitos_item_updated_at before update on priv.requisitos_item for each row execute function core.set_updated_at();
create trigger analises_item_updated_at before update on priv.analises_item for each row execute function core.set_updated_at();

-- O worker lê o necessário e grava SÓ o que classifica (a API não grava resultado).
grant select on priv.requisitos_item, priv.analises_item, priv.analise_linhas to vv_worker;
grant insert, update on priv.analise_linhas to vv_worker;
grant update (resumo, hash_resultado, calculado_em, aprovado_por, aprovado_em, aprovado_resumo) on priv.analises_item to vv_worker;
grant select (id, empresa_id, codigo_interno, marca, modelo, garantia_meses, prazo_entrega_dias, ficha_documento_id, deleted_at) on priv.produtos to vv_worker;
grant select on priv.produto_atributos to vv_worker;
grant select (id, acompanhamento_id, empresa_id, item_id, deleted_at) on priv.participacoes to vv_worker;
grant select on pub.unidades, pub.atributos_def to vv_worker;

-- ---------------------------------------------------------------- funções
create function priv.criar_requisito(
  p_empresa uuid, p_participacao uuid, p_nome text, p_tipo text, p_atributo uuid, p_operador text, p_numero numeric, p_max numeric,
  p_texto text, p_unidade uuid, p_obrigatorio boolean, p_citacao text, p_pagina int
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  insert into priv.requisitos_item (empresa_id, participacao_id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_max, valor_texto,
                                   unidade_id, obrigatorio, citacao_edital, pagina)
  values (p_empresa, p_participacao, btrim(p_nome), p_tipo, p_atributo, p_operador, p_numero, p_max, nullif(btrim(p_texto), ''), p_unidade,
          coalesce(p_obrigatorio, true), nullif(btrim(p_citacao), ''), p_pagina)
  returning id into v_id;
  perform priv.reanalisar_participacao(p_empresa, p_participacao);
  return v_id;
end;
$$;

create function priv.remover_requisito(p_empresa uuid, p_requisito uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_part uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.requisitos_item set deleted_at = now() where id = p_requisito and empresa_id = p_empresa and deleted_at is null returning participacao_id into v_part;
  if not found then
    raise exception 'requisito não encontrado' using errcode = 'no_data_found';
  end if;
  perform priv.reanalisar_participacao(p_empresa, v_part);
end;
$$;

-- Enfileira a (re)análise de todos os produtos já analisados nesta participação (interna: sem grant).
create function priv.reanalisar_participacao(p_empresa uuid, p_participacao uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('analisar_item', p_empresa, jsonb_build_object('analise_id', a.id),
                        'analise:' || a.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
    from priv.analises_item a where a.empresa_id = p_empresa and a.participacao_id = p_participacao
$$;
revoke all on function priv.reanalisar_participacao(uuid, uuid) from public;

-- Pede a análise de um produto para a participação (idempotente).
create function priv.analisar_item(p_empresa uuid, p_participacao uuid, p_produto uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null)
     or not exists (select 1 from priv.produtos where id = p_produto and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'participação ou produto não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.analises_item (empresa_id, participacao_id, produto_id) values (p_empresa, p_participacao, p_produto)
  on conflict (participacao_id, produto_id) do update set solicitada_em = now(), solicitada_por = core.usuario_atual()
  returning id into v_id;
  perform ops.enfileirar('analisar_item', p_empresa, jsonb_build_object('analise_id', v_id),
                         'analise:' || v_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  return v_id;
end;
$$;

-- A pessoa confere a evidência na ficha técnica (documento, página e trecho) e, se quiser, registra uma ressalva.
-- Isto NÃO muda a classificação: ela é recalculada pelo worker.
create function priv.conferir_ficha(p_empresa uuid, p_linha uuid, p_documento uuid, p_pagina int, p_trecho text, p_ressalva text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_analise uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_documento is null or p_pagina is null or p_trecho is null or char_length(btrim(p_trecho)) < 5 then
    raise exception 'informe documento, página e o trecho da ficha técnica' using errcode = 'invalid_parameter_value';
  end if;
  update priv.analise_linhas
     set ficha_documento_id = p_documento, ficha_pagina = p_pagina, ficha_trecho = btrim(p_trecho), ressalva = nullif(btrim(p_ressalva), ''),
         ficha_conferida_por = core.usuario_atual(), ficha_conferida_em = now()
   where id = p_linha and empresa_id = p_empresa
   returning analise_id into v_analise;
  if not found then
    raise exception 'linha não encontrada' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('analisar_item', p_empresa, jsonb_build_object('analise_id', v_analise),
                         'analise:' || v_analise || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;

-- Aprovação técnica do item (6.9): registra quem e quando e o resumo aprovado. Não altera classificação nenhuma.
create function priv.aprovar_analise(p_empresa uuid, p_analise uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_resumo text;
begin
  if not core.has_permission(p_empresa, 'analises', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select resumo into v_resumo from priv.analises_item where id = p_analise and empresa_id = p_empresa;
  if not found then
    raise exception 'análise não encontrada' using errcode = 'no_data_found';
  end if;
  if v_resumo is null or v_resumo = 'PENDENTE' then
    raise exception 'só se aprova uma análise sem pendências (resolva os "A CONFIRMAR")' using errcode = 'invalid_parameter_value';
  end if;
  update priv.analises_item set aprovado_por = core.usuario_atual(), aprovado_em = now(), aprovado_resumo = v_resumo where id = p_analise;
end;
$$;

grant execute on function priv.criar_requisito(uuid, uuid, text, text, uuid, text, numeric, numeric, text, uuid, boolean, text, int),
  priv.remover_requisito(uuid, uuid), priv.analisar_item(uuid, uuid, uuid), priv.conferir_ficha(uuid, uuid, uuid, int, text, text),
  priv.aprovar_analise(uuid, uuid) to vv_api;

-- O worker pode enfileirar a (re)análise (por exemplo, quando o produto muda) pela lista fechada.
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
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos', 'email_agenda', 'analisar_item') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.aprovar_analise(uuid, uuid), priv.conferir_ficha(uuid, uuid, uuid, int, text, text), priv.analisar_item(uuid, uuid, uuid),
  priv.reanalisar_participacao(uuid, uuid), priv.remover_requisito(uuid, uuid),
  priv.criar_requisito(uuid, uuid, text, text, uuid, text, numeric, numeric, text, uuid, boolean, text, int);
drop table priv.analise_linhas, priv.analises_item, priv.requisitos_item;
drop index priv.participacoes_id_empresa_uk;
