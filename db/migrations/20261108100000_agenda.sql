-- Fase 05 · Agenda, acompanhamento de editais e prazos jurídicos. Spec: docs/specs/fase-05.md.
--
-- * pub.feriados / pub.regras_prazo: dado de referência (nacionais calculados e gravados pelo worker; estaduais e
--   municipais por carga e cadastro). As regras nascem NÃO VALIDADAS pelo jurídico (validada_por nulo).
-- * priv.acompanhamentos (empresa x edital), priv.participacoes (empresa x item), priv.agenda_eventos (+ histórico
--   imutável). A data de abertura e os prazos só mudam por função; quem CALCULA é o worker (rules/prazos.py).
-- * Override de prazo e dispensa exigem justificativa e vão para o histórico e para a auditoria.

-- migrate:up
create table pub.feriados (
  id          uuid primary key default core.uuid_v7(),
  data        date not null,
  nome        text not null check (char_length(nome) between 2 and 120),
  tipo        text not null default 'feriado' check (tipo in ('feriado', 'ponto_facultativo')),
  abrangencia text not null check (abrangencia in ('nacional', 'uf', 'municipio')),
  uf          text check (uf ~ '^[A-Z]{2}$'),
  codigo_ibge text check (codigo_ibge ~ '^[0-9]{7}$'),
  origem      text not null default 'manual' check (origem in ('calculado', 'manual')),
  created_at  timestamptz not null default now(),
  check ((abrangencia = 'nacional' and uf is null and codigo_ibge is null)
      or (abrangencia = 'uf' and uf is not null and codigo_ibge is null)
      or (abrangencia = 'municipio' and uf is not null and codigo_ibge is not null))
);
create unique index feriados_uk on pub.feriados (data, abrangencia, coalesce(uf, ''), coalesce(codigo_ibge, ''));
alter table pub.feriados enable row level security;
create policy feriados_select on pub.feriados for select to vv_api using ((select core.usuario_atual()) is not null);
grant select on pub.feriados to vv_api;
grant select, insert on pub.feriados to vv_worker;
-- Carga inicial estadual (revisável pelo jurídico/operação): PR 19/12 (emancipação política) e SC 11/08 (Dia de Santa Catarina).
insert into pub.feriados (data, nome, abrangencia, uf, origem)
select make_date(a, 12, 19), 'Emancipação política do Paraná', 'uf', 'PR', 'manual' from generate_series(2026, 2032) a
union all
select make_date(a, 8, 11), 'Data magna de Santa Catarina', 'uf', 'SC', 'manual' from generate_series(2026, 2032) a;

create table pub.regras_prazo (
  id               uuid primary key default core.uuid_v7(),
  evento           text not null check (evento in ('esclarecimento', 'impugnacao', 'resposta_administracao', 'intencao_recurso',
                                                    'razoes_recurso', 'contrarrazoes', 'regularizacao_fiscal_me_epp')),
  base             text not null check (base in ('abertura', 'peca_protocolada', 'sessao_resultado', 'intimacao', 'recurso_terceiro', 'declaracao_vencedora')),
  quantidade       int not null check (quantidade >= 0),
  unidade          text not null check (unidade in ('dias_uteis', 'imediato')),
  sentido          text not null check (sentido in ('antes', 'depois')),
  limite_superior  text check (limite_superior in ('ultimo_dia_util_antes_abertura')),
  artigo           text not null check (char_length(artigo) between 3 and 200),
  prorrogavel      boolean not null default false,
  validada_por     uuid references core.usuarios (id),
  validada_em      timestamptz,
  vigente_de       date not null default date '2000-01-01',
  vigente_ate      date,
  created_at       timestamptz not null default now(),
  check ((validada_por is null) = (validada_em is null))
);
create index regras_prazo_idx on pub.regras_prazo (evento, vigente_de);
alter table pub.regras_prazo enable row level security;
create policy regras_prazo_select on pub.regras_prazo for select to vv_api using ((select core.usuario_atual()) is not null);
grant select on pub.regras_prazo to vv_api, vv_worker;
-- ⚖️ Valores do Prompt Mestre 5.3, NÃO validados pelo jurídico (validada_por nulo): a tela mostra o selo.
insert into pub.regras_prazo (evento, base, quantidade, unidade, sentido, limite_superior, artigo, prorrogavel) values
  ('esclarecimento', 'abertura', 3, 'dias_uteis', 'antes', null, 'Lei 14.133/2021, art. 164', false),
  ('impugnacao', 'abertura', 3, 'dias_uteis', 'antes', null, 'Lei 14.133/2021, art. 164', false),
  ('resposta_administracao', 'peca_protocolada', 3, 'dias_uteis', 'depois', 'ultimo_dia_util_antes_abertura', 'Lei 14.133/2021, art. 164, parágrafo único', false),
  ('intencao_recurso', 'sessao_resultado', 0, 'imediato', 'depois', null, 'Lei 14.133/2021, art. 165, §1º', false),
  ('razoes_recurso', 'intimacao', 3, 'dias_uteis', 'depois', null, 'Lei 14.133/2021, art. 165', false),
  ('contrarrazoes', 'recurso_terceiro', 3, 'dias_uteis', 'depois', null, 'Lei 14.133/2021, art. 165, §4º', false),
  ('regularizacao_fiscal_me_epp', 'declaracao_vencedora', 5, 'dias_uteis', 'depois', null, 'LC 123/2006, art. 43, §1º', true);

-- =============================================================== priv
create table priv.acompanhamentos (
  id                         uuid primary key default core.uuid_v7(),
  empresa_id                 uuid not null references core.empresas (id) on delete cascade,
  edital_id                  uuid not null references pub.editais (id),
  responsavel_id             uuid references core.usuarios (id),
  prioridade                 text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  status                     text not null default 'acompanhando'
                             check (status in ('acompanhando', 'em_elaboracao', 'aguardando_sessao', 'em_disputa', 'encerrado', 'desistiu')),
  data_abertura              timestamptz,
  abertura_origem            text not null default 'pncp_sugerida' check (abertura_origem in ('edital', 'portal', 'pncp_sugerida', 'manual')),
  abertura_confirmada        boolean not null default false,
  abertura_clausula          text check (char_length(abertura_clausula) <= 300),
  portal                     text check (char_length(portal) <= 120),
  link_disputa               text check (link_disputa is null or (link_disputa ~ '^https://[^\s]+$' and char_length(link_disputa) <= 500)),
  link_documentos            text check (link_documentos is null or (link_documentos ~ '^https://[^\s]+$' and char_length(link_documentos) <= 500)),
  prazo_esclarecimento_edital timestamptz,
  prazo_impugnacao_edital    timestamptz,
  clausula_prazos            text check (char_length(clausula_prazos) <= 300),
  confiabilidade             text not null default 'a_confirmar' check (confiabilidade in ('alta', 'media', 'baixa', 'a_confirmar')),
  observacoes                text check (char_length(observacoes) <= 4000),
  ultima_conferencia_em      timestamptz,
  edital_versao_vista        int not null default 1,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid default core.usuario_atual(),
  deleted_at                 timestamptz,
  unique (id, empresa_id)
);
create unique index acompanhamentos_uk on priv.acompanhamentos (empresa_id, edital_id) where deleted_at is null;
create index acompanhamentos_edital_idx on priv.acompanhamentos (edital_id);

create table priv.participacoes (
  id                    uuid primary key default core.uuid_v7(),
  empresa_id            uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id     uuid not null,
  item_id               uuid not null references pub.edital_itens (id),
  responsavel_id        uuid references core.usuarios (id),
  prioridade            text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  status                text not null default 'avaliando'
                        check (status in ('avaliando', 'vai_participar', 'nao_vai', 'proposta_enviada', 'em_disputa', 'arrematada',
                                          'habilitacao', 'vencida', 'perdida', 'desclassificada', 'cancelada')),
  situacao_documentacao text not null default 'a_confirmar' check (situacao_documentacao in ('a_confirmar', 'pendente', 'em_andamento', 'ok', 'nao_se_aplica')),
  situacao_proposta     text not null default 'a_confirmar' check (situacao_proposta in ('a_confirmar', 'pendente', 'em_andamento', 'ok', 'nao_se_aplica')),
  situacao_juridica     text not null default 'a_confirmar' check (situacao_juridica in ('a_confirmar', 'pendente', 'em_andamento', 'ok', 'nao_se_aplica')),
  atendimento_tecnico   text check (char_length(atendimento_tecnico) <= 2000),
  marca                 text check (char_length(marca) <= 120),
  modelo                text check (char_length(modelo) <= 120),
  versao                text check (char_length(versao) <= 120),
  valor_unitario        numeric(18, 4) check (valor_unitario >= 0),
  valor_total           numeric(18, 4) check (valor_total >= 0),
  pendencias            text check (char_length(pendencias) <= 2000),
  observacoes           text check (char_length(observacoes) <= 4000),
  origem_oportunidade_id uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid default core.usuario_atual(),
  deleted_at            timestamptz,
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (origem_oportunidade_id, empresa_id) references priv.oportunidades (id, empresa_id)
);
create unique index participacoes_uk on priv.participacoes (empresa_id, item_id) where deleted_at is null;
create index participacoes_acomp_idx on priv.participacoes (acompanhamento_id);

create table priv.agenda_eventos (
  id                       uuid primary key default core.uuid_v7(),
  empresa_id               uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id        uuid not null,
  tipo                     text not null check (tipo in ('esclarecimento', 'impugnacao', 'resposta_administracao', 'intencao_recurso',
                                                         'razoes_recurso', 'contrarrazoes', 'regularizacao_fiscal_me_epp',
                                                         'disputa', 'alteracao_edital', 'documento_vence')),
  regra_id                 uuid references pub.regras_prazo (id),
  base_data                timestamptz,
  data_limite_legal        timestamptz,
  data_interna_recomendada timestamptz,
  horario_limite_portal    time,
  origem_prazo             text not null default 'regra' check (origem_prazo in ('regra', 'edital', 'manual')),
  clausula_edital          text check (char_length(clausula_edital) <= 300),
  provisorio               boolean not null default true,
  regra_validada           boolean not null default false,
  responsavel_id           uuid references core.usuarios (id),
  status                   text not null default 'sugerido'
                           check (status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado', 'protocolado', 'respondido', 'prazo_perdido', 'dispensado')),
  justificativa            text check (char_length(justificativa) <= 1000),
  aviso_calculo            text check (char_length(aviso_calculo) <= 500),
  calculado_em             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  unique (acompanhamento_id, tipo)
);
create index agenda_eventos_data_idx on priv.agenda_eventos (empresa_id, data_limite_legal);
create unique index agenda_eventos_id_empresa_uk on priv.agenda_eventos (id, empresa_id);

create table priv.agenda_evento_historico (
  id         uuid primary key default core.uuid_v7(),
  empresa_id uuid not null references core.empresas (id) on delete cascade,
  evento_id  uuid not null,
  quem       uuid default core.usuario_atual(),
  em         timestamptz not null default now(),
  campo      text not null check (char_length(campo) <= 60),
  antes      text check (char_length(antes) <= 300),
  depois     text check (char_length(depois) <= 300),
  motivo     text check (char_length(motivo) <= 1000),
  foreign key (evento_id, empresa_id) references priv.agenda_eventos (id, empresa_id) on delete cascade
);
create index agenda_historico_idx on priv.agenda_evento_historico (evento_id, em desc);
create trigger agenda_historico_imutavel before update or delete on priv.agenda_evento_historico
  for each row execute function pub.imutavel();

alter table priv.acompanhamentos enable row level security;
alter table priv.participacoes enable row level security;
alter table priv.agenda_eventos enable row level security;
alter table priv.agenda_evento_historico enable row level security;
do $$
declare t text;
begin
  foreach t in array array['acompanhamentos', 'participacoes', 'agenda_eventos', 'agenda_evento_historico'] loop
    execute format('create policy %I on priv.%I for select to vv_api using (core.has_permission(empresa_id, ''agenda'', ''visualizar''))', t || '_select', t);
  end loop;
end $$;
create policy acompanhamentos_update on priv.acompanhamentos for update to vv_api
  using (core.has_permission(empresa_id, 'agenda', 'editar')) with check (core.has_permission(empresa_id, 'agenda', 'editar'));
create policy participacoes_update on priv.participacoes for update to vv_api
  using (core.has_permission(empresa_id, 'agenda', 'editar')) with check (core.has_permission(empresa_id, 'agenda', 'editar'));
create policy agenda_eventos_update on priv.agenda_eventos for update to vv_api
  using (core.has_permission(empresa_id, 'agenda', 'editar')) with check (core.has_permission(empresa_id, 'agenda', 'editar'));

grant select on priv.acompanhamentos, priv.participacoes, priv.agenda_eventos, priv.agenda_evento_historico to vv_api;
-- Datas, status e justificativa só por função; aqui só o que é cadastro simples.
grant update (responsavel_id, prioridade, status, portal, link_disputa, link_documentos, observacoes, ultima_conferencia_em, edital_versao_vista, deleted_at)
  on priv.acompanhamentos to vv_api;
grant update (responsavel_id, prioridade, status, situacao_documentacao, situacao_proposta, situacao_juridica, atendimento_tecnico,
              marca, modelo, versao, valor_unitario, valor_total, pendencias, observacoes, deleted_at) on priv.participacoes to vv_api;
grant update (responsavel_id) on priv.agenda_eventos to vv_api;
grant select on priv.acompanhamentos to vv_worker;
grant select, insert, update on priv.agenda_eventos to vv_worker;
grant select, insert on priv.agenda_evento_historico to vv_worker;
grant select on priv.participacoes to vv_worker;

create trigger acompanhamentos_updated_at before update on priv.acompanhamentos for each row execute function core.set_updated_at();
create trigger participacoes_updated_at before update on priv.participacoes for each row execute function core.set_updated_at();
create trigger agenda_eventos_updated_at before update on priv.agenda_eventos for each row execute function core.set_updated_at();
create trigger acompanhamentos_audit after insert or update on priv.acompanhamentos for each row execute function audit.registrar();
create trigger participacoes_audit after insert or update on priv.participacoes for each row execute function audit.registrar();
create trigger agenda_eventos_audit after insert or update on priv.agenda_eventos for each row execute function audit.registrar();
alter table priv.acompanhamentos enable always trigger acompanhamentos_audit;
alter table priv.participacoes enable always trigger participacoes_audit;
alter table priv.agenda_eventos enable always trigger agenda_eventos_audit;

-- =============================================================== funções
-- Acompanhar um edital (idempotente): nasce com a abertura SUGERIDA do PNCP (fim das propostas), não confirmada.
create function priv.acompanhar_edital(p_empresa uuid, p_edital uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ed record;
begin
  if not core.has_permission(p_empresa, 'agenda', 'cadastrar') or not core.pode_ver_editais() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id into v_id from priv.acompanhamentos where empresa_id = p_empresa and edital_id = p_edital and deleted_at is null;
  if found then
    return v_id;
  end if;
  select e.id, e.versao_atual, e.data_encerramento_propostas, e.portal, e.link_portal into v_ed from pub.editais e where e.id = p_edital;
  if not found then
    raise exception 'edital não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.acompanhamentos (empresa_id, edital_id, responsavel_id, data_abertura, abertura_origem, portal, link_disputa, edital_versao_vista)
  values (p_empresa, p_edital, core.usuario_atual(), v_ed.data_encerramento_propostas, 'pncp_sugerida', v_ed.portal, v_ed.link_portal, v_ed.versao_atual)
  returning id into v_id;
  perform ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', v_id), 'calc:' || v_id || ':novo');
  return v_id;
end;
$$;

-- Confirma (ou altera) a abertura e os prazos que o próprio edital fixa; enfileira o recálculo.
create function priv.confirmar_abertura(p_empresa uuid, p_acomp uuid, p_data timestamptz, p_origem text, p_clausula text,
                                        p_prazo_esclarecimento timestamptz, p_prazo_impugnacao timestamptz, p_clausula_prazos text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_origem not in ('edital', 'portal', 'manual') then
    raise exception 'origem inválida' using errcode = 'invalid_parameter_value';
  end if;
  if p_data is null then
    raise exception 'informe a data de abertura' using errcode = 'invalid_parameter_value';
  end if;
  update priv.acompanhamentos
     set data_abertura = p_data, abertura_origem = p_origem, abertura_confirmada = true,
         abertura_clausula = nullif(btrim(p_clausula), ''), prazo_esclarecimento_edital = p_prazo_esclarecimento,
         prazo_impugnacao_edital = p_prazo_impugnacao, clausula_prazos = nullif(btrim(p_clausula_prazos), ''),
         confiabilidade = case p_origem when 'edital' then 'alta' when 'portal' then 'media' else 'baixa' end,
         ultima_conferencia_em = now()
   where id = p_acomp and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', p_acomp),
                         'calc:' || p_acomp || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;

-- Fato gerador dos demais eventos (até as Fases 09 e 10 o registrarem sozinhas): cria/atualiza o evento e enfileira o cálculo.
create function priv.registrar_fato(p_empresa uuid, p_acomp uuid, p_tipo text, p_base timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('resposta_administracao', 'intencao_recurso', 'razoes_recurso', 'contrarrazoes', 'regularizacao_fiscal_me_epp') then
    raise exception 'tipo de evento inválido' using errcode = 'invalid_parameter_value';
  end if;
  if p_base is null then
    raise exception 'informe a data do fato' using errcode = 'invalid_parameter_value';
  end if;
  perform 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, base_data)
  values (p_empresa, p_acomp, p_tipo, p_base)
  on conflict (acompanhamento_id, tipo) do update set base_data = excluded.base_data
  returning id into v_id;
  perform ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', p_acomp),
                         'calc:' || p_acomp || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  return v_id;
end;
$$;

create function priv.mudar_status_evento(p_empresa uuid, p_evento uuid, p_status text, p_justificativa text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ev record;
  v_just text := nullif(btrim(p_justificativa), '');
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado', 'protocolado', 'respondido', 'dispensado') then
    raise exception 'status inválido (Prazo perdido é marcado pelo sistema)' using errcode = 'invalid_parameter_value';
  end if;
  select id, status into v_ev from priv.agenda_eventos where id = p_evento and empresa_id = p_empresa for update;
  if not found then
    raise exception 'evento não encontrado' using errcode = 'no_data_found';
  end if;
  if (p_status = 'dispensado' or v_ev.status = 'prazo_perdido') and (v_just is null or char_length(v_just) < 10) then
    raise exception 'informe a justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.agenda_eventos set status = p_status, justificativa = coalesce(v_just, justificativa) where id = p_evento;
  insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo)
  values (p_empresa, p_evento, 'status', v_ev.status, p_status, v_just);
end;
$$;

create function priv.override_prazo(p_empresa uuid, p_evento uuid, p_nova_data timestamptz, p_justificativa text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ev record;
  v_just text := nullif(btrim(p_justificativa), '');
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if v_just is null or char_length(v_just) < 10 then
    raise exception 'informe a justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  if p_nova_data is null then
    raise exception 'informe a nova data-limite' using errcode = 'invalid_parameter_value';
  end if;
  select id, data_limite_legal into v_ev from priv.agenda_eventos where id = p_evento and empresa_id = p_empresa for update;
  if not found then
    raise exception 'evento não encontrado' using errcode = 'no_data_found';
  end if;
  update priv.agenda_eventos set data_limite_legal = p_nova_data, origem_prazo = 'manual', justificativa = v_just, provisorio = false where id = p_evento;
  insert into priv.agenda_evento_historico (empresa_id, evento_id, campo, antes, depois, motivo)
  values (p_empresa, p_evento, 'data_limite_legal', v_ev.data_limite_legal::text, p_nova_data::text, v_just);
end;
$$;

-- Participações por item: cria as que faltam (idempotente). A promoção a partir de uma oportunidade usa a mesma função.
create function priv.criar_participacoes(p_empresa uuid, p_acomp uuid, p_itens uuid[], p_oportunidade uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not core.has_permission(p_empresa, 'agenda', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from priv.acompanhamentos a where a.id = p_acomp and a.empresa_id = p_empresa and a.deleted_at is null;
  if not found then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.participacoes (empresa_id, acompanhamento_id, item_id, responsavel_id, origem_oportunidade_id)
  select p_empresa, p_acomp, i.id, core.usuario_atual(), case when cardinality(p_itens) = 1 then p_oportunidade end
    from pub.edital_itens i join priv.acompanhamentos a on a.edital_id = i.edital_id and a.id = p_acomp
   where i.id = any (p_itens) and i.tipo = 'item'
  on conflict (empresa_id, item_id) where deleted_at is null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- "Tenho interesse" vira acompanhamento + participação do item em um clique.
create function priv.promover_oportunidade(p_empresa uuid, p_oportunidade uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_op record;
  v_acomp uuid;
begin
  if not core.has_permission(p_empresa, 'agenda', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, edital_id, item_id into v_op from priv.oportunidades where id = p_oportunidade and empresa_id = p_empresa;
  if not found then
    raise exception 'oportunidade não encontrada' using errcode = 'no_data_found';
  end if;
  v_acomp := priv.acompanhar_edital(p_empresa, v_op.edital_id);
  perform priv.criar_participacoes(p_empresa, v_acomp, array[v_op.item_id], p_oportunidade);
  return v_acomp;
end;
$$;

revoke all on function priv.acompanhar_edital(uuid, uuid), priv.confirmar_abertura(uuid, uuid, timestamptz, text, text, timestamptz, timestamptz, text),
  priv.registrar_fato(uuid, uuid, text, timestamptz), priv.mudar_status_evento(uuid, uuid, text, text), priv.override_prazo(uuid, uuid, timestamptz, text),
  priv.criar_participacoes(uuid, uuid, uuid[], uuid), priv.promover_oportunidade(uuid, uuid) from public;
grant execute on function priv.acompanhar_edital(uuid, uuid), priv.confirmar_abertura(uuid, uuid, timestamptz, text, text, timestamptz, timestamptz, text),
  priv.registrar_fato(uuid, uuid, text, timestamptz), priv.mudar_status_evento(uuid, uuid, text, text), priv.override_prazo(uuid, uuid, timestamptz, text),
  priv.criar_participacoes(uuid, uuid, uuid[], uuid), priv.promover_oportunidade(uuid, uuid) to vv_api;

-- O worker enfileira o recálculo (sem payload além do id) pelo invólucro já existente.
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
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.promover_oportunidade(uuid, uuid), priv.criar_participacoes(uuid, uuid, uuid[], uuid), priv.override_prazo(uuid, uuid, timestamptz, text),
  priv.mudar_status_evento(uuid, uuid, text, text), priv.registrar_fato(uuid, uuid, text, timestamptz),
  priv.confirmar_abertura(uuid, uuid, timestamptz, text, text, timestamptz, timestamptz, text), priv.acompanhar_edital(uuid, uuid);
drop table priv.agenda_evento_historico, priv.agenda_eventos, priv.participacoes, priv.acompanhamentos;
drop table pub.regras_prazo, pub.feriados;
