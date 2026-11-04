-- Fase 04 · Motor de pesquisa: fontes e execuções (ops), modelo público de licitações (pub) e o resultado por
-- empresa (priv.oportunidades, priv.importacoes). Spec: docs/specs/fase-04.md.
--
-- * pub.* e ops.* não têm empresa_id: pub é lido por quem tem editais/visualizar em alguma empresa; só o worker
--   escreve (vv_api não tem grant de escrita). ops.* é do SUPERADMIN (RLS), com um resumo do estado das fontes
--   por função para o banner de todas as telas.
-- * priv.oportunidades: nota gravada só pelo worker; o usuário só faz a triagem (função), nunca apaga.
-- * Extensão unaccent vem de db/init (superusuário); pgvector é opcional (coluna de embedding condicional).

-- migrate:up
create text search configuration pub.pt_unaccent (copy = pg_catalog.portuguese);
alter text search configuration pub.pt_unaccent
  alter mapping for hword, hword_part, word with extensions.unaccent, portuguese_stem;

-- Quem lê dado público de licitações: SUPERADMIN ou usuário com editais/visualizar em algum vínculo ativo.
create function core.pode_ver_editais()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select core.is_superadmin() or exists (
    select 1
      from core.vinculos v
      join core.usuarios u on u.id = v.usuario_id
      join core.empresas e on e.id = v.empresa_id
      join core.permissoes p on p.vinculo_id = v.id
     where v.usuario_id = core.usuario_atual()
       and v.ativo and v.deleted_at is null
       and u.ativo and u.deleted_at is null
       and e.ativo and e.deleted_at is null
       and p.modulo = 'editais' and p.acao = 'visualizar'
       and (core.mfa_ok() or v.papel = 'CLIENTE')
  );
$$;
grant execute on function core.pode_ver_editais() to vv_api;

-- =============================================================== ops: fontes e execuções
create table ops.fontes (
  id                  uuid primary key default core.uuid_v7(),
  slug                text not null unique check (slug ~ '^[a-z0-9_]{2,40}$'),
  nome                text not null check (char_length(nome) between 2 and 120),
  url_base            text not null check (url_base ~ '^https://[^/\s]+') ,
  tipo_integracao     text not null check (tipo_integracao in ('api_oficial', 'dados_abertos', 'feed', 'pagina')),
  credencial_ref      text check (char_length(credencial_ref) <= 200),
  hosts_permitidos    text[] not null default '{}' check (cardinality(hosts_permitidos) <= 20),
  termos_uso_url      text check (char_length(termos_uso_url) <= 300),
  horarios            text[] not null default '{07:00,12:00,17:00}',
  ativa               boolean not null default false,
  status              text not null default 'desativada' check (status in ('ok', 'degradada', 'indisponivel', 'desativada')),
  falhas_consecutivas int not null default 0 check (falhas_consecutivas >= 0),
  ultima_pesquisa_em  timestamptz,
  ultimo_sucesso_em   timestamptz,
  ultimo_resultado    text check (char_length(ultimo_resultado) <= 300),
  parametros          jsonb not null default '{}' check (jsonb_typeof(parametros) = 'object'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (cardinality(horarios) between 1 and 24)
);

create table ops.execucoes (
  id                    uuid primary key default core.uuid_v7(),
  fonte_id              uuid not null references ops.fontes (id),
  tipo                  text not null check (tipo in ('principal', 'incremental', 'manual', 'importacao')),
  agendada_para         timestamptz not null,
  iniciada_em           timestamptz,
  concluida_em          timestamptz,
  janela_ini            timestamptz,
  janela_fim            timestamptz,
  status                text not null default 'agendada' check (status in ('agendada', 'executando', 'ok', 'parcial', 'falhou', 'perdida')),
  processos_encontrados int not null default 0 check (processos_encontrados >= 0),
  editais_novos         int not null default 0 check (editais_novos >= 0),
  editais_atualizados   int not null default 0 check (editais_atualizados >= 0),
  arquivos_baixados     int not null default 0 check (arquivos_baixados >= 0),
  arquivos_processados  int not null default 0 check (arquivos_processados >= 0),
  itens_extraidos       int not null default 0 check (itens_extraidos >= 0),
  itens_pendentes       int not null default 0 check (itens_pendentes >= 0),
  erro_tipo             text check (char_length(erro_tipo) <= 100),
  detalhe               jsonb not null default '{}' check (jsonb_typeof(detalhe) = 'object' and pg_column_size(detalhe) <= 8192),
  solicitada_por        uuid references core.usuarios (id),
  created_at            timestamptz not null default now(),
  unique (fonte_id, tipo, agendada_para)
);
create index execucoes_fonte_idx on ops.execucoes (fonte_id, agendada_para desc);
create index execucoes_aberta_idx on ops.execucoes (status) where status in ('agendada', 'executando');

create table ops.fonte_checagens (
  id         uuid primary key default core.uuid_v7(),
  fonte_id   uuid not null references ops.fontes (id),
  em         timestamptz not null default now(),
  ok         boolean not null,
  latencia_ms int check (latencia_ms >= 0),
  erro_tipo  text check (char_length(erro_tipo) <= 100)
);
create index fonte_checagens_idx on ops.fonte_checagens (fonte_id, em desc);

create table ops.amostra_cobertura (
  id              uuid primary key default core.uuid_v7(),
  referencia      text not null check (char_length(referencia) between 3 and 300),
  uf              text not null check (uf ~ '^[A-Z]{2}$'),
  orgao_nome      text check (char_length(orgao_nome) <= 200),
  objeto_resumo   text check (char_length(objeto_resumo) <= 300),
  data_publicacao date,
  levantado_por   text check (char_length(levantado_por) <= 120),
  mes_referencia  date not null check (mes_referencia = date_trunc('month', mes_referencia)::date),
  created_at      timestamptz not null default now(),
  created_by      uuid default core.usuario_atual(),
  unique (mes_referencia, referencia)
);

create table ops.cobertura_resultados (
  id            uuid primary key default core.uuid_v7(),
  amostra_id    uuid not null references ops.amostra_cobertura (id),
  apurado_em    timestamptz not null default now(),
  encontrado    boolean not null,
  edital_id     uuid,
  causa         text check (causa in ('fonte_nao_coberta', 'filtro_uf_modalidade', 'falha_conector', 'janela_de_data', 'nao_publicado_no_pncp', 'outra')),
  causa_detalhe text check (char_length(causa_detalhe) <= 500),
  check (encontrado or causa is not null or causa_detalhe is null)
);
create index cobertura_resultados_idx on ops.cobertura_resultados (amostra_id, apurado_em desc);

alter table ops.fontes enable row level security;
alter table ops.execucoes enable row level security;
alter table ops.fonte_checagens enable row level security;
alter table ops.amostra_cobertura enable row level security;
alter table ops.cobertura_resultados enable row level security;

create policy fontes_select on ops.fontes for select to vv_api using ((select core.is_superadmin()));
create policy fontes_insert on ops.fontes for insert to vv_api with check ((select core.is_superadmin()));
create policy fontes_update on ops.fontes for update to vv_api using ((select core.is_superadmin())) with check ((select core.is_superadmin()));
create policy execucoes_select on ops.execucoes for select to vv_api using ((select core.is_superadmin()));
create policy checagens_select on ops.fonte_checagens for select to vv_api using ((select core.is_superadmin()));
create policy amostra_select on ops.amostra_cobertura for select to vv_api using ((select core.is_superadmin()));
create policy amostra_insert on ops.amostra_cobertura for insert to vv_api with check ((select core.is_superadmin()));
create policy cobertura_select on ops.cobertura_resultados for select to vv_api using ((select core.is_superadmin()));
create policy cobertura_update on ops.cobertura_resultados for update to vv_api using ((select core.is_superadmin())) with check ((select core.is_superadmin()));

-- vv_api: SUPERADMIN edita a configuração da fonte; estado (status, contadores, datas) é só do worker.
grant select on ops.fontes, ops.execucoes, ops.fonte_checagens, ops.amostra_cobertura, ops.cobertura_resultados to vv_api;
grant update (nome, url_base, tipo_integracao, hosts_permitidos, termos_uso_url, horarios, ativa, parametros) on ops.fontes to vv_api;
grant insert (referencia, uf, orgao_nome, objeto_resumo, data_publicacao, levantado_por, mes_referencia) on ops.amostra_cobertura to vv_api;
grant update (causa, causa_detalhe) on ops.cobertura_resultados to vv_api;
grant select, insert, update on ops.fontes, ops.execucoes to vv_worker;
grant select, insert, delete on ops.fonte_checagens to vv_worker;
grant select on ops.amostra_cobertura to vv_worker;
grant select, insert, update on ops.cobertura_resultados to vv_worker;

create trigger fontes_updated_at before update on ops.fontes for each row execute function core.set_updated_at();
create trigger fontes_audit after insert or update on ops.fontes for each row execute function audit.registrar('empresa_id_inexistente');
alter table ops.fontes enable always trigger fontes_audit;

-- Fontes de partida: desligadas até o conector existir (o vigia só cobra fonte ativa).
insert into ops.fontes (slug, nome, url_base, tipo_integracao, hosts_permitidos, parametros) values
  ('pncp', 'PNCP · Portal Nacional de Contratações Públicas', 'https://pncp.gov.br', 'api_oficial', '{pncp.gov.br}',
   '{"ufs": ["PR", "SC"], "tamanho_pagina": 50, "requisicoes_por_segundo": 2}'),
  ('comprasgov', 'Compras.gov.br · dados abertos', 'https://dadosabertos.compras.gov.br', 'dados_abertos', '{compras.gov.br,dadosabertos.compras.gov.br}',
   '{"ufs": ["PR", "SC"], "tamanho_pagina": 50, "requisicoes_por_segundo": 2}');

-- Resumo do estado das fontes para o banner de todas as telas de oportunidade (sem detalhe de erro).
create function ops.estado_das_fontes()
returns table (slug text, nome text, status text, ativa boolean, ultimo_sucesso_em timestamptz, ultima_pesquisa_em timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not core.pode_ver_editais() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  return query select f.slug, f.nome, f.status, f.ativa, f.ultimo_sucesso_em, f.ultima_pesquisa_em from ops.fontes f order by f.slug;
end;
$$;
grant execute on function ops.estado_das_fontes() to vv_api;

-- =============================================================== pub: licitações
create table pub.orgaos (
  id             uuid primary key default core.uuid_v7(),
  cnpj           text not null check (cnpj ~ '^[0-9]{14}$'),
  unidade_codigo text not null default '0' check (char_length(unidade_codigo) <= 40),
  razao_social   text not null check (char_length(razao_social) between 1 and 300),
  esfera         text check (esfera in ('municipal', 'estadual', 'federal', 'distrital')),
  tipo           text check (char_length(tipo) <= 60),
  uf             text check (uf ~ '^[A-Z]{2}$'),
  municipio      text check (char_length(municipio) <= 120),
  codigo_ibge    text check (codigo_ibge ~ '^[0-9]{7}$'),
  uasg           text check (char_length(uasg) <= 20),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (cnpj, unidade_codigo)
);
create index orgaos_uf_idx on pub.orgaos (uf, municipio);

create table pub.editais (
  id                          uuid primary key default core.uuid_v7(),
  fonte_id                    uuid not null references ops.fontes (id),
  id_externo                  text not null check (char_length(id_externo) between 3 and 200),
  orgao_id                    uuid not null references pub.orgaos (id),
  numero_edital               text check (char_length(numero_edital) <= 80),
  processo                    text check (char_length(processo) <= 80),
  modalidade                  text check (char_length(modalidade) <= 80),
  modo_disputa                text check (char_length(modo_disputa) <= 80),
  criterio_julgamento         text check (char_length(criterio_julgamento) <= 80),
  srp                         boolean not null default false,
  julgamento_por              text not null default 'item' check (julgamento_por in ('item', 'lote')),
  objeto                      text not null check (char_length(objeto) <= 20000),
  objeto_tsv                  tsvector generated always as (to_tsvector('pub.pt_unaccent'::regconfig, objeto)) stored,
  valor_estimado              numeric(18, 4) check (valor_estimado >= 0),
  sigiloso                    boolean not null default false,
  situacao                    text check (char_length(situacao) <= 80),
  data_publicacao             timestamptz,
  data_abertura_propostas     timestamptz,
  data_encerramento_propostas timestamptz,
  data_sessao                 timestamptz,
  portal                      text check (char_length(portal) <= 120),
  link_origem                 text check (link_origem is null or (link_origem ~ '^https://[^\s]+$' and char_length(link_origem) <= 500)),
  link_portal                 text check (link_portal is null or (link_portal ~ '^https://[^\s]+$' and char_length(link_portal) <= 500)),
  versao_atual                int not null default 1 check (versao_atual >= 1),
  hash_conteudo               text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  origem                      text not null default 'automatica' check (origem in ('automatica', 'manual')),
  primeira_coleta_em          timestamptz not null default now(),
  ultima_coleta_em            timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (fonte_id, id_externo)
);
create index editais_orgao_idx on pub.editais (orgao_id);
create index editais_sessao_idx on pub.editais (data_sessao);
create index editais_publicacao_idx on pub.editais (data_publicacao desc);
create index editais_objeto_idx on pub.editais using gin (objeto_tsv);

create table pub.edital_versoes (
  id               uuid primary key default core.uuid_v7(),
  edital_id        uuid not null references pub.editais (id),
  versao           int not null check (versao >= 1),
  coletada_em      timestamptz not null default now(),
  hash_conteudo    text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  campos_alterados text[] not null default '{}',
  conteudo         jsonb not null check (jsonb_typeof(conteudo) = 'object'),
  unique (edital_id, versao)
);

create table pub.edital_itens (
  id                      uuid primary key default core.uuid_v7(),
  edital_id               uuid not null references pub.editais (id),
  tipo                    text not null default 'item' check (tipo in ('item', 'lote')),
  numero_item             int not null check (numero_item >= 0),
  lote_numero             text check (char_length(lote_numero) <= 40),
  pai_id                  uuid references pub.edital_itens (id),
  descricao               text not null check (char_length(descricao) <= 20000),
  descricao_tsv           tsvector generated always as (to_tsvector('pub.pt_unaccent'::regconfig, descricao)) stored,
  quantidade              numeric(18, 4) check (quantidade >= 0),
  unidade_medida          text check (char_length(unidade_medida) <= 60),
  valor_unitario_estimado numeric(18, 4) check (valor_unitario_estimado >= 0),
  valor_total_estimado    numeric(18, 4) check (valor_total_estimado >= 0),
  beneficio               text not null default 'nao_informado'
                          check (beneficio in ('exclusivo_me_epp', 'cota_reservada', 'ampla_concorrencia', 'nao_informado')),
  situacao                text check (char_length(situacao) <= 80),
  versao_inicial          int not null default 1 check (versao_inicial >= 1),
  versao_final            int check (versao_final is null or versao_final >= versao_inicial),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (edital_id, tipo, numero_item),
  unique (id, edital_id)
);
create index edital_itens_desc_idx on pub.edital_itens using gin (descricao_tsv);

create table pub.edital_arquivos (
  id               uuid primary key default core.uuid_v7(),
  edital_id        uuid not null references pub.editais (id),
  tipo             text not null default 'anexo'
                   check (tipo in ('edital', 'termo_referencia', 'etp', 'anexo', 'planilha', 'retificacao', 'aviso', 'outro')),
  titulo           text check (char_length(titulo) <= 300),
  url_origem       text not null check (url_origem ~ '^https://[^\s]+$' and char_length(url_origem) <= 1000),
  coletado_em      timestamptz,
  tamanho          bigint check (tamanho >= 0),
  sha256           text check (sha256 ~ '^[0-9a-f]{64}$'),
  tipo_real        text check (char_length(tipo_real) <= 100),
  arquivo_chave    text check (char_length(arquivo_chave) <= 300),
  status_arquivo   text not null default 'pendente'
                   check (status_arquivo in ('pendente', 'quarentena', 'liberado', 'bloqueado', 'grande_demais', 'falhou')),
  motivo           text check (char_length(motivo) <= 300),
  paginas          int check (paginas >= 0),
  status_extracao  text not null default 'pendente'
                   check (status_extracao in ('pendente', 'ok', 'parcial', 'ocr', 'falhou', 'nao_suportado')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, edital_id)
);
-- Arquivo trocado na mesma URL vira outra linha (o antigo é preservado); sem hash ainda só uma linha pendente por URL.
create unique index edital_arquivos_url_hash_uk on pub.edital_arquivos (edital_id, url_origem, coalesce(sha256, ''));
create index edital_arquivos_edital_idx on pub.edital_arquivos (edital_id);

create table pub.trechos (
  id              uuid primary key default core.uuid_v7(),
  edital_id       uuid not null references pub.editais (id),
  arquivo_id      uuid not null,
  item_id         uuid,
  pagina          int not null check (pagina >= 1),
  ordem           int not null default 0 check (ordem >= 0),
  texto           text not null check (char_length(texto) between 1 and 20000),
  tsv             tsvector generated always as (to_tsvector('pub.pt_unaccent'::regconfig, texto)) stored,
  origem_extracao text not null default 'texto' check (origem_extracao in ('texto', 'ocr')),
  confianca_ocr   numeric(5, 4) check (confianca_ocr between 0 and 1),
  embedding_modelo text check (char_length(embedding_modelo) <= 100),
  created_at      timestamptz not null default now(),
  foreign key (arquivo_id, edital_id) references pub.edital_arquivos (id, edital_id),
  foreign key (item_id, edital_id) references pub.edital_itens (id, edital_id)
);
create index trechos_edital_idx on pub.trechos (edital_id, arquivo_id, pagina, ordem);
create index trechos_tsv_idx on pub.trechos using gin (tsv);

-- Embedding (384 dimensões, modelo local): só onde a extensão existe (a imagem do Postgres do projeto a traz).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    alter table pub.trechos add column embedding extensions.vector(384);
    create index trechos_embedding_idx on pub.trechos using hnsw (embedding extensions.vector_cosine_ops);
  end if;
end $$;

create table pub.edital_eventos (
  id        uuid primary key default core.uuid_v7(),
  edital_id uuid not null references pub.editais (id),
  tipo      text not null check (tipo in ('novo', 'retificado', 'data_alterada', 'arquivo_novo', 'situacao_alterada')),
  versao    int not null check (versao >= 1),
  em        timestamptz not null default now()
);
create index edital_eventos_idx on pub.edital_eventos (em);

alter table pub.orgaos enable row level security;
alter table pub.editais enable row level security;
alter table pub.edital_versoes enable row level security;
alter table pub.edital_itens enable row level security;
alter table pub.edital_arquivos enable row level security;
alter table pub.trechos enable row level security;
alter table pub.edital_eventos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['orgaos', 'editais', 'edital_versoes', 'edital_itens', 'edital_arquivos', 'trechos', 'edital_eventos'] loop
    execute format('create policy %I on pub.%I for select to vv_api using ((select core.pode_ver_editais()))', t || '_select', t);
  end loop;
end $$;

-- vv_api só lê (arquivo_chave e url_origem seguem legíveis: a chave só vale com URL assinada pela API).
grant select on pub.orgaos, pub.editais, pub.edital_versoes, pub.edital_itens, pub.edital_arquivos, pub.trechos, pub.edital_eventos to vv_api;
-- vv_worker escreve; versões e eventos são só inserção; trechos podem ser regravados (extração atômica).
grant select, insert, update on pub.orgaos, pub.editais, pub.edital_itens, pub.edital_arquivos to vv_worker;
grant select, insert on pub.edital_versoes, pub.edital_eventos to vv_worker;
grant select, insert, update, delete on pub.trechos to vv_worker;

create trigger orgaos_updated_at before update on pub.orgaos for each row execute function core.set_updated_at();
create trigger editais_updated_at before update on pub.editais for each row execute function core.set_updated_at();
create trigger edital_itens_updated_at before update on pub.edital_itens for each row execute function core.set_updated_at();
create trigger edital_arquivos_updated_at before update on pub.edital_arquivos for each row execute function core.set_updated_at();

-- Versões e eventos são imutáveis (nem o worker corrige): quem erra grava uma nova.
create function pub.imutavel()
returns trigger
language plpgsql
as $$
begin
  raise exception 'registro imutável: grave uma nova versão' using errcode = 'insufficient_privilege';
end;
$$;
create trigger edital_versoes_imutavel before update or delete on pub.edital_versoes for each row execute function pub.imutavel();
create trigger edital_eventos_imutavel before update or delete on pub.edital_eventos for each row execute function pub.imutavel();

-- =============================================================== priv: resultado por empresa
create table priv.oportunidades (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  edital_id        uuid not null references pub.editais (id),
  item_id          uuid not null,
  nota             smallint not null check (nota between 0 and 100),
  faixa            text not null check (faixa in ('alta', 'media', 'baixa')),
  motivos          jsonb not null default '[]' check (jsonb_typeof(motivos) = 'array' and pg_column_size(motivos) <= 16384),
  fora_dos_filtros jsonb not null default '[]' check (jsonb_typeof(fora_dos_filtros) = 'array'),
  semelhanca       numeric(5, 4) check (semelhanca between -1 and 1),
  versao_regra     text not null check (char_length(versao_regra) <= 40),
  edital_versao    int not null check (edital_versao >= 1),
  retirado         boolean not null default false,
  triagem          text not null default 'nova' check (triagem in ('nova', 'vista', 'interesse', 'descartada_pelo_usuario')),
  triagem_motivo   text check (char_length(triagem_motivo) between 3 and 500),
  triagem_por      uuid references core.usuarios (id),
  triagem_em       timestamptz,
  avaliada_em      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (empresa_id, item_id),
  unique (id, empresa_id),
  foreign key (item_id, edital_id) references pub.edital_itens (id, edital_id),
  check (triagem <> 'descartada_pelo_usuario' or triagem_motivo is not null)
);
create index oportunidades_lista_idx on priv.oportunidades (empresa_id, faixa, avaliada_em desc);
create index oportunidades_edital_idx on priv.oportunidades (edital_id);

create table priv.importacoes (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  tipo           text not null check (tipo in ('url', 'upload')),
  url            text check (url ~ '^https://[^\s]+$' and char_length(url) <= 1000),
  arquivo_chave  text check (char_length(arquivo_chave) <= 300),
  status         text not null default 'pendente' check (status in ('pendente', 'processando', 'ok', 'falhou')),
  edital_id      uuid references pub.editais (id),
  erro           text check (char_length(erro) <= 300),
  solicitado_por uuid default core.usuario_atual() references core.usuarios (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((tipo = 'url' and url is not null) or (tipo = 'upload' and arquivo_chave is not null))
);
create index importacoes_empresa_idx on priv.importacoes (empresa_id, created_at desc);

alter table priv.oportunidades enable row level security;
alter table priv.importacoes enable row level security;
create policy oportunidades_select on priv.oportunidades for select to vv_api using (core.has_permission(empresa_id, 'editais', 'visualizar'));
create policy importacoes_select on priv.importacoes for select to vv_api using (core.has_permission(empresa_id, 'editais', 'visualizar'));
grant select on priv.oportunidades, priv.importacoes to vv_api;
-- Nota e importação são gravadas pelo worker; o usuário só faz triagem e pede importação por função.
grant select, insert, update on priv.oportunidades to vv_worker;
grant select, update on priv.importacoes to vv_worker;
revoke update (triagem, triagem_motivo, triagem_por, triagem_em) on priv.oportunidades from vv_worker;

create trigger importacoes_updated_at before update on priv.importacoes for each row execute function core.set_updated_at();
create trigger oportunidades_triagem_audit after update of triagem, triagem_motivo on priv.oportunidades
  for each row execute function audit.registrar();
alter table priv.oportunidades enable always trigger oportunidades_triagem_audit;

-- Triagem (nunca apaga): interesse, vista ou descartada com motivo.
create function priv.triar_oportunidade(p_empresa uuid, p_id uuid, p_triagem text, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'editais', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_triagem not in ('vista', 'interesse', 'descartada_pelo_usuario') then
    raise exception 'triagem inválida' using errcode = 'invalid_parameter_value';
  end if;
  update priv.oportunidades
     set triagem = p_triagem, triagem_motivo = nullif(btrim(p_motivo), ''), triagem_por = core.usuario_atual(), triagem_em = now()
   where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'oportunidade não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

-- Importação manual: valida permissão, URL de fonte permitida e taxa (20 por hora e empresa); enfileira o job.
create function priv.solicitar_importacao(p_empresa uuid, p_tipo text, p_url text, p_arquivo_chave text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := core.uuid_v7();
  v_host text;
begin
  if not core.has_permission(p_empresa, 'editais', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if (select count(*) from priv.importacoes where empresa_id = p_empresa and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'limite de importações por hora atingido' using errcode = 'program_limit_exceeded';
  end if;
  if p_tipo = 'url' then
    v_host := lower((regexp_match(coalesce(p_url, ''), '^https://([a-z0-9.-]+)(?::443)?(?:/|$)', 'i'))[1]);
    if v_host is null or not exists (
         select 1 from ops.fontes f where f.ativa and v_host = any (f.hosts_permitidos)
                                        or (f.ativa and exists (select 1 from unnest(f.hosts_permitidos) h where v_host like '%.' || h))) then
      raise exception 'endereço não permitido para importação' using errcode = 'invalid_parameter_value';
    end if;
  elsif p_tipo <> 'upload' then
    raise exception 'tipo inválido' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.importacoes (id, empresa_id, tipo, url, arquivo_chave)
  values (v_id, p_empresa, p_tipo, case when p_tipo = 'url' then p_url end, case when p_tipo = 'upload' then p_arquivo_chave end);
  perform ops.enfileirar('importar_edital', p_empresa, jsonb_build_object('importacao_id', v_id), 'importar:' || v_id);
  return v_id;
end;
$$;

-- Pesquisa manual sob demanda (RF-04.2): cria a execução `manual` e enfileira a coleta; 6 por hora e usuário.
create function ops.solicitar_coleta_manual(p_empresa uuid, p_fonte text, p_inicio date, p_fim date, p_uf text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_fonte uuid;
  v_id uuid := core.uuid_v7();
begin
  if not (core.is_superadmin() or core.has_permission(p_empresa, 'editais', 'cadastrar')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 31 then
    raise exception 'período inválido (até 31 dias)' using errcode = 'invalid_parameter_value';
  end if;
  if p_uf is not null and p_uf !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from ops.execucoes where tipo = 'manual' and solicitada_por = core.usuario_atual()
                                              and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'limite de pesquisas manuais por hora atingido' using errcode = 'program_limit_exceeded';
  end if;
  select id into v_fonte from ops.fontes where slug = p_fonte and ativa;
  if v_fonte is null then
    raise exception 'fonte inexistente ou desativada' using errcode = 'no_data_found';
  end if;
  insert into ops.execucoes (id, fonte_id, tipo, agendada_para, janela_ini, janela_fim, solicitada_por, detalhe)
  values (v_id, v_fonte, 'manual', now(), p_inicio::timestamptz, (p_fim + 1)::timestamptz, core.usuario_atual(),
          jsonb_build_object('uf', p_uf));
  perform ops.enfileirar('coletar_fonte', null, jsonb_build_object('execucao_id', v_id), 'coleta_manual:' || v_id);
  return v_id;
end;
$$;

grant execute on function priv.triar_oportunidade(uuid, uuid, text, text), priv.solicitar_importacao(uuid, text, text, text),
  ops.solicitar_coleta_manual(uuid, text, date, date, text) to vv_api;
revoke all on function pub.imutavel() from public;

-- migrate:down
drop function ops.solicitar_coleta_manual(uuid, text, date, date, text), priv.solicitar_importacao(uuid, text, text, text),
  priv.triar_oportunidade(uuid, uuid, text, text);
drop table priv.importacoes, priv.oportunidades;
drop table pub.edital_eventos, pub.trechos, pub.edital_arquivos, pub.edital_itens, pub.edital_versoes, pub.editais, pub.orgaos;
drop function pub.imutavel();
drop function ops.estado_das_fontes();
drop table ops.cobertura_resultados, ops.amostra_cobertura, ops.fonte_checagens, ops.execucoes, ops.fontes;
drop function core.pode_ver_editais();
drop text search configuration pub.pt_unaccent;
