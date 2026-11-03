-- Fase 01 · PR 5 · Convite de usuário com aceite + salvar_vinculo da matriz (port de
-- supabase/migrations/20261101160000).
--
-- Regras mantidas da revisão 1 (T2.2, T2.3, T2.4, T3.1): convite preso à CONTA, não ao e-mail; aceitar
-- exige empresa ativa e autor que ainda administre a empresa; teto de concessão (core.validar_teto_
-- concessao, 20261103050000); resposta igual exista ou não a conta; aviso in-app com título fixo; e-mail
-- redigido na auditoria; limite de 30 convites/dia por empresa.
-- Mudanças: sem auth.users, a posse do e-mail é provada pelo link de redefinição de senha
-- (core.usuarios.email_verificado_em, gravado por core.redefinir_senha). Convite só se liga, aparece e
-- é aceito por conta com e-mail verificado; a ligação de convites pendentes sem conta acontece NA
-- VERIFICAÇÃO (não na criação da conta: quem cria a conta não ganha o convite de outra empresa).
-- auth.uid() → core.usuario_atual(); authenticated → vv_api.

-- migrate:up
alter table core.usuarios add column email_verificado_em timestamptz;

create table core.convites (
  id           uuid primary key default core.uuid_v7(),
  empresa_id   uuid not null references core.empresas (id) on delete cascade,
  email        text not null check (email = lower(trim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  usuario_id   uuid references core.usuarios (id),
  papel        text not null check (papel in ('ADMIN_EMPRESA', 'OPERADOR', 'JURIDICO', 'CLIENTE')),
  permissoes   text[] not null default '{}',
  criado_por   uuid not null references core.usuarios (id),
  created_at   timestamptz not null default now(),
  expira_em    timestamptz not null default now() + interval '7 days',
  aceito_em    timestamptz,
  aceito_por   uuid references core.usuarios (id),
  revogado_em  timestamptz,
  revogado_por uuid references core.usuarios (id)
);

create unique index convites_pendente_uk on core.convites (empresa_id, email)
  where aceito_em is null and revogado_em is null;
create index convites_usuario_idx on core.convites (usuario_id) where aceito_em is null and revogado_em is null;
create index convites_email_idx on core.convites (email) where usuario_id is null and aceito_em is null and revogado_em is null;
create index convites_empresa_criacao_idx on core.convites (empresa_id, created_at);

alter table core.convites enable row level security;

-- E-mails e permissões de convidados: só para quem vê permissões da empresa.
create policy convites_select on core.convites for select to vv_api
  using (core.has_permission(empresa_id, 'permissoes', 'visualizar'));

grant select on core.convites to vv_api, vv_worker;

create trigger convites_audit after insert or update on core.convites
  for each row execute function audit.registrar('empresa_id', 'email');
alter table core.convites enable always trigger convites_audit;

-- ---------------------------------------------------------------------------
-- Validações
-- ---------------------------------------------------------------------------
-- O usuário ainda administra permissões na empresa (para validar convite órfão).
create function core.administra_empresa(p_usuario uuid, p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from core.usuarios u where u.id = p_usuario and u.superadmin and u.ativo and u.deleted_at is null
  ) or exists (
    select 1
      from core.vinculos v
      join core.usuarios u on u.id = v.usuario_id
      join core.permissoes p on p.vinculo_id = v.id
     where v.usuario_id = p_usuario and v.empresa_id = p_empresa
       and v.ativo and v.deleted_at is null and u.ativo and u.deleted_at is null
       and p.modulo = 'permissoes' and p.acao = 'administrar_permissoes'
  );
$$;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
-- O autor ainda tem, na empresa, cada permissão oferecida no convite (teto vale também no aceite:
-- convite pendente não preserva permissão que o autor perdeu, T2.4b). SUPERADMIN fica fora do teto.
create function core.autor_cobre_convite(p_autor uuid, p_empresa uuid, p_permissoes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from core.usuarios u where u.id = p_autor and u.superadmin and u.ativo and u.deleted_at is null)
      or not exists (
        select 1 from unnest(p_permissoes) x
         where not exists (
           select 1 from core.vinculos v
             join core.usuarios u on u.id = v.usuario_id
             join core.permissoes p on p.vinculo_id = v.id
            where v.usuario_id = p_autor and v.empresa_id = p_empresa
              and v.ativo and v.deleted_at is null and u.ativo and u.deleted_at is null
              and p.modulo = split_part(x, ':', 1) and p.acao = split_part(x, ':', 2)))
$$;

-- Vínculos do próprio usuário com o nome da empresa (sem depender de empresas:visualizar).
create function core.meus_vinculos()
returns table (id uuid, empresa_id uuid, empresa text, papel text, ativo boolean, permissoes text[])
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.empresa_id, coalesce(e.nome_fantasia, e.razao_social), v.papel, v.ativo,
         coalesce(array_agg(p.modulo || ':' || p.acao order by p.modulo, p.acao) filter (where p.id is not null), '{}')
    from core.vinculos v
    join core.empresas e on e.id = v.empresa_id and e.deleted_at is null
    left join core.permissoes p on p.vinculo_id = v.id
   where v.usuario_id = core.usuario_atual() and v.deleted_at is null
   group by v.id, e.id
   order by 3
$$;

create function core.convidar_usuario(
  p_empresa uuid, p_email text, p_papel text, p_permissoes text[], p_step_up uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
  v_usuario uuid;
begin
  if not core.has_permission(p_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para convidar nesta empresa' using errcode = 'insufficient_privilege';
  end if;
  perform core.validar_permissoes(p_papel, p_permissoes);
  perform core.validar_teto_concessao(p_empresa, null, p_permissoes);

  -- Conta existente e ativa: o convite fica preso a ela (contas só nascem por convite/administrador).
  select u.id into v_usuario
    from core.usuarios u
   where u.email operator(extensions.=) v_email::extensions.citext and u.ativo and u.deleted_at is null
     and u.email_verificado_em is not null;
  if v_usuario is not null and exists (
    select 1 from core.vinculos v where v.usuario_id = v_usuario and v.empresa_id = p_empresa and v.deleted_at is null
  ) then
    raise exception 'este e-mail já tem vínculo com a empresa; altere o vínculo existente'
      using errcode = 'unique_violation';
  end if;
  if (select count(*) from core.convites c where c.empresa_id = p_empresa and c.created_at > now() - interval '24 hours') >= 30 then
    raise exception 'limite de convites por dia atingido para esta empresa' using errcode = 'program_limit_exceeded';
  end if;

  -- Convite expirado não bloqueia um novo.
  update core.convites set revogado_em = now()
   where empresa_id = p_empresa and email = v_email
     and aceito_em is null and revogado_em is null and expira_em <= now();

  insert into core.convites (empresa_id, email, usuario_id, papel, permissoes, criado_por)
  values (p_empresa, v_email, v_usuario, p_papel,
          (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_permissoes) x), core.usuario_atual())
  returning id into v_id;

  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', p_empresa, 'convidar:' || v_id);

  if v_usuario is not null then
    insert into core.notificacoes (usuario_id, tipo, titulo, link)
    values (v_usuario, 'convite', 'Você recebeu um convite para acessar uma empresa', '/convites');
  end if;
  return v_id;
end;
$$;

create function core.revogar_convite(p_convite uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select c.empresa_id into v_empresa from core.convites c
   where c.id = p_convite and c.aceito_em is null and c.revogado_em is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'convite inexistente, já decidido ou sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update core.convites set revogado_em = now(), revogado_por = core.usuario_atual() where id = p_convite;
end;
$$;

-- Convites pendentes da CONTA logada (nunca pelo e-mail atual).
create function core.meus_convites()
returns table (id uuid, empresa text, papel text, permissoes text[], convidado_em timestamptz, expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(e.nome_fantasia, e.razao_social), c.papel, c.permissoes, c.created_at, c.expira_em
    from core.convites c
    join core.empresas e on e.id = c.empresa_id
    join core.usuarios u on u.id = c.usuario_id
   where c.usuario_id = core.usuario_atual()
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
     and u.ativo and u.deleted_at is null and u.email_verificado_em is not null
     and e.ativo and e.deleted_at is null
     and core.administra_empresa(c.criado_por, c.empresa_id)
     and core.autor_cobre_convite(c.criado_por, c.empresa_id, c.permissoes)
   order by c.created_at desc;
$$;

create function core.aceitar_convite(p_convite uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_c core.convites;
  v_vinculo uuid;
begin
  select c.* into v_c
    from core.convites c
    join core.usuarios u on u.id = c.usuario_id and u.ativo and u.deleted_at is null
                         and u.email_verificado_em is not null
    join core.empresas e on e.id = c.empresa_id and e.ativo and e.deleted_at is null
   where c.id = p_convite and c.usuario_id = core.usuario_atual()
   for update of c;
  if v_c.id is null or v_c.aceito_em is not null or v_c.revogado_em is not null or v_c.expira_em <= now()
     or not core.administra_empresa(v_c.criado_por, v_c.empresa_id)
     or not core.autor_cobre_convite(v_c.criado_por, v_c.empresa_id, v_c.permissoes) then
    raise exception 'convite inexistente, expirado ou não é mais válido' using errcode = 'insufficient_privilege';
  end if;

  insert into core.vinculos (usuario_id, empresa_id, papel, created_by)
  values (core.usuario_atual(), v_c.empresa_id, v_c.papel, v_c.criado_por)
  returning id into v_vinculo;

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select v_vinculo, v_c.empresa_id, split_part(x, ':', 1), split_part(x, ':', 2), v_c.criado_por
    from unnest(v_c.permissoes) x;

  update core.convites set aceito_em = now(), aceito_por = core.usuario_atual() where id = p_convite;
  return v_vinculo;
end;
$$;

-- Convites pendentes ainda sem conta, para o e-mail do usuário, passam a ser dele. Interna: só chamada
-- quando o e-mail acaba de ser provado (redefinir_senha). Troca de e-mail não liga nada.
create function core.ligar_convites_verificados(p_usuario uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update core.convites c set usuario_id = p_usuario
    from core.usuarios u
   where u.id = p_usuario and u.email_verificado_em is not null
     and c.usuario_id is null and c.email = lower(u.email::text)
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
$$;

-- Redefinir a senha pelo link do e-mail prova a posse da caixa: marca o e-mail como verificado e liga
-- os convites pendentes desse e-mail.
create or replace function core.redefinir_senha(p_token text, p_senha_hash text, p_kek text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  perform core.conferir_kek(p_kek);
  update core.tokens_recuperacao set usado_em = now()
   where token_hash = core.hash_token(p_token) and usado_em is null and expira_em > now()
  returning usuario_id into v_usuario;
  if v_usuario is null then
    return false;
  end if;
  update core.usuarios
     set senha_hash = p_senha_hash, senha_trocada_em = now(), bloqueado_ate = null,
         email_verificado_em = coalesce(email_verificado_em, now())
   where id = v_usuario;
  update core.sessoes set revogada_em = now() where usuario_id = v_usuario and revogada_em is null;
  perform core.ligar_convites_verificados(v_usuario);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Matriz: salvar papel, situação e permissões com UM step-up
-- ---------------------------------------------------------------------------
-- Ordem: remove permissões → troca papel/situação → insere permissões. Assim funciona tanto virar
-- CLIENTE (triggers veem só o que restou) quanto sair de CLIENTE para papel com escrita.
create function core.salvar_vinculo(
  p_vinculo uuid, p_papel text, p_ativo boolean, p_permissoes text[], p_step_up uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_papel is null or p_ativo is null then
    raise exception 'papel e situação são obrigatórios' using errcode = 'invalid_parameter_value';
  end if;
  perform core.validar_permissoes(p_papel, p_permissoes);
  perform core.validar_teto_concessao(v_empresa, p_vinculo, p_permissoes);
  -- Reativar um vínculo devolve todas as permissões dele: vale o teto sobre o conjunto inteiro (T2.4).
  if p_ativo and exists (select 1 from core.vinculos v where v.id = p_vinculo and not v.ativo) then
    perform core.validar_teto_concessao(v_empresa, null, p_permissoes);
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'salvar_vinculo:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  update core.vinculos set papel = p_papel, ativo = p_ativo
   where id = p_vinculo and (papel, ativo) is distinct from (p_papel, p_ativo);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), core.usuario_atual()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);

  -- Convites de quem deixou de administrar a empresa, ou que agora excedem o que o autor tem, caem junto.
  update core.convites c set revogado_em = now(), revogado_por = core.usuario_atual()
   where c.empresa_id = v_empresa and c.aceito_em is null and c.revogado_em is null
     and (not core.administra_empresa(c.criado_por, v_empresa)
          or not core.autor_cobre_convite(c.criado_por, v_empresa, c.permissoes));
end;
$$;

grant execute on function core.convidar_usuario(uuid, text, text, text[], uuid), core.revogar_convite(uuid),
  core.meus_convites(), core.aceitar_convite(uuid), core.salvar_vinculo(uuid, text, boolean, text[], uuid),
  core.meus_vinculos() to vv_api;

-- migrate:down
-- Volta redefinir_senha de 20261103030000.
create or replace function core.redefinir_senha(p_token text, p_senha_hash text, p_kek text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  perform core.conferir_kek(p_kek);
  update core.tokens_recuperacao set usado_em = now()
   where token_hash = core.hash_token(p_token) and usado_em is null and expira_em > now()
  returning usuario_id into v_usuario;
  if v_usuario is null then
    return false;
  end if;
  update core.usuarios set senha_hash = p_senha_hash, senha_trocada_em = now(), bloqueado_ate = null
   where id = v_usuario;
  update core.sessoes set revogada_em = now() where usuario_id = v_usuario and revogada_em is null;
  return true;
end;
$$;
drop function core.salvar_vinculo(uuid, text, boolean, text[], uuid), core.aceitar_convite(uuid),
  core.meus_convites(), core.revogar_convite(uuid), core.convidar_usuario(uuid, text, text, text[], uuid),
  core.ligar_convites_verificados(uuid), core.meus_vinculos(), core.autor_cobre_convite(uuid, uuid, text[]),
  core.administra_empresa(uuid, uuid);
drop table core.convites;
alter table core.usuarios drop column email_verificado_em;
