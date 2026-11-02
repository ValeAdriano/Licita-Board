-- Fase 01 · PR 5 · Convite de usuário com aceite (spec fase-01, pergunta 0) + salvar_vinculo da matriz.
--
-- Fluxo: quem administra permissões (+ step-up) convida um e-mail com papel e permissões → o dono da
-- conta aceita → vínculo e permissões são criados.
-- Regras de segurança (revisões de 2026-11-02):
-- * Convite é preso à CONTA (usuario_id), não ao e-mail atual: trocar o e-mail no Auth não dá acesso a
--   convite de outra pessoa (T2.2). A conta é ligada ao convite quando o convite é criado (conta já
--   existe e e-mail confirmado) ou quando a conta é CRIADA com aquele e-mail (cadastro aberto está
--   desligado: só SUPERADMIN/Admin API criam contas). Troca de e-mail nunca liga convite.
-- * Aceitar exige e-mail confirmado, empresa ativa e que o autor do convite ainda administre
--   permissões na empresa (convite órfão não vale, T2.3).
-- * Teto de concessão (T2.4): só se concede o que o autor tem; ninguém amplia o próprio vínculo
--   (só reduz). SUPERADMIN fica fora do teto.
-- * Não revela se o e-mail tem conta. Aviso in-app com título FIXO (sem texto da empresa, T3.1).
-- * E-mail do convidado é redigido na auditoria; o step-up registra o id do convite, não o e-mail.
-- * Conta nova: o envio do convite por e-mail (Admin API) fica no worker/Edge Function, em PR próprio.

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
create policy convites_select on core.convites for select to authenticated
  using (core.has_permission(empresa_id, 'permissoes', 'visualizar'));

revoke all on core.convites from public, anon, authenticated, service_role;
grant select on core.convites to authenticated, service_role;

create trigger convites_audit after insert or update on core.convites
  for each row execute function audit.registrar('empresa_id', 'email');
alter table core.convites enable always trigger convites_audit;

-- ---------------------------------------------------------------------------
-- Validações
-- ---------------------------------------------------------------------------
-- Lista 'modulo:acao' válida para o papel (CLIENTE só visualiza). Erro 22023/23514 se inválida.
create function core.validar_permissoes(p_papel text, p_permissoes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item text;
  v_acoes constant text[] := array[
    'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
    'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar', 'administrar_permissoes'
  ];
begin
  if p_permissoes is null then
    raise exception 'lista de permissões obrigatória' using errcode = 'invalid_parameter_value';
  end if;
  foreach v_item in array p_permissoes loop
    if v_item !~ '^[a-z_]+:[a-z_]+$'
       or not exists (select 1 from core.modulos m where m.slug = split_part(v_item, ':', 1))
       or split_part(v_item, ':', 2) <> all (v_acoes) then
      raise exception 'permissão inválida: %', v_item using errcode = 'invalid_parameter_value';
    end if;
    if p_papel = 'CLIENTE' and split_part(v_item, ':', 2) <> 'visualizar' then
      raise exception 'papel CLIENTE só pode ter a ação visualizar (recebido: %)', v_item using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

-- Teto de concessão (T2.4). p_vinculo null = convite (vínculo novo).
create function core.validar_teto_concessao(p_empresa uuid, p_vinculo uuid, p_permissoes text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_novas text[];
  v_proprio boolean;
begin
  if core.is_superadmin() then
    return;
  end if;
  select coalesce(array_agg(x), '{}') into v_novas
    from unnest(p_permissoes) x
   where p_vinculo is null or not exists (
     select 1 from core.permissoes p where p.vinculo_id = p_vinculo and p.modulo || ':' || p.acao = x
   );
  if cardinality(v_novas) = 0 then
    return;
  end if;
  select exists (select 1 from core.vinculos v where v.id = p_vinculo and v.usuario_id = auth.uid()) into v_proprio;
  if v_proprio then
    raise exception 'ninguém amplia as próprias permissões; peça a outro administrador'
      using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from unnest(v_novas) x
     where not core.has_permission(p_empresa, split_part(x, ':', 1), split_part(x, ':', 2))
  ) then
    raise exception 'só é possível conceder permissões que você mesmo tem nesta empresa'
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

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

  -- Conta existente com e-mail confirmado: o convite fica preso a ela.
  select u.id into v_usuario
    from core.usuarios u
    join auth.users a on a.id = u.id and a.email_confirmed_at is not null
   where lower(u.email) = v_email;
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
          (select coalesce(array_agg(distinct x order by x), '{}') from unnest(p_permissoes) x), auth.uid())
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
  update core.convites set revogado_em = now(), revogado_por = auth.uid() where id = p_convite;
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
   where c.usuario_id = auth.uid()
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
     and u.ativo and u.deleted_at is null
     and e.ativo and e.deleted_at is null
     and core.administra_empresa(c.criado_por, c.empresa_id)
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
    join auth.users a on a.id = c.usuario_id and a.email_confirmed_at is not null
    join core.empresas e on e.id = c.empresa_id and e.ativo and e.deleted_at is null
   where c.id = p_convite and c.usuario_id = auth.uid()
   for update of c;
  if v_c.id is null or v_c.aceito_em is not null or v_c.revogado_em is not null or v_c.expira_em <= now()
     or not core.administra_empresa(v_c.criado_por, v_c.empresa_id) then
    raise exception 'convite inexistente, expirado ou não é mais válido' using errcode = 'insufficient_privilege';
  end if;

  insert into core.vinculos (usuario_id, empresa_id, papel, created_by)
  values (auth.uid(), v_c.empresa_id, v_c.papel, v_c.criado_por)
  returning id into v_vinculo;

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select v_vinculo, v_c.empresa_id, split_part(x, ':', 1), split_part(x, ':', 2), v_c.criado_por
    from unnest(v_c.permissoes) x;

  update core.convites set aceito_em = now(), aceito_por = auth.uid() where id = p_convite;
  return v_vinculo;
end;
$$;

-- Conta CRIADA com o e-mail de um convite pendente (sem conta) fica ligada a ele. Só na criação:
-- troca de e-mail não liga nada.
create function core.ligar_convites_conta_nova()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update core.convites c set usuario_id = new.id
   where c.usuario_id is null and c.email = lower(new.email)
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now();
  return new;
end;
$$;

create trigger usuarios_ligar_convites after insert on core.usuarios
  for each row execute function core.ligar_convites_conta_nova();

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
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'salvar_vinculo:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  update core.vinculos set papel = p_papel, ativo = p_ativo
   where id = p_vinculo and (papel, ativo) is distinct from (p_papel, p_ativo);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), auth.uid()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);

  -- Convites de quem deixou de administrar a empresa caem junto.
  update core.convites c set revogado_em = now(), revogado_por = auth.uid()
   where c.empresa_id = v_empresa and c.aceito_em is null and c.revogado_em is null
     and not core.administra_empresa(c.criado_por, v_empresa);
end;
$$;

-- definir_permissoes (20261101130000) passa a respeitar o mesmo teto.
create or replace function core.definir_permissoes(p_vinculo uuid, p_permissoes text[], p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa
    from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_permissoes is null then
    raise exception 'lista de permissões obrigatória (use array vazio para remover todas)'
      using errcode = 'invalid_parameter_value';
  end if;
  perform core.validar_teto_concessao(v_empresa, p_vinculo, p_permissoes);
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'definir_permissoes:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo
     and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), auth.uid()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);
end;
$$;

revoke all on function core.validar_permissoes(text, text[]), core.validar_teto_concessao(uuid, uuid, text[]),
  core.administra_empresa(uuid, uuid), core.ligar_convites_conta_nova() from public, anon, authenticated;
revoke all on function core.convidar_usuario(uuid, text, text, text[], uuid), core.revogar_convite(uuid),
  core.meus_convites(), core.aceitar_convite(uuid), core.salvar_vinculo(uuid, text, boolean, text[], uuid)
  from public, anon;
grant execute on function core.convidar_usuario(uuid, text, text, text[], uuid), core.revogar_convite(uuid),
  core.meus_convites(), core.aceitar_convite(uuid), core.salvar_vinculo(uuid, text, boolean, text[], uuid)
  to authenticated;

-- down:
-- drop trigger usuarios_ligar_convites on core.usuarios;
-- drop function core.salvar_vinculo(uuid, text, boolean, text[], uuid), core.aceitar_convite(uuid),
--   core.meus_convites(), core.revogar_convite(uuid), core.convidar_usuario(uuid, text, text, text[], uuid),
--   core.ligar_convites_conta_nova(), core.administra_empresa(uuid, uuid),
--   core.validar_teto_concessao(uuid, uuid, text[]), core.validar_permissoes(text, text[]);
-- drop table core.convites;
-- recriar core.definir_permissoes como em 20261101130000 (sem o teto).
