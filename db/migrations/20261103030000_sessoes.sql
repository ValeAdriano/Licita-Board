-- Fase 01 · PR 2a · Identidade e sessão próprias (spec fase-01 §4, ADR-012, ADR-013).
--
-- * O contexto deixa de ser "usuário + aal" informados pela API e passa a ser a sessão: a API passa
--   o token opaco a definir_contexto, que guarda na transação só o SHA-256 dele (app.sessao_hash; o
--   token cru nunca fica legível no banco). usuario_atual/sessao_atual/aal_atual buscam a sessão viva
--   em core.sessoes a cada consulta. Forjar app.* (mesmo por SQLi dentro da transação) não serve sem
--   o token de uma sessão viva.
-- * Sessão viva = não revogada, dentro da absoluta (12 h) e da inatividade (30 min), usuário ativo.
--   O bloqueio por falhas de login (bloqueado_ate) só impede login NOVO: não derruba sessões abertas
--   (senão errar a senha de alguém vira ataque de indisponibilidade contra essa pessoa).
-- * Login em duas etapas, para a força bruta paralela não passar do limite: preparar_login registra a
--   tentativa ANTES de a API conferir o Argon2 (serializada por IP e por e-mail) e recusa se a conta
--   estiver bloqueada (10 falhas liberadas em 15 min) ou o IP (IPv6 por /64) passar de 10/min;
--   concluir_login marca o sucesso e cria a sessão. Senha errada não precisa de nova chamada.
-- * Funções que leem o hash da senha, criam sessão ou redefinem senha exigem a chave-mestra (KEK),
--   conferida contra o verificador em core.chaves_mestras: quem só executa SQL como vv_api (SQLi) não
--   lê hash, não cria sessão e não redefine senha. senha_hash não tem grant para vv_api nem vv_worker
--   e é redigida na auditoria.
-- * Tentativas guardam o SHA-256 do e-mail (pseudônimo; e-mail inexistente não é gravado em claro).
-- * Com search_path vazio, comparar citext exige operator(extensions.=).

-- migrate:up
alter table core.usuarios
  add column senha_hash text check (senha_hash like '$argon2id$%'),
  add column senha_trocada_em timestamptz,
  add column bloqueado_ate timestamptz;

-- senha_hash fora da auditoria (redigida) e sem SELECT para os papéis da aplicação.
drop trigger usuarios_audit on core.usuarios;
create trigger usuarios_audit after insert or update or delete on core.usuarios
  for each row execute function audit.registrar('-', 'nome,email,telefone,oab,senha_hash');
alter table core.usuarios enable always trigger usuarios_audit;
revoke select on core.usuarios from vv_worker;
grant select (id, email, nome, telefone, oab, superadmin, ativo, created_at, updated_at, deleted_at,
  senha_trocada_em, bloqueado_ate) on core.usuarios to vv_worker;

create table core.sessoes (
  id             uuid primary key default core.uuid_v7(),
  usuario_id     uuid not null references core.usuarios (id) on delete cascade,
  token_hash     bytea not null unique check (octet_length(token_hash) = 32),
  aal            text not null default 'aal1' check (aal in ('aal1', 'aal2')),
  mfa_em         timestamptz,
  criada_em      timestamptz not null default now(),
  ultimo_uso_em  timestamptz not null default now(),
  expira_em      timestamptz not null default now() + interval '12 hours',
  revogada_em    timestamptz,
  ip             inet,
  user_agent     text check (char_length(user_agent) <= 500),
  plataforma     text not null check (plataforma in ('web', 'ios', 'android'))
);
create index sessoes_usuario_idx on core.sessoes (usuario_id) where revogada_em is null;

create table core.tentativas_login (
  id          uuid primary key default core.uuid_v7(),
  email_hash  bytea not null,
  ip          inet,
  liberada    boolean not null default false,  -- preparar_login deixou conferir a senha
  sucesso     boolean not null default false,
  em          timestamptz not null default now()
);
create index tentativas_email_idx on core.tentativas_login (email_hash, em desc);
create index tentativas_ip_idx on core.tentativas_login (ip, em desc);

create table core.tokens_recuperacao (
  id          uuid primary key default core.uuid_v7(),
  usuario_id  uuid not null references core.usuarios (id) on delete cascade,
  token_hash  bytea not null unique check (octet_length(token_hash) = 32),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null default now() + interval '30 minutes',
  usado_em    timestamptz
);
create index tokens_recuperacao_usuario_idx on core.tokens_recuperacao (usuario_id) where usado_em is null;

alter table core.sessoes enable row level security;
alter table core.tentativas_login enable row level security;
alter table core.tokens_recuperacao enable row level security;
-- Sem policy e sem grant para vv_api: só as funções abaixo. O worker vê sessões sem o hash.
grant select (id, usuario_id, aal, criada_em, ultimo_uso_em, expira_em, revogada_em, plataforma)
  on core.sessoes to vv_worker;

-- Sessão: criação, revogação e elevação auditadas (não cada uso).
create trigger sessoes_audit after insert or update of revogada_em, aal, token_hash or delete on core.sessoes
  for each row execute function audit.registrar('-', 'token_hash,ip,user_agent');
alter table core.sessoes enable always trigger sessoes_audit;

-- Verificador da chave-mestra (KEK, ADR-017), gravado no deploy por vv_owner (db/scripts/registrar-kek.sh).
create table core.chaves_mestras (
  versao       int primary key,
  verificador  bytea not null,
  criada_em    timestamptz not null default now()
);

alter table core.chaves_mestras enable row level security;
create trigger chaves_mestras_audit after insert or update or delete on core.chaves_mestras
  for each row execute function audit.registrar('-', 'verificador');
alter table core.chaves_mestras enable always trigger chaves_mestras_audit;

create function core.hash_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(convert_to(p_token, 'UTF8'))
$$;

-- Registro da KEK no deploy (só vv_owner; db/scripts/registrar-kek.sh). Guarda só um verificador.
create function core.registrar_kek(p_versao int, p_kek text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if coalesce(char_length(p_kek), 0) < 32 then
    raise exception 'KEK curta' using errcode = '22023';
  end if;
  insert into core.chaves_mestras (versao, verificador)
  values (p_versao, extensions.pgp_sym_encrypt('vv-kek-ok', p_kek, 'cipher-algo=aes256'));
end;
$$;

-- Versão da KEK recebida, ou erro 28000 se não for a registrada. Interna.
create function core.conferir_kek(p_kek text)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_versao int;
begin
  select c.versao into v_versao from core.chaves_mestras c order by c.versao desc limit 1;
  if v_versao is null or p_kek is null or char_length(p_kek) < 32
     or extensions.pgp_sym_decrypt((select verificador from core.chaves_mestras where versao = v_versao), p_kek)
        is distinct from 'vv-kek-ok' then
    raise exception 'chave-mestra inválida' using errcode = '28000';
  end if;
  return v_versao;
exception when others then
  raise exception 'chave-mestra inválida' using errcode = '28000';
end;
$$;

-- Sessão da transação, se viva. Única leitora de app.sessao_hash.
create function core.sessao_valida()
returns table (id uuid, usuario_id uuid, aal text, mfa_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.usuario_id, s.aal, s.mfa_em
    from core.sessoes s
    join core.usuarios u on u.id = s.usuario_id
   where core.contexto_valido()
     and s.token_hash = decode(nullif(current_setting('app.sessao_hash', true), ''), 'hex')
     and s.revogada_em is null
     and s.expira_em > now()
     and s.ultimo_uso_em > now() - interval '30 minutes'
     and u.ativo and u.deleted_at is null
$$;

create or replace function core.usuario_atual()
returns uuid
language sql
stable
set search_path = ''
as $$
  select usuario_id from core.sessao_valida()
$$;

create or replace function core.sessao_atual()
returns uuid
language sql
stable
set search_path = ''
as $$
  select id from core.sessao_valida()
$$;

create or replace function core.aal_atual()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce((select aal from core.sessao_valida()), 'aal0')
$$;

-- O contexto antigo (usuário e aal informados pela API) sai: era forjável por SQLi.
drop function core.definir_contexto(uuid, uuid, text);

create function core.definir_contexto(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash bytea := core.hash_token(coalesce(p_token, ''));
begin
  perform set_config('app.sessao_hash', encode(v_hash, 'hex'), true),
          set_config('app.tx', extract(epoch from now())::text, true);
  if not exists (select 1 from core.sessao_valida()) then
    perform set_config('app.sessao_hash', '', true);
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  -- Renova a inatividade no máximo uma vez por minuto e sem esperar trava: requisições paralelas
  -- da mesma sessão não ficam em fila.
  update core.sessoes set ultimo_uso_em = now()
   where id = (select s.id from core.sessoes s
                where s.token_hash = v_hash and s.ultimo_uso_em < now() - interval '1 minute'
                for update skip locked);
end;
$$;

-- Troca o token da sessão atual (rotação após trocar senha ou elevar a aal2). Exige o token atual
-- em claro, que só a API tem: um SQL injetado na transação de outra pessoa não toma a sessão dela.
create function core.rotacionar_sessao(p_token_atual text, p_token_novo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sessao uuid := core.sessao_atual();
begin
  if v_sessao is null or coalesce(char_length(p_token_novo), 0) < 43
     or not exists (select 1 from core.sessoes s where s.id = v_sessao and s.token_hash = core.hash_token(p_token_atual)) then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  update core.sessoes set token_hash = core.hash_token(p_token_novo) where id = v_sessao;
  perform set_config('app.sessao_hash', encode(core.hash_token(p_token_novo), 'hex'), true);
end;
$$;

-- Etapa 1 do login. Exige a KEK (só a API tem: SQLi não lê hash de senha). Registra a tentativa
-- antes de a API conferir o Argon2, serializada por grupo de IP e por e-mail. motivo: 'ok' |
-- 'bloqueado' (conta: resposta 401 igual à de senha errada) | 'limite_ip' (429). Só tentativas
-- liberadas contam para o bloqueio do e-mail (recusadas não renovam o bloqueio), e a contagem recomeça
-- no último sucesso ou na última troca de senha (recuperação desbloqueia).
create function core.preparar_login(p_email text, p_ip inet, p_kek text)
returns table (tentativa_id uuid, usuario_id uuid, senha_hash text, motivo text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hash bytea := core.hash_token(lower(p_email));
  v_grupo inet := case when p_ip is null then null
                       when family(p_ip) = 6 then network(set_masklen(p_ip, 64))
                       else host(p_ip)::inet end;
  v_falhas int;
  v_usuario uuid;
  v_senha text;
  v_bloqueado timestamptz;
  v_trocada timestamptz;
  v_tentativa uuid;
begin
  perform core.conferir_kek(p_kek);
  perform pg_advisory_xact_lock(hashtextextended('ip:' || coalesce(v_grupo::text, '-'), 0));
  perform pg_advisory_xact_lock(hashtextextended('email:' || encode(v_hash, 'hex'), 0));

  insert into core.tentativas_login (email_hash, ip) values (v_hash, p_ip) returning id into v_tentativa;

  -- IP nulo conta como um grupo só; IPv6 por /64.
  if (select count(*) from core.tentativas_login t
       where t.em > now() - interval '1 minute'
         and (case when t.ip is null then null when family(t.ip) = 6 then network(set_masklen(t.ip, 64))
                   else host(t.ip)::inet end) is not distinct from v_grupo) > 10 then
    return query select v_tentativa, null::uuid, null::text, 'limite_ip'::text;
    return;
  end if;

  select u.id, u.senha_hash, u.bloqueado_ate, u.senha_trocada_em
    into v_usuario, v_senha, v_bloqueado, v_trocada
    from core.usuarios u
   where u.email operator(extensions.=) p_email::extensions.citext and u.ativo and u.deleted_at is null;

  select count(*) into v_falhas from core.tentativas_login t
   where t.email_hash = v_hash and t.liberada and not t.sucesso and t.em > now() - interval '15 minutes'
     and t.em > greatest(coalesce(v_trocada, '-infinity'),
                         coalesce((select max(s.em) from core.tentativas_login s
                                    where s.email_hash = v_hash and s.sucesso), '-infinity'));
  if v_falhas >= 10 or (v_bloqueado is not null and v_bloqueado > now()) then
    if v_usuario is not null and (v_bloqueado is null or v_bloqueado <= now()) then
      update core.usuarios set bloqueado_ate = now() + interval '15 minutes' where id = v_usuario;
    end if;
    return query select v_tentativa, null::uuid, null::text, 'bloqueado'::text;
    return;
  end if;

  update core.tentativas_login set liberada = true where id = v_tentativa;
  return query select v_tentativa, v_usuario, v_senha, 'ok'::text;
end;
$$;

-- Etapa 2 (só com a senha conferida e a KEK): a tentativa liberada vira sucesso e nasce a sessão aal1.
create function core.concluir_login(p_tentativa uuid, p_usuario uuid, p_token text, p_ip inet,
                                    p_user_agent text, p_plataforma text, p_kek text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform core.conferir_kek(p_kek);
  if coalesce(char_length(p_token), 0) < 43 then
    raise exception 'token curto' using errcode = '22023';
  end if;
  update core.tentativas_login t set sucesso = true
    from core.usuarios u
   where t.id = p_tentativa and t.liberada and not t.sucesso and t.em > now() - interval '1 minute'
     and u.id = p_usuario and t.email_hash = core.hash_token(lower(u.email::text))
     and (u.senha_trocada_em is null or u.senha_trocada_em < t.em);
  if not found or not exists (select 1 from core.usuarios u where u.id = p_usuario and u.ativo
                               and u.deleted_at is null and (u.bloqueado_ate is null or u.bloqueado_ate <= now())) then
    raise exception 'login indisponível' using errcode = '28000';
  end if;
  insert into core.sessoes (usuario_id, token_hash, ip, user_agent, plataforma)
  values (p_usuario, core.hash_token(p_token), p_ip, left(p_user_agent, 500), p_plataforma)
  returning id into v_id;
  return v_id;
end;
$$;

-- As funções abaixo agem sobre a sessão do contexto (definir_contexto antes).
create function core.hash_senha_atual(p_kek text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform core.conferir_kek(p_kek);
  return (select u.senha_hash from core.usuarios u where u.id = core.usuario_atual());
end;
$$;

create function core.encerrar_sessao(p_sessao uuid default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update core.sessoes set revogada_em = now()
   where usuario_id = core.usuario_atual() and revogada_em is null
     and id = coalesce(p_sessao, core.sessao_atual())
$$;

create function core.encerrar_todas_sessoes(p_manter_atual boolean)
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with r as (
    update core.sessoes set revogada_em = now()
     where usuario_id = core.usuario_atual() and revogada_em is null
       and (not coalesce(p_manter_atual, true) or id <> core.sessao_atual())
    returning 1
  ) select count(*)::int from r
$$;

create function core.minhas_sessoes()
returns table (id uuid, criada_em timestamptz, ultimo_uso_em timestamptz, ip inet, user_agent text,
               plataforma text, aal text, atual boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.criada_em, s.ultimo_uso_em, s.ip, s.user_agent, s.plataforma, s.aal,
         s.id = core.sessao_atual()
    from core.sessoes s
   where s.usuario_id = core.usuario_atual() and s.revogada_em is null and s.expira_em > now()
     and s.ultimo_uso_em > now() - interval '30 minutes'
   order by s.ultimo_uso_em desc
$$;

-- Troca logada: a API conferiu a senha atual; as outras sessões são encerradas. A exigência de aal2
-- para quem tem/precisa de MFA entra com o PR 2b (create or replace).
create function core.trocar_senha(p_senha_hash text)
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
  update core.usuarios set senha_hash = p_senha_hash, senha_trocada_em = now()
   where id = core.usuario_atual();
  perform core.encerrar_todas_sessoes(true);
end;
$$;

-- Recuperação: devolve o usuário (para a API enfileirar o e-mail) ou nulo; a resposta HTTP é a mesma
-- nos dois casos. Um token ativo por usuário.
create function core.criar_token_recuperacao(p_email text, p_token text, p_kek text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  perform core.conferir_kek(p_kek);
  if coalesce(char_length(p_token), 0) < 43 then
    raise exception 'token curto' using errcode = '22023';
  end if;
  select u.id into v_usuario from core.usuarios u
   where u.email operator(extensions.=) p_email::extensions.citext and u.ativo and u.deleted_at is null;
  if v_usuario is null then
    return null;
  end if;
  update core.tokens_recuperacao set usado_em = now() where usuario_id = v_usuario and usado_em is null;
  insert into core.tokens_recuperacao (usuario_id, token_hash) values (v_usuario, core.hash_token(p_token));
  return v_usuario;
end;
$$;

create function core.redefinir_senha(p_token text, p_senha_hash text, p_kek text)
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

grant execute on function core.sessao_valida() to vv_api, vv_worker;
grant execute on function core.definir_contexto(text), core.rotacionar_sessao(text, text),
  core.preparar_login(text, inet, text), core.concluir_login(uuid, uuid, text, inet, text, text, text),
  core.hash_senha_atual(text), core.encerrar_sessao(uuid), core.encerrar_todas_sessoes(boolean),
  core.minhas_sessoes(), core.trocar_senha(text), core.criar_token_recuperacao(text, text, text),
  core.redefinir_senha(text, text, text) to vv_api;

-- migrate:down
drop function core.redefinir_senha(text, text, text), core.criar_token_recuperacao(text, text, text),
  core.trocar_senha(text), core.minhas_sessoes(), core.encerrar_todas_sessoes(boolean),
  core.encerrar_sessao(uuid), core.hash_senha_atual(text),
  core.concluir_login(uuid, uuid, text, inet, text, text, text), core.preparar_login(text, inet, text),
  core.rotacionar_sessao(text, text), core.definir_contexto(text), core.conferir_kek(text),
  core.registrar_kek(int, text);
-- Volta o contexto da fundação (20261103010000).
create function core.definir_contexto(p_usuario uuid, p_sessao uuid, p_aal text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_aal not in ('aal1', 'aal2') then
    raise exception 'aal inválido' using errcode = '22023';
  end if;
  perform set_config('app.usuario_id', p_usuario::text, true),
          set_config('app.sessao_id', p_sessao::text, true),
          set_config('app.aal', p_aal, true),
          set_config('app.tx', extract(epoch from now())::text, true);
end;
$$;
grant execute on function core.definir_contexto(uuid, uuid, text) to vv_api;
create or replace function core.usuario_atual() returns uuid language sql stable set search_path = '' as $$
  select case when core.contexto_valido() then nullif(current_setting('app.usuario_id', true), '')::uuid end
$$;
create or replace function core.sessao_atual() returns uuid language sql stable set search_path = '' as $$
  select case when core.contexto_valido() then nullif(current_setting('app.sessao_id', true), '')::uuid end
$$;
create or replace function core.aal_atual() returns text language sql stable set search_path = '' as $$
  select case when core.contexto_valido() and current_setting('app.aal', true) in ('aal1', 'aal2')
              then current_setting('app.aal', true) else 'aal0' end
$$;
drop function core.sessao_valida(), core.hash_token(text);
drop table core.tokens_recuperacao, core.tentativas_login, core.sessoes, core.chaves_mestras;
revoke select on core.usuarios from vv_worker;
grant select on core.usuarios to vv_worker;
drop trigger usuarios_audit on core.usuarios;
create trigger usuarios_audit after insert or update or delete on core.usuarios
  for each row execute function audit.registrar('-', 'nome,email,telefone,oab');
alter table core.usuarios enable always trigger usuarios_audit;
alter table core.usuarios drop column bloqueado_ate, drop column senha_trocada_em, drop column senha_hash;
