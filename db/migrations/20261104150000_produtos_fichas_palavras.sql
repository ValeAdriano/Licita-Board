-- Fase 02 · PRs 7, 8 e 9 · Produtos da empresa, atributos técnicos, fichas técnicas versionadas e palavras-chave
-- (spec fase-02 §3.3; RF-02.9, RF-02.11, RF-02.12; Prompt 2.3, 2.4, 2.5). Primeiras tabelas de priv.
--
-- * Dado comercial segregado por construção: o modelo técnico é compartilhado (pub.modelos, sem preço);
--   o produto é da empresa (priv.produtos) e o CUSTO e o PREÇO DE REFERÊNCIA ficam em tabela à parte
--   (priv.produto_precos) que só quem tem produtos/ver_custos_margens lê (spec pergunta 9).
-- * Atributos técnicos do produto: mesmos tipos e unidades do catálogo (pub.validar_valor_atributo).
-- * Fichas técnicas: histórico (só nova versão; a anterior vira 'substituida'; o conteúdo não se reescreve).
-- * Palavras-chave e filtros: só cadastro (a pontuação de relevância é da Fase 04; exclusão NUNCA elimina).
-- * Módulo de permissão: produtos (palavras-chave reusam, spec pergunta 7). FK com cascade: a exclusão
--   definitiva da empresa leva tudo (teste 080).
-- * ⚠️ Antes de uso real: teste de isolamento A x B por tabela em db/tests/isolamento/ (AGENTS.md §0 e regra 13).
-- * Dinheiro em numeric(18,4).

-- migrate:up
create table priv.produtos (
  id                    uuid primary key default core.uuid_v7(),
  empresa_id            uuid not null references core.empresas (id) on delete cascade,
  modelo_id             uuid references pub.modelos (id),
  categoria_id          uuid not null references pub.categorias (id),
  subcategoria_id       uuid references pub.categorias (id),
  codigo_interno        text not null check (char_length(codigo_interno) between 1 and 60),
  marca                 text check (char_length(marca) <= 120),
  modelo                text check (char_length(modelo) <= 120),
  versao                text check (char_length(versao) <= 120),
  descricao             text not null check (char_length(descricao) between 2 and 2000),
  unidade_fornecimento_id uuid references pub.unidades (id),
  prazo_entrega_dias    int check (prazo_entrega_dias >= 0),
  garantia_meses        int check (garantia_meses >= 0),
  disponibilidade       text check (disponibilidade in ('imediata', 'sob_encomenda', 'indisponivel')),
  fornecedor            text check (char_length(fornecedor) <= 200),
  status_comercial      text not null default 'ativo' check (status_comercial in ('ativo', 'suspenso', 'descontinuado')),
  catalogo_documento_id uuid,  -- Fase 03
  ficha_documento_id    uuid,  -- Fase 03
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid default core.usuario_atual(),
  deleted_at            timestamptz,
  unique (id, empresa_id)
);
create unique index produtos_codigo_uk on priv.produtos (empresa_id, codigo_interno) where deleted_at is null;
create index produtos_empresa_idx on priv.produtos (empresa_id);
create index produtos_modelo_idx on priv.produtos (modelo_id);

create table priv.produto_precos (
  produto_id        uuid primary key,
  empresa_id        uuid not null,
  preco_custo       numeric(18, 4) check (preco_custo >= 0),
  preco_referencia  numeric(18, 4) check (preco_referencia >= 0),
  updated_at        timestamptz not null default now(),
  foreign key (produto_id, empresa_id) references priv.produtos (id, empresa_id) on delete cascade
);
create index produto_precos_empresa_idx on priv.produto_precos (empresa_id);

create table priv.produto_atributos (
  produto_id      uuid not null,
  empresa_id      uuid not null,
  atributo_id     uuid not null references pub.atributos_def (id),
  valor_numero    numeric(30, 12),
  valor_texto     text check (char_length(valor_texto) <= 500),
  valor_booleano  boolean,
  unidade_id      uuid references pub.unidades (id),
  primary key (produto_id, atributo_id),
  foreign key (produto_id, empresa_id) references priv.produtos (id, empresa_id) on delete cascade
);
create index produto_atributos_empresa_idx on priv.produto_atributos (empresa_id);
create function priv.produto_atributos_validar() returns trigger language plpgsql set search_path = '' as $$
begin
  perform pub.validar_valor_atributo(new.atributo_id, new.valor_numero, new.valor_texto, new.valor_booleano, new.unidade_id);
  return new;
end;
$$;
create trigger produto_atributos_validar before insert or update on priv.produto_atributos
  for each row execute function priv.produto_atributos_validar();

create table priv.fichas_tecnicas (
  id              uuid primary key default core.uuid_v7(),
  empresa_id      uuid not null references core.empresas (id) on delete cascade,
  produto_id      uuid not null,
  modelo_id       uuid references pub.modelos (id),
  versao_ficha    int not null check (versao_ficha >= 1),
  fabricante      text not null check (char_length(fabricante) between 1 and 120),
  modelo          text not null check (char_length(modelo) between 1 and 120),
  versao_produto  text check (char_length(versao_produto) <= 120),
  ano             int check (ano between 1900 and 2100),
  data_emissao    date,
  fonte_oficial   text check (char_length(fonte_oficial) <= 300),
  documento_id    uuid,  -- Fase 03
  situacao        text not null default 'vigente' check (situacao in ('vigente', 'vencida', 'substituida', 'descontinuada')),
  valida_ate      date,
  created_at      timestamptz not null default now(),
  created_by      uuid default core.usuario_atual(),
  unique (produto_id, versao_ficha),
  foreign key (produto_id, empresa_id) references priv.produtos (id, empresa_id) on delete cascade
);
create index fichas_empresa_idx on priv.fichas_tecnicas (empresa_id);
-- Histórico: o conteúdo nunca é reescrito; só a situação muda (a nova versão marca a anterior como substituída).
create function priv.fichas_somente_situacao() returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'situacao') is distinct from (to_jsonb(old) - 'situacao') then
    raise exception 'ficha técnica é histórico: só a situação muda; crie uma nova versão' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger fichas_historico before update on priv.fichas_tecnicas
  for each row execute function priv.fichas_somente_situacao();

create table priv.palavras_chave (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  tipo               text not null check (tipo in ('palavra', 'sinonimo', 'categoria', 'marca', 'modelo', 'relacionado', 'exclusao')),
  termo              text not null check (char_length(termo) between 1 and 120),
  termo_normalizado  text not null check (char_length(termo_normalizado) between 1 and 120),
  grupo_id           uuid references priv.palavras_chave (id) on delete set null,
  ativo              boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default core.usuario_atual(),
  deleted_at         timestamptz
);
create unique index palavras_chave_uk on priv.palavras_chave (empresa_id, tipo, termo_normalizado) where deleted_at is null;
create index palavras_chave_empresa_idx on priv.palavras_chave (empresa_id);

create table priv.palavras_chave_filtros (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  tipo        text not null check (tipo in ('uf', 'municipio', 'faixa_valor', 'restricao')),
  uf          text check (uf in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  municipio   text check (char_length(municipio) <= 100),
  valor_min   numeric(18, 4) check (valor_min >= 0),
  valor_max   numeric(18, 4) check (valor_max >= 0),
  texto       text check (char_length(texto) <= 300),
  created_at  timestamptz not null default now(),
  created_by  uuid default core.usuario_atual(),
  deleted_at  timestamptz,
  check ((tipo = 'uf' and uf is not null)
      or (tipo = 'municipio' and municipio is not null and uf is not null)
      or (tipo = 'faixa_valor' and (valor_min is not null or valor_max is not null) and (valor_min is null or valor_max is null or valor_min <= valor_max))
      or (tipo = 'restricao' and texto is not null))
);
create index palavras_filtros_empresa_idx on priv.palavras_chave_filtros (empresa_id);

alter table priv.produtos enable row level security;
alter table priv.produto_precos enable row level security;
alter table priv.produto_atributos enable row level security;
alter table priv.fichas_tecnicas enable row level security;
alter table priv.palavras_chave enable row level security;
alter table priv.palavras_chave_filtros enable row level security;

-- Policies por operação. Produtos e filhos: visualizar / cadastrar / editar (arquivar via update com a ação arquivar).
do $$
declare t text;
begin
  foreach t in array array['produtos', 'produto_atributos', 'fichas_tecnicas', 'palavras_chave', 'palavras_chave_filtros'] loop
    execute format('create policy %I on priv.%I for select to vv_api using (core.has_permission(empresa_id, ''produtos'', ''visualizar''))', t || '_select', t);
    execute format('create policy %I on priv.%I for insert to vv_api with check (core.has_permission(empresa_id, ''produtos'', ''cadastrar''))', t || '_insert', t);
    execute format('create policy %I on priv.%I for update to vv_api using (core.has_permission(empresa_id, ''produtos'', ''editar'') or core.has_permission(empresa_id, ''produtos'', ''arquivar'')) with check (core.has_permission(empresa_id, ''produtos'', ''editar'') or core.has_permission(empresa_id, ''produtos'', ''arquivar''))', t || '_update', t);
  end loop;
end $$;
-- Atributos do produto se corrigem apagando e regravando (sem soft delete): delete exige editar.
create policy produto_atributos_delete on priv.produto_atributos for delete to vv_api
  using (core.has_permission(empresa_id, 'produtos', 'editar'));
-- Custo e preço de referência: só com ver_custos_margens (leitura) e editar + ver_custos_margens (escrita).
create policy produto_precos_select on priv.produto_precos for select to vv_api
  using (core.has_permission(empresa_id, 'produtos', 'ver_custos_margens'));
create policy produto_precos_insert on priv.produto_precos for insert to vv_api
  with check (core.has_permission(empresa_id, 'produtos', 'ver_custos_margens') and core.has_permission(empresa_id, 'produtos', 'editar'));
create policy produto_precos_update on priv.produto_precos for update to vv_api
  using (core.has_permission(empresa_id, 'produtos', 'ver_custos_margens') and core.has_permission(empresa_id, 'produtos', 'editar'))
  with check (core.has_permission(empresa_id, 'produtos', 'ver_custos_margens') and core.has_permission(empresa_id, 'produtos', 'editar'));

grant select on priv.produtos, priv.produto_precos, priv.produto_atributos, priv.fichas_tecnicas, priv.palavras_chave, priv.palavras_chave_filtros to vv_api;
grant insert (empresa_id, modelo_id, categoria_id, subcategoria_id, codigo_interno, marca, modelo, versao, descricao,
              unidade_fornecimento_id, prazo_entrega_dias, garantia_meses, disponibilidade, fornecedor, status_comercial)
  on priv.produtos to vv_api;
grant update (modelo_id, categoria_id, subcategoria_id, codigo_interno, marca, modelo, versao, descricao, unidade_fornecimento_id,
              prazo_entrega_dias, garantia_meses, disponibilidade, fornecedor, status_comercial, deleted_at)
  on priv.produtos to vv_api;
grant insert (produto_id, empresa_id, preco_custo, preco_referencia), update (preco_custo, preco_referencia, updated_at) on priv.produto_precos to vv_api;
grant insert (produto_id, empresa_id, atributo_id, valor_numero, valor_texto, valor_booleano, unidade_id),
      update (valor_numero, valor_texto, valor_booleano, unidade_id), delete on priv.produto_atributos to vv_api;
grant insert (empresa_id, produto_id, modelo_id, versao_ficha, fabricante, modelo, versao_produto, ano, data_emissao, fonte_oficial, situacao, valida_ate),
      update (situacao) on priv.fichas_tecnicas to vv_api;
grant insert (empresa_id, tipo, termo, termo_normalizado, grupo_id), update (termo, termo_normalizado, ativo, deleted_at) on priv.palavras_chave to vv_api;
grant insert (empresa_id, tipo, uf, municipio, valor_min, valor_max, texto), update (uf, municipio, valor_min, valor_max, texto, deleted_at) on priv.palavras_chave_filtros to vv_api;

create trigger produtos_updated_at before update on priv.produtos for each row execute function core.set_updated_at();
create trigger produto_precos_updated_at before update on priv.produto_precos for each row execute function core.set_updated_at();
create trigger palavras_chave_updated_at before update on priv.palavras_chave for each row execute function core.set_updated_at();
create trigger produtos_audit after insert or update or delete on priv.produtos for each row execute function audit.registrar();
create trigger produto_precos_audit after insert or update or delete on priv.produto_precos for each row execute function audit.registrar('empresa_id', 'preco_custo,preco_referencia');
create trigger fichas_audit after insert or update or delete on priv.fichas_tecnicas for each row execute function audit.registrar();
create trigger palavras_chave_audit after insert or update or delete on priv.palavras_chave for each row execute function audit.registrar();
alter table priv.produtos enable always trigger produtos_audit;
alter table priv.produto_precos enable always trigger produto_precos_audit;
alter table priv.fichas_tecnicas enable always trigger fichas_audit;
alter table priv.fichas_tecnicas enable always trigger fichas_historico;
alter table priv.palavras_chave enable always trigger palavras_chave_audit;

-- migrate:down
drop table priv.palavras_chave_filtros, priv.palavras_chave, priv.fichas_tecnicas, priv.produto_atributos, priv.produto_precos, priv.produtos;
drop function priv.fichas_somente_situacao(), priv.produto_atributos_validar();
