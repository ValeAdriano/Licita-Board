-- Chave do provedor de IA por EMPRESA, cadastrada pela interface (decisão do Adriano, 2026-11-05). Cada empresa traz a sua chave e paga o
-- seu uso. A chave é CIFRADA (envelope AES-256-GCM da ADR-017, contexto = tabela|coluna|empresa) ANTES de chegar ao banco; o banco nunca vê o
-- texto, a API nunca a devolve (só os 4 últimos caracteres) e o `vv_api` nem tem permissão de ler a coluna cifrada. Só o worker a decifra,
-- no momento de chamar o provedor. Quem cadastra, troca ou remove: `configuracoes/editar`. A auditoria registra a mudança sem o valor.

-- migrate:up
create table priv.empresa_ia (
  empresa_id     uuid primary key references core.empresas (id) on delete cascade,
  provedor       text not null default 'anthropic' check (provedor in ('anthropic')),
  chave_cifrada  jsonb not null check (core.envelope_valido(chave_cifrada)),
  ultimos4       text not null check (char_length(ultimos4) = 4),
  modelo         text check (modelo in ('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5')),
  teste_status   text check (teste_status in ('ok', 'falhou', 'pendente')),
  teste_erro     text check (char_length(teste_erro) <= 300),
  teste_em       timestamptz,
  atualizada_por uuid default core.usuario_atual(),
  atualizada_em  timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
alter table priv.empresa_ia enable row level security;
create policy empresa_ia_select on priv.empresa_ia for select to vv_api using (core.has_permission(empresa_id, 'configuracoes', 'visualizar'));
-- A API lê só os metadados: a coluna cifrada não tem grant nenhum para ela.
grant select (empresa_id, provedor, ultimos4, modelo, teste_status, teste_erro, teste_em, atualizada_por, atualizada_em) on priv.empresa_ia to vv_api;
grant select on priv.empresa_ia to vv_worker;
grant execute on function core.envelope_valido(jsonb) to vv_worker;  -- o CHECK da tabela roda também nos UPDATE do worker (teste da chave)
grant update (teste_status, teste_erro, teste_em) on priv.empresa_ia to vv_worker;
create trigger empresa_ia_audit after insert or update or delete on priv.empresa_ia for each row execute function audit.registrar('empresa_id', 'chave_cifrada,ultimos4');
alter table priv.empresa_ia enable always trigger empresa_ia_audit;

create function priv.salvar_chave_ia(p_empresa uuid, p_envelope jsonb, p_ultimos4 text, p_modelo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  insert into priv.empresa_ia (empresa_id, chave_cifrada, ultimos4, modelo, teste_status, teste_erro, teste_em)
  values (p_empresa, p_envelope, p_ultimos4, p_modelo, null, null, null)
  on conflict (empresa_id) do update set chave_cifrada = excluded.chave_cifrada, ultimos4 = excluded.ultimos4, modelo = coalesce(excluded.modelo, priv.empresa_ia.modelo),
    teste_status = null, teste_erro = null, teste_em = null, atualizada_por = core.usuario_atual(), atualizada_em = now();
end;
$$;

create function priv.definir_modelo_ia(p_empresa uuid, p_modelo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set modelo = p_modelo, atualizada_por = core.usuario_atual(), atualizada_em = now() where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'no_data_found';
  end if;
end;
$$;

create function priv.remover_chave_ia(p_empresa uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  delete from priv.empresa_ia where empresa_id = p_empresa;
end;
$$;

-- Pede ao worker um teste barato da chave (1 mensagem mínima ao provedor); o resultado volta em teste_status.
create function priv.pedir_teste_chave_ia(p_empresa uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set teste_status = 'pendente', teste_erro = null, teste_em = null where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('testar_chave_ia', p_empresa, jsonb_build_object('empresa_id', p_empresa), 'testeia:' || p_empresa || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;
grant execute on function priv.salvar_chave_ia(uuid, jsonb, text, text), priv.definir_modelo_ia(uuid, text), priv.remover_chave_ia(uuid), priv.pedir_teste_chave_ia(uuid) to vv_api;

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
                    'extrair_requisitos', 'testar_chave_ia') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop function priv.pedir_teste_chave_ia(uuid), priv.remover_chave_ia(uuid), priv.definir_modelo_ia(uuid, text), priv.salvar_chave_ia(uuid, jsonb, text, text);
drop table priv.empresa_ia;
