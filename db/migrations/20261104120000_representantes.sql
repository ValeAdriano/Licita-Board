-- Fase 02 · PR 4 · Representantes legais, procuradores e advogados (spec fase-02 §3.2; RF-02.4; Prompt 2.2).
--
-- * Vários por empresa. CPF é dado pessoal sensível: a API o cifra (ADR-017) e o banco guarda só o
--   envelope, uma máscara e a marca HMAC (única por empresa, nunca legível por vv_api). Por isso o
--   dígito verificador do CPF é conferido na API e no app, NÃO no banco (o banco só vê o envelope);
--   desvio da spec §4.1 ("core.cpf_valido"), registrado lá.
-- * Advogado exige OAB (número + UF); os demais não têm OAB. Assinatura digitalizada fica para a
--   Fase 03 (assinatura_documento_id sem FK por enquanto).
-- * Poderes e procurações entram no PR 5 (dependem da lista do jurídico, ⚖️).
-- * Escrita direta por vv_api com RLS (representantes/cadastrar, editar, arquivar); os envelopes e a
--   marca só entram, nunca saem (grant por coluna). Revelar o CPF: função com step-up
--   `dados_pessoais`, registro em core.revelacoes_dados e só então o envelope.
-- * FK com ON DELETE CASCADE: a exclusão definitiva da empresa leva os representantes sem mexer em
--   core.executar_exclusao (o teste 080 lista as FKs com cascade).
-- * Dado pessoal sai redigido da auditoria imutável.

-- migrate:up
alter table core.step_up_tokens drop constraint step_up_tokens_escopo_check;
alter table core.step_up_tokens add constraint step_up_tokens_escopo_check check (escopo in (
  'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca',
  'dados_bancarios', 'dados_pessoais'
));

create table core.representantes (
  id                      uuid primary key default core.uuid_v7(),
  empresa_id              uuid not null references core.empresas (id) on delete cascade,
  tipo                    text not null check (tipo in ('SOCIO_ADMINISTRADOR', 'PROCURADOR', 'ADVOGADO')),
  nome                    text not null check (char_length(nome) between 2 and 200),
  cpf_cifrado             jsonb not null check (core.envelope_valido(cpf_cifrado)),
  cpf_mascara             text not null check (char_length(cpf_mascara) between 1 and 12),
  cpf_hash                text not null check (cpf_hash ~ '^[0-9a-f]{64}$'),
  rg                      text check (char_length(rg) <= 30),
  orgao_expedidor         text check (char_length(orgao_expedidor) <= 30),
  nacionalidade           text check (char_length(nacionalidade) <= 50),
  estado_civil            text check (char_length(estado_civil) <= 30),
  profissao               text check (char_length(profissao) <= 80),
  cargo                   text check (char_length(cargo) <= 80),
  email                   text check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  telefone                text check (telefone ~ '^[0-9]{10,13}$'),
  oab_numero              text check (oab_numero ~ '^[0-9]{1,7}$'),
  oab_uf                  text check (oab_uf in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
    'RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  assinatura_documento_id uuid,  -- Fase 03 liga ao arquivo
  ativo                   boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid default core.usuario_atual(),
  deleted_at              timestamptz,
  -- OAB só para advogado, e advogado sempre com OAB.
  check ((tipo = 'ADVOGADO') = (oab_numero is not null and oab_uf is not null)),
  check (tipo = 'ADVOGADO' or (oab_numero is null and oab_uf is null))
);
create unique index representantes_cpf_uk on core.representantes (empresa_id, cpf_hash) where deleted_at is null;
create index representantes_empresa_idx on core.representantes (empresa_id);

alter table core.representantes enable row level security;

create policy representantes_select on core.representantes for select to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'visualizar'));
create policy representantes_insert on core.representantes for insert to vv_api
  with check (core.has_permission(empresa_id, 'representantes', 'cadastrar'));
-- Editar e arquivar são ações diferentes: arquivar (deleted_at) exige 'arquivar'; o resto, 'editar'.
create policy representantes_update on core.representantes for update to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'editar')
      or core.has_permission(empresa_id, 'representantes', 'arquivar'))
  with check (
    core.has_permission(empresa_id, 'representantes', 'editar')
    or core.has_permission(empresa_id, 'representantes', 'arquivar'));

-- Sem envelope nem hash na leitura; escrita por coluna (empresa_id só entra no insert).
grant select (id, empresa_id, tipo, nome, cpf_mascara, rg, orgao_expedidor, nacionalidade, estado_civil, profissao,
              cargo, email, telefone, oab_numero, oab_uf, assinatura_documento_id, ativo, created_at, updated_at,
              deleted_at)
  on core.representantes to vv_api;
grant insert (empresa_id, tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, rg, orgao_expedidor, nacionalidade,
              estado_civil, profissao, cargo, email, telefone, oab_numero, oab_uf)
  on core.representantes to vv_api;
grant update (tipo, nome, cpf_cifrado, cpf_mascara, cpf_hash, rg, orgao_expedidor, nacionalidade, estado_civil,
              profissao, cargo, email, telefone, oab_numero, oab_uf, ativo, deleted_at)
  on core.representantes to vv_api;

-- Arquivar (deleted_at) é só com 'arquivar'; mexer em outros campos, só com 'editar'. A policy deixa as
-- duas passarem; este gatilho separa as ações (security definer: lê permissões sem RLS).
create function core.representantes_separar_acoes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and not core.has_permission(new.empresa_id, 'representantes', 'arquivar') then
    raise exception 'arquivar representante exige a permissão arquivar' using errcode = 'insufficient_privilege';
  end if;
  -- Qualquer outra coluna que mude (além de deleted_at e updated_at) exige 'editar', mesmo junto do arquivar.
  if (to_jsonb(new) - 'deleted_at' - 'updated_at') is distinct from (to_jsonb(old) - 'deleted_at' - 'updated_at')
     and not core.has_permission(new.empresa_id, 'representantes', 'editar') then
    raise exception 'editar representante exige a permissão editar' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger representantes_acoes before update on core.representantes
  for each row execute function core.representantes_separar_acoes();

create trigger representantes_updated_at before update on core.representantes
  for each row execute function core.set_updated_at();
create trigger representantes_audit after insert or update or delete on core.representantes
  for each row execute function audit.registrar('empresa_id',
    'nome,cpf_cifrado,cpf_mascara,cpf_hash,rg,orgao_expedidor,nacionalidade,estado_civil,profissao,cargo,email,telefone,oab_numero');
alter table core.representantes enable always trigger representantes_audit;

-- Revelar o CPF inteiro: step-up, registro e só então o envelope (a API decifra).
create function core.revelar_cpf_representante(p_empresa uuid, p_id uuid, p_step_up uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_envelope jsonb;
begin
  if not core.has_permission(p_empresa, 'representantes', 'editar') then
    raise exception 'sem permissão para revelar o CPF' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'dados_pessoais', p_empresa, 'revelar_cpf:' || p_id);
  select r.cpf_cifrado into v_envelope
    from core.representantes r
   where r.id = p_id and r.empresa_id = p_empresa and r.deleted_at is null;
  if v_envelope is null then
    raise exception 'representante não encontrado' using errcode = 'no_data_found';
  end if;
  insert into core.revelacoes_dados (empresa_id, usuario_id, tabela, registro_id, campo)
  values (p_empresa, core.usuario_atual(), 'representantes', p_id, 'cpf');
  return v_envelope;
end;
$$;
grant execute on function core.revelar_cpf_representante(uuid, uuid, uuid) to vv_api;

-- migrate:down
drop function core.revelar_cpf_representante(uuid, uuid, uuid);
drop table core.representantes;
drop function core.representantes_separar_acoes();
delete from core.step_up_tokens where escopo = 'dados_pessoais';
alter table core.step_up_tokens drop constraint step_up_tokens_escopo_check;
alter table core.step_up_tokens add constraint step_up_tokens_escopo_check check (escopo in (
  'alterar_permissoes', 'exclusao_definitiva', 'preco_abaixo_minimo', 'proposta_final', 'aprovar_peca',
  'dados_bancarios'
));
