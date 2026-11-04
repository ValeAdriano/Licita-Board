-- Fase 03 · Atestados técnicos estruturados (quantidades em numeric, unidade de pub.unidades) e as FKs que a
-- Fase 02 deixou abertas: toda referência a documento passa a exigir que o documento seja DA MESMA empresa.

-- migrate:up
create table priv.atestados_tecnicos (
  id           uuid primary key default core.uuid_v7(),
  empresa_id   uuid not null references core.empresas (id) on delete cascade,
  documento_id uuid not null,
  contratante  text not null check (char_length(contratante) between 2 and 200),
  objeto       text not null check (char_length(objeto) between 2 and 1000),
  periodo_inicio date,
  periodo_fim    date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default core.usuario_atual(),
  deleted_at   timestamptz,
  unique (id, empresa_id),
  check (periodo_inicio is null or periodo_fim is null or periodo_fim >= periodo_inicio),
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id)
);
create index atestados_tecnicos_empresa_idx on priv.atestados_tecnicos (empresa_id);

create table priv.atestado_itens (
  id          uuid primary key default core.uuid_v7(),
  atestado_id uuid not null,
  empresa_id  uuid not null,
  descricao   text not null check (char_length(descricao) between 2 and 300),
  quantidade  numeric(18, 4) not null check (quantidade > 0),
  unidade_id  uuid not null references pub.unidades (id),
  created_at  timestamptz not null default now(),
  foreign key (atestado_id, empresa_id) references priv.atestados_tecnicos (id, empresa_id) on delete cascade
);
create index atestado_itens_empresa_idx on priv.atestado_itens (empresa_id);

alter table priv.atestados_tecnicos enable row level security;
alter table priv.atestado_itens enable row level security;
create policy atestados_select on priv.atestados_tecnicos for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy atestados_insert on priv.atestados_tecnicos for insert to vv_api with check (core.has_permission(empresa_id, 'documentos', 'cadastrar'));
create policy atestados_update on priv.atestados_tecnicos for update to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'editar') or core.has_permission(empresa_id, 'documentos', 'arquivar'))
  with check (core.has_permission(empresa_id, 'documentos', 'editar') or core.has_permission(empresa_id, 'documentos', 'arquivar'));
create policy atestado_itens_select on priv.atestado_itens for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy atestado_itens_insert on priv.atestado_itens for insert to vv_api with check (core.has_permission(empresa_id, 'documentos', 'cadastrar'));
create policy atestado_itens_delete on priv.atestado_itens for delete to vv_api using (core.has_permission(empresa_id, 'documentos', 'editar'));

grant select on priv.atestados_tecnicos, priv.atestado_itens to vv_api;
grant insert (empresa_id, documento_id, contratante, objeto, periodo_inicio, periodo_fim) on priv.atestados_tecnicos to vv_api;
grant update (contratante, objeto, periodo_inicio, periodo_fim, deleted_at) on priv.atestados_tecnicos to vv_api;
grant insert (atestado_id, empresa_id, descricao, quantidade, unidade_id), delete on priv.atestado_itens to vv_api;

create trigger atestados_updated_at before update on priv.atestados_tecnicos for each row execute function core.set_updated_at();
create trigger atestados_audit after insert or update or delete on priv.atestados_tecnicos for each row execute function audit.registrar();
alter table priv.atestados_tecnicos enable always trigger atestados_audit;

-- FKs que a Fase 02 deixou abertas (documento da MESMA empresa; nulo = sem arquivo ainda).
alter table core.representantes add foreign key (assinatura_documento_id, empresa_id) references priv.documentos (id, empresa_id);
alter table core.procuracoes add foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id);
alter table priv.produtos add foreign key (catalogo_documento_id, empresa_id) references priv.documentos (id, empresa_id);
alter table priv.produtos add foreign key (ficha_documento_id, empresa_id) references priv.documentos (id, empresa_id);
alter table priv.fichas_tecnicas add foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id);

-- migrate:down
alter table priv.fichas_tecnicas drop constraint fichas_tecnicas_documento_id_empresa_id_fkey;
alter table priv.produtos drop constraint produtos_ficha_documento_id_empresa_id_fkey;
alter table priv.produtos drop constraint produtos_catalogo_documento_id_empresa_id_fkey;
alter table core.procuracoes drop constraint procuracoes_documento_id_empresa_id_fkey;
alter table core.representantes drop constraint representantes_assinatura_documento_id_empresa_id_fkey;
drop table priv.atestado_itens, priv.atestados_tecnicos;
