-- Fase 10 · 10.6 Contrarrazões: recurso interposto por OUTRO licitante, inserido pelo jurídico (texto colado + link opcional).
-- Inserir o recurso: (1) lança o prazo de contrarrazões na agenda a partir da data de divulgação (regra já cadastrada em pub.regras_prazo,
-- ⚖️ ainda sem validação do jurídico: nada novo é suposto aqui), (2) abre a peça de contrarrazões e (3) pede à IA a leitura das alegações.
-- A IA só EXTRAI as alegações (com citação literal conferida pelo código); a defesa de cada uma (prova que refuta e fundamento) é decisão
-- humana. Alegação a rebater sem prova indicada é PONTO DE RISCO e aparece no validador da peça (aviso, não bloqueia).

-- migrate:up
create table priv.recursos_terceiros (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id  uuid not null,
  peca_id            uuid not null,
  recorrente         text not null check (char_length(recorrente) between 2 and 200),
  publicado_em       timestamptz not null,
  link               text check (link ~ '^https://[^\s]+$' and char_length(link) <= 500),
  texto              text not null check (char_length(texto) between 50 and 60000),
  leitura_status     text not null default 'pendente' check (leitura_status in ('pendente', 'concluida', 'falhou', 'desligada')),
  leitura_erro       text check (char_length(leitura_erro) <= 500),
  leitura_modelo     text check (char_length(leitura_modelo) <= 100),
  leitura_prompt_versao text check (char_length(leitura_prompt_versao) <= 40),
  leitura_tokens_entrada int check (leitura_tokens_entrada >= 0),
  leitura_tokens_saida   int check (leitura_tokens_saida >= 0),
  leitura_em         timestamptz,
  leitura_dia        date,
  leitura_qtd        int not null default 0,
  created_at         timestamptz not null default now(),
  created_by         uuid default core.usuario_atual(),
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (peca_id, empresa_id) references priv.pecas (id, empresa_id) on delete cascade,
  unique (id, empresa_id),
  unique (peca_id)
);
create index recursos_terceiros_acomp_idx on priv.recursos_terceiros (acompanhamento_id);

create table priv.recurso_alegacoes (
  id                  uuid primary key default core.uuid_v7(),
  empresa_id          uuid not null references core.empresas (id) on delete cascade,
  recurso_id          uuid not null,
  ordem               int not null default 0,
  origem              text not null check (origem in ('ia', 'manual')),
  resumo              text not null check (char_length(resumo) between 3 and 600),
  citacao             text check (char_length(citacao) <= 1500),
  citacao_confere     boolean not null default false,
  fundamentos         jsonb not null default '[]'::jsonb,
  decisao             text check (decisao in ('rebater', 'concordar', 'sem_relevancia')),
  contra_prova        text check (char_length(contra_prova) <= 1000),
  fundamento_refutacao text check (char_length(fundamento_refutacao) <= 1000),
  risco               boolean generated always as (coalesce(decisao, 'rebater') = 'rebater' and btrim(coalesce(contra_prova, '')) = '') stored,
  modelo_ia           text check (char_length(modelo_ia) <= 100),
  created_at          timestamptz not null default now(),
  created_by          uuid default core.usuario_atual(),
  updated_at          timestamptz not null default now(),
  foreign key (recurso_id, empresa_id) references priv.recursos_terceiros (id, empresa_id) on delete cascade,
  check (citacao_confere = false or citacao is not null)
);
create index recurso_alegacoes_idx on priv.recurso_alegacoes (recurso_id, ordem);

alter table priv.recursos_terceiros enable row level security;
alter table priv.recurso_alegacoes enable row level security;
create policy recursos_terceiros_select on priv.recursos_terceiros for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
create policy recurso_alegacoes_select on priv.recurso_alegacoes for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.recursos_terceiros, priv.recurso_alegacoes to vv_api;
grant select on priv.recursos_terceiros, priv.recurso_alegacoes to vv_worker;
grant update (leitura_status, leitura_erro, leitura_modelo, leitura_prompt_versao, leitura_tokens_entrada, leitura_tokens_saida, leitura_em) on priv.recursos_terceiros to vv_worker;
grant insert, delete on priv.recurso_alegacoes to vv_worker;
create trigger recursos_terceiros_audit after insert or update on priv.recursos_terceiros for each row execute function audit.registrar();
alter table priv.recursos_terceiros enable always trigger recursos_terceiros_audit;
create trigger recurso_alegacoes_audit after insert or update or delete on priv.recurso_alegacoes for each row execute function audit.registrar();
alter table priv.recurso_alegacoes enable always trigger recurso_alegacoes_audit;

-- Pede (ou repete) a leitura pela IA: no máximo 5 por recurso por dia (custo). Mantém as alegações já tratadas por pessoa.
create function priv.pedir_leitura_recurso(p_empresa uuid, p_recurso uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_dia date;
  v_qtd int;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select leitura_dia, leitura_qtd into v_dia, v_qtd from priv.recursos_terceiros where id = p_recurso and empresa_id = p_empresa for update;
  if not found then
    raise exception 'recurso não encontrado' using errcode = 'no_data_found';
  end if;
  if v_dia = current_date and v_qtd >= 5 then
    raise exception 'limite de leituras por recurso atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  update priv.recursos_terceiros set leitura_status = 'pendente', leitura_erro = null,
         leitura_dia = current_date, leitura_qtd = case when v_dia = current_date then v_qtd + 1 else 1 end
   where id = p_recurso and empresa_id = p_empresa;
  perform ops.enfileirar('ler_recurso', p_empresa, jsonb_build_object('recurso_id', p_recurso),
                         'recurso:' || p_recurso || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;
grant execute on function priv.pedir_leitura_recurso(uuid, uuid) to vv_api;

-- Insere o recurso de terceiro: lança o prazo de contrarrazões (um evento por acompanhamento; com mais de um recurso vale a data mais
-- CEDO, o lado seguro), abre a peça de contrarrazões ligada ao prazo e pede a leitura das alegações.
create function priv.inserir_recurso_terceiro(p_empresa uuid, p_acomp uuid, p_recorrente text, p_publicado_em timestamptz, p_texto text, p_link text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_evento uuid;
  v_peca uuid;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo, base_data)
  values (p_empresa, p_acomp, 'contrarrazoes', p_publicado_em)
  on conflict (acompanhamento_id, tipo) do update set base_data = least(priv.agenda_eventos.base_data, excluded.base_data)
  returning id into v_evento;
  perform ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', p_acomp),
                         'calc:' || p_acomp || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  insert into priv.pecas (empresa_id, acompanhamento_id, evento_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, p_acomp, v_evento, 'contrarrazoes', 'Contrarrazões ao recurso de ' || left(btrim(p_recorrente), 150), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_peca;
  insert into priv.recursos_terceiros (empresa_id, acompanhamento_id, peca_id, recorrente, publicado_em, link, texto)
  values (p_empresa, p_acomp, v_peca, btrim(p_recorrente), p_publicado_em, nullif(btrim(p_link), ''), p_texto)
  returning id into v_id;
  perform priv.pedir_leitura_recurso(p_empresa, v_id);
  return jsonb_build_object('id', v_id, 'pecaId', v_peca, 'eventoId', v_evento);
end;
$$;
grant execute on function priv.inserir_recurso_terceiro(uuid, uuid, text, timestamptz, text, text) to vv_api;

create function priv.adicionar_alegacao(p_empresa uuid, p_recurso uuid, p_resumo text, p_citacao text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_texto text;
  v_id uuid;
  v_cit text := nullif(btrim(p_citacao), '');
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select texto into v_texto from priv.recursos_terceiros where id = p_recurso and empresa_id = p_empresa;
  if not found then
    raise exception 'recurso não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.recurso_alegacoes (empresa_id, recurso_id, ordem, origem, resumo, citacao, citacao_confere)
  values (p_empresa, p_recurso, (select coalesce(max(ordem), 0) + 1 from priv.recurso_alegacoes where recurso_id = p_recurso), 'manual', btrim(p_resumo), v_cit,
          v_cit is not null and strpos(lower(regexp_replace(v_texto, '\s+', ' ', 'g')), lower(regexp_replace(v_cit, '\s+', ' ', 'g'))) > 0)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function priv.adicionar_alegacao(uuid, uuid, text, text) to vv_api;

-- Decisão humana sobre a alegação: rebater / concordar / sem relevância, a prova que refuta e o fundamento. Reconfere a peça (aviso de risco).
create function priv.decidir_alegacao(p_empresa uuid, p_id uuid, p_decisao text, p_contra_prova text, p_fundamento text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_peca uuid;
  v_status text;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.recurso_alegacoes set decisao = p_decisao, contra_prova = nullif(btrim(p_contra_prova), ''), fundamento_refutacao = nullif(btrim(p_fundamento), ''), updated_at = now()
   where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'alegação não encontrada' using errcode = 'no_data_found';
  end if;
  select p.id, p.status into v_peca, v_status from priv.pecas p join priv.recursos_terceiros r on r.peca_id = p.id and r.empresa_id = p.empresa_id
   join priv.recurso_alegacoes a on a.recurso_id = r.id and a.empresa_id = r.empresa_id where a.id = p_id;
  if v_status in ('triagem', 'minuta', 'revisao') then
    perform priv.enfileirar_peca(p_empresa, v_peca);
  end if;
end;
$$;
grant execute on function priv.decidir_alegacao(uuid, uuid, text, text, text) to vv_api;

create function priv.remover_alegacao(p_empresa uuid, p_id uuid)
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
  delete from priv.recurso_alegacoes where id = p_id and empresa_id = p_empresa;
  if not found then
    raise exception 'alegação não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;
grant execute on function priv.remover_alegacao(uuid, uuid) to vv_api;

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
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca', 'minutar_peca', 'ler_recurso') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.remover_alegacao(uuid, uuid);
drop function priv.decidir_alegacao(uuid, uuid, text, text, text);
drop function priv.adicionar_alegacao(uuid, uuid, text, text);
drop function priv.inserir_recurso_terceiro(uuid, uuid, text, timestamptz, text, text);
drop function priv.pedir_leitura_recurso(uuid, uuid);
drop table priv.recurso_alegacoes;
drop table priv.recursos_terceiros;
