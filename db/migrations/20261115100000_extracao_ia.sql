-- Fase 06 · extração de requisitos por IA (decisão do Adriano, 2026-11-05: ligar a IA). A IA SÓ SUGERE (6.6): cada requisito vem com
-- citação literal do edital que o worker confere no texto; requisito de origem `ia` só entra como "A CONFIRMAR" até uma pessoa
-- confirmar. Nada de custo, margem, dado pessoal ou dado da empresa vai ao provedor: só o texto público do edital e o item.
-- Cada execução registra modelo, versão do prompt e tokens (6.7). Limite de 5 pedidos por participação por dia (custo).

-- migrate:up
alter table priv.requisitos_item add column confirmado_por uuid references core.usuarios (id), add column confirmado_em timestamptz,
  add check ((confirmado_por is null) = (confirmado_em is null));
update priv.requisitos_item set confirmado_por = created_by, confirmado_em = created_at where origem = 'manual' and created_by is not null;
grant select (confirmado_por, confirmado_em) on priv.requisitos_item to vv_worker;
grant insert (empresa_id, participacao_id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_max, valor_texto, unidade_id, obrigatorio,
              citacao_edital, pagina, origem, modelo_ia, prompt_versao) on priv.requisitos_item to vv_worker;

create table priv.extracoes_ia (
  id               uuid primary key default core.uuid_v7(),
  empresa_id       uuid not null references core.empresas (id) on delete cascade,
  participacao_id  uuid not null,
  status           text not null default 'pendente' check (status in ('pendente', 'concluida', 'falhou', 'desligada')),
  modelo           text check (char_length(modelo) <= 100),
  prompt_versao    text check (char_length(prompt_versao) <= 40),
  tokens_entrada   int check (tokens_entrada >= 0),
  tokens_saida     int check (tokens_saida >= 0),
  requisitos_criados int not null default 0,
  descartados      int not null default 0,
  sem_citacao      int not null default 0,
  erro             text check (char_length(erro) <= 500),
  solicitada_por   uuid default core.usuario_atual(),
  created_at       timestamptz not null default now(),
  concluida_em     timestamptz,
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create index extracoes_ia_part_idx on priv.extracoes_ia (participacao_id, created_at desc);
alter table priv.extracoes_ia enable row level security;
create policy extracoes_ia_select on priv.extracoes_ia for select to vv_api using (core.has_permission(empresa_id, 'analises', 'visualizar'));
grant select on priv.extracoes_ia to vv_api;
grant select on priv.extracoes_ia to vv_worker;
grant update (status, modelo, prompt_versao, tokens_entrada, tokens_saida, requisitos_criados, descartados, sem_citacao, erro, concluida_em) on priv.extracoes_ia to vv_worker;
create trigger extracoes_ia_audit after insert or update on priv.extracoes_ia for each row execute function audit.registrar();
alter table priv.extracoes_ia enable always trigger extracoes_ia_audit;

create function priv.pedir_extracao_requisitos(p_empresa uuid, p_participacao uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from priv.extracoes_ia where participacao_id = p_participacao and status = 'pendente' and created_at > now() - interval '15 minutes') then
    raise exception 'já há uma extração em andamento para este item' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from priv.extracoes_ia where participacao_id = p_participacao and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite de extrações por item atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  insert into priv.extracoes_ia (empresa_id, participacao_id) values (p_empresa, p_participacao) returning id into v_id;
  perform ops.enfileirar('extrair_requisitos', p_empresa, jsonb_build_object('extracao_id', v_id), 'extracao:' || v_id);
  return v_id;
end;
$$;

-- A pessoa confirma o requisito sugerido pela IA (depois de conferir o texto e a citação); só então ele deixa de ser "A CONFIRMAR".
create function priv.confirmar_requisito(p_empresa uuid, p_requisito uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_part uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.requisitos_item set confirmado_por = core.usuario_atual(), confirmado_em = now()
   where id = p_requisito and empresa_id = p_empresa and deleted_at is null and confirmado_em is null returning participacao_id into v_part;
  if not found then
    raise exception 'requisito não encontrado ou já confirmado' using errcode = 'no_data_found';
  end if;
  perform priv.reanalisar_participacao(p_empresa, v_part);
end;
$$;
grant execute on function priv.pedir_extracao_requisitos(uuid, uuid), priv.confirmar_requisito(uuid, uuid) to vv_api;

-- Requisito cadastrado à mão já nasce confirmado por quem o cadastrou.
create or replace function priv.criar_requisito(
  p_empresa uuid, p_participacao uuid, p_nome text, p_tipo text, p_atributo uuid, p_operador text, p_numero numeric, p_max numeric,
  p_texto text, p_unidade uuid, p_obrigatorio boolean, p_citacao text, p_pagina int
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  insert into priv.requisitos_item (empresa_id, participacao_id, nome, tipo_exigencia, atributo_id, operador, valor_numero, valor_max, valor_texto,
                                   unidade_id, obrigatorio, citacao_edital, pagina, confirmado_por, confirmado_em)
  values (p_empresa, p_participacao, btrim(p_nome), p_tipo, p_atributo, p_operador, p_numero, p_max, nullif(btrim(p_texto), ''), p_unidade,
          coalesce(p_obrigatorio, true), nullif(btrim(p_citacao), ''), p_pagina, core.usuario_atual(), now())
  returning id into v_id;
  perform priv.reanalisar_participacao(p_empresa, p_participacao);
  return v_id;
end;
$$;

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
                    'extrair_requisitos') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.confirmar_requisito(uuid, uuid), priv.pedir_extracao_requisitos(uuid, uuid);
drop table priv.extracoes_ia;
alter table priv.requisitos_item drop column confirmado_em, drop column confirmado_por;
