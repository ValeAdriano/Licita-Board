-- Fase 01 · PR 5 · Notificações in-app (port de supabase/migrations/20261101150000).
-- Mudança frente à revisão 1: auth.uid() → core.usuario_atual(); authenticated → vv_api;
-- service_role → vv_worker (quem cria notificação).
--
-- * Quem cria notificação é o sistema (worker / vv_worker), nunca o usuário pela API.
-- * Notificação de empresa carrega o módulo e só é visível enquanto o destinatário tiver
--   <modulo>/visualizar naquela empresa (revogação vale na hora, inclusive MFA: ADR-003).
-- * Segunda camada: o banco recusa notificação de empresa para quem não tem vínculo ativo com ela.
-- * link: só caminho interno do app; nada de "//", "\", "..", "%" (evita sair do app / phishing).
-- * Exceção consciente às colunas padrão (supabase/AGENTS.md, regra 4): sem updated_at/created_by/
--   deleted_at e sem trigger de auditoria. Notificação é derivada de eventos que já são auditados na
--   origem (prazo, documento, peça) e a marcação de leitura é volumosa e de pouco valor. O service
--   role só pode alterar lida_em, então o conteúdo enviado não é reescrito depois.
-- * LGPD: titulo/corpo não levam CPF, valores ou dado sensível. A futura RPC de anonimização de
--   usuário precisa tratar esta tabela.

-- migrate:up
create table core.notificacoes (
  id          uuid primary key default core.uuid_v7(),
  usuario_id  uuid not null references core.usuarios (id) on delete restrict,
  empresa_id  uuid references core.empresas (id) on delete cascade,
  modulo      text references core.modulos (slug),
  tipo        text not null check (tipo ~ '^[a-z_]{3,40}$'),
  titulo      text not null check (char_length(titulo) between 1 and 140),
  corpo       text check (char_length(corpo) <= 1000),
  link        text check (
    link is null or (
      char_length(link) <= 300
      and link ~ '^/([A-Za-z0-9][A-Za-z0-9/_?=&.-]*)?$'
      and link !~ '//'
      and link !~ '\.\.'
    )
  ),
  lida_em     timestamptz,
  created_at  timestamptz not null default now(),
  check ((empresa_id is null) = (modulo is null))
);

create index notificacoes_usuario_idx on core.notificacoes (usuario_id, created_at desc);
create index notificacoes_nao_lidas_idx on core.notificacoes (usuario_id, empresa_id) where lida_em is null;
create index notificacoes_empresa_idx on core.notificacoes (empresa_id);

alter table core.notificacoes enable row level security;

create policy notificacoes_select on core.notificacoes for select to vv_api
  using (
    usuario_id = (select core.usuario_atual())
    and (empresa_id is null or core.has_permission(empresa_id, modulo, 'visualizar'))
  );
create policy notificacoes_update on core.notificacoes for update to vv_api
  using (
    usuario_id = (select core.usuario_atual())
    and (empresa_id is null or core.has_permission(empresa_id, modulo, 'visualizar'))
  )
  with check (usuario_id = (select core.usuario_atual()));

grant select on core.notificacoes to vv_api;
grant update (lida_em) on core.notificacoes to vv_api;
-- delete: limpeza por política de retenção (job do worker), nunca pela API do usuário.
grant select, insert, delete on core.notificacoes to vv_worker;
grant update (lida_em) on core.notificacoes to vv_worker;

-- Destinatário precisa ter vínculo ativo com a empresa da notificação (ou ser SUPERADMIN).
create function core.validar_destinatario_notificacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.empresa_id is not null and not exists (
    select 1 from core.vinculos v
     where v.usuario_id = new.usuario_id and v.empresa_id = new.empresa_id
       and v.ativo and v.deleted_at is null
  ) and not exists (
    select 1 from core.usuarios u where u.id = new.usuario_id and u.superadmin and u.ativo
  ) then
    raise exception 'destinatário não tem vínculo ativo com a empresa da notificação'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- lida_em é sempre o instante do servidor (não aceita data futura nem retroativa).
create function core.carimbar_leitura_notificacao()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lida_em is not null and old.lida_em is null then
    new.lida_em := now();
  elsif new.lida_em is distinct from old.lida_em then
    new.lida_em := old.lida_em;  -- leitura registrada não é desfeita nem reescrita
  end if;
  return new;
end;
$$;

create trigger notificacoes_destinatario before insert on core.notificacoes
  for each row execute function core.validar_destinatario_notificacao();
create trigger notificacoes_leitura before update of lida_em on core.notificacoes
  for each row execute function core.carimbar_leitura_notificacao();

-- migrate:down
drop table core.notificacoes;
drop function core.validar_destinatario_notificacao(), core.carimbar_leitura_notificacao();
