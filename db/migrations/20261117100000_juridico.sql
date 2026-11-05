-- Fase 10 · Módulo jurídico, núcleo (spec docs/specs/fase-10.md). Base jurídica VERIFICADA (nasce vazia: nada é cadastrado por mim), peças com fluxo,
-- conferência de citações pelo worker, documento final com hash e PDF, protocolo humano. Perfil JURIDICO decide; o sistema nunca protocola.

-- migrate:up
create table priv.base_juridica (
  id            uuid primary key default core.uuid_v7(),
  empresa_id    uuid not null references core.empresas (id) on delete cascade,
  tipo          text not null check (tipo in ('lei', 'lei_complementar', 'decreto', 'regulamento', 'acordao', 'sumula', 'constituicao')),
  numero        text check (char_length(numero) <= 40),
  orgao         text check (char_length(orgao) <= 40),
  dispositivo   text check (char_length(dispositivo) <= 60),
  titulo        text not null check (char_length(titulo) between 3 and 300),
  ementa        text check (char_length(ementa) <= 4000),
  data_ato      date,
  link_oficial  text not null check (link_oficial ~ '^https://[^\s]+$' and char_length(link_oficial) <= 500),
  verificada_por uuid references core.usuarios (id),
  verificada_em  timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid default core.usuario_atual(),
  deleted_at    timestamptz,
  check (tipo = 'constituicao' or numero is not null),
  check ((verificada_por is null) = (verificada_em is null)),
  unique (id, empresa_id)
);
create index base_juridica_empresa_idx on priv.base_juridica (empresa_id) where deleted_at is null;

create table priv.pecas (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id  uuid not null,
  evento_id          uuid,
  tipo               text not null check (tipo in ('esclarecimento', 'impugnacao', 'recurso', 'contrarrazoes')),
  titulo             text not null check (char_length(titulo) between 3 and 200),
  status             text not null default 'triagem' check (status in ('sugerida', 'triagem', 'minuta', 'revisao', 'aprovada', 'final', 'protocolada', 'respondida', 'descartada')),
  minuta             text check (char_length(minuta) <= 60000),
  clausulas          text check (char_length(clausulas) <= 2000),
  justificativa_descarte text check (char_length(justificativa_descarte) <= 1000),
  validacao          jsonb,
  validada_em        timestamptz,
  bloqueada          boolean not null default true,
  arquivo_chave      text,
  arquivo_sha256     text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  arquivo_pdf_chave  text,
  arquivo_pdf_sha256 text check (arquivo_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  gerado_em          timestamptz,
  protocolo_numero   text check (char_length(protocolo_numero) <= 80),
  protocolado_em     timestamptz,
  protocolado_por    uuid references core.usuarios (id),
  comprovante        text check (char_length(comprovante) <= 1000),
  resultado          text check (resultado in ('deferido', 'parcialmente_deferido', 'indeferido')),
  resultado_obs      text check (char_length(resultado_obs) <= 2000),
  resultado_em       timestamptz,
  triado_por         uuid references core.usuarios (id),
  triado_em          timestamptz,
  elaborado_por      uuid references core.usuarios (id),
  revisado_por       uuid references core.usuarios (id),
  revisado_em        timestamptz,
  aprovado_por       uuid references core.usuarios (id),
  aprovado_em        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default core.usuario_atual(),
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (evento_id, empresa_id) references priv.agenda_eventos (id, empresa_id),
  check (status <> 'final' or (arquivo_chave is not null and arquivo_sha256 is not null)),
  check (status <> 'protocolada' or (protocolo_numero is not null and protocolado_em is not null)),
  unique (id, empresa_id)
);
create index pecas_empresa_idx on priv.pecas (empresa_id, status);
create index pecas_acomp_idx on priv.pecas (acompanhamento_id);

-- Depois do documento final o conteúdo NUNCA muda (só avançam protocolo, resultado e o PDF).
create function priv.pecas_final_imutavel() returns trigger language plpgsql set search_path = '' as $$
declare
  v_ok text[] := array['arquivo_pdf_chave', 'arquivo_pdf_sha256', 'updated_at', 'status', 'protocolo_numero', 'protocolado_em', 'protocolado_por', 'comprovante',
                       'resultado', 'resultado_obs', 'resultado_em'];
  v_k text;
  v_antes jsonb := to_jsonb(old);
  v_depois jsonb := to_jsonb(new);
begin
  if old.status in ('final', 'protocolada', 'respondida') then
    foreach v_k in array v_ok loop
      v_antes := v_antes - v_k;
      v_depois := v_depois - v_k;
    end loop;
    if v_antes is distinct from v_depois or (new.status = 'respondida' and old.status = 'final')
       or (old.status = 'final' and new.status not in ('final', 'protocolada'))
       or (old.status = 'protocolada' and new.status not in ('protocolada', 'respondida'))
       or (old.status = 'respondida' and new.status <> 'respondida') then
      raise exception 'peça com documento final é imutável' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
create trigger pecas_final_imutavel before update on priv.pecas for each row execute function priv.pecas_final_imutavel();
create trigger pecas_updated_at before update on priv.pecas for each row execute function core.set_updated_at();

alter table priv.base_juridica enable row level security;
alter table priv.pecas enable row level security;
create policy base_juridica_select on priv.base_juridica for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
create policy pecas_select on priv.pecas for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.base_juridica, priv.pecas to vv_api;
create trigger base_juridica_audit after insert or update on priv.base_juridica for each row execute function audit.registrar();
create trigger pecas_audit after insert or update on priv.pecas for each row execute function audit.registrar();
alter table priv.base_juridica enable always trigger base_juridica_audit;
alter table priv.pecas enable always trigger pecas_audit;

grant select on priv.base_juridica, priv.pecas to vv_worker;
grant update (validacao, validada_em, bloqueada, arquivo_chave, arquivo_sha256, arquivo_pdf_chave, arquivo_pdf_sha256, gerado_em, status, aprovado_por, aprovado_em, revisado_por, revisado_em)
  on priv.pecas to vv_worker;

create function priv.enfileirar_peca(p_empresa uuid, p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('processar_peca', p_empresa, jsonb_build_object('peca_id', p_id),
                        'peca:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
$$;
revoke all on function priv.enfileirar_peca(uuid, uuid) from public;

-- ---------------------------------------------------------------- base jurídica
create function priv.cadastrar_base_juridica(p_empresa uuid, p_tipo text, p_numero text, p_orgao text, p_dispositivo text, p_titulo text, p_ementa text, p_data date, p_link text)
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
  insert into priv.base_juridica (empresa_id, tipo, numero, orgao, dispositivo, titulo, ementa, data_ato, link_oficial)
  values (p_empresa, p_tipo, nullif(btrim(p_numero), ''), nullif(btrim(p_orgao), ''), nullif(btrim(p_dispositivo), ''), btrim(p_titulo), nullif(btrim(p_ementa), ''), p_data, btrim(p_link))
  returning id into v_id;
  return v_id;
end;
$$;

-- Verificar = a pessoa de perfil jurídico conferiu a entrada na fonte oficial. Só entrada verificada serve de base.
create function priv.verificar_base_juridica(p_empresa uuid, p_id uuid)
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
  update priv.base_juridica set verificada_por = core.usuario_atual(), verificada_em = now() where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'entrada não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

create function priv.remover_base_juridica(p_empresa uuid, p_id uuid)
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
  update priv.base_juridica set deleted_at = now() where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'entrada não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ---------------------------------------------------------------- peças
create function priv.criar_peca(p_empresa uuid, p_acomp uuid, p_tipo text, p_titulo text, p_evento uuid)
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
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.pecas (empresa_id, acompanhamento_id, evento_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, p_acomp, p_evento, p_tipo, btrim(p_titulo), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_id;
  return v_id;
end;
$$;

create function priv.descartar_peca(p_empresa uuid, p_id uuid, p_justificativa text)
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
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'o descarte exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa)
   where id = p_id and empresa_id = p_empresa and status in ('sugerida', 'triagem', 'minuta');
  if not found then
    raise exception 'só se descarta uma peça sugerida, em triagem ou em minuta' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function priv.salvar_minuta(p_empresa uuid, p_id uuid, p_minuta text, p_clausulas text)
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
  update priv.pecas set minuta = p_minuta, clausulas = nullif(btrim(p_clausulas), ''), status = 'minuta', elaborado_por = core.usuario_atual(),
         validacao = null, validada_em = null, bloqueada = true, revisado_por = null, revisado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao');
  if not found then
    raise exception 'a minuta só se edita antes da aprovação' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$$;

create function priv.revalidar_peca(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$$;

-- Revisão jurídica: só com minuta validada (todas as citações na base verificada) e sem bloqueio.
create function priv.enviar_revisao_peca(p_empresa uuid, p_id uuid)
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
  update priv.pecas set status = 'revisao' where id = p_id and empresa_id = p_empresa and status = 'minuta' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só vai à revisão uma minuta validada e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function priv.devolver_peca(p_empresa uuid, p_id uuid)
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
  update priv.pecas set status = 'minuta', revisado_por = null, revisado_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('revisao', 'aprovada');
  if not found then
    raise exception 'só se devolve uma peça em revisão ou aprovada (a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Aprovação jurídica (quem tem aprovar_peca; idealmente outra pessoa que a autora, o que fica registrado em elaborado_por/aprovado_por): só peça em
-- revisão, validada e sem divergência; pede o documento final ao worker.
create function priv.aprovar_peca(p_empresa uuid, p_id uuid)
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
  update priv.pecas set status = 'aprovada', revisado_por = core.usuario_atual(), revisado_em = now(), aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null;
  if not found then
    raise exception 'só se aprova uma peça em revisão, validada e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$$;

-- Protocolo é HUMANO: a pessoa protocolou no portal e registra número, data/hora e o comprovante. O evento da agenda passa a protocolado.
create function priv.protocolar_peca(p_empresa uuid, p_id uuid, p_numero text, p_quando timestamptz, p_comprovante text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_numero, ''))) < 2 or p_quando is null then
    raise exception 'informe o número do protocolo e a data e hora' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pecas set status = 'protocolada', protocolo_numero = btrim(p_numero), protocolado_em = p_quando, protocolado_por = core.usuario_atual(),
         comprovante = nullif(btrim(p_comprovante), '')
   where id = p_id and empresa_id = p_empresa and status = 'final' returning evento_id into v_evento;
  if not found then
    raise exception 'só se protocola uma peça com documento final' using errcode = 'invalid_parameter_value';
  end if;
  if v_evento is not null then
    update priv.agenda_eventos set status = 'protocolado' where id = v_evento and empresa_id = p_empresa and status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado');
  end if;
end;
$$;

create function priv.registrar_resultado_peca(p_empresa uuid, p_id uuid, p_resultado text, p_obs text, p_quando timestamptz)
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
  update priv.pecas set status = 'respondida', resultado = p_resultado, resultado_obs = nullif(btrim(p_obs), ''), resultado_em = coalesce(p_quando, now())
   where id = p_id and empresa_id = p_empresa and status = 'protocolada';
  if not found then
    raise exception 'só se registra resultado de uma peça protocolada' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function priv.pedir_pdf_peca(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa and status in ('final', 'protocolada', 'respondida')) then
    raise exception 'só a peça com documento final tem PDF' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$$;

grant execute on function priv.cadastrar_base_juridica(uuid, text, text, text, text, text, text, date, text), priv.verificar_base_juridica(uuid, uuid),
  priv.remover_base_juridica(uuid, uuid), priv.criar_peca(uuid, uuid, text, text, uuid), priv.descartar_peca(uuid, uuid, text), priv.salvar_minuta(uuid, uuid, text, text),
  priv.revalidar_peca(uuid, uuid), priv.enviar_revisao_peca(uuid, uuid), priv.devolver_peca(uuid, uuid), priv.aprovar_peca(uuid, uuid),
  priv.protocolar_peca(uuid, uuid, text, timestamptz, text), priv.registrar_resultado_peca(uuid, uuid, text, text, timestamptz), priv.pedir_pdf_peca(uuid, uuid) to vv_api;

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
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.pedir_pdf_peca(uuid, uuid), priv.registrar_resultado_peca(uuid, uuid, text, text, timestamptz), priv.protocolar_peca(uuid, uuid, text, timestamptz, text),
  priv.aprovar_peca(uuid, uuid), priv.devolver_peca(uuid, uuid), priv.enviar_revisao_peca(uuid, uuid), priv.revalidar_peca(uuid, uuid), priv.salvar_minuta(uuid, uuid, text, text),
  priv.descartar_peca(uuid, uuid, text), priv.criar_peca(uuid, uuid, text, text, uuid), priv.remover_base_juridica(uuid, uuid), priv.verificar_base_juridica(uuid, uuid),
  priv.cadastrar_base_juridica(uuid, text, text, text, text, text, text, date, text), priv.enfileirar_peca(uuid, uuid);
drop table priv.pecas, priv.base_juridica;
drop function priv.pecas_final_imutavel();
