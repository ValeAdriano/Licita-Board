-- Fase 00 · Fundação do banco na stack nova (ADR-011, ADR-013). Roda como vv_owner (dbmate).
--
-- * Schemas da ADR-013. Negar por padrão: nada para PUBLIC; vv_api e vv_worker recebem USAGE aqui
--   e grants de tabela explícitos em cada migration.
-- * Contexto do usuário: a API chama core.definir_contexto(usuario, sessao, aal) no início de cada
--   transação. Os valores ficam presos à transação (set_config local + marca app.tx = início da
--   transação): valor de sessão, "options=-c app..." na URL ou contexto esquecido no pool não valem.
--   Fora disso as funções devolvem nulo/aal0 e as policies negam (falha fechada).
-- * Contrato: policies e funções só leem o contexto por usuario_atual/sessao_atual/aal_atual. Nenhum
--   outro objeto cita current_setting('app.…') (guarda em db/tests/001). A Fase 01 troca a fonte
--   (busca da sessão em core.sessoes, ADR-013) sem mexer em policy.
-- * Limite conhecido: quem executa SQL como vv_api dentro de uma transação (SQLi na API) consegue
--   chamar definir_contexto. A Fase 01 fecha isso validando a sessão no banco.
-- * core.uuid_v7(): como na revisão 1 (supabase/migrations/20261101120000), truncando o milissegundo.

-- migrate:up
create schema core;   -- identidade, sessões e acesso
create schema pub;    -- dados públicos compartilhados (escrita só pelo worker)
create schema priv;   -- dados privados por empresa
create schema ops;    -- operação: fontes, execuções, jobs
create schema audit;  -- trilha de auditoria imutável

revoke all on schema core, pub, priv, ops, audit from public;
grant usage on schema core, pub, priv, ops, audit to vv_api, vv_worker;

-- Funções novas não ficam executáveis por PUBLIC; cada migration concede o que precisa.
alter default privileges revoke execute on functions from public;

create function core.uuid_v7()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid;
$$;

create function core.contexto_valido()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.tx', true) = extract(epoch from now())::text, false)
$$;

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

create function core.usuario_atual()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when core.contexto_valido()
              then nullif(current_setting('app.usuario_id', true), '')::uuid end
$$;

create function core.sessao_atual()
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when core.contexto_valido()
              then nullif(current_setting('app.sessao_id', true), '')::uuid end
$$;

create function core.aal_atual()
returns text
language sql
stable
set search_path = ''
as $$
  select case when core.contexto_valido() and current_setting('app.aal', true) in ('aal1', 'aal2')
              then current_setting('app.aal', true) else 'aal0' end
$$;

grant execute on function core.uuid_v7(), core.contexto_valido(), core.usuario_atual(),
  core.sessao_atual(), core.aal_atual() to vv_api, vv_worker;
grant execute on function core.definir_contexto(uuid, uuid, text) to vv_api;

-- migrate:down
drop function core.aal_atual(), core.sessao_atual(), core.usuario_atual(),
  core.definir_contexto(uuid, uuid, text), core.contexto_valido(), core.uuid_v7();
alter default privileges grant execute on functions to public;
drop schema audit, ops, priv, pub, core;
