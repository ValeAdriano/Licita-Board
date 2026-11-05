-- Fase 11 · anexos do contrato por etapa, documentos de regularidade durante a execução e pedido de reajuste/reequilíbrio pelo jurídico.
-- Anexo = vínculo entre o contrato (ou um empenho/etapa dele) e um documento que JÁ está no repositório da Fase 03 (quarentena, antivírus, versões,
-- alertas de validade). O arquivo não é copiado: a validade e o status vêm do repositório. Pedido ao órgão = peça jurídica (tipo reajuste ou
-- reequilíbrio) no fluxo normal (minuta, conferência de citações, aprovação, documento final, protocolo humano). ⚖️ O sistema não calcula índice
-- de reajuste nem decide direito a reequilíbrio: registra e encaminha ao jurídico.

-- migrate:up
alter table priv.pecas drop constraint pecas_tipo_check;
alter table priv.pecas add constraint pecas_tipo_check check (tipo in ('esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes', 'reajuste', 'reequilibrio'));
alter table priv.pecas add column contrato_id uuid;
alter table priv.pecas add constraint pecas_contrato_fk foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id);
create index pecas_contrato_idx on priv.pecas (contrato_id) where contrato_id is not null;

create table priv.contrato_anexos (
  id           uuid primary key default core.uuid_v7(),
  empresa_id   uuid not null references core.empresas (id) on delete cascade,
  contrato_id  uuid not null,
  empenho_id   uuid,
  etapa        text check (etapa in ('pedido_recebido', 'pedido_fornecedor', 'aguardando_producao', 'produto_disponivel', 'faturamento_autorizado',
                                      'nota_emitida', 'transporte', 'entrega', 'recebimento_provisorio', 'recebimento_definitivo', 'concluido')),
  documento_id uuid not null,
  nota         text check (char_length(nota) <= 300),
  created_at   timestamptz not null default now(),
  created_by   uuid default core.usuario_atual(),
  foreign key (contrato_id, empresa_id) references priv.contratos (id, empresa_id) on delete cascade,
  foreign key (empenho_id, empresa_id) references priv.empenhos (id, empresa_id) on delete cascade,
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id),
  check (etapa is null or empenho_id is not null)
);
create unique index contrato_anexos_uk on priv.contrato_anexos (contrato_id, documento_id, coalesce(empenho_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(etapa, ''));
create index contrato_anexos_contrato_idx on priv.contrato_anexos (contrato_id);
alter table priv.contrato_anexos enable row level security;
create policy contrato_anexos_select on priv.contrato_anexos for select to vv_api using (core.has_permission(empresa_id, 'contratos', 'visualizar'));
grant select on priv.contrato_anexos to vv_api;
create trigger contrato_anexos_audit after insert or delete on priv.contrato_anexos for each row execute function audit.registrar();
alter table priv.contrato_anexos enable always trigger contrato_anexos_audit;

create function priv.anexar_documento_contrato(p_empresa uuid, p_contrato uuid, p_documento uuid, p_empenho uuid, p_etapa text, p_nota text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'contrato não encontrado' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.documentos where id = p_documento and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'documento não encontrado no repositório' using errcode = 'no_data_found';
  end if;
  if p_empenho is not null and not exists (select 1 from priv.empenhos where id = p_empenho and empresa_id = p_empresa and contrato_id = p_contrato) then
    raise exception 'empenho não pertence a este contrato' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.contrato_anexos (empresa_id, contrato_id, empenho_id, etapa, documento_id, nota)
  values (p_empresa, p_contrato, p_empenho, nullif(p_etapa, ''), p_documento, nullif(btrim(p_nota), '')) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function priv.anexar_documento_contrato(uuid, uuid, uuid, uuid, text, text) to vv_api;

create function priv.remover_anexo_contrato(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  delete from priv.contrato_anexos where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'anexo não encontrado' using errcode = 'no_data_found';
  end if;
end;
$$;
grant execute on function priv.remover_anexo_contrato(uuid, uuid) to vv_api;

-- Abre a peça de reajuste ou de reequilíbrio ligada ao contrato (e ao acompanhamento do edital, que a peça exige). Sem texto pronto: o jurídico redige,
-- as citações são conferidas contra a base verificada e a aprovação segue o fluxo normal.
create function priv.abrir_pedido_contratual(p_empresa uuid, p_contrato uuid, p_tipo text, p_titulo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_acomp uuid;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('reajuste', 'reequilibrio') then
    raise exception 'tipo de pedido inválido' using errcode = 'invalid_parameter_value';
  end if;
  select acompanhamento_id into v_acomp from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo';
  if not found then
    raise exception 'contrato ativo não encontrado' using errcode = 'no_data_found';
  end if;
  if v_acomp is null then
    raise exception 'o pedido jurídico precisa do edital do contrato: cadastre o contrato a partir do resultado contratado' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pecas (empresa_id, acompanhamento_id, contrato_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_acomp, p_contrato, p_tipo, btrim(p_titulo), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function priv.abrir_pedido_contratual(uuid, uuid, text, text) to vv_api;

-- migrate:down
drop function priv.abrir_pedido_contratual(uuid, uuid, text, text);
drop function priv.remover_anexo_contrato(uuid, uuid);
drop function priv.anexar_documento_contrato(uuid, uuid, uuid, uuid, text, text);
drop table priv.contrato_anexos;
alter table priv.pecas drop constraint pecas_contrato_fk;
alter table priv.pecas drop column contrato_id;
alter table priv.pecas drop constraint pecas_tipo_check;
alter table priv.pecas add constraint pecas_tipo_check check (tipo in ('esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes'));
