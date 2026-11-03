-- Helpers de teste (schema `tests`), port de supabase/tests/000_helpers. Roda primeiro e NÃO faz
-- rollback: os demais arquivos usam estas funções. Só existe no banco descartável de teste.
do $$ begin
  if current_database() = 'vv' then
    raise exception 'helpers de teste não entram no banco vv (use um banco descartável)';
  end if;
end $$;
create schema if not exists tap;
create extension if not exists pgtap with schema tap;
grant usage on schema tap to vv_api, vv_worker;
create schema if not exists tests;
revoke all on schema tests from public;
grant usage on schema tests to vv_api;

-- Cria (ou reaproveita) um usuário fictício <ident>@teste.local, com e-mail já verificado.
create or replace function tests.criar_usuario(p_ident text, p_superadmin boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into core.usuarios (email, nome, superadmin, email_verificado_em)
  values (p_ident || '@teste.local', 'Teste ' || p_ident, p_superadmin, now())
  on conflict (email) do update set superadmin = excluded.superadmin
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function tests.usuario_id(p_ident text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.usuarios where email = p_ident || '@teste.local';
$$;

create or replace function tests.empresa_id(p_letra text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.empresas where razao_social = 'Empresa Teste ' || p_letra;
$$;

create or replace function tests.vinculo_id(p_ident text, p_letra text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.vinculos
   where usuario_id = tests.usuario_id(p_ident) and empresa_id = tests.empresa_id(p_letra);
$$;

-- Vincula usuário à empresa com as permissões dadas (padrão: todas as ações em todos os módulos).
create or replace function tests.vincular(
  p_ident text,
  p_letra text,
  p_papel text default 'ADMIN_EMPRESA',
  p_permissoes text[] default null  -- formato 'modulo:acao'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vinculo uuid;
begin
  insert into core.vinculos (usuario_id, empresa_id, papel)
  values (tests.usuario_id(p_ident), tests.empresa_id(p_letra), p_papel)
  returning id into v_vinculo;

  if p_permissoes is null then
    insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
    select v_vinculo, tests.empresa_id(p_letra), m.slug, a.acao
      from core.modulos m
     cross join unnest(array[
       'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
       'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar',
       'administrar_permissoes'
     ]) as a(acao);
  else
    insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
    select v_vinculo, tests.empresa_id(p_letra), split_part(x, ':', 1), split_part(x, ':', 2)
      from unnest(p_permissoes) x;
  end if;
  return v_vinculo;
end;
$$;

-- Empresa A + usuario_a (ADMIN_EMPRESA, tudo) e Empresa B + usuario_b. CNPJs fictícios com DV válido.
create or replace function tests.criar_empresas_ab()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into core.empresas (razao_social, cnpj) values
    ('Empresa Teste A', '11222333000181'),
    ('Empresa Teste B', '12ABC34501DE35');
  perform tests.criar_usuario('usuario_a');
  perform tests.criar_usuario('usuario_b');
  perform tests.vincular('usuario_a', 'A');
  perform tests.vincular('usuario_b', 'B');
end;
$$;

-- Token fictício e determinístico da sessão de teste de um usuário.
create or replace function tests.token(p_ident text, p_sessao text default 'sessao-teste')
returns text
language sql
immutable
as $$
  select 'token-teste|' || p_ident || '|' || p_sessao;
$$;

create or replace function tests.sessao_id(p_ident text, p_sessao text default 'sessao-teste')
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.sessoes where token_hash = core.hash_token(tests.token(p_ident, p_sessao));
$$;

-- Garante uma sessão viva com o aal pedido (MFA há p_mfa_ha_seg segundos) e devolve o token.
create or replace function tests.garantir_sessao(
  p_ident text, p_aal text default 'aal2', p_sessao text default 'sessao-teste', p_mfa_ha_seg int default 3600
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := tests.token(p_ident, p_sessao);
begin
  insert into core.sessoes (usuario_id, token_hash, aal, mfa_em, plataforma)
  values (tests.usuario_id(p_ident), core.hash_token(v_token), p_aal,
          case when p_aal = 'aal2' then now() - make_interval(secs => p_mfa_ha_seg) end, 'web')
  on conflict (token_hash) do update
    set aal = excluded.aal, mfa_em = excluded.mfa_em, revogada_em = null,
        ultimo_uso_em = now(), expira_em = now() + interval '12 hours';
  return v_token;
end;
$$;

-- Simula uma requisição da API: sessão viva + contexto pelo token + papel vv_api.
--   p_mfa_ha_seg:  há quantos segundos foi a última verificação TOTP desta sessão (aal2). Cada valor
--                  diferente simula uma nova verificação MFA (o step-up gera um token por verificação).
--   p_fator_idade: idade do fator TOTP verificado do usuário (step-up exige ≥ 24 h).
-- Security invoker (SET ROLE não é permitido em security definer): chamar como superusuário.
drop function if exists tests.autenticar_como(text, text, text);
create or replace function tests.autenticar_como(
  p_ident text,
  p_aal text default 'aal2',
  p_mfa_ha_seg int default 3600,
  p_sessao text default 'sessao-teste',
  p_fator_idade interval default interval '30 days'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_usuario uuid := tests.usuario_id(p_ident);
begin
  if p_aal = 'aal2' then
    update core.fatores_mfa set verificado_em = now() - p_fator_idade
     where usuario_id = v_usuario and verificado_em is not null;
    if not found then
      insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek, verificado_em)
      values (v_usuario, extensions.pgp_sym_encrypt_bytea(convert_to('segredo-de-teste-' || p_ident, 'UTF8'), tests.kek()),
              1, now() - p_fator_idade);
    end if;
  end if;
  perform tests.garantir_sessao(p_ident, p_aal, p_sessao, p_mfa_ha_seg);
  update core.sessoes set mfa_metodo = case when p_aal = 'aal2' then 'totp' end
   where token_hash = core.hash_token(tests.token(p_ident, p_sessao));
  perform core.definir_contexto(tests.token(p_ident, p_sessao));
  perform set_config('role', 'vv_api', true);
end;
$$;

create or replace function tests.sair()
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  perform set_config('app.sessao_hash', '', true),
          set_config('app.usuario_id', '', true),
          set_config('app.sessao_id', '', true),
          set_config('app.aal', '', true),
          set_config('app.tx', '', true),
          set_config('app.req_tx', '', true),
          set_config('app.ip', '', true),
          set_config('app.user_agent', '', true);
end;
$$;

-- Só os helpers de leitura/sessão ficam acessíveis a vv_api; os que criam dados (e podem criar
-- SUPERADMIN) só rodam como superusuário.
revoke all on all functions in schema tests from public;
grant execute on function tests.usuario_id(text), tests.empresa_id(text), tests.vinculo_id(text, text),
  tests.autenticar_como(text, text, int, text, interval), tests.sessao_id(text, text), tests.token(text, text),
  tests.sair() to vv_api;

-- KEK fictícia do banco de teste (em produção: db/scripts/registrar-kek.sh, como vv_owner).
create or replace function tests.kek()
returns text
language sql
immutable
as $$
  select 'kek-de-teste-nao-usar-em-producao-0123456789'
$$;
grant execute on function tests.kek() to vv_api;
insert into core.chaves_mestras (versao, verificador)
values (1, extensions.pgp_sym_encrypt('vv-kek-ok', tests.kek(), 'cipher-algo=aes256'))
on conflict (versao) do nothing;

set search_path = tap;
select plan(1);
select has_function('tests', 'criar_empresas_ab', 'helpers de teste instalados');
select * from finish();
