-- Fase 01 · PR 1 · Empresas, usuários, vínculos, permissões e has_permission().
-- Spec: docs/specs/fase-01.md (RF-01.3 a RF-01.7) · ADR-002, ADR-003
--
-- Decisões de segurança desta migration (revisão revisor-migration, 2026-11-01):
-- * Escrita por coluna (grants por coluna): ninguém via API altera id, cnpj, ativo, deleted_at,
--   created_by, superadmin, usuario_id ou empresa_id. Essas mudanças vão por RPC/service role.
-- * Vínculo novo só por SUPERADMIN até existir o fluxo de convite com aceite (PR do convite).
-- * CLIENTE só pode ter a ação 'visualizar' e é o único papel dispensado de MFA, e só para ler.
-- * permissoes carrega empresa_id com FK composta para o vínculo: consistência garantida pelo banco.

-- ---------------------------------------------------------------------------
-- CNPJ (numérico e alfanumérico, regra da Receita Federal vigente desde jul/2026)
-- ---------------------------------------------------------------------------
create function core.cnpj_valido(p_cnpj text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pesos1 constant int[] := array[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_pesos2 constant int[] := array[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_soma int;
  v_resto int;
  v_dv1 int;
  v_dv2 int;
begin
  if p_cnpj is null or p_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then
    return false;
  end if;
  if p_cnpj ~ '^(.)\1{13}$' then
    return false;  -- sequência repetida (00000000000000, 11111111111111...)
  end if;

  v_soma := 0;
  for i in 1..12 loop
    v_soma := v_soma + (ascii(substr(p_cnpj, i, 1)) - 48) * v_pesos1[i];
  end loop;
  v_resto := v_soma % 11;
  v_dv1 := case when v_resto < 2 then 0 else 11 - v_resto end;

  v_soma := 0;
  for i in 1..13 loop
    v_soma := v_soma + (ascii(substr(p_cnpj, i, 1)) - 48) * v_pesos2[i];
  end loop;
  v_resto := v_soma % 11;
  v_dv2 := case when v_resto < 2 then 0 else 11 - v_resto end;

  return substr(p_cnpj, 13, 1)::int = v_dv1 and substr(p_cnpj, 14, 1)::int = v_dv2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table core.empresas (
  id            uuid primary key default core.uuid_v7(),
  razao_social  text not null check (char_length(razao_social) between 2 and 200),
  nome_fantasia text check (char_length(nome_fantasia) <= 200),
  cnpj          text not null unique check (core.cnpj_valido(cnpj)),
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  deleted_at    timestamptz
);

-- Usuários nunca são apagados (auditoria e LGPD): exclusão = desativar + anonimizar (RPC futura).
-- Por isso vinculos.usuario_id é RESTRICT e o delete em auth.users falha se houver vínculo.
create table core.usuarios (
  id          uuid primary key references auth.users (id) on delete cascade,
  nome        text check (char_length(nome) <= 200),
  email       text,
  telefone    text check (char_length(telefone) <= 30),
  oab         text check (char_length(oab) <= 30),
  superadmin  boolean not null default false,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table core.vinculos (
  id          uuid primary key default core.uuid_v7(),
  usuario_id  uuid not null references core.usuarios (id) on delete restrict,
  empresa_id  uuid not null references core.empresas (id),
  papel       text not null check (papel in ('ADMIN_EMPRESA', 'OPERADOR', 'JURIDICO', 'CLIENTE')),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  deleted_at  timestamptz,
  unique (id, empresa_id)  -- alvo da FK composta de core.permissoes
);

create unique index vinculos_usuario_empresa_uk
  on core.vinculos (usuario_id, empresa_id) where deleted_at is null;
create index vinculos_empresa_idx on core.vinculos (empresa_id);

create table core.modulos (
  slug   text primary key check (slug ~ '^[a-z_]+$'),
  nome   text not null,
  ordem  int not null default 0
);

insert into core.modulos (slug, nome, ordem) values
  ('empresas', 'Empresas', 10),
  ('usuarios', 'Usuários', 20),
  ('permissoes', 'Permissões', 30),
  ('auditoria', 'Auditoria', 40),
  ('representantes', 'Representantes', 50),
  ('produtos', 'Produtos', 60),
  ('documentos', 'Documentos', 70),
  ('agenda', 'Agenda', 80),
  ('editais', 'Editais e oportunidades', 90),
  ('analises', 'Análise técnica', 100),
  ('precos', 'Preços', 110),
  ('propostas', 'Propostas', 120),
  ('juridico', 'Jurídico', 130),
  ('contratos', 'Contratos', 140),
  ('financeiro', 'Financeiro', 150),
  ('relatorios', 'Relatórios', 160),
  ('configuracoes', 'Configurações', 170);

create table core.permissoes (
  id          uuid primary key default core.uuid_v7(),
  vinculo_id  uuid not null,
  empresa_id  uuid not null,
  modulo      text not null references core.modulos (slug),
  acao        text not null check (acao in (
    'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
    'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar',
    'administrar_permissoes'
  )),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  unique (vinculo_id, modulo, acao),
  foreign key (vinculo_id, empresa_id) references core.vinculos (id, empresa_id) on delete cascade
);

create index permissoes_empresa_idx on core.permissoes (empresa_id);

alter table core.empresas enable row level security;
alter table core.usuarios enable row level security;
alter table core.vinculos enable row level security;
alter table core.modulos enable row level security;
alter table core.permissoes enable row level security;

-- ---------------------------------------------------------------------------
-- Funções de autorização (security definer: leem as tabelas sem RLS, sem recursão)
-- ---------------------------------------------------------------------------
create function core.mfa_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create function core.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select core.mfa_ok() and exists (
    select 1
      from core.usuarios u
     where u.id = auth.uid()
       and u.superadmin
       and u.ativo
       and u.deleted_at is null
  );
$$;

create function core.has_permission(p_empresa uuid, p_modulo text, p_acao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from core.vinculos v
      join core.usuarios u on u.id = v.usuario_id
      join core.empresas e on e.id = v.empresa_id
      join core.permissoes p on p.vinculo_id = v.id
     where v.usuario_id = auth.uid()
       and v.empresa_id = p_empresa
       and v.ativo and v.deleted_at is null
       and u.ativo and u.deleted_at is null
       and e.ativo and e.deleted_at is null
       and p.modulo = p_modulo
       and p.acao = p_acao
       and (core.mfa_ok() or (v.papel = 'CLIENTE' and p_acao = 'visualizar'))
  ) or core.is_superadmin();
$$;

-- Usuário enxerga outro usuário se tem usuarios/visualizar numa empresa em que o outro tem vínculo.
create function core.pode_ver_usuario(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from core.vinculos v
     where v.usuario_id = p_usuario
       and v.deleted_at is null
       and core.has_permission(v.empresa_id, 'usuarios', 'visualizar')
  );
$$;

revoke all on function core.is_superadmin(), core.has_permission(uuid, text, text),
  core.pode_ver_usuario(uuid), core.mfa_ok() from public, anon;
grant execute on function core.is_superadmin(), core.has_permission(uuid, text, text),
  core.pode_ver_usuario(uuid), core.mfa_ok(), core.cnpj_valido(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Regras de integridade em trigger
-- ---------------------------------------------------------------------------

-- CLIENTE é somente leitura (Prompt 1.2): só aceita a ação 'visualizar'.
create function core.validar_permissao_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.acao <> 'visualizar'
     and exists (select 1 from core.vinculos v where v.id = new.vinculo_id and v.papel = 'CLIENTE') then
    raise exception 'papel CLIENTE só pode ter a ação visualizar (recebido: %)', new.acao
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Impede virar CLIENTE mantendo permissões de escrita (o que contornaria o MFA).
create function core.validar_mudanca_papel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.papel = 'CLIENTE' and old.papel <> 'CLIENTE'
     and exists (select 1 from core.permissoes p where p.vinculo_id = new.id and p.acao <> 'visualizar') then
    raise exception 'remova as permissões além de visualizar antes de mudar o papel para CLIENTE'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function core.validar_permissao_cliente(), core.validar_mudanca_papel()
  from public, anon, authenticated;

create trigger permissoes_cliente before insert on core.permissoes
  for each row execute function core.validar_permissao_cliente();
create trigger vinculos_mudanca_papel before update of papel on core.vinculos
  for each row execute function core.validar_mudanca_papel();

-- ---------------------------------------------------------------------------
-- Policies ((select ...) faz o planner avaliar a função uma vez por consulta)
-- ---------------------------------------------------------------------------

-- core.empresas
create policy empresas_select on core.empresas for select to authenticated
  using (core.has_permission(id, 'empresas', 'visualizar'));
create policy empresas_insert on core.empresas for insert to authenticated
  with check ((select core.is_superadmin()));
create policy empresas_update on core.empresas for update to authenticated
  using (core.has_permission(id, 'empresas', 'editar'))
  with check (core.has_permission(id, 'empresas', 'editar'));

-- core.usuarios (insert pelo trigger de auth.users)
create policy usuarios_select on core.usuarios for select to authenticated
  using (id = (select auth.uid()) or (select core.is_superadmin()) or core.pode_ver_usuario(id));
create policy usuarios_update on core.usuarios for update to authenticated
  using (id = (select auth.uid()) or (select core.is_superadmin()))
  with check (id = (select auth.uid()) or (select core.is_superadmin()));

-- core.vinculos
create policy vinculos_select on core.vinculos for select to authenticated
  using (usuario_id = (select auth.uid()) or core.has_permission(empresa_id, 'usuarios', 'visualizar'));
create policy vinculos_insert on core.vinculos for insert to authenticated
  with check ((select core.is_superadmin()));
create policy vinculos_update on core.vinculos for update to authenticated
  using (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'))
  with check (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));

-- core.modulos: catálogo legível por qualquer autenticado
create policy modulos_select on core.modulos for select to authenticated
  using ((select auth.uid()) is not null);

-- core.permissoes
create policy permissoes_select on core.permissoes for select to authenticated
  using (
    exists (select 1 from core.vinculos v where v.id = vinculo_id and v.usuario_id = (select auth.uid()))
    or core.has_permission(empresa_id, 'permissoes', 'visualizar')
  );
create policy permissoes_insert on core.permissoes for insert to authenticated
  with check (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));
create policy permissoes_delete on core.permissoes for delete to authenticated
  using (core.has_permission(empresa_id, 'permissoes', 'administrar_permissoes'));

-- audit.audit_log (has_permission já inclui SUPERADMIN; registros sem empresa: só SUPERADMIN)
create policy audit_log_select on audit.audit_log for select to authenticated
  using (core.has_permission(empresa_id, 'auditoria', 'visualizar') or (select core.is_superadmin()));

-- ---------------------------------------------------------------------------
-- Grants (auto_expose_new_tables = false: tudo explícito, escrita por coluna)
-- ---------------------------------------------------------------------------
revoke all on core.empresas, core.usuarios, core.vinculos, core.modulos, core.permissoes
  from public, anon, authenticated;

grant select on core.empresas, core.usuarios, core.vinculos, core.modulos, core.permissoes
  to authenticated;
grant insert (razao_social, nome_fantasia, cnpj) on core.empresas to authenticated;
grant update (razao_social, nome_fantasia) on core.empresas to authenticated;
grant update (nome, telefone, oab) on core.usuarios to authenticated;
grant insert (usuario_id, empresa_id, papel) on core.vinculos to authenticated;
grant update (papel, ativo) on core.vinculos to authenticated;
grant insert (vinculo_id, empresa_id, modulo, acao) on core.permissoes to authenticated;
grant delete on core.permissoes to authenticated;

grant all on core.empresas, core.usuarios, core.vinculos, core.modulos, core.permissoes to service_role;

-- ---------------------------------------------------------------------------
-- Triggers de updated_at e auditoria (ALWAYS: valem também em modo replica)
-- ---------------------------------------------------------------------------
create trigger empresas_updated_at before update on core.empresas
  for each row execute function core.set_updated_at();
create trigger usuarios_updated_at before update on core.usuarios
  for each row execute function core.set_updated_at();
create trigger vinculos_updated_at before update on core.vinculos
  for each row execute function core.set_updated_at();

create trigger empresas_audit after insert or update or delete on core.empresas
  for each row execute function audit.registrar('id');
create trigger usuarios_audit after insert or update or delete on core.usuarios
  for each row execute function audit.registrar('-', 'nome,email,telefone,oab');
create trigger vinculos_audit after insert or update or delete on core.vinculos
  for each row execute function audit.registrar();
create trigger permissoes_audit after insert or update or delete on core.permissoes
  for each row execute function audit.registrar();

alter table core.empresas enable always trigger empresas_audit;
alter table core.usuarios enable always trigger usuarios_audit;
alter table core.vinculos enable always trigger vinculos_audit;
alter table core.permissoes enable always trigger permissoes_audit;

-- ---------------------------------------------------------------------------
-- Sincronia com auth.users
-- ---------------------------------------------------------------------------
create function core.sincronizar_usuario_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into core.usuarios (id, email, nome)
    values (new.id, new.email, left(new.raw_user_meta_data ->> 'nome', 200));
  elsif new.email is distinct from old.email then
    update core.usuarios set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function core.sincronizar_usuario_auth() from public, anon, authenticated;

create trigger auth_users_sincronizar after insert or update of email on auth.users
  for each row execute function core.sincronizar_usuario_auth();

-- down:
-- drop trigger auth_users_sincronizar on auth.users;
-- drop function core.sincronizar_usuario_auth();
-- drop policy audit_log_select on audit.audit_log;
-- drop table core.permissoes, core.modulos, core.vinculos, core.usuarios, core.empresas;
-- drop function core.validar_permissao_cliente(), core.validar_mudanca_papel(),
--   core.pode_ver_usuario(uuid), core.has_permission(uuid, text, text), core.is_superadmin(),
--   core.mfa_ok(), core.cnpj_valido(text);
