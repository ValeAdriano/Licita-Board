-- Fase 09 · Bloco 9.5: Documentos posteriores à disputa (spec docs/specs/fase-09.md §5).
-- Linha do tempo pós-sessão, foto da habilitação própria apresentada, tipos documentais na pasta 'licitacao',
-- bloqueio de duplicidade quando já há contrato cadastrado e preservação do princípio arrematação ≠ homologação (CA-8)
-- e de não lançar prazo automaticamente a partir de documento (CA-9, regra 2).

-- migrate:up
insert into pub.tipos_documento (slug, nome, pasta, exige_validade, emissor_url, ordem) values
  ('ata_sessao', 'Ata de sessão', 'licitacao', false, null, 310),
  ('decisao_administrativa', 'Decisão administrativa', 'licitacao', false, null, 320),
  ('adjudicacao', 'Termo de adjudicação', 'licitacao', false, null, 330),
  ('homologacao', 'Termo de homologação', 'licitacao', false, null, 340),
  ('ata_registro_precos', 'Ata de registro de preços', 'licitacao', false, null, 350),
  ('contrato_assinado', 'Contrato assinado', 'licitacao', false, null, 360),
  ('nota_empenho', 'Nota de empenho / autorização de fornecimento', 'licitacao', false, null, 370),
  ('habilitacao_concorrente', 'Documentos de habilitação da vencedora', 'licitacao', false, null, 380),
  ('recurso_terceiro_arquivo', 'Recurso ou contrarrazões de terceiro (arquivo)', 'licitacao', false, null, 390)
on conflict (slug) do nothing;

create table priv.documentos_posteriores (
  id                  uuid primary key default core.uuid_v7(),
  empresa_id          uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id   uuid not null,
  participacao_id     uuid,
  tipo                text not null check (tipo in (
                        'ata_sessao', 'habilitacao_propria', 'habilitacao_vencedora', 'decisao',
                        'adjudicacao', 'homologacao', 'ata_registro_precos', 'contrato', 'empenho',
                        'recurso_terceiro', 'contrarrazoes_terceiro', 'outro'
                      )),
  subtipo             text check (subtipo is null or subtipo in ('recurso', 'impugnacao', 'esclarecimento', 'habilitacao', 'outra')),
  data_ato            date not null,
  numero              text check (char_length(numero) <= 80),
  documento_id        uuid,
  documento_versao_id uuid references priv.documento_versoes (id),
  link_publico        text check (link_publico is null or (link_publico ~ '^https://[^\s]+$' and char_length(link_publico) <= 500)),
  concorrente_cnpj    text check (concorrente_cnpj is null or concorrente_cnpj ~ '^[0-9A-Z]{14}$'),
  recurso_terceiro_id uuid,
  observacao          text check (char_length(observacao) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default core.usuario_atual(),
  deleted_at          timestamptz,
  removido_por        uuid references core.usuarios (id),
  removido_motivo     text check (removido_motivo is null or char_length(btrim(removido_motivo)) between 5 and 500),
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id),
  foreign key (recurso_terceiro_id, empresa_id) references priv.recursos_terceiros (id, empresa_id),
  check (documento_id is not null or link_publico is not null),
  check (tipo <> 'habilitacao_propria' or documento_versao_id is not null),
  check ((tipo = 'decisao' and subtipo is not null) or (tipo <> 'decisao' and subtipo is null)),
  check (concorrente_cnpj is null or tipo in ('habilitacao_vencedora', 'recurso_terceiro', 'contrarrazoes_terceiro')),
  check ((deleted_at is null and removido_por is null and removido_motivo is null)
      or (deleted_at is not null and removido_por is not null and removido_motivo is not null)),
  unique (id, empresa_id)
);
create index documentos_posteriores_acomp_idx on priv.documentos_posteriores (acompanhamento_id, data_ato desc) where deleted_at is null;
create index documentos_posteriores_empresa_idx on priv.documentos_posteriores (empresa_id);
create index documentos_posteriores_doc_idx on priv.documentos_posteriores (documento_id) where documento_id is not null;
create unique index documentos_posteriores_hab_uk on priv.documentos_posteriores (acompanhamento_id, tipo, documento_versao_id)
  where tipo = 'habilitacao_propria' and deleted_at is null;

alter table priv.documentos_posteriores enable row level security;
create policy documentos_posteriores_select on priv.documentos_posteriores for select to vv_api
  using (
    core.has_permission(empresa_id, 'agenda', 'visualizar')
    or (tipo in ('contrato', 'ata_registro_precos', 'empenho') and core.has_permission(empresa_id, 'contratos', 'visualizar'))
  );
grant select on priv.documentos_posteriores to vv_api;
create trigger documentos_posteriores_updated_at before update on priv.documentos_posteriores for each row execute function core.set_updated_at();
create trigger documentos_posteriores_audit after insert or update on priv.documentos_posteriores for each row execute function audit.registrar();
alter table priv.documentos_posteriores enable always trigger documentos_posteriores_audit;

-- Registra um documento posterior à disputa (arquivo do repositório ou link https). Nunca altera resultados_item nem cria evento na agenda.
create function priv.registrar_documento_posterior(
  p_empresa uuid,
  p_acomp uuid,
  p_participacao uuid,
  p_tipo text,
  p_subtipo text,
  p_data_ato date,
  p_numero text,
  p_documento uuid,
  p_link text,
  p_concorrente_cnpj text,
  p_recurso_terceiro uuid,
  p_observacao text
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_part_acomp uuid;
  v_rec_acomp uuid;
  v_doc record;
  v_versao record;
  v_versao_id uuid := null;
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_subtipo text := nullif(btrim(coalesce(p_subtipo, '')), '');
  v_cnpj text := nullif(upper(regexp_replace(coalesce(p_concorrente_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  v_slug_esperado text;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_documento is not null and not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  if p_participacao is not null then
    select acompanhamento_id into v_part_acomp
      from priv.participacoes
     where id = p_participacao and empresa_id = p_empresa and deleted_at is null;
    if not found then
      raise exception 'participação não encontrada' using errcode = 'no_data_found';
    end if;
    if v_part_acomp <> p_acomp then
      raise exception 'a participação não pertence a este acompanhamento' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_documento is not null then
    select d.id, t.slug as tipo_slug into v_doc
      from priv.documentos d
      join pub.tipos_documento t on t.id = d.tipo_id
     where d.id = p_documento and d.empresa_id = p_empresa and d.deleted_at is null;
    if not found then
      raise exception 'documento não encontrado no repositório' using errcode = 'no_data_found';
    end if;
  end if;
  if p_recurso_terceiro is not null then
    select acompanhamento_id into v_rec_acomp
      from priv.recursos_terceiros
     where id = p_recurso_terceiro and empresa_id = p_empresa;
    if not found then
      raise exception 'recurso de terceiro não encontrado' using errcode = 'no_data_found';
    end if;
    if v_rec_acomp <> p_acomp then
      raise exception 'o recurso de terceiro não pertence a este acompanhamento' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if p_tipo is null or p_tipo not in (
    'ata_sessao', 'habilitacao_propria', 'habilitacao_vencedora', 'decisao',
    'adjudicacao', 'homologacao', 'ata_registro_precos', 'contrato', 'empenho',
    'recurso_terceiro', 'contrarrazoes_terceiro', 'outro'
  ) then
    raise exception 'tipo de documento posterior inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_tipo = 'decisao' and (v_subtipo is null or v_subtipo not in ('recurso', 'impugnacao', 'esclarecimento', 'habilitacao', 'outra')) then
    raise exception 'decisão exige subtipo válido (recurso, impugnacao, esclarecimento, habilitacao ou outra)' using errcode = 'invalid_parameter_value';
  end if;
  if p_tipo <> 'decisao' and v_subtipo is not null then
    raise exception 'subtipo só é permitido quando o tipo é decisão' using errcode = 'invalid_parameter_value';
  end if;
  if p_data_ato is null or p_data_ato > current_date then
    raise exception 'a data do ato é obrigatória e não pode ser futura' using errcode = 'invalid_parameter_value';
  end if;
  if p_documento is null and v_link is null then
    raise exception 'informe um documento do repositório ou um link público https' using errcode = 'invalid_parameter_value';
  end if;
  if v_link is not null and (v_link !~ '^https://[^\s]+$' or char_length(v_link) > 500) then
    raise exception 'o link público precisa começar com https:// e ter até 500 caracteres' using errcode = 'invalid_parameter_value';
  end if;
  if p_tipo in ('contrato', 'ata_registro_precos', 'empenho')
     and exists (select 1 from priv.contratos where acompanhamento_id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'já existe contrato cadastrado para este acompanhamento: anexe no contrato' using errcode = 'invalid_parameter_value';
  end if;
  if v_cnpj is not null then
    if p_tipo not in ('habilitacao_vencedora', 'recurso_terceiro', 'contrarrazoes_terceiro') then
      raise exception 'CNPJ da concorrente só se aplica a habilitação da vencedora ou recurso/contrarrazões de terceiro' using errcode = 'invalid_parameter_value';
    end if;
    if not core.cnpj_valido(v_cnpj) then
      raise exception 'CNPJ da concorrente inválido' using errcode = 'invalid_parameter_value';
    end if;
  end if;

  if p_documento is not null then
    v_slug_esperado := case p_tipo
      when 'ata_sessao' then 'ata_sessao'
      when 'decisao' then 'decisao_administrativa'
      when 'adjudicacao' then 'adjudicacao'
      when 'homologacao' then 'homologacao'
      when 'ata_registro_precos' then 'ata_registro_precos'
      when 'contrato' then 'contrato_assinado'
      when 'empenho' then 'nota_empenho'
      when 'habilitacao_vencedora' then 'habilitacao_concorrente'
      when 'recurso_terceiro' then 'recurso_terceiro_arquivo'
      when 'contrarrazoes_terceiro' then 'recurso_terceiro_arquivo'
      else null
    end;
    if v_slug_esperado is not null and v_doc.tipo_slug <> v_slug_esperado then
      raise exception 'o documento selecionado não é do tipo esperado (%) para este ato', v_slug_esperado using errcode = 'invalid_parameter_value';
    end if;
    select id, status_arquivo into v_versao
      from priv.documento_versoes
     where documento_id = p_documento and empresa_id = p_empresa
     order by versao desc limit 1;
    if not found or v_versao.status_arquivo <> 'liberado' then
      raise exception 'o documento precisa ter a última versão liberada pela verificação' using errcode = 'invalid_parameter_value';
    end if;
    v_versao_id := v_versao.id;
  end if;
  if p_tipo = 'habilitacao_propria' and v_versao_id is null then
    raise exception 'habilitação própria exige documento com versão liberada' using errcode = 'invalid_parameter_value';
  end if;

  insert into priv.documentos_posteriores (
    empresa_id, acompanhamento_id, participacao_id, tipo, subtipo, data_ato, numero,
    documento_id, documento_versao_id, link_publico, concorrente_cnpj, recurso_terceiro_id, observacao
  ) values (
    p_empresa, p_acomp, p_participacao, p_tipo, v_subtipo, p_data_ato, nullif(btrim(p_numero), ''),
    p_documento, v_versao_id, v_link, v_cnpj, p_recurso_terceiro, nullif(btrim(p_observacao), '')
  ) returning id into v_id;

  return v_id;
end;
$$;
revoke all on function priv.registrar_documento_posterior(uuid, uuid, uuid, text, text, date, text, uuid, text, text, uuid, text) from public;
grant execute on function priv.registrar_documento_posterior(uuid, uuid, uuid, text, text, date, text, uuid, text, text, uuid, text) to vv_api;

-- Registra a "foto" da habilitação própria apresentada a partir das exigências aplicáveis do checklist na data informada (CA-11).
create function priv.registrar_habilitacao_apresentada(
  p_empresa uuid,
  p_acomp uuid,
  p_data_ato date
) returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') or not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  if p_data_ato is null or p_data_ato > current_date then
    raise exception 'a data do ato é obrigatória e não pode ser futura' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (
    select 1 from priv.checklist_exigencias
     where acompanhamento_id = p_acomp and empresa_id = p_empresa and deleted_at is null and aplicavel
  ) then
    raise exception 'nenhuma exigência aplicável no checklist deste acompanhamento' using errcode = 'invalid_parameter_value';
  end if;

  insert into priv.documentos_posteriores (
    empresa_id, acompanhamento_id, tipo, data_ato, numero, documento_id, documento_versao_id, observacao
  )
  select p_empresa, p_acomp, 'habilitacao_propria', p_data_ato, chosen.numero, chosen.documento_id, chosen.versao_id,
         'Habilitação apresentada (' || t.nome || ')'
    from priv.checklist_exigencias ce
    join pub.tipos_documento t on t.id = ce.tipo_id
    join lateral (
      select d.id as documento_id, d.numero, dv.id as versao_id
        from priv.documentos d
        join lateral (
          select x.id, x.validade, x.versao
            from priv.documento_versoes x
           where x.documento_id = d.id and x.empresa_id = p_empresa and x.status_arquivo = 'liberado'
           order by x.versao desc limit 1
        ) dv on true
       where d.empresa_id = p_empresa
         and d.tipo_id = ce.tipo_id
         and d.deleted_at is null
         and (not t.exige_validade or d.sem_vencimento or dv.validade is null or dv.validade >= p_data_ato)
       order by dv.validade desc nulls first, d.updated_at desc
       limit 1
    ) chosen on true
   where ce.acompanhamento_id = p_acomp
     and ce.empresa_id = p_empresa
     and ce.deleted_at is null
     and ce.aplicavel
  on conflict (acompanhamento_id, tipo, documento_versao_id) where tipo = 'habilitacao_propria' and deleted_at is null
  do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function priv.registrar_habilitacao_apresentada(uuid, uuid, date) from public;
grant execute on function priv.registrar_habilitacao_apresentada(uuid, uuid, date) to vv_api;

-- Remove (soft delete) um documento posterior com motivo auditado; o arquivo no repositório permanece intacto.
create function priv.remover_documento_posterior(p_empresa uuid, p_id uuid, p_motivo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_doc record;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, deleted_at into v_doc
    from priv.documentos_posteriores
   where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'documento posterior não encontrado' using errcode = 'no_data_found';
  end if;
  if v_doc.deleted_at is not null then
    raise exception 'este documento posterior já foi removido' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 or char_length(btrim(coalesce(p_motivo, ''))) > 500 then
    raise exception 'informe o motivo da remoção (entre 5 e 500 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.documentos_posteriores
     set deleted_at = now(), removido_por = core.usuario_atual(), removido_motivo = btrim(p_motivo)
   where id = p_id and empresa_id = p_empresa;
end;
$$;
revoke all on function priv.remover_documento_posterior(uuid, uuid, text) from public;
grant execute on function priv.remover_documento_posterior(uuid, uuid, text) to vv_api;

-- migrate:down
drop function priv.remover_documento_posterior(uuid, uuid, text),
  priv.registrar_habilitacao_apresentada(uuid, uuid, date),
  priv.registrar_documento_posterior(uuid, uuid, uuid, text, text, date, text, uuid, text, text, uuid, text);
drop table priv.documentos_posteriores;
delete from pub.tipos_documento
 where slug in (
   'ata_sessao', 'decisao_administrativa', 'adjudicacao', 'homologacao',
   'ata_registro_precos', 'contrato_assinado', 'nota_empenho',
   'habilitacao_concorrente', 'recurso_terceiro_arquivo'
 );
