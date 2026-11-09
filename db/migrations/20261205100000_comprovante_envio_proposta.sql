-- Fase 08 · Bloco 8.7: Registro do comprovante de envio da proposta ao portal (spec docs/specs/fase-08.md §7).
-- O sistema NUNCA envia proposta ao portal (regra 17): a pessoa autorizada envia fora do sistema e registra aqui o fato e o
-- comprovante (repositório da Fase 03, liberado pela verificação). Registro imutável; correção = anular com motivo e registrar de novo.

-- migrate:up
alter table pub.tipos_documento drop constraint tipos_documento_pasta_check;
alter table pub.tipos_documento add constraint tipos_documento_pasta_check
  check (pasta in ('habilitacao_juridica', 'economico_financeira', 'fiscal_trabalhista', 'tecnica', 'timbrado_modelos', 'juridico', 'licitacao'));

insert into pub.tipos_documento (slug, nome, pasta, exige_validade, emissor_url, ordem)
values ('comprovante_envio_proposta', 'Comprovante de envio de proposta', 'licitacao', false, null, 300)
on conflict (slug) do nothing;

create table priv.proposta_envios (
  id                       uuid primary key default core.uuid_v7(),
  empresa_id               uuid not null references core.empresas (id) on delete cascade,
  proposta_id              uuid not null,
  proposta_versao          int not null check (proposta_versao >= 1),
  formato                  text not null check (formato in ('docx', 'pdf', 'outro')),
  proposta_sha256          text check (proposta_sha256 is null or proposta_sha256 ~ '^[0-9a-f]{64}$'),
  enviado_em               timestamptz not null,
  portal                   text check (char_length(portal) <= 120),
  identificador_portal     text check (char_length(identificador_portal) <= 120),
  tipo_comprovante         text check (char_length(tipo_comprovante) <= 120),
  representante_id         uuid,
  comprovante_documento_id uuid not null,
  comprovante_versao_id    uuid not null references priv.documento_versoes (id),
  observacao               text check (char_length(observacao) <= 1000),
  registrado_em            timestamptz not null default now(),
  registrado_por           uuid not null default core.usuario_atual() references core.usuarios (id),
  anulado_em               timestamptz,
  anulado_por              uuid references core.usuarios (id),
  anulado_motivo           text check (anulado_motivo is null or char_length(btrim(anulado_motivo)) between 10 and 1000),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid default core.usuario_atual(),
  deleted_at               timestamptz,
  foreign key (proposta_id, empresa_id) references priv.propostas (id, empresa_id) on delete cascade,
  foreign key (comprovante_documento_id, empresa_id) references priv.documentos (id, empresa_id),
  foreign key (representante_id, empresa_id) references core.representantes (id, empresa_id),
  check (enviado_em <= registrado_em + interval '5 minutes'),
  check ((anulado_em is null and anulado_por is null and anulado_motivo is null)
      or (anulado_em is not null and anulado_por is not null and anulado_motivo is not null)),
  unique (id, empresa_id)
);
create index proposta_envios_proposta_idx on priv.proposta_envios (proposta_id, registrado_em desc);
create index proposta_envios_empresa_idx on priv.proposta_envios (empresa_id);

-- Registro imutável (RF-08.10): UPDATE só pode preencher os três campos de anulação uma única vez.
create function priv.proposta_envios_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.anulado_em is null and new.anulado_em is not null and new.anulado_por is not null and new.anulado_motivo is not null
     and (to_jsonb(old) - 'anulado_em' - 'anulado_por' - 'anulado_motivo' - 'updated_at')
       = (to_jsonb(new) - 'anulado_em' - 'anulado_por' - 'anulado_motivo' - 'updated_at') then
    return new;
  end if;
  raise exception 'registro de envio de proposta é imutável: só pode ser anulado uma vez' using errcode = 'insufficient_privilege';
end;
$$;
create trigger proposta_envios_imutavel before update on priv.proposta_envios for each row execute function priv.proposta_envios_imutavel();
create trigger proposta_envios_updated_at before update on priv.proposta_envios for each row execute function core.set_updated_at();

alter table priv.proposta_envios enable row level security;
create policy proposta_envios_select on priv.proposta_envios for select to vv_api
  using (core.has_permission(empresa_id, 'propostas', 'visualizar'));
grant select on priv.proposta_envios to vv_api;
create trigger proposta_envios_audit after insert or update on priv.proposta_envios for each row execute function audit.registrar();
alter table priv.proposta_envios enable always trigger proposta_envios_audit;

-- Registra o envio humano da proposta ao portal e move as participações dos itens para 'proposta_cadastrada' sem regredir status posterior.
create function priv.registrar_envio_proposta(
  p_empresa uuid,
  p_proposta uuid,
  p_enviado_em timestamptz,
  p_formato text,
  p_portal text,
  p_identificador text,
  p_documento uuid,
  p_observacao text,
  p_tipo_comprovante text default null,
  p_representante uuid default null
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prop record;
  v_doc record;
  v_versao record;
  v_portal_acomp text;
  v_sha256 text;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') or not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, acompanhamento_id, versao, status, arquivo_sha256, arquivo_pdf_sha256, conteudo, representante_id
    into v_prop
    from priv.propostas
   where id = p_proposta and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  select d.id, t.slug as tipo_slug
    into v_doc
    from priv.documentos d
    join pub.tipos_documento t on t.id = d.tipo_id
   where d.id = p_documento and d.empresa_id = p_empresa and d.deleted_at is null;
  if not found then
    raise exception 'documento do comprovante não encontrado' using errcode = 'no_data_found';
  end if;
  if p_representante is not null and not exists (select 1 from core.representantes where id = p_representante and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'representante não encontrado' using errcode = 'no_data_found';
  end if;
  if v_prop.status <> 'final' then
    raise exception 'só se registra envio de proposta com status final' using errcode = 'invalid_parameter_value';
  end if;
  if p_formato is null or p_formato not in ('docx', 'pdf', 'outro') then
    raise exception 'formato de envio inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_enviado_em is null or p_enviado_em > now() + interval '5 minutes' then
    raise exception 'a data/hora do envio é obrigatória e não pode ser futura' using errcode = 'invalid_parameter_value';
  end if;
  if v_doc.tipo_slug <> 'comprovante_envio_proposta' then
    raise exception 'o comprovante precisa ser do tipo comprovante_envio_proposta' using errcode = 'invalid_parameter_value';
  end if;
  select id, status_arquivo
    into v_versao
    from priv.documento_versoes
   where documento_id = p_documento and empresa_id = p_empresa
   order by versao desc limit 1;
  if not found or v_versao.status_arquivo <> 'liberado' then
    raise exception 'o comprovante precisa ter a última versão liberada pela verificação' using errcode = 'invalid_parameter_value';
  end if;

  select portal into v_portal_acomp from priv.acompanhamentos where id = v_prop.acompanhamento_id and empresa_id = p_empresa;
  v_sha256 := case
    when p_formato = 'docx' then v_prop.arquivo_sha256
    when p_formato = 'pdf' then coalesce(v_prop.arquivo_pdf_sha256, v_prop.arquivo_sha256)
    else null
  end;

  insert into priv.proposta_envios (
    empresa_id, proposta_id, proposta_versao, formato, proposta_sha256, enviado_em, portal, identificador_portal,
    tipo_comprovante, representante_id, comprovante_documento_id, comprovante_versao_id, observacao
  ) values (
    p_empresa, p_proposta, v_prop.versao, p_formato, v_sha256, p_enviado_em,
    coalesce(nullif(btrim(p_portal), ''), v_portal_acomp),
    nullif(btrim(p_identificador), ''),
    nullif(btrim(p_tipo_comprovante), ''),
    coalesce(p_representante, v_prop.representante_id),
    p_documento, v_versao.id,
    nullif(btrim(p_observacao), '')
  ) returning id into v_id;

  -- RF-08.11: atualiza as participações dos itens da proposta para 'proposta_cadastrada' sem regredir status posterior.
  update priv.participacoes p
     set status = 'proposta_cadastrada'
   where p.empresa_id = p_empresa
     and p.acompanhamento_id = v_prop.acompanhamento_id
     and p.deleted_at is null
     and p.status in ('avaliando', 'aguardando_analise', 'vai_participar', 'proposta_preparada')
     and (
       jsonb_array_length(v_prop.conteudo) = 0
       or exists (
         select 1 from jsonb_array_elements(v_prop.conteudo) elem
          where elem->>'participacao_id' = p.id::text
       )
     );

  return v_id;
end;
$$;
revoke all on function priv.registrar_envio_proposta(uuid, uuid, timestamptz, text, text, text, uuid, text, text, uuid) from public;
grant execute on function priv.registrar_envio_proposta(uuid, uuid, timestamptz, text, text, text, uuid, text, text, uuid) to vv_api;

-- Anula um registro de envio (única vez; exige motivo >= 10 caracteres; não desfaz status das participações).
create function priv.anular_envio_proposta(p_empresa uuid, p_envio uuid, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_envio record;
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, anulado_em into v_envio
    from priv.proposta_envios
   where id = p_envio and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'registro de envio não encontrado' using errcode = 'no_data_found';
  end if;
  if v_envio.anulado_em is not null then
    raise exception 'este registro de envio já foi anulado' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 10 or char_length(btrim(coalesce(p_motivo, ''))) > 1000 then
    raise exception 'informe o motivo da anulação (entre 10 e 1000 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.proposta_envios
     set anulado_em = now(), anulado_por = core.usuario_atual(), anulado_motivo = btrim(p_motivo)
   where id = p_envio and empresa_id = p_empresa;
end;
$$;
revoke all on function priv.anular_envio_proposta(uuid, uuid, text) from public;
grant execute on function priv.anular_envio_proposta(uuid, uuid, text) to vv_api;

-- migrate:down
drop function priv.anular_envio_proposta(uuid, uuid, text), priv.registrar_envio_proposta(uuid, uuid, timestamptz, text, text, text, uuid, text, text, uuid);
drop table priv.proposta_envios;
drop function priv.proposta_envios_imutavel();
delete from pub.tipos_documento where slug = 'comprovante_envio_proposta';
alter table pub.tipos_documento drop constraint tipos_documento_pasta_check;
alter table pub.tipos_documento add constraint tipos_documento_pasta_check
  check (pasta in ('habilitacao_juridica', 'economico_financeira', 'fiscal_trabalhista', 'tecnica', 'timbrado_modelos', 'juridico'));
