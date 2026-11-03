-- Fase 01 · PR 7 · Requisição de segundo plano não renova a inatividade (threat-model T5.17).
--
-- O app consulta notificações periodicamente. Se essa consulta renovasse `ultimo_uso_em`, a sessão
-- de quem deixou a tela aberta nunca expiraria (os 30 min de inatividade valeriam só no papel).
-- core.definir_contexto(token, renovar) confere a sessão igual, mas só renova quando renovar = true.
-- A versão de 1 argumento continua renovando (todo uso feito pela pessoa).

-- migrate:up
create function core.definir_contexto(p_token text, p_renovar boolean)
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
  -- da mesma sessão não ficam em fila. Nulo renova de propósito (comportamento anterior); a função
  -- não é strict porque token nulo também precisa ser recusado.
  if coalesce(p_renovar, true) then
    update core.sessoes set ultimo_uso_em = now()
     where id = (select s.id from core.sessoes s
                  where s.token_hash = v_hash and s.ultimo_uso_em < now() - interval '1 minute'
                  for update skip locked);
  end if;
end;
$$;

-- begin atomic: o Postgres registra a dependência (apagar a versão de 2 argumentos falha na hora).
create or replace function core.definir_contexto(p_token text)
returns void
language sql
volatile
security definer
set search_path = ''
begin atomic
  select core.definir_contexto(p_token, true);
end;

grant execute on function core.definir_contexto(text, boolean) to vv_api;

-- migrate:down
create or replace function core.definir_contexto(p_token text)
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
drop function core.definir_contexto(text, boolean);
