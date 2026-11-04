-- Fase 04 · Cobertura mensal contra a amostra de referência (RF-04.17): pedido de apuração pelo SUPERADMIN.
-- O job `apurar_cobertura` roda no worker (também sozinho, no dia 1º de cada mês).

-- migrate:up
create function ops.solicitar_apuracao(p_mes date)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.is_superadmin() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_mes <> date_trunc('month', p_mes)::date then
    raise exception 'informe o primeiro dia do mês' using errcode = 'invalid_parameter_value';
  end if;
  perform ops.enfileirar('apurar_cobertura', null, jsonb_build_object('mes', p_mes::text),
                         'cobertura:' || p_mes::text || ':' || to_char(now(), 'YYYYMMDDHH24MI'));
end;
$$;
grant execute on function ops.solicitar_apuracao(date) to vv_api;
-- O worker precisa ler editais para conferir a amostra e gravar o resultado (grants já existem em
-- ops.cobertura_resultados e pub.editais).

-- migrate:down
drop function ops.solicitar_apuracao(date);
