-- Fase 10 · 10.4 Análise da licitante vencedora e parecer de viabilidade recursal (e 10.5: peça de recurso a partir do parecer).
-- Quando a empresa não é a primeira colocada (gatilho_recursal do resultado), o jurídico abre o parecer, insere o que se sabe da concorrente
-- (texto da proposta/habilitação dela) e lista os ACHADOS: falha, prova, fundamento (base verificada) e classificação (forte/moderada/fraca).
-- A IA pode SUGERIR achados a partir do texto colado (citações literais conferidas pelo código). A RECOMENDAÇÃO (recorrer, não recorrer,
-- apenas registrar) e a classificação são decisão humana: o código só confere EVIDÊNCIA (prova, fundamento na base, citação no texto) e
-- bloqueia "recorrer" sem achado provado. Nada é suposto sobre mérito jurídico (⚖️ critérios de classificação ficam com o jurídico).

-- migrate:up
create table priv.pareceres_recursais (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  participacao_id    uuid not null,
  concorrente        text not null check (char_length(concorrente) between 2 and 200),
  texto_concorrente  text check (char_length(texto_concorrente) <= 60000),
  recomendacao       text check (recomendacao in ('recorrer', 'nao_recorrer', 'apenas_registrar')),
  recomendacao_justificativa text check (char_length(recomendacao_justificativa) <= 1000),
  recomendada_por    uuid references core.usuarios (id),
  recomendada_em     timestamptz,
  validacao          jsonb,
  validada_em        timestamptz,
  bloqueado          boolean not null default true,
  analise_status     text not null default 'sem_analise' check (analise_status in ('sem_analise', 'pendente', 'concluida', 'falhou', 'desligada')),
  analise_erro       text check (char_length(analise_erro) <= 500),
  analise_modelo     text check (char_length(analise_modelo) <= 100),
  analise_prompt_versao text check (char_length(analise_prompt_versao) <= 40),
  analise_tokens_entrada int check (analise_tokens_entrada >= 0),
  analise_tokens_saida   int check (analise_tokens_saida >= 0),
  analise_em         timestamptz,
  analise_dia        date,
  analise_qtd        int not null default 0,
  peca_id            uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid default core.usuario_atual(),
  foreign key (participacao_id, empresa_id) references priv.participacoes (id, empresa_id) on delete cascade,
  foreign key (peca_id, empresa_id) references priv.pecas (id, empresa_id) on delete set null (peca_id),
  check ((recomendacao is null) = (recomendada_em is null)),
  unique (participacao_id),
  unique (id, empresa_id)
);

create table priv.parecer_achados (
  id                  uuid primary key default core.uuid_v7(),
  empresa_id          uuid not null references core.empresas (id) on delete cascade,
  parecer_id          uuid not null,
  ordem               int not null default 0,
  origem              text not null check (origem in ('ia', 'manual')),
  tipo                text not null check (tipo in ('certidao', 'economico_financeiro', 'atestado', 'signatario', 'me_epp', 'produto_tecnico', 'proposta', 'inexequibilidade', 'outro')),
  descricao           text not null check (char_length(descricao) between 3 and 600),
  citacao_concorrente text check (char_length(citacao_concorrente) <= 1500),
  concorrente_confere boolean not null default false,
  citacao_edital      text check (char_length(citacao_edital) <= 1500),
  edital_confere      boolean not null default false,
  pagina_edital       int,
  prova               text check (char_length(prova) <= 1000),
  fundamento          text check (char_length(fundamento) <= 500),
  classificacao       text check (classificacao in ('forte', 'moderada', 'fraca')),
  modelo_ia           text check (char_length(modelo_ia) <= 100),
  created_at          timestamptz not null default now(),
  created_by          uuid default core.usuario_atual(),
  updated_at          timestamptz not null default now(),
  foreign key (parecer_id, empresa_id) references priv.pareceres_recursais (id, empresa_id) on delete cascade
);
create index parecer_achados_idx on priv.parecer_achados (parecer_id, ordem);

alter table priv.pareceres_recursais enable row level security;
alter table priv.parecer_achados enable row level security;
create policy pareceres_recursais_select on priv.pareceres_recursais for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
create policy parecer_achados_select on priv.parecer_achados for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.pareceres_recursais, priv.parecer_achados to vv_api;
grant select on priv.pareceres_recursais, priv.parecer_achados to vv_worker;
grant update (validacao, validada_em, bloqueado, analise_status, analise_erro, analise_modelo, analise_prompt_versao, analise_tokens_entrada, analise_tokens_saida, analise_em)
  on priv.pareceres_recursais to vv_worker;
grant insert, delete on priv.parecer_achados to vv_worker;
grant update (concorrente_confere, edital_confere, pagina_edital) on priv.parecer_achados to vv_worker;
create trigger pareceres_recursais_audit after insert or update on priv.pareceres_recursais for each row execute function audit.registrar();
alter table priv.pareceres_recursais enable always trigger pareceres_recursais_audit;
create trigger parecer_achados_audit after insert or update or delete on priv.parecer_achados for each row execute function audit.registrar();
alter table priv.parecer_achados enable always trigger parecer_achados_audit;

create function priv.enfileirar_parecer(p_empresa uuid, p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('validar_parecer', p_empresa, jsonb_build_object('parecer_id', p_id),
                        'parecer:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
$$;
revoke all on function priv.enfileirar_parecer(uuid, uuid) from public;

-- Abre (ou atualiza) o parecer de um item em que a empresa NÃO foi a primeira colocada (gatilho recursal do resultado).
create function priv.abrir_parecer(p_empresa uuid, p_participacao uuid, p_concorrente text, p_texto text)
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
  if not exists (select 1 from priv.resultados_item where participacao_id = p_participacao and empresa_id = p_empresa and gatilho_recursal) then
    raise exception 'o parecer só se abre quando a empresa não foi a primeira colocada (resultado com gatilho recursal)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pareceres_recursais (empresa_id, participacao_id, concorrente, texto_concorrente)
  values (p_empresa, p_participacao, btrim(p_concorrente), nullif(btrim(p_texto), ''))
  on conflict (participacao_id) do update set concorrente = excluded.concorrente, texto_concorrente = excluded.texto_concorrente, updated_at = now(),
         validacao = null, validada_em = null, bloqueado = true
  returning id into v_id;
  perform priv.enfileirar_parecer(p_empresa, v_id);
  return v_id;
end;
$$;
grant execute on function priv.abrir_parecer(uuid, uuid, text, text) to vv_api;

-- Pede à IA que SUGIRA achados a partir do texto da concorrente (3 por parecer por dia: custo).
create function priv.pedir_analise_vencedora(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dia date;
  v_qtd int;
  v_texto text;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select analise_dia, analise_qtd, texto_concorrente into v_dia, v_qtd, v_texto from priv.pareceres_recursais where id = p_id and empresa_id = p_empresa for update;
  if not found then
    raise exception 'parecer não encontrado' using errcode = 'no_data_found';
  end if;
  if char_length(btrim(coalesce(v_texto, ''))) < 50 then
    raise exception 'cole o texto da proposta ou dos documentos da concorrente (mínimo 50 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  if v_dia = current_date and v_qtd >= 3 then
    raise exception 'limite de análises por parecer atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  update priv.pareceres_recursais set analise_status = 'pendente', analise_erro = null, analise_dia = current_date,
         analise_qtd = case when v_dia = current_date then v_qtd + 1 else 1 end
   where id = p_id and empresa_id = p_empresa;
  perform ops.enfileirar('analisar_vencedora', p_empresa, jsonb_build_object('parecer_id', p_id),
                         'vencedora:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;
grant execute on function priv.pedir_analise_vencedora(uuid, uuid) to vv_api;

-- Cria ou edita um achado (decisão humana: tipo, prova, fundamento, classificação). O worker reconfere as citações e a evidência.
create function priv.salvar_achado(p_empresa uuid, p_parecer uuid, p_id uuid, p_tipo text, p_descricao text, p_cit_concorrente text, p_cit_edital text,
                                   p_prova text, p_fundamento text, p_classificacao text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pareceres_recursais where id = p_parecer and empresa_id = p_empresa) then
    raise exception 'parecer não encontrado' using errcode = 'no_data_found';
  end if;
  if v_id is null then
    insert into priv.parecer_achados (empresa_id, parecer_id, ordem, origem, tipo, descricao, citacao_concorrente, citacao_edital, prova, fundamento, classificacao)
    values (p_empresa, p_parecer, (select coalesce(max(ordem), 0) + 1 from priv.parecer_achados where parecer_id = p_parecer), 'manual', p_tipo, btrim(p_descricao),
            nullif(btrim(p_cit_concorrente), ''), nullif(btrim(p_cit_edital), ''), nullif(btrim(p_prova), ''), nullif(btrim(p_fundamento), ''), p_classificacao)
    returning id into v_id;
  else
    update priv.parecer_achados set tipo = p_tipo, descricao = btrim(p_descricao), citacao_concorrente = nullif(btrim(p_cit_concorrente), ''),
           citacao_edital = nullif(btrim(p_cit_edital), ''), prova = nullif(btrim(p_prova), ''), fundamento = nullif(btrim(p_fundamento), ''),
           classificacao = p_classificacao, concorrente_confere = false, edital_confere = false, pagina_edital = null, updated_at = now()
     where id = v_id and parecer_id = p_parecer and empresa_id = p_empresa;
    if not found then
      raise exception 'achado não encontrado' using errcode = 'no_data_found';
    end if;
  end if;
  update priv.pareceres_recursais set validacao = null, validada_em = null, bloqueado = true, updated_at = now() where id = p_parecer and empresa_id = p_empresa;
  perform priv.enfileirar_parecer(p_empresa, p_parecer);
  return v_id;
end;
$$;
grant execute on function priv.salvar_achado(uuid, uuid, uuid, text, text, text, text, text, text, text) to vv_api;

create function priv.remover_achado(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_parecer uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  delete from priv.parecer_achados where id = p_id and empresa_id = p_empresa returning parecer_id into v_parecer;
  if not found then
    raise exception 'achado não encontrado' using errcode = 'no_data_found';
  end if;
  update priv.pareceres_recursais set validacao = null, validada_em = null, bloqueado = true, updated_at = now() where id = v_parecer and empresa_id = p_empresa;
  perform priv.enfileirar_parecer(p_empresa, v_parecer);
end;
$$;
grant execute on function priv.remover_achado(uuid, uuid) to vv_api;

-- A recomendação é do perfil jurídico que APROVA peças (recorrer, não recorrer, apenas registrar), com justificativa.
create function priv.registrar_recomendacao(p_empresa uuid, p_id uuid, p_recomendacao text, p_justificativa text)
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
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'a recomendação exige justificativa' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pareceres_recursais set recomendacao = p_recomendacao, recomendacao_justificativa = btrim(p_justificativa), recomendada_por = core.usuario_atual(),
         recomendada_em = now(), validacao = null, validada_em = null, bloqueado = true, updated_at = now()
   where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'parecer não encontrado' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_parecer(p_empresa, p_id);
end;
$$;
grant execute on function priv.registrar_recomendacao(uuid, uuid, text, text) to vv_api;

-- 10.5: com a recomendação "recorrer" e a evidência conferida (sem bloqueio), abre a peça de recurso ligada ao prazo das razões, se houver.
create function priv.abrir_peca_recurso(p_empresa uuid, p_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_p record;
  v_acomp uuid;
  v_evento uuid;
  v_peca uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select * into v_p from priv.pareceres_recursais where id = p_id and empresa_id = p_empresa for update;
  if not found then
    raise exception 'parecer não encontrado' using errcode = 'no_data_found';
  end if;
  if v_p.peca_id is not null then
    raise exception 'a peça de recurso já foi aberta' using errcode = 'invalid_parameter_value';
  end if;
  if v_p.recomendacao is distinct from 'recorrer' or v_p.validada_em is null or v_p.bloqueado then
    raise exception 'só se abre o recurso com a recomendação "recorrer" e a evidência conferida sem bloqueios' using errcode = 'invalid_parameter_value';
  end if;
  select acompanhamento_id into v_acomp from priv.participacoes where id = v_p.participacao_id and empresa_id = p_empresa;
  select id into v_evento from priv.agenda_eventos where acompanhamento_id = v_acomp and empresa_id = p_empresa and tipo = 'razoes_recurso';
  insert into priv.pecas (empresa_id, acompanhamento_id, evento_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_acomp, v_evento, 'recurso', 'Recurso administrativo contra a classificação de ' || left(v_p.concorrente, 150), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_peca;
  update priv.pareceres_recursais set peca_id = v_peca, updated_at = now() where id = p_id;
  return v_peca;
end;
$$;
grant execute on function priv.abrir_peca_recurso(uuid, uuid) to vv_api;

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
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca', 'minutar_peca', 'ler_recurso', 'validar_parecer', 'analisar_vencedora') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.abrir_peca_recurso(uuid, uuid);
drop function priv.registrar_recomendacao(uuid, uuid, text, text);
drop function priv.remover_achado(uuid, uuid);
drop function priv.salvar_achado(uuid, uuid, uuid, text, text, text, text, text, text, text);
drop function priv.pedir_analise_vencedora(uuid, uuid);
drop function priv.abrir_parecer(uuid, uuid, text, text);
drop function priv.enfileirar_parecer(uuid, uuid);
drop table priv.parecer_achados;
drop table priv.pareceres_recursais;
