-- Fase 01 · PR 9 · Web Push (ADR-018, spec fase-01 RF-01.15): dispositivos inscritos e fila de envio.
--
-- * core.dispositivos_push guarda a inscrição Web Push do navegador (endpoint + chaves p256dh/auth).
--   O endpoint é uma URL secreta do serviço de push (FCM, Mozilla, Apple, Windows); quem a conhece
--   pode enviar push àquele navegador. Por isso: só o dono vê o próprio dispositivo, vv_api não lê
--   endpoint nem chaves (só id, user agent e datas), e o worker é quem as lê para enviar.
-- * SSRF: o worker faz POST no endpoint. O banco só aceita https em hosts de serviços de push
--   conhecidos (lista fechada), sem usuário, porta ou IP.
-- * Escrita só por funções (security definer): registrar (até 10 por usuário), revogar por id e por
--   endpoint (logout: o próximo usuário do navegador não recebe alertas do anterior, T5.26).
-- * Toda notificação criada (core.notificacoes) enfileira um job `push_notificacao` com o id, sem
--   texto: o push leva só um aviso genérico ("abra o app"), nunca o conteúdo (ADR-018).
-- * Exceção consciente às colunas padrão (db/AGENTS.md): sem updated_at/created_by/deleted_at e sem
--   auditoria da tabela (inscrição é descartável e o endpoint é segredo). O rastro é outro: registrar um
--   dispositivo novo manda alerta por e-mail ao dono (como login de IP novo), e trocar a senha ou
--   desativar a conta revoga os dispositivos (conta comprometida não continua recebendo avisos).
-- * Tabela por usuário (como core.notificacoes): não tem empresa_id nem has_permission. O push é só
--   um aviso genérico; o conteúdo continua passando pela API (sessão, permissão, RLS).
-- * Takeover: o endpoint só muda de dono se a pessoa reenviar as MESMAS chaves (o navegador as
--   devolve em getSubscription(): fluxo legítimo de navegador compartilhado). Quem só sabe a URL do
--   endpoint não derruba nem sequestra os avisos de outra pessoa.
-- * Retenção: ao registrar, apaga as inscrições revogadas há mais de 30 dias do próprio usuário; teto
--   de 50 linhas por usuário. A RPC futura de anonimização de usuário precisa tratar esta tabela
--   (on delete restrict, como core.notificacoes).

-- migrate:up
create table core.dispositivos_push (
  id               uuid primary key default core.uuid_v7(),
  usuario_id       uuid not null references core.usuarios (id) on delete restrict,
  endpoint         text not null unique
                   check (char_length(endpoint) <= 2048
                          and endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$'),
  p256dh           text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),  -- ponto P-256 não comprimido, base64url
  auth             text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),    -- 16 bytes, base64url
  user_agent       text check (char_length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  ultimo_envio_em  timestamptz,
  falhas           int not null default 0 check (falhas >= 0),
  revogado_em      timestamptz
);
create index dispositivos_push_usuario_idx on core.dispositivos_push (usuario_id) where revogado_em is null;
create index jobs_push_usuario_idx on ops.jobs ((payload ->> 'usuario_id'), created_at) where tipo = 'push_notificacao';

alter table core.dispositivos_push enable row level security;

create policy dispositivos_push_select on core.dispositivos_push for select to vv_api
  using (usuario_id = (select core.usuario_atual()) and revogado_em is null);

-- vv_api lê só o que a tela precisa: nunca o endpoint nem as chaves.
grant select (id, usuario_id, user_agent, created_at, ultimo_envio_em, revogado_em) on core.dispositivos_push to vv_api;
-- worker: lê tudo para enviar e só atualiza o resultado do envio.
grant select on core.dispositivos_push to vv_worker;
grant update (ultimo_envio_em, falhas, revogado_em) on core.dispositivos_push to vv_worker;

-- Aviso por e-mail (job email_alerta) de evento de segurança; interna, sem grant (como alertar_seguranca).
create function core.alertar_evento_seguranca(p_usuario uuid, p_evento text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into ops.jobs (tipo, payload, chave_idempotencia)
  values ('email_alerta', jsonb_build_object('usuario_id', p_usuario, 'eventos', jsonb_build_array(p_evento)),
          'alerta:' || p_usuario || ':' || txid_current())
  on conflict (chave_idempotencia) do update
    set payload = jsonb_set(ops.jobs.payload, '{eventos}', (ops.jobs.payload -> 'eventos') || jsonb_build_array(p_evento));
  perform pg_notify('ops_jobs', 'email_alerta');
end;
$$;

create function core.registrar_dispositivo_push(p_endpoint text, p_p256dh text, p_auth text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.usuario_atual();
  v_id uuid;
  v_ja_ativo boolean;
begin
  if v_usuario is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  if core.mfa_obrigatorio() and core.aal_atual() <> 'aal2' then
    raise exception 'registrar dispositivo exige MFA' using errcode = '42501';
  end if;
  -- Validação aqui (sem repetir os dados na mensagem: um check_violation imprimiria endpoint e chaves
  -- no log do Postgres); o CHECK da tabela fica como segunda camada.
  if p_endpoint is null or char_length(p_endpoint) > 2048
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$' then
    raise exception 'endpoint de push inválido' using errcode = '22023';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'chaves de push inválidas' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || v_usuario, 0));
  delete from core.dispositivos_push d
   where d.usuario_id = v_usuario and d.revogado_em < now() - interval '30 days';
  if (select count(*) from core.dispositivos_push d
       where d.usuario_id = v_usuario and d.revogado_em is null and d.endpoint <> p_endpoint) >= 10 then
    raise exception 'muitos dispositivos; revogue algum' using errcode = '54000';
  end if;
  if (select count(*) from core.dispositivos_push d where d.usuario_id = v_usuario) >= 50 then
    raise exception 'muitos registros de dispositivo; tente mais tarde' using errcode = '54000';
  end if;
  v_ja_ativo := exists (select 1 from core.dispositivos_push d
                         where d.endpoint = p_endpoint and d.usuario_id = v_usuario and d.revogado_em is null);
  -- Mesmo navegador, outra conta (logout e novo login): só passa para quem reenviar as MESMAS chaves.
  insert into core.dispositivos_push as d (usuario_id, endpoint, p256dh, auth, user_agent)
  values (v_usuario, p_endpoint, p_p256dh, p_auth, left(core.user_agent_atual(), 300))
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, revogado_em = null, falhas = 0,
        created_at = case when d.usuario_id <> excluded.usuario_id then now() else d.created_at end,
        ultimo_envio_em = case when d.usuario_id <> excluded.usuario_id then null else d.ultimo_envio_em end
    where d.usuario_id = excluded.usuario_id or (d.p256dh = excluded.p256dh and d.auth = excluded.auth)
  returning d.id into v_id;
  if v_id is null then
    raise exception 'dispositivo já registrado' using errcode = '42501';
  end if;
  if not v_ja_ativo then
    perform core.alertar_evento_seguranca(v_usuario, 'dispositivo_push_cadastrado');
  end if;
  return v_id;
end;
$$;

-- Id do dispositivo do navegador (se este endpoint é um dispositivo ativo do usuário logado).
create function core.meu_dispositivo_push(p_endpoint text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from core.dispositivos_push d
   where d.endpoint = p_endpoint and d.usuario_id = core.usuario_atual() and d.revogado_em is null
$$;

create function core.revogar_dispositivo_push(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if core.usuario_atual() is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  update core.dispositivos_push set revogado_em = now()
   where id = p_id and usuario_id = core.usuario_atual() and revogado_em is null;
  if not found then
    raise exception 'dispositivo não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

-- Logout: idempotente (nenhum erro se o endpoint não for do usuário ou já estiver revogado).
create function core.revogar_dispositivo_push_endpoint(p_endpoint text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if core.usuario_atual() is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  update core.dispositivos_push set revogado_em = now()
   where endpoint = p_endpoint and usuario_id = core.usuario_atual() and revogado_em is null;
end;
$$;

grant execute on function core.registrar_dispositivo_push(text, text, text),
  core.meu_dispositivo_push(text), core.revogar_dispositivo_push(uuid),
  core.revogar_dispositivo_push_endpoint(text) to vv_api;

-- Toda notificação nova vira um job de push (só o id; o texto nunca vai para a fila nem para o push).
create function core.enfileirar_push_notificacao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Sem dispositivo ativo não há o que enviar (evita fila cheia e rajada de avisos velhos ao ligar o push).
  -- No máximo 5 pushes por hora por usuário: notificação criada por outra empresa (convite, prazo) não
  -- pode virar enxurrada no celular da pessoa. A notificação continua no app.
  if exists (select 1 from core.dispositivos_push d where d.usuario_id = new.usuario_id and d.revogado_em is null)
     and (select count(*) from ops.jobs j
           where j.tipo = 'push_notificacao' and j.payload ->> 'usuario_id' = new.usuario_id::text
             and j.created_at > now() - interval '1 hour') < 5 then
    perform ops.enfileirar('push_notificacao', null,
                           jsonb_build_object('notificacao_id', new.id, 'usuario_id', new.usuario_id), 'push:' || new.id);
  end if;
  return new;
end;
$$;

create trigger notificacoes_push after insert on core.notificacoes
  for each row execute function core.enfileirar_push_notificacao();
alter table core.notificacoes enable always trigger notificacoes_push;

-- Senha trocada/redefinida ou conta desativada: os dispositivos deixam de receber avisos (conta
-- comprometida; a pessoa liga de novo na Conta depois de entrar).
create function core.revogar_push_do_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update core.dispositivos_push set revogado_em = now() where usuario_id = new.id and revogado_em is null;
  return new;
end;
$$;

create trigger usuarios_revoga_push after update of senha_hash, ativo on core.usuarios
  for each row
  when (old.senha_hash is distinct from new.senha_hash or (old.ativo and not new.ativo))
  execute function core.revogar_push_do_usuario();
alter table core.usuarios enable always trigger usuarios_revoga_push;

-- migrate:down
delete from ops.jobs where tipo = 'push_notificacao';
drop index ops.jobs_push_usuario_idx;
drop trigger usuarios_revoga_push on core.usuarios;
drop function core.revogar_push_do_usuario();
drop trigger notificacoes_push on core.notificacoes;
drop function core.enfileirar_push_notificacao();
drop function core.revogar_dispositivo_push_endpoint(text), core.revogar_dispositivo_push(uuid),
  core.meu_dispositivo_push(text), core.registrar_dispositivo_push(text, text, text),
  core.alertar_evento_seguranca(uuid, text);
drop table core.dispositivos_push;
