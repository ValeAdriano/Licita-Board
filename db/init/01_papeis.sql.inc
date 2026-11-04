-- Papéis e banco do VV Licitações (ADR-013). Roda como superusuário, uma vez por cluster:
-- no Docker via 01_papeis.sh (extensão .inc para o entrypoint não rodar sem variáveis);
-- sem Docker via db/scripts/test-local.sh.
-- Ambiente: VV_OWNER_PASSWORD, VV_API_PASSWORD, VV_WORKER_PASSWORD, VV_DB.
--
-- * vv_owner: dono dos objetos da aplicação; só as migrations (dbmate) conectam com ele. Não é dono
--   do banco nem de public/extensions, para uma migration não plantar código que o superusuário rode.
-- * vv_api: login da API. Sem BYPASSRLS: toda leitura passa pela RLS com o contexto app.*.
-- * vv_worker: login do worker. BYPASSRLS (antiga service role); valida empresa_id em código.
-- Nenhum dos três é superusuário, cria papéis ou bancos, ou é membro de outro papel.

\getenv owner_password VV_OWNER_PASSWORD
\getenv api_password VV_API_PASSWORD
\getenv worker_password VV_WORKER_PASSWORD
\getenv db_name VV_DB

select format('create role %I login', r)
  from unnest(array['vv_owner', 'vv_api', 'vv_worker']) r
 where not exists (select 1 from pg_roles where rolname = r) \gexec

alter role vv_owner password :'owner_password';
alter role vv_api noinherit nobypassrls connection limit 30 password :'api_password';
alter role vv_worker noinherit bypassrls connection limit 10 password :'worker_password';
-- O contexto do usuário vive dentro da transação: transação parada não pode segurar conexão.
alter role vv_api set idle_in_transaction_session_timeout = '30s';
alter role vv_api set statement_timeout = '15s';
-- KEK, códigos e tokens passam como parâmetro: nunca no log do Postgres (consulta lenta, erro).
alter role vv_api set log_parameter_max_length = 0;
alter role vv_api set log_parameter_max_length_on_error = 0;
-- Erro sem a linha que falhou (DETAIL pode trazer e-mail, nome, telefone).
alter role vv_api set log_error_verbosity = terse;
alter role vv_worker set log_parameter_max_length = 0;
alter role vv_worker set log_parameter_max_length_on_error = 0;
alter role vv_worker set log_error_verbosity = terse;

select format('create database %I', :'db_name')
 where not exists (select 1 from pg_database where datname = :'db_name') \gexec

revoke connect, temporary on database postgres, template1 from public;
revoke all on database :"db_name" from public;
grant connect on database :"db_name" to vv_owner, vv_api, vv_worker;
grant create on database :"db_name" to vv_owner;

\connect :db_name

revoke create on schema public from public;

-- Extensões exigem superusuário; ficam fora das migrations, num schema que só o superusuário altera.
create schema if not exists extensions;
grant usage on schema extensions to vv_owner, vv_api, vv_worker;
create extension if not exists citext with schema extensions;  -- e-mail (core.usuarios)
create extension if not exists pgcrypto with schema extensions;  -- TOTP (HMAC), segredo e códigos de recuperação
create extension if not exists unaccent with schema extensions;  -- busca sem acento (pub.pt_unaccent)
-- pgvector vem na imagem de db/Dockerfile; num Postgres local sem ela, o teste segue sem a extensão.
select 'create extension if not exists vector with schema extensions'
 where exists (select 1 from pg_available_extensions where name = 'vector') \gexec
