-- Fase 01 · PR 3b · Fila de jobs (ADR-014), recuperação de senha por e-mail e alertas de segurança.
--
-- * ops.jobs: a API só enfileira por funções do banco, na mesma transação do dado; o worker (vv_worker)
--   pega com FOR UPDATE SKIP LOCKED, com visibilidade de 5 min e um id de execução: só quem pegou
--   conclui ou falha (worker atrasado não mexe no job de outro). Falha volta com backoff exponencial e
--   variação; prazo vencido na última tentativa vira 'falhou'. Payload só com IDs, nunca token.
-- * Recuperação: a API chama core.solicitar_recuperacao(e-mail, KEK) e responde sempre igual; no máximo
--   1 pedido a cada 5 min (janela deslizante) e 5 por dia por usuário. O token NÃO passa pela fila nem
--   pelo banco: o worker gera o token e envia só o SHA-256 dele, e só para um job de recuperação em
--   execução por aquele worker (um token por job). A API perde o caminho antigo (criar_token_recuperacao).
--   Risco residual (threat-model T5.4b): quem envia o e-mail vê o token.
-- * Alertas por e-mail (decisão 5): senha alterada/redefinida, autenticador cadastrado/removido e login
--   de IP novo. Eventos da mesma transação viram UM e-mail (troca de autenticador, reset de MFA).

-- migrate:up
create table ops.jobs (
  id                  uuid primary key default core.uuid_v7(),
  tipo                text not null check (tipo ~ '^[a-z_]{3,60}$'),
  empresa_id          uuid references core.empresas (id) on delete cascade,
  payload             jsonb not null default '{}'
                      check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  chave_idempotencia  text unique check (char_length(chave_idempotencia) <= 200),
  status              text not null default 'pendente'
                      check (status in ('pendente', 'executando', 'concluido', 'falhou')),
  tentativas          int not null default 0,
  max_tentativas      int not null default 5 check (max_tentativas between 1 and 20),
  execucao            uuid,
  disponivel_em       timestamptz not null default now(),
  travado_ate         timestamptz,
  ultimo_erro         text check (char_length(ultimo_erro) <= 1000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  concluido_em        timestamptz
);
create index jobs_fila_idx on ops.jobs (tipo, disponivel_em) where status in ('pendente', 'executando');
create index jobs_empresa_idx on ops.jobs (empresa_id) where empresa_id is not null;
create index jobs_recuperacao_idx on ops.jobs ((payload ->> 'usuario_id'), created_at)
  where tipo = 'email_recuperacao';

alter table ops.jobs enable row level security;
-- Sem grant de tabela para ninguém da aplicação: só as funções abaixo.

create trigger jobs_updated_at before update on ops.jobs
  for each row execute function core.set_updated_at();

-- Enfileira (interna: sem grant). Chave de idempotência repetida não duplica o job.
create function ops.enfileirar(p_tipo text, p_empresa uuid, p_payload jsonb, p_chave text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into ops.jobs (tipo, empresa_id, payload, chave_idempotencia)
  values (p_tipo, p_empresa, coalesce(p_payload, '{}'), p_chave)
  on conflict (chave_idempotencia) do nothing;
  perform pg_notify('ops_jobs', p_tipo);
end;
$$;

-- Worker: pega até p_limite jobs dos tipos dados (pendentes vencidos ou travados que expiraram). Antes,
-- marca 'falhou' o que venceu o prazo na última tentativa (worker caiu no meio).
create function ops.pegar_jobs(p_tipos text[], p_limite int)
returns setof ops.jobs
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update ops.jobs
     set status = 'falhou', travado_ate = null, execucao = null,
         ultimo_erro = 'prazo esgotado na última tentativa'
   where status = 'executando' and travado_ate < now() and tentativas >= max_tentativas;
  return query
  update ops.jobs j
     set status = 'executando', travado_ate = now() + interval '5 minutes', tentativas = j.tentativas + 1,
         execucao = core.uuid_v7()
   where j.id in (
     select x.id from ops.jobs x
      where x.tipo = any (p_tipos) and x.tentativas < x.max_tentativas
        and ((x.status = 'pendente' and x.disponivel_em <= now())
             or (x.status = 'executando' and x.travado_ate < now()))
      order by x.disponivel_em
      limit least(greatest(p_limite, 1), 50)
      for update skip locked)
  returning j.*;
end;
$$;

create function ops.concluir_job(p_job uuid, p_execucao uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update ops.jobs set status = 'concluido', concluido_em = now(), travado_ate = null, ultimo_erro = null
   where id = p_job and status = 'executando' and execucao = p_execucao
$$;

-- Falha: volta para a fila com backoff (2^tentativas min + até 30 s) ou desiste na última tentativa.
create function ops.falhar_job(p_job uuid, p_execucao uuid, p_erro text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update ops.jobs
     set status = case when tentativas >= max_tentativas then 'falhou' else 'pendente' end,
         disponivel_em = now() + make_interval(mins => power(2, least(tentativas, 10))::int)
                         + random() * interval '30 seconds',
         travado_ate = null,
         execucao = null,
         ultimo_erro = left(p_erro, 1000)
   where id = p_job and status = 'executando' and execucao = p_execucao
$$;

grant execute on function ops.pegar_jobs(text[], int), ops.concluir_job(uuid, uuid),
  ops.falhar_job(uuid, uuid, text) to vv_worker;

-- Recuperação de senha: resposta igual exista ou não a conta; 1 pedido a cada 5 min e 5 por dia.
create function core.solicitar_recuperacao(p_email text, p_kek text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  perform core.conferir_kek(p_kek);
  select u.id into v_usuario from core.usuarios u
   where u.email operator(extensions.=) p_email::extensions.citext and u.ativo and u.deleted_at is null;
  if v_usuario is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('recuperacao:' || v_usuario, 0));
  if exists (select 1 from ops.jobs j where j.tipo = 'email_recuperacao'
              and j.payload ->> 'usuario_id' = v_usuario::text and j.created_at > now() - interval '5 minutes')
     or (select count(*) from ops.jobs j where j.tipo = 'email_recuperacao'
          and j.payload ->> 'usuario_id' = v_usuario::text and j.created_at > now() - interval '24 hours') >= 5 then
    return;
  end if;
  perform ops.enfileirar('email_recuperacao', null, jsonb_build_object('usuario_id', v_usuario), null);
end;
$$;

-- A API não cria mais token de recuperação (ela veria o token); quem cria é o worker, abaixo.
revoke execute on function core.criar_token_recuperacao(text, text, text) from vv_api;

alter table core.tokens_recuperacao
  add column job_id uuid unique references ops.jobs (id) on delete set null;

-- Worker: gera o token de recuperação para o job em execução (um token por job; só o hash fica) e
-- recebe o destinatário. Sem job de recuperação vivo e dele, nada é emitido.
create function core.emitir_token_recuperacao(p_job uuid, p_execucao uuid, p_token_hash bytea)
returns table (email text, nome text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
begin
  if coalesce(octet_length(p_token_hash), 0) <> 32 then
    raise exception 'hash do token inválido' using errcode = '22023';
  end if;
  select (j.payload ->> 'usuario_id')::uuid into v_usuario
    from ops.jobs j
   where j.id = p_job and j.tipo = 'email_recuperacao' and j.status = 'executando'
     and j.execucao = p_execucao and j.travado_ate > now()
     and not exists (select 1 from core.tokens_recuperacao t where t.job_id = j.id);
  if v_usuario is null then
    raise exception 'job de recuperação inválido' using errcode = '42501';
  end if;
  if not exists (select 1 from core.usuarios u where u.id = v_usuario and u.ativo and u.deleted_at is null) then
    return;
  end if;
  update core.tokens_recuperacao set usado_em = now() where usuario_id = v_usuario and usado_em is null;
  insert into core.tokens_recuperacao (usuario_id, token_hash, job_id)
  values (v_usuario, p_token_hash, p_job);
  return query select u.email::text, u.nome from core.usuarios u where u.id = v_usuario;
end;
$$;

grant execute on function core.solicitar_recuperacao(text, text) to vv_api;
grant execute on function core.emitir_token_recuperacao(uuid, uuid, bytea) to vv_worker;

-- Alertas de segurança por e-mail (decisão 5). Eventos da mesma transação somam num único job
-- (payload {usuario_id, eventos[]}); sem conteúdo sensível.
create function core.alertar_seguranca()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
  v_evento text;
begin
  if tg_table_name = 'usuarios' then
    if new.senha_hash is distinct from old.senha_hash and old.senha_hash is not null then
      v_usuario := new.id;
      v_evento := case when new.senha_hash is null then 'acesso_redefinido' else 'senha_alterada' end;
    end if;
  elsif tg_table_name = 'sessoes' then
    if not exists (select 1 from core.sessoes s
                    where s.usuario_id = new.usuario_id and s.id <> new.id
                      and s.ip is not distinct from new.ip and s.criada_em > now() - interval '90 days') then
      v_usuario := new.usuario_id;
      v_evento := 'login_novo';
    end if;
  elsif tg_op = 'UPDATE' and old.verificado_em is null and new.verificado_em is not null then
    v_usuario := new.usuario_id;
    v_evento := 'autenticador_cadastrado';
  elsif tg_op = 'DELETE' and old.verificado_em is not null then
    v_usuario := old.usuario_id;
    v_evento := 'autenticador_removido';
  end if;
  if v_evento is not null then
    insert into ops.jobs (tipo, payload, chave_idempotencia)
    values ('email_alerta', jsonb_build_object('usuario_id', v_usuario, 'eventos', jsonb_build_array(v_evento)),
            'alerta:' || v_usuario || ':' || txid_current())
    on conflict (chave_idempotencia) do update
      set payload = jsonb_set(ops.jobs.payload, '{eventos}',
                              (ops.jobs.payload -> 'eventos') || jsonb_build_array(v_evento));
    perform pg_notify('ops_jobs', 'email_alerta');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger usuarios_alerta_senha after update of senha_hash on core.usuarios
  for each row execute function core.alertar_seguranca();
create trigger fatores_mfa_alerta after update of verificado_em or delete on core.fatores_mfa
  for each row execute function core.alertar_seguranca();
create trigger sessoes_alerta_login after insert on core.sessoes
  for each row execute function core.alertar_seguranca();
alter table core.usuarios enable always trigger usuarios_alerta_senha;
alter table core.fatores_mfa enable always trigger fatores_mfa_alerta;
alter table core.sessoes enable always trigger sessoes_alerta_login;

-- migrate:down
drop trigger sessoes_alerta_login on core.sessoes;
drop trigger fatores_mfa_alerta on core.fatores_mfa;
drop trigger usuarios_alerta_senha on core.usuarios;
drop function core.alertar_seguranca(), core.emitir_token_recuperacao(uuid, uuid, bytea),
  core.solicitar_recuperacao(text, text), ops.falhar_job(uuid, uuid, text), ops.concluir_job(uuid, uuid),
  ops.pegar_jobs(text[], int), ops.enfileirar(text, uuid, jsonb, text);
alter table core.tokens_recuperacao drop column job_id;
grant execute on function core.criar_token_recuperacao(text, text, text) to vv_api;
drop table ops.jobs;
