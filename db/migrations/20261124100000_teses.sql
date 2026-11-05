-- Fase 10 · 10.8 Banco de teses. Tese = argumento jurídico reutilizável por tipo de peça, APROVADA pelo perfil que aprova peças depois que o worker
-- confere que nenhuma citação do texto está fora da base jurídica verificada. Usar uma tese numa peça fica registrado (priv.peca_teses) e, quando a
-- peça tem resultado, o banco soma usos e deferimentos por tese (10.9). O sistema não decide o que é "boa tese": só registra uso e resultado.

-- migrate:up
create table priv.teses (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  tipo_peca      text not null check (tipo_peca in ('esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes')),
  titulo         text not null check (char_length(titulo) between 3 and 200),
  texto          text not null check (char_length(texto) between 20 and 4000),
  status         text not null default 'rascunho' check (status in ('rascunho', 'aprovada', 'arquivada')),
  validacao      jsonb,
  validada_em    timestamptz,
  bloqueada      boolean not null default true,
  criada_por     uuid default core.usuario_atual() references core.usuarios (id),
  aprovada_por   uuid references core.usuarios (id),
  aprovada_em    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  check (status <> 'aprovada' or (aprovada_por is not null and aprovada_em is not null)),
  unique (id, empresa_id)
);
create index teses_empresa_idx on priv.teses (empresa_id, tipo_peca) where deleted_at is null;

create table priv.peca_teses (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  peca_id     uuid not null,
  tese_id     uuid not null,
  usada_por   uuid default core.usuario_atual() references core.usuarios (id),
  created_at  timestamptz not null default now(),
  foreign key (peca_id, empresa_id) references priv.pecas (id, empresa_id) on delete cascade,
  foreign key (tese_id, empresa_id) references priv.teses (id, empresa_id) on delete cascade,
  unique (peca_id, tese_id)
);
create index peca_teses_tese_idx on priv.peca_teses (tese_id);

alter table priv.teses enable row level security;
alter table priv.peca_teses enable row level security;
create policy teses_select on priv.teses for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
create policy peca_teses_select on priv.peca_teses for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.teses, priv.peca_teses to vv_api;
grant select on priv.teses, priv.peca_teses to vv_worker;
grant update (validacao, validada_em, bloqueada) on priv.teses to vv_worker;
create trigger teses_updated_at before update on priv.teses for each row execute function core.set_updated_at();
create trigger teses_audit after insert or update on priv.teses for each row execute function audit.registrar();
alter table priv.teses enable always trigger teses_audit;
create trigger peca_teses_audit after insert on priv.peca_teses for each row execute function audit.registrar();
alter table priv.peca_teses enable always trigger peca_teses_audit;

create function priv.enfileirar_tese(p_empresa uuid, p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('validar_tese', p_empresa, jsonb_build_object('tese_id', p_id),
                        'tese:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
$$;
revoke all on function priv.enfileirar_tese(uuid, uuid) from public;

create function priv.criar_tese(p_empresa uuid, p_tipo text, p_titulo text, p_texto text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  insert into priv.teses (empresa_id, tipo_peca, titulo, texto) values (p_empresa, p_tipo, btrim(p_titulo), btrim(p_texto)) returning id into v_id;
  perform priv.enfileirar_tese(p_empresa, v_id);
  return v_id;
end;
$$;
grant execute on function priv.criar_tese(uuid, text, text, text) to vv_api;

-- Editar volta a tese para rascunho (perde a aprovação) e pede nova conferência das citações.
create function priv.editar_tese(p_empresa uuid, p_id uuid, p_titulo text, p_texto text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set titulo = btrim(p_titulo), texto = btrim(p_texto), status = 'rascunho', aprovada_por = null, aprovada_em = null,
         validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status in ('rascunho', 'aprovada');
  if not found then
    raise exception 'tese não encontrada ou arquivada' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_tese(p_empresa, p_id);
end;
$$;
grant execute on function priv.editar_tese(uuid, uuid, text, text) to vv_api;

create function priv.aprovar_tese(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set status = 'aprovada', aprovada_por = core.usuario_atual(), aprovada_em = now()
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status = 'rascunho' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se aprova uma tese em rascunho, conferida e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;
grant execute on function priv.aprovar_tese(uuid, uuid) to vv_api;

create function priv.arquivar_tese(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set status = 'arquivada' where id = p_id and empresa_id = p_empresa and deleted_at is null and status <> 'arquivada';
  if not found then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
grant execute on function priv.arquivar_tese(uuid, uuid) to vv_api;

-- Registra que a tese foi usada na peça (idempotente). Só tese APROVADA, do mesmo tipo da peça, e antes de a peça virar documento final.
create function priv.usar_tese(p_empresa uuid, p_peca uuid, p_tese uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao')) then
    raise exception 'a tese só se usa numa peça em triagem, minuta ou revisão' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.teses t join priv.pecas p on p.tipo = t.tipo_peca
                  where t.id = p_tese and t.empresa_id = p_empresa and t.deleted_at is null and t.status = 'aprovada' and p.id = p_peca) then
    raise exception 'só se usa uma tese aprovada e do mesmo tipo da peça' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.peca_teses (empresa_id, peca_id, tese_id) values (p_empresa, p_peca, p_tese) on conflict (peca_id, tese_id) do nothing;
end;
$$;
grant execute on function priv.usar_tese(uuid, uuid, uuid) to vv_api;

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
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos', 'email_agenda', 'analisar_item', 'calcular_preco', 'gerar_proposta',
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca', 'minutar_peca', 'ler_recurso', 'validar_parecer', 'analisar_vencedora', 'sugerir_pecas',
                    'validar_tese') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.usar_tese(uuid, uuid, uuid);
drop function priv.arquivar_tese(uuid, uuid);
drop function priv.aprovar_tese(uuid, uuid);
drop function priv.editar_tese(uuid, uuid, text, text);
drop function priv.criar_tese(uuid, text, text, text);
drop function priv.enfileirar_tese(uuid, uuid);
drop table priv.peca_teses;
drop table priv.teses;
