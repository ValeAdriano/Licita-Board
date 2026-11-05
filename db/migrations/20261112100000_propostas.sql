-- Fase 08 · Propostas (spec docs/specs/fase-08.md): instantâneo dos itens com PREÇO APROVADO (Fase 07), validação automática (8.6),
-- fluxo rascunho → conferência → aprovada → final e documento final com SHA-256, bloqueado. Custos e margens NUNCA entram aqui.
-- O worker valida e gera o documento; a API só grava as decisões humanas por função. O sistema nunca envia ao portal (regra 17).

-- migrate:up
create table priv.propostas (
  id                  uuid primary key default core.uuid_v7(),
  empresa_id          uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id   uuid not null,
  versao              int not null check (versao >= 1),
  tipo                text not null default 'inicial' check (tipo in ('inicial', 'final')),
  status              text not null default 'rascunho' check (status in ('rascunho', 'conferencia', 'aprovada', 'final')),
  representante_id    uuid,
  validade_dias       int check (validade_dias > 0),
  prazo_entrega_dias  int check (prazo_entrega_dias > 0),
  garantia_meses      int check (garantia_meses > 0),
  condicoes           text check (char_length(condicoes) <= 2000),
  local_assinatura    text check (char_length(local_assinatura) <= 120),
  conteudo            jsonb not null check (jsonb_typeof(conteudo) = 'array'),
  total               numeric(18, 4) not null check (total >= 0),
  total_extenso       text,
  validacao           jsonb,
  validada_em         timestamptz,
  bloqueada           boolean not null default true,
  arquivo_chave       text,
  arquivo_sha256      text check (arquivo_sha256 ~ '^[0-9a-f]{64}$'),
  gerado_em           timestamptz,
  conferido_por       uuid references core.usuarios (id),
  conferido_em        timestamptz,
  aprovado_por        uuid references core.usuarios (id),
  aprovado_em         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default core.usuario_atual(),
  deleted_at          timestamptz,
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  foreign key (representante_id, empresa_id) references core.representantes (id, empresa_id),
  check ((conferido_por is null) = (conferido_em is null)),
  check ((aprovado_por is null) = (aprovado_em is null)),
  check (status <> 'final' or (arquivo_chave is not null and arquivo_sha256 is not null)),
  unique (acompanhamento_id, versao),
  unique (id, empresa_id)
);
create index propostas_empresa_idx on priv.propostas (empresa_id);

-- Versão final é imutável (8.7): qualquer UPDATE nela é recusado; mudar = nova versão. (DELETE por cascata de exclusão da empresa segue possível.)
create function priv.propostas_final_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'final' then
    raise exception 'proposta final é imutável: crie uma nova versão' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger propostas_final_imutavel before update on priv.propostas for each row execute function priv.propostas_final_imutavel();
create trigger propostas_updated_at before update on priv.propostas for each row execute function core.set_updated_at();

alter table priv.propostas enable row level security;
create policy propostas_select on priv.propostas for select to vv_api using (core.has_permission(empresa_id, 'propostas', 'visualizar'));
grant select on priv.propostas to vv_api;
create trigger propostas_audit after insert or update on priv.propostas for each row execute function audit.registrar();
alter table priv.propostas enable always trigger propostas_audit;

-- Worker: lê o que valida e grava só resultado, documento e a mudança de status que ele decide.
grant select on priv.propostas to vv_worker;
grant update (total_extenso, validacao, validada_em, bloqueada, arquivo_chave, arquivo_sha256, gerado_em, status, conferido_por, conferido_em, aprovado_por, aprovado_em)
  on priv.propostas to vv_worker;
grant select (id, empresa_id, tipo, nome, cargo, ativo, deleted_at) on core.representantes to vv_worker;
grant select on core.representante_poderes, core.procuracao_poderes to vv_worker;
grant select (id, representante_id, data_emissao, data_validade, revogada_em, deleted_at) on core.procuracoes to vv_worker;
grant execute on function core.signatario_valido(uuid, date, text), core.cnpj_valido(text) to vv_worker;

create function priv.enfileirar_proposta(p_empresa uuid, p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('gerar_proposta', p_empresa, jsonb_build_object('proposta_id', p_id),
                        'proposta:' || p_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
$$;
revoke all on function priv.enfileirar_proposta(uuid, uuid) from public;

-- Cria uma versão (rascunho) a partir dos itens do acompanhamento com preço APROVADO. Só preço unitário e total entram: nunca custos.
create function priv.criar_proposta(p_empresa uuid, p_acomp uuid, p_representante uuid, p_tipo text, p_validade int, p_prazo int, p_garantia int, p_condicoes text, p_local text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_itens jsonb;
  v_total numeric(18, 4);
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'participacao_id', pa.id, 'numero_item', i.numero_item, 'descricao', i.descricao, 'unidade', i.unidade_medida,
           'quantidade', pr.quantidade::text, 'valor_unitario', pr.preco_final_unit::text, 'valor_total', pr.total_proposta::text,
           'produto_id', pr.produto_id, 'marca', coalesce(p.marca, pa.marca), 'modelo', coalesce(p.modelo, pa.modelo), 'casas', pr.casas_unitario) order by i.numero_item), '[]'::jsonb),
         coalesce(sum(pr.total_proposta), 0)
    into v_itens, v_total
    from priv.participacoes pa
    join priv.precificacoes pr on pr.participacao_id = pa.id and pr.empresa_id = pa.empresa_id and pr.deleted_at is null and pr.aprovado_em is not null and pr.erro_calculo is null
    left join pub.edital_itens i on i.id = pa.item_id
    left join priv.produtos p on p.id = pr.produto_id
   where pa.acompanhamento_id = p_acomp and pa.empresa_id = p_empresa and pa.deleted_at is null;
  if jsonb_array_length(v_itens) = 0 then
    raise exception 'nenhum item com preço aprovado (aprove o preço na formação de preços)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.propostas (empresa_id, acompanhamento_id, versao, tipo, representante_id, validade_dias, prazo_entrega_dias, garantia_meses, condicoes, local_assinatura, conteudo, total)
  values (p_empresa, p_acomp, coalesce((select max(versao) from priv.propostas where acompanhamento_id = p_acomp), 0) + 1, p_tipo, p_representante, p_validade, p_prazo, p_garantia,
          nullif(btrim(p_condicoes), ''), nullif(btrim(p_local), ''), v_itens, v_total)
  returning id into v_id;
  perform priv.enfileirar_proposta(p_empresa, v_id);
  return v_id;
end;
$$;

-- Ajusta os dados de um RASCUNHO e revalida.
create function priv.salvar_proposta(p_empresa uuid, p_id uuid, p_representante uuid, p_validade int, p_prazo int, p_garantia int, p_condicoes text, p_local text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas
     set representante_id = p_representante, validade_dias = p_validade, prazo_entrega_dias = p_prazo, garantia_meses = p_garantia,
         condicoes = nullif(btrim(p_condicoes), ''), local_assinatura = nullif(btrim(p_local), ''), validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null;
  if not found then
    raise exception 'só se edita um rascunho existente' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$$;

create function priv.revalidar_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$$;

-- Conferência (quem confere pode ser quem criou, mas a aprovação é de outra permissão).
create function priv.conferir_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'conferencia', conferido_por = core.usuario_atual(), conferido_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se confere um rascunho validado e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

create function priv.devolver_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'rascunho', conferido_por = null, conferido_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('conferencia', 'aprovada') and deleted_at is null;
  if not found then
    raise exception 'só se devolve uma proposta em conferência ou aprovada (e a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Aprovação: registra quem aprovou e pede ao worker o documento final (ele revalida; divergência devolve a rascunho).
create function priv.aprovar_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'aprovada', aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada;
  if not found then
    raise exception 'só se aprova uma proposta conferida e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$$;

-- Nova versão (rascunho) com os mesmos dados e os preços aprovados de AGORA; a final anterior fica preservada.
create function priv.nova_versao_proposta(p_empresa uuid, p_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select * into v from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  return priv.criar_proposta(p_empresa, v.acompanhamento_id, v.representante_id, v.tipo, v.validade_dias, v.prazo_entrega_dias, v.garantia_meses, v.condicoes, v.local_assinatura);
end;
$$;

grant execute on function priv.criar_proposta(uuid, uuid, uuid, text, int, int, int, text, text), priv.salvar_proposta(uuid, uuid, uuid, int, int, int, text, text),
  priv.revalidar_proposta(uuid, uuid), priv.conferir_proposta(uuid, uuid), priv.devolver_proposta(uuid, uuid), priv.aprovar_proposta(uuid, uuid),
  priv.nova_versao_proposta(uuid, uuid) to vv_api;

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
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos', 'email_agenda', 'analisar_item', 'calcular_preco', 'gerar_proposta') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.nova_versao_proposta(uuid, uuid), priv.aprovar_proposta(uuid, uuid), priv.devolver_proposta(uuid, uuid), priv.conferir_proposta(uuid, uuid),
  priv.revalidar_proposta(uuid, uuid), priv.salvar_proposta(uuid, uuid, uuid, int, int, int, text, text),
  priv.criar_proposta(uuid, uuid, uuid, text, int, int, int, text, text), priv.enfileirar_proposta(uuid, uuid);
drop table priv.propostas;
drop function priv.propostas_final_imutavel();
