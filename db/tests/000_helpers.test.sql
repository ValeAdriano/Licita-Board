-- Helpers de teste (schema `tests`), port de supabase/tests/000_helpers. Roda primeiro e NÃO faz
-- rollback: os demais arquivos usam estas funções. Só existe no banco descartável de teste.
do $$ begin
  if current_database() = 'vv' then
    raise exception 'helpers de teste não entram no banco vv (use um banco descartável)';
  end if;
end $$;
create schema if not exists tap;
create extension if not exists pgtap with schema tap;
grant usage on schema tap to vv_api;
create schema if not exists tests;
revoke all on schema tests from public;
grant usage on schema tests to vv_api;

-- Cria (ou reaproveita) um usuário fictício <ident>@teste.local.
create or replace function tests.criar_usuario(p_ident text, p_superadmin boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into core.usuarios (email, nome, superadmin)
  values (p_ident || '@teste.local', 'Teste ' || p_ident, p_superadmin)
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

create or replace function tests.sessao_id(p_ident text, p_sessao text default 'sessao-teste')
returns uuid
language sql
immutable
as $$
  select md5(p_ident || '|sessao|' || p_sessao)::uuid;
$$;

-- Simula uma requisição da API: contexto do usuário na transação + papel vv_api.
-- Security invoker (SET ROLE não é permitido em security definer): chamar como superusuário.
create or replace function tests.autenticar_como(
  p_ident text,
  p_aal text default 'aal2',
  p_sessao text default 'sessao-teste'
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform core.definir_contexto(tests.usuario_id(p_ident), tests.sessao_id(p_ident, p_sessao), p_aal);
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
  perform set_config('app.usuario_id', '', true),
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
  tests.autenticar_como(text, text, text), tests.sessao_id(text, text), tests.sair() to vv_api;

set search_path = tap;
select plan(1);
select has_function('tests', 'criar_empresas_ab', 'helpers de teste instalados');
select * from finish();
