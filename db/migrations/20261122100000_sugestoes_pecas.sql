-- Fase 10 · 10.2/10.3 Sugestões de pedido de esclarecimento e de impugnação a partir do edital.
-- A IA (sob pedido, chave da empresa) lê o texto do edital e SUGERE: trecho literal (conferido pelo código), dúvida/ilegalidade, impacto, pedido,
-- fundamento (só da base jurídica VERIFICADA; fora dela é descartado) e grau de viabilidade da impugnação. Viabilidade "alta/média" exige fundamento
-- verificado (regra de código). Prazo vencido = "intempestiva": a impugnação não é sugerida como tal. A pessoa aceita (abre a peça em triagem,
-- ligada ao prazo da agenda) ou descarta com justificativa; nada vira peça sem decisão humana.

-- migrate:up
create table priv.sugestoes_execucoes (
  id                uuid primary key default core.uuid_v7(),
  empresa_id        uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id uuid not null,
  status            text not null default 'pendente' check (status in ('pendente', 'concluida', 'falhou', 'desligada')),
  erro              text check (char_length(erro) <= 500),
  modelo            text check (char_length(modelo) <= 100),
  prompt_versao     text check (char_length(prompt_versao) <= 40),
  tokens_entrada    int check (tokens_entrada >= 0),
  tokens_saida      int check (tokens_saida >= 0),
  criadas           int not null default 0,
  descartadas       int not null default 0,
  solicitada_por    uuid default core.usuario_atual(),
  created_at        timestamptz not null default now(),
  concluida_em      timestamptz,
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create index sugestoes_execucoes_idx on priv.sugestoes_execucoes (acompanhamento_id, created_at desc);

create table priv.sugestoes_pecas (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id  uuid not null,
  execucao_id        uuid,
  tipo               text not null check (tipo in ('esclarecimento', 'impugnacao')),
  titulo             text not null check (char_length(titulo) between 3 and 200),
  trecho_edital      text check (char_length(trecho_edital) <= 1500),
  trecho_confere     boolean not null default false,
  pagina             int,
  duvida             text not null check (char_length(duvida) between 3 and 800),
  impacto            text check (char_length(impacto) <= 600),
  pedido             text check (char_length(pedido) <= 600),
  fundamento         text check (char_length(fundamento) <= 500),
  fundamento_na_base boolean not null default false,
  viabilidade        text check (viabilidade in ('alta', 'media', 'baixa')),
  viabilidade_justificativa text check (char_length(viabilidade_justificativa) <= 500),
  prazo_legal        timestamptz,
  status             text not null default 'nova' check (status in ('nova', 'aceita', 'descartada', 'intempestiva')),
  justificativa_descarte text check (char_length(justificativa_descarte) <= 1000),
  peca_id            uuid,
  decidida_por       uuid references core.usuarios (id),
  decidida_em        timestamptz,
  modelo_ia          text check (char_length(modelo_ia) <= 100),
  created_at         timestamptz not null default now(),
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (execucao_id, empresa_id) references priv.sugestoes_execucoes (id, empresa_id) on delete set null (execucao_id),
  foreign key (peca_id, empresa_id) references priv.pecas (id, empresa_id) on delete set null (peca_id),
  check (status <> 'descartada' or justificativa_descarte is not null),
  check (status <> 'aceita' or peca_id is not null)
);
create index sugestoes_pecas_idx on priv.sugestoes_pecas (empresa_id, status, created_at desc);
create index sugestoes_pecas_acomp_idx on priv.sugestoes_pecas (acompanhamento_id);

alter table priv.sugestoes_execucoes enable row level security;
alter table priv.sugestoes_pecas enable row level security;
create policy sugestoes_execucoes_select on priv.sugestoes_execucoes for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
create policy sugestoes_pecas_select on priv.sugestoes_pecas for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.sugestoes_execucoes, priv.sugestoes_pecas to vv_api;
grant select on priv.sugestoes_execucoes, priv.sugestoes_pecas to vv_worker;
grant update (status, erro, modelo, prompt_versao, tokens_entrada, tokens_saida, criadas, descartadas, concluida_em) on priv.sugestoes_execucoes to vv_worker;
grant insert, delete on priv.sugestoes_pecas to vv_worker;
create trigger sugestoes_execucoes_audit after insert or update on priv.sugestoes_execucoes for each row execute function audit.registrar();
alter table priv.sugestoes_execucoes enable always trigger sugestoes_execucoes_audit;
create trigger sugestoes_pecas_audit after insert or update or delete on priv.sugestoes_pecas for each row execute function audit.registrar();
alter table priv.sugestoes_pecas enable always trigger sugestoes_pecas_audit;

-- Pede as sugestões: uma por vez e no máximo 3 por edital por dia (custo).
create function priv.pedir_sugestoes_pecas(p_empresa uuid, p_acomp uuid)
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
  if exists (select 1 from priv.sugestoes_execucoes where acompanhamento_id = p_acomp and status = 'pendente' and created_at > now() - interval '15 minutes') then
    raise exception 'já há uma busca de sugestões em andamento para este edital' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from priv.sugestoes_execucoes where acompanhamento_id = p_acomp and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'limite de buscas de sugestões por edital atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  insert into priv.sugestoes_execucoes (empresa_id, acompanhamento_id) values (p_empresa, p_acomp) returning id into v_id;
  perform ops.enfileirar('sugerir_pecas', p_empresa, jsonb_build_object('execucao_id', v_id), 'sugestoes:' || v_id);
  return v_id;
end;
$$;
grant execute on function priv.pedir_sugestoes_pecas(uuid, uuid) to vv_api;

-- Aceita a sugestão: abre a peça em triagem, ligada ao prazo da agenda (esclarecimento/impugnação) quando houver. Prazo vencido não aceita.
create function priv.aceitar_sugestao(p_empresa uuid, p_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_evento uuid;
  v_limite timestamptz;
  v_peca uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select * into v_s from priv.sugestoes_pecas where id = p_id and empresa_id = p_empresa for update;
  if not found then
    raise exception 'sugestão não encontrada' using errcode = 'no_data_found';
  end if;
  if v_s.status <> 'nova' then
    raise exception 'só se aceita uma sugestão nova (não intempestiva, aceita ou descartada)' using errcode = 'invalid_parameter_value';
  end if;
  select id, data_limite_legal into v_evento, v_limite from priv.agenda_eventos where acompanhamento_id = v_s.acompanhamento_id and empresa_id = p_empresa and tipo = v_s.tipo;
  if v_limite is not null and v_limite < now() then
    update priv.sugestoes_pecas set status = 'intempestiva' where id = p_id;
    raise exception 'o prazo legal deste pedido já venceu (intempestivo)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pecas (empresa_id, acompanhamento_id, evento_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_s.acompanhamento_id, v_evento, v_s.tipo, v_s.titulo, 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_peca;
  update priv.sugestoes_pecas set status = 'aceita', peca_id = v_peca, decidida_por = core.usuario_atual(), decidida_em = now() where id = p_id;
  return v_peca;
end;
$$;
grant execute on function priv.aceitar_sugestao(uuid, uuid) to vv_api;

create function priv.descartar_sugestao(p_empresa uuid, p_id uuid, p_justificativa text)
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
  update priv.sugestoes_pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa), decidida_por = core.usuario_atual(), decidida_em = now()
   where id = p_id and empresa_id = p_empresa and status in ('nova', 'intempestiva');
  if not found then
    raise exception 'só se descarta uma sugestão nova ou intempestiva' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;
grant execute on function priv.descartar_sugestao(uuid, uuid, text) to vv_api;

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
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca', 'minutar_peca', 'ler_recurso', 'validar_parecer', 'analisar_vencedora', 'sugerir_pecas') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.descartar_sugestao(uuid, uuid, text);
drop function priv.aceitar_sugestao(uuid, uuid);
drop function priv.pedir_sugestoes_pecas(uuid, uuid);
drop table priv.sugestoes_pecas;
drop table priv.sugestoes_execucoes;
