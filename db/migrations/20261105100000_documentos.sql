-- Fase 03 · Repositório documental (spec fase-03 §3 e §4; RF-03.1 a RF-03.6).
--
-- * Tipos de documento (pastas) em pub, como dado: tipo novo = linha nova. Escrita só de SUPERADMIN.
-- * priv.documentos + priv.documento_versoes (só inserção; versão nova preserva a anterior).
-- * Upload em duas etapas (ADR-017): a API cria a versão em QUARENTENA por função (permissão conferida
--   aqui), o navegador envia direto ao S3, e o worker verifica (antivírus, tipo real, tamanho, SHA-256)
--   e só ele libera (priv.registrar_verificacao, execute só para vv_worker). Versão que não está
--   'liberado' nunca tem download.
-- * Download: priv.registrar_download confere a permissão, grava QUEM baixou e devolve a chave; a API
--   gera a URL assinada de 60 s. A URL nunca é guardada.
-- * Status calculado em view (security_invoker): válido, a vencer, vencido, em atualização, pendente.
--   Data em America/Sao_Paulo.
-- ⚠️ Antes de uso real: teste de isolamento A x B por tabela (AGENTS.md §0, regra 13).

-- migrate:up
create table pub.tipos_documento (
  id                   uuid primary key default core.uuid_v7(),
  slug                 text not null unique check (slug ~ '^[a-z0-9_]{2,60}$'),
  nome                 text not null check (char_length(nome) between 2 and 120),
  pasta                text not null check (pasta in ('habilitacao_juridica', 'economico_financeira', 'fiscal_trabalhista', 'tecnica', 'timbrado_modelos', 'juridico')),
  exige_validade       boolean not null default true,
  antecedencias        int[] not null default '{30,15,10,5}' check (cardinality(antecedencias) between 1 and 8),
  emissor_url          text check (char_length(emissor_url) <= 300),
  ordem                int not null default 0
);
alter table pub.tipos_documento enable row level security;
create policy tipos_documento_select on pub.tipos_documento for select to vv_api using ((select core.usuario_atual()) is not null);
create policy tipos_documento_insert on pub.tipos_documento for insert to vv_api with check ((select core.is_superadmin()));
create policy tipos_documento_update on pub.tipos_documento for update to vv_api using ((select core.is_superadmin())) with check ((select core.is_superadmin()));
grant select on pub.tipos_documento to vv_api;
grant insert (slug, nome, pasta, exige_validade, antecedencias, emissor_url, ordem), update (nome, exige_validade, antecedencias, emissor_url, ordem) on pub.tipos_documento to vv_api;

insert into pub.tipos_documento (slug, nome, pasta, exige_validade, emissor_url, ordem) values
  ('doc_representante', 'Documento de representante', 'habilitacao_juridica', false, null, 10),
  ('contrato_social', 'Contrato social e alterações', 'habilitacao_juridica', false, null, 20),
  ('certidao_simplificada', 'Certidão simplificada (Junta Comercial)', 'habilitacao_juridica', true, null, 30),
  ('inscricoes', 'Inscrições (estadual e municipal)', 'habilitacao_juridica', false, null, 40),
  ('alvara', 'Alvará de funcionamento', 'habilitacao_juridica', true, null, 50),
  ('cartao_cnpj', 'Cartão CNPJ', 'habilitacao_juridica', false, 'https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp', 60),
  ('qsa', 'Quadro de sócios e administradores (QSA)', 'habilitacao_juridica', false, null, 70),
  ('sintegra', 'SINTEGRA', 'habilitacao_juridica', true, null, 80),
  ('cicad', 'CICAD', 'habilitacao_juridica', true, null, 90),
  ('procuracao', 'Procuração', 'habilitacao_juridica', true, null, 100),
  ('certidao_falencia', 'Certidão de falência e recuperação judicial', 'economico_financeira', true, null, 110),
  ('balanco', 'Balanço patrimonial', 'economico_financeira', false, null, 120),
  ('dre', 'DRE', 'economico_financeira', false, null, 130),
  ('indices_contabeis', 'Índices contábeis', 'economico_financeira', false, null, 140),
  ('cnd_federal', 'CND Federal (Receita e PGFN)', 'fiscal_trabalhista', true, 'https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir', 150),
  ('cnd_estadual', 'CND Estadual', 'fiscal_trabalhista', true, null, 160),
  ('cnd_municipal', 'CND Municipal', 'fiscal_trabalhista', true, null, 170),
  ('crf_fgts', 'Certificado de Regularidade do FGTS', 'fiscal_trabalhista', true, 'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf', 180),
  ('cndt', 'CNDT (Certidão Negativa de Débitos Trabalhistas)', 'fiscal_trabalhista', true, 'https://cndt-certidao.tst.jus.br/inicio.faces', 190),
  ('atestado_tecnico', 'Atestado de capacidade técnica', 'tecnica', false, null, 200),
  ('contrato_executado', 'Contrato executado', 'tecnica', false, null, 210),
  ('nota_fiscal', 'Nota fiscal comprobatória', 'tecnica', false, null, 220),
  ('termo_recebimento', 'Termo de recebimento', 'tecnica', false, null, 230),
  ('certificacao', 'Certificação', 'tecnica', true, null, 240),
  ('papel_timbrado', 'Papel timbrado (Word)', 'timbrado_modelos', false, null, 250),
  ('logotipo', 'Logotipo', 'timbrado_modelos', false, null, 260),
  ('modelo_documento', 'Modelo de proposta, declaração, ofício ou peça', 'timbrado_modelos', false, null, 270),
  ('assinatura_autorizada', 'Assinatura autorizada', 'timbrado_modelos', false, null, 280),
  ('peca_juridica', 'Peça jurídica e comprovante de protocolo', 'juridico', false, null, 290),
  ('outro', 'Outro documento', 'habilitacao_juridica', false, null, 999);

create table priv.documentos (
  id              uuid primary key default core.uuid_v7(),
  empresa_id      uuid not null references core.empresas (id) on delete cascade,
  tipo_id         uuid not null references pub.tipos_documento (id),
  descricao       text not null check (char_length(descricao) between 2 and 300),
  numero          text check (char_length(numero) <= 80),
  emissor         text check (char_length(emissor) <= 200),
  origem          text check (char_length(origem) <= 200),
  responsavel_id  uuid references core.usuarios (id),
  sem_vencimento  boolean not null default false,
  em_atualizacao  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid default core.usuario_atual(),
  deleted_at      timestamptz,
  unique (id, empresa_id)
);
create index documentos_empresa_idx on priv.documentos (empresa_id);

create table priv.documento_versoes (
  id              uuid primary key default core.uuid_v7(),
  documento_id    uuid not null,
  empresa_id      uuid not null,
  versao          int not null check (versao >= 1),
  arquivo_chave   text not null,
  nome_original   text not null check (char_length(nome_original) between 1 and 255),
  tipo_real       text check (char_length(tipo_real) <= 100),
  tamanho         bigint check (tamanho >= 0),
  sha256          text check (sha256 ~ '^[0-9a-f]{64}$'),
  emissao         date,
  validade        date,
  status_arquivo  text not null default 'quarentena' check (status_arquivo in ('quarentena', 'liberado', 'bloqueado')),
  motivo_bloqueio text check (char_length(motivo_bloqueio) <= 300),
  enviado_em      timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid default core.usuario_atual(),
  unique (documento_id, versao),
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade,
  check (validade is null or emissao is null or validade >= emissao)
);
create index documento_versoes_empresa_idx on priv.documento_versoes (empresa_id);

create table priv.documento_downloads (
  id           uuid primary key default core.uuid_v7(),
  documento_id uuid not null,
  empresa_id   uuid not null,
  versao_id    uuid not null references priv.documento_versoes (id) on delete cascade,
  usuario_id   uuid not null references core.usuarios (id),
  em           timestamptz not null default now(),
  ip           inet,
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade
);
create index documento_downloads_empresa_idx on priv.documento_downloads (empresa_id, em desc);

alter table priv.documentos enable row level security;
alter table priv.documento_versoes enable row level security;
alter table priv.documento_downloads enable row level security;

create policy documentos_select on priv.documentos for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy documentos_insert on priv.documentos for insert to vv_api with check (core.has_permission(empresa_id, 'documentos', 'cadastrar'));
create policy documentos_update on priv.documentos for update to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'editar') or core.has_permission(empresa_id, 'documentos', 'arquivar'))
  with check (core.has_permission(empresa_id, 'documentos', 'editar') or core.has_permission(empresa_id, 'documentos', 'arquivar'));
create policy documento_versoes_select on priv.documento_versoes for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy documento_downloads_select on priv.documento_downloads for select to vv_api using (core.has_permission(empresa_id, 'auditoria', 'visualizar'));

-- A chave final do arquivo e as versões só nascem pelas funções; vv_api não escreve nelas direto.
grant select on priv.documentos, priv.documento_downloads to vv_api;
grant select (id, documento_id, empresa_id, versao, nome_original, tipo_real, tamanho, sha256, emissao, validade, status_arquivo, motivo_bloqueio, enviado_em, created_at)
  on priv.documento_versoes to vv_api;
grant insert (empresa_id, tipo_id, descricao, numero, emissor, origem, responsavel_id, sem_vencimento) on priv.documentos to vv_api;
grant update (tipo_id, descricao, numero, emissor, origem, responsavel_id, sem_vencimento, em_atualizacao, deleted_at) on priv.documentos to vv_api;

create trigger documentos_updated_at before update on priv.documentos for each row execute function core.set_updated_at();
create trigger documentos_audit after insert or update or delete on priv.documentos for each row execute function audit.registrar();
create trigger documento_versoes_audit after insert or update on priv.documento_versoes for each row execute function audit.registrar('empresa_id', 'arquivo_chave');
alter table priv.documentos enable always trigger documentos_audit;
alter table priv.documento_versoes enable always trigger documento_versoes_audit;

-- Cria a próxima versão em quarentena e devolve onde o navegador deve enviar o arquivo.
create function priv.iniciar_versao(p_empresa uuid, p_documento uuid, p_nome text, p_tamanho bigint, p_emissao date, p_validade date)
returns table (versao_id uuid, chave text, versao int)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_id uuid := core.uuid_v7();
  v_tem boolean;
begin
  select exists (select 1 from priv.documento_versoes x where x.documento_id = p_documento) into v_tem;
  if not core.has_permission(p_empresa, 'documentos', case when v_tem then 'substituir_arquivos' else 'cadastrar' end) then
    raise exception 'sem permissão para enviar arquivo' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from priv.documentos d where d.id = p_documento and d.empresa_id = p_empresa and d.deleted_at is null for update;
  if not found then
    raise exception 'documento não encontrado' using errcode = 'no_data_found';
  end if;
  select coalesce(max(x.versao), 0) + 1 into v_n from priv.documento_versoes x where x.documento_id = p_documento;
  insert into priv.documento_versoes (id, documento_id, empresa_id, versao, arquivo_chave, nome_original, tamanho, emissao, validade)
  values (v_id, p_documento, p_empresa, v_n, 'quarentena/' || p_empresa || '/' || v_id, p_nome, p_tamanho, p_emissao, p_validade);
  return query select v_id, 'quarentena/' || p_empresa || '/' || v_id, v_n;
end;
$$;

-- O navegador terminou de enviar: enfileira a verificação (só ids no payload).
create function priv.concluir_upload(p_empresa uuid, p_versao uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (core.has_permission(p_empresa, 'documentos', 'cadastrar') or core.has_permission(p_empresa, 'documentos', 'substituir_arquivos')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.documento_versoes set enviado_em = now()
   where id = p_versao and empresa_id = p_empresa and status_arquivo = 'quarentena' and enviado_em is null;
  if not found then
    raise exception 'versão não encontrada ou já enviada' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('verificar_arquivo', p_empresa, jsonb_build_object('versao_id', p_versao), 'verificar:' || p_versao);
end;
$$;

-- Só o worker libera ou bloqueia (e só uma vez), depois de verificar o arquivo.
create function priv.registrar_verificacao(p_versao uuid, p_status text, p_tipo_real text, p_tamanho bigint, p_sha256 text, p_motivo text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
  v_chave text;
begin
  if p_status not in ('liberado', 'bloqueado') then
    raise exception 'status inválido' using errcode = 'invalid_parameter_value';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and status_arquivo = 'quarentena' for update;
  if not found then
    raise exception 'versão não está em quarentena' using errcode = 'no_data_found';
  end if;
  v_chave := case when p_status = 'liberado'
                  then 'documentos/' || v.empresa_id || '/' || v.documento_id || '/' || v.versao else v.arquivo_chave end;
  update priv.documento_versoes
     set status_arquivo = p_status, tipo_real = p_tipo_real, tamanho = p_tamanho, sha256 = p_sha256,
         motivo_bloqueio = case when p_status = 'bloqueado' then left(p_motivo, 300) end, arquivo_chave = v_chave
   where id = p_versao;
  return v_chave;
end;
$$;

-- Download: permissão, versão liberada e REGISTRO de quem baixou; devolve a chave para a API assinar.
create function priv.registrar_download(p_empresa uuid, p_versao uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and empresa_id = p_empresa and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível' using errcode = 'no_data_found';
  end if;
  insert into priv.documento_downloads (documento_id, empresa_id, versao_id, usuario_id, ip)
  values (v.documento_id, p_empresa, p_versao, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$$;

-- Status calculado (nunca digitado). A vencer = dentro da MAIOR antecedência do tipo.
create view priv.documentos_status with (security_invoker = true) as
select d.id as documento_id, d.empresa_id, d.tipo_id, v.id as versao_id, v.validade,
  case
    when d.em_atualizacao then 'em_atualizacao'
    when v.id is null then 'pendente'
    when d.sem_vencimento or v.validade is null then 'valido'
    when v.validade < (now() at time zone 'America/Sao_Paulo')::date then 'vencido'
    when v.validade <= (now() at time zone 'America/Sao_Paulo')::date + (select max(a) from unnest(t.antecedencias) a) then 'a_vencer'
    else 'valido'
  end as status
from priv.documentos d
join pub.tipos_documento t on t.id = d.tipo_id
left join lateral (select x.* from priv.documento_versoes x where x.documento_id = d.id and x.status_arquivo = 'liberado' order by x.versao desc limit 1) v on true
where d.deleted_at is null;
grant select on priv.documentos_status to vv_api;

grant execute on function priv.iniciar_versao(uuid, uuid, text, bigint, date, date), priv.concluir_upload(uuid, uuid), priv.registrar_download(uuid, uuid) to vv_api;
grant execute on function priv.registrar_verificacao(uuid, text, text, bigint, text, text) to vv_worker;
grant usage on schema priv to vv_worker;

-- migrate:down
drop view priv.documentos_status;
drop function priv.registrar_download(uuid, uuid), priv.registrar_verificacao(uuid, text, text, bigint, text, text), priv.concluir_upload(uuid, uuid), priv.iniciar_versao(uuid, uuid, text, bigint, date, date);
drop table priv.documento_downloads, priv.documento_versoes, priv.documentos;
drop table pub.tipos_documento;
