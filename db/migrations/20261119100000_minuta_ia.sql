-- Fase 10 · minuta pela IA (10.2 a 10.6, decisão do Adriano: "Minuta por IA"). A IA ELABORA A MINUTA; a decisão, a revisão e a aprovação são do
-- perfil jurídico (10.1). O worker chama o provedor com a chave da EMPRESA, entrega à IA APENAS fontes da base jurídica VERIFICADA e trechos públicos
-- do edital, e o rascunho cai como `minuta` (nunca adianta o fluxo): a conferência de citações do módulo continua bloqueando o que não estiver na base.

-- migrate:up
alter table priv.pecas add column minuta_origem text not null default 'manual' check (minuta_origem in ('manual', 'ia', 'ia_revisada')),
  add column minuta_modelo text check (char_length(minuta_modelo) <= 100);
grant update (minuta, clausulas, minuta_origem, minuta_modelo) on priv.pecas to vv_worker;

create table priv.pecas_ia (
  id             uuid primary key default core.uuid_v7(),
  empresa_id     uuid not null references core.empresas (id) on delete cascade,
  peca_id        uuid not null,
  status         text not null default 'pendente' check (status in ('pendente', 'concluida', 'falhou', 'desligada')),
  instrucao      text check (char_length(instrucao) <= 3000),
  modelo         text check (char_length(modelo) <= 100),
  prompt_versao  text check (char_length(prompt_versao) <= 40),
  tokens_entrada int check (tokens_entrada >= 0),
  tokens_saida   int check (tokens_saida >= 0),
  referencias_ok int not null default 0,
  referencias_descartadas int not null default 0,
  citacoes_fora_da_base int not null default 0,
  erro           text check (char_length(erro) <= 500),
  solicitada_por uuid default core.usuario_atual(),
  created_at     timestamptz not null default now(),
  concluida_em   timestamptz,
  foreign key (peca_id, empresa_id) references priv.pecas (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create index pecas_ia_peca_idx on priv.pecas_ia (peca_id, created_at desc);
alter table priv.pecas_ia enable row level security;
create policy pecas_ia_select on priv.pecas_ia for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.pecas_ia to vv_api;
grant select on priv.pecas_ia to vv_worker;
grant update (status, modelo, prompt_versao, tokens_entrada, tokens_saida, referencias_ok, referencias_descartadas, citacoes_fora_da_base, erro, concluida_em) on priv.pecas_ia to vv_worker;
create trigger pecas_ia_audit after insert or update on priv.pecas_ia for each row execute function audit.registrar();
alter table priv.pecas_ia enable always trigger pecas_ia_audit;

-- Pede a minuta à IA (só antes da aprovação). Uma por vez por peça e no máximo 5 por dia (custo).
create function priv.pedir_minuta_peca(p_empresa uuid, p_peca uuid, p_instrucao text)
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
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta')) then
    raise exception 'a IA só minuta uma peça em triagem ou minuta (antes da revisão)' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from priv.pecas_ia where peca_id = p_peca and status = 'pendente' and created_at > now() - interval '15 minutes') then
    raise exception 'já há uma minuta em andamento para esta peça' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from priv.pecas_ia where peca_id = p_peca and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite de minutas por peça atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  insert into priv.pecas_ia (empresa_id, peca_id, instrucao) values (p_empresa, p_peca, nullif(btrim(p_instrucao), '')) returning id into v_id;
  perform ops.enfileirar('minutar_peca', p_empresa, jsonb_build_object('minuta_id', v_id), 'minuta:' || v_id);
  return v_id;
end;
$$;
grant execute on function priv.pedir_minuta_peca(uuid, uuid, text) to vv_api;

-- Quem edita a minuta da IA a assume: passa a 'ia_revisada' (fica registrado que nasceu de rascunho da IA).
create or replace function priv.salvar_minuta(p_empresa uuid, p_id uuid, p_minuta text, p_clausulas text)
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
         minuta_origem = case when minuta_origem = 'manual' then 'manual' else 'ia_revisada' end,
         validacao = null, validada_em = null, bloqueada = true, revisado_por = null, revisado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao');
  if not found then
    raise exception 'a minuta só se edita antes da aprovação' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
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
                    'extrair_requisitos', 'testar_chave_ia', 'processar_peca', 'minutar_peca') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.pedir_minuta_peca(uuid, uuid, text);
drop table priv.pecas_ia;
alter table priv.pecas drop column minuta_modelo, drop column minuta_origem;
