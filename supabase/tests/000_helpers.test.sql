-- Helpers de teste (schema `tests`). Roda primeiro e NÃO faz rollback: os demais arquivos usam estas funções.
-- Só existe no banco local/CI (`supabase test db`); nunca em produção.
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;
revoke all on schema tests from public;
grant usage on schema tests to authenticated;

-- Cria (ou reaproveita) um usuário no Auth; o trigger cria o perfil em core.usuarios.
create or replace function tests.criar_usuario(p_ident text, p_superadmin boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where email = p_ident || '@teste.local';
  if v_id is null then
    insert into auth.users (id, email, raw_user_meta_data)  -- id explícito: no GoTrue não há default
    values (gen_random_uuid(), p_ident || '@teste.local', jsonb_build_object('nome', 'Teste ' || p_ident))
    returning id into v_id;
  end if;
  update core.usuarios set superadmin = p_superadmin where id = v_id;
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
  select id from auth.users where email = p_ident || '@teste.local';
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

-- Simula a requisição de um usuário logado (equivalente ao JWT do PostgREST). Security invoker:
-- SET ROLE não é permitido dentro de função security definer.
create or replace function tests.autenticar_como(p_ident text, p_aal text default 'aal2')
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', tests.usuario_id(p_ident), 'role', 'authenticated', 'aal', p_aal
  )::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.sair()
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Só os helpers de leitura/sessão ficam acessíveis ao papel authenticated; os que criam dados
-- (e podem criar SUPERADMIN) só rodam como postgres.
revoke all on all functions in schema tests from public, anon, authenticated;
grant execute on function tests.usuario_id(text), tests.empresa_id(text), tests.vinculo_id(text, text),
  tests.autenticar_como(text, text), tests.sair() to authenticated;

select plan(1);
select has_function('tests', 'criar_empresas_ab', 'helpers de teste instalados');
select * from finish();
