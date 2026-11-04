-- Fase 02 · PR 3 · Dados bancários e PIX da empresa, cifrados em campo (spec fase-02 §3.1 e §4.2;
-- RF-02.3, RF-02.14; ADR-017; ameaças T4, T4.c, T5.38).
--
-- * A API cifra (AES-256-GCM em envelope, apps/api/src/cripto) ANTES de chegar aqui: o banco guarda só
--   o envelope jsonb e uma MÁSCARA (últimos caracteres) para listar sem decifrar. Nenhum valor em claro.
-- * vv_api NÃO lê as colunas cifradas nem o hash do PIX (grant por coluna) e NÃO escreve na tabela:
--   tudo passa por funções que conferem permissão (empresas/editar) e step-up `dados_bancarios`.
-- * Revelar o valor inteiro (core.revelar_conta) exige step-up, grava em core.revelacoes_dados (que a
--   auditoria também registra) e só então devolve o envelope, que a API decifra.
-- * Mudança de conta, de PIX ou revelação avisa os administradores de permissões da empresa por
--   notificação (que o worker transforma em push): vetor clássico de desvio de pagamento.
-- * Dado pessoal e cifrado saem redigidos da auditoria. O hash do PIX só detecta duplicidade DENTRO da
--   empresa (domínio com o id da empresa) e nunca é legível por vv_api.
-- * Exclusão definitiva da empresa apaga as contas (migration seguinte); revelações caem em cascade.

-- migrate:up
alter table core.step_up_tokens drop constraint step_up_tokens_escopo_check;
alter table core.step_up_tokens add constraint step_up_tokens_escopo_check check (escopo in (
  'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca',
  'dados_bancarios'
));

-- Envelope de ADR-017: { v: 1, dek, iv, ct } em base64, e só isso.
create function core.envelope_valido(p_envelope jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Nulo passa (colunas opcionais); as obrigatórias têm NOT NULL. JSON null não é envelope.
  select p_envelope is null or coalesce(
         jsonb_typeof(p_envelope) = 'object'
     and p_envelope ?& array['v', 'dek', 'iv', 'ct']
     and (select count(*) from jsonb_object_keys(p_envelope)) = 4
     and p_envelope ->> 'v' = '1'
     and p_envelope ->> 'dek' ~ '^[A-Za-z0-9+/]{80}={0,2}$'
     and p_envelope ->> 'iv' ~ '^[A-Za-z0-9+/]{16}$'
     and p_envelope ->> 'ct' ~ '^[A-Za-z0-9+/]{4,}={0,2}$'
     and char_length(p_envelope ->> 'ct') <= 1400, false)
$$;
grant execute on function core.envelope_valido(jsonb) to vv_api;

create table core.empresa_contas (
  id                         uuid primary key default core.uuid_v7(),
  empresa_id                 uuid not null references core.empresas (id),
  banco                      text not null check (banco ~ '^[0-9]{3}$'),
  tipo_conta                 text not null check (tipo_conta in ('corrente', 'poupanca', 'pagamento')),
  titular_nome               text not null check (char_length(titular_nome) between 2 and 200),
  agencia_cifrada            jsonb not null check (core.envelope_valido(agencia_cifrada)),
  conta_cifrada              jsonb not null check (core.envelope_valido(conta_cifrada)),
  titular_documento_cifrado  jsonb not null check (core.envelope_valido(titular_documento_cifrado)),
  pix_tipo                   text check (pix_tipo in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  pix_chave_cifrada          jsonb check (core.envelope_valido(pix_chave_cifrada)),
  pix_hash                   text check (pix_hash ~ '^[0-9a-f]{64}$'),
  agencia_mascara            text not null check (char_length(agencia_mascara) between 1 and 12),
  conta_mascara              text not null check (char_length(conta_mascara) between 1 and 12),
  titular_documento_mascara  text not null check (char_length(titular_documento_mascara) between 1 and 12),
  pix_mascara                text check (char_length(pix_mascara) between 1 and 12),
  principal                  boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  created_by                 uuid default core.usuario_atual(),
  deleted_at                 timestamptz,
  -- PIX é tudo ou nada: tipo, envelope, hash e máscara juntos.
  check ((pix_tipo is null) = (pix_chave_cifrada is null)
     and (pix_tipo is null) = (pix_hash is null)
     and (pix_tipo is null) = (pix_mascara is null))
);
create unique index empresa_contas_pix_uk on core.empresa_contas (empresa_id, pix_hash)
  where pix_hash is not null and deleted_at is null;
create unique index empresa_contas_principal_uk on core.empresa_contas (empresa_id)
  where principal and deleted_at is null;
create index empresa_contas_empresa_idx on core.empresa_contas (empresa_id);

-- Registro das revelações de valor inteiro (só inclusão; a auditoria também grava o INSERT).
create table core.revelacoes_dados (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  usuario_id  uuid not null references core.usuarios (id),
  tabela      text not null,
  registro_id uuid not null,
  campo       text not null,
  created_at  timestamptz not null default now()
);
create index revelacoes_dados_empresa_idx on core.revelacoes_dados (empresa_id, created_at desc);
create trigger revelacoes_dados_historico before update or delete on core.revelacoes_dados
  for each row execute function core.somente_insercao_empresa();
create trigger revelacoes_dados_sem_truncate before truncate on core.revelacoes_dados
  for each statement execute function core.somente_insercao_empresa();

alter table core.empresa_contas enable row level security;
alter table core.revelacoes_dados enable row level security;

create policy empresa_contas_select on core.empresa_contas for select to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'visualizar'));
create policy revelacoes_dados_select on core.revelacoes_dados for select to vv_api
  using (core.has_permission(empresa_id, 'auditoria', 'visualizar'));

-- Só colunas sem segredo: nada de envelope, de hash do PIX nem de escrita direta.
grant select (id, empresa_id, banco, tipo_conta, titular_nome, pix_tipo, agencia_mascara, conta_mascara,
              titular_documento_mascara, pix_mascara, principal, created_at, updated_at, deleted_at)
  on core.empresa_contas to vv_api;
grant select on core.revelacoes_dados to vv_api;

create trigger empresa_contas_updated_at before update on core.empresa_contas
  for each row execute function core.set_updated_at();
create trigger empresa_contas_audit after insert or update or delete on core.empresa_contas
  for each row execute function audit.registrar('empresa_id',
    'titular_nome,agencia_cifrada,conta_cifrada,titular_documento_cifrado,pix_chave_cifrada,pix_hash,'
    'agencia_mascara,conta_mascara,titular_documento_mascara,pix_mascara');
create trigger revelacoes_dados_audit after insert on core.revelacoes_dados
  for each row execute function audit.registrar();
alter table core.empresa_contas enable always trigger empresa_contas_audit;
alter table core.revelacoes_dados enable always trigger revelacoes_dados_audit;
alter table core.revelacoes_dados enable always trigger revelacoes_dados_historico;
alter table core.revelacoes_dados enable always trigger revelacoes_dados_sem_truncate;

-- Aviso aos administradores de permissões da empresa (interna: sem grant para vv_api).
create function core.avisar_admins_dados_bancarios(p_empresa uuid, p_titulo text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo)
  select distinct v.usuario_id, p_empresa, 'empresas', 'dados_bancarios', p_titulo
    from core.vinculos v
    join core.usuarios u on u.id = v.usuario_id
    join core.permissoes p on p.vinculo_id = v.id
   where v.empresa_id = p_empresa and v.ativo and v.deleted_at is null
     and u.ativo and u.deleted_at is null and v.papel <> 'CLIENTE'
     and p.modulo = 'permissoes' and p.acao = 'administrar_permissoes'
$$;

-- Cria (p_id nulo) ou altera uma conta. p_dados traz só o que muda; a API manda os envelopes já
-- cifrados e as máscaras. Chaves: banco, tipoConta, titularNome, agencia, conta, titularDocumento,
-- pixTipo, pixChave, pixHash, agenciaMascara, contaMascara, titularDocumentoMascara, pixMascara, principal.
create function core.salvar_conta(p_empresa uuid, p_id uuid, p_dados jsonb, p_step_up uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'empresas', 'editar') then
    raise exception 'sem permissão para alterar dados bancários' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'dados_bancarios', p_empresa, 'salvar_conta:' || coalesce(p_id::text, 'nova'));

  if coalesce((p_dados ->> 'principal')::boolean, false) then
    update core.empresa_contas set principal = false
     where empresa_id = p_empresa and principal and deleted_at is null and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into core.empresa_contas (
      empresa_id, banco, tipo_conta, titular_nome, agencia_cifrada, conta_cifrada, titular_documento_cifrado,
      pix_tipo, pix_chave_cifrada, pix_hash, agencia_mascara, conta_mascara, titular_documento_mascara,
      pix_mascara, principal)
    values (
      p_empresa, p_dados ->> 'banco', p_dados ->> 'tipoConta', p_dados ->> 'titularNome',
      p_dados -> 'agencia', p_dados -> 'conta', p_dados -> 'titularDocumento',
      p_dados ->> 'pixTipo', p_dados -> 'pixChave', p_dados ->> 'pixHash',
      p_dados ->> 'agenciaMascara', p_dados ->> 'contaMascara', p_dados ->> 'titularDocumentoMascara',
      p_dados ->> 'pixMascara', coalesce((p_dados ->> 'principal')::boolean, false))
    returning id into v_id;
  else
    update core.empresa_contas c set
      banco = coalesce(p_dados ->> 'banco', c.banco),
      tipo_conta = coalesce(p_dados ->> 'tipoConta', c.tipo_conta),
      titular_nome = coalesce(p_dados ->> 'titularNome', c.titular_nome),
      agencia_cifrada = coalesce(p_dados -> 'agencia', c.agencia_cifrada),
      conta_cifrada = coalesce(p_dados -> 'conta', c.conta_cifrada),
      titular_documento_cifrado = coalesce(p_dados -> 'titularDocumento', c.titular_documento_cifrado),
      agencia_mascara = coalesce(p_dados ->> 'agenciaMascara', c.agencia_mascara),
      conta_mascara = coalesce(p_dados ->> 'contaMascara', c.conta_mascara),
      titular_documento_mascara = coalesce(p_dados ->> 'titularDocumentoMascara', c.titular_documento_mascara),
      -- PIX: se vier pixTipo (mesmo "null" explícito), troca o conjunto inteiro; se não vier, mantém.
      pix_tipo = case when p_dados ? 'pixTipo' then p_dados ->> 'pixTipo' else c.pix_tipo end,
      pix_chave_cifrada = case when p_dados ? 'pixTipo' then p_dados -> 'pixChave' else c.pix_chave_cifrada end,
      pix_hash = case when p_dados ? 'pixTipo' then p_dados ->> 'pixHash' else c.pix_hash end,
      pix_mascara = case when p_dados ? 'pixTipo' then p_dados ->> 'pixMascara' else c.pix_mascara end,
      principal = coalesce((p_dados ->> 'principal')::boolean, c.principal)
     where c.id = p_id and c.empresa_id = p_empresa and c.deleted_at is null
    returning c.id into v_id;
    if v_id is null then
      raise exception 'conta não encontrada' using errcode = 'no_data_found';
    end if;
  end if;

  perform core.avisar_admins_dados_bancarios(p_empresa, 'Os dados bancários da empresa foram alterados');
  return v_id;
end;
$$;

create function core.remover_conta(p_empresa uuid, p_id uuid, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'empresas', 'editar') then
    raise exception 'sem permissão para alterar dados bancários' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'dados_bancarios', p_empresa, 'remover_conta:' || p_id);
  update core.empresa_contas set deleted_at = now(), principal = false
   where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'conta não encontrada' using errcode = 'no_data_found';
  end if;
  perform core.avisar_admins_dados_bancarios(p_empresa, 'Uma conta bancária da empresa foi removida');
end;
$$;

-- Revelar um campo inteiro: step-up, registro e só então o envelope (que a API decifra).
create function core.revelar_conta(p_empresa uuid, p_id uuid, p_campo text, p_step_up uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_envelope jsonb;
begin
  if p_campo not in ('agencia', 'conta', 'titular_documento', 'pix_chave') then
    raise exception 'campo % não pode ser revelado', p_campo using errcode = 'invalid_parameter_value';
  end if;
  if not core.has_permission(p_empresa, 'empresas', 'editar') then
    raise exception 'sem permissão para revelar dados bancários' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'dados_bancarios', p_empresa, 'revelar:' || p_campo || ':' || p_id);

  select case p_campo when 'agencia' then c.agencia_cifrada when 'conta' then c.conta_cifrada
                      when 'titular_documento' then c.titular_documento_cifrado else c.pix_chave_cifrada end
    into v_envelope
    from core.empresa_contas c
   where c.id = p_id and c.empresa_id = p_empresa and c.deleted_at is null;
  if v_envelope is null then
    raise exception 'valor não encontrado' using errcode = 'no_data_found';
  end if;

  insert into core.revelacoes_dados (empresa_id, usuario_id, tabela, registro_id, campo)
  values (p_empresa, core.usuario_atual(), 'empresa_contas', p_id, p_campo);
  perform core.avisar_admins_dados_bancarios(p_empresa, 'Um dado bancário da empresa foi exibido por inteiro');
  return v_envelope;
end;
$$;

grant execute on function core.salvar_conta(uuid, uuid, jsonb, uuid), core.remover_conta(uuid, uuid, uuid),
  core.revelar_conta(uuid, uuid, text, uuid) to vv_api;

-- migrate:down
drop function core.revelar_conta(uuid, uuid, text, uuid), core.remover_conta(uuid, uuid, uuid),
  core.salvar_conta(uuid, uuid, jsonb, uuid), core.avisar_admins_dados_bancarios(uuid, text);
drop table core.revelacoes_dados, core.empresa_contas;
drop function core.envelope_valido(jsonb);
-- A lista de escopos volta ao que era (tokens do escopo novo, se existirem, são apagados antes).
delete from core.step_up_tokens where escopo = 'dados_bancarios';
alter table core.step_up_tokens drop constraint step_up_tokens_escopo_check;
alter table core.step_up_tokens add constraint step_up_tokens_escopo_check check (escopo in (
  'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca'
));
