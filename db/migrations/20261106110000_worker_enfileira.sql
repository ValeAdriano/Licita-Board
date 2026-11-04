-- Fase 04 · O agendador e as etapas da pesquisa (coletar, detalhar, baixar, extrair, avaliar) rodam no worker
-- e encadeiam jobs. ops.enfileirar é interna (sem grant); o worker usa este invólucro, que só aceita os tipos
-- da pesquisa: um worker comprometido não consegue, por aqui, forjar e-mail de recuperação nem push.

-- migrate:up
create function ops.enfileirar_pesquisa(p_tipo text, p_empresa uuid, p_payload jsonb, p_chave text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tipo not in ('coletar_fonte', 'detalhar_edital', 'baixar_arquivo_edital', 'verificar_arquivo_edital',
                    'extrair_texto', 'indexar_trechos', 'avaliar_relevancia', 'importar_edital',
                    'apurar_cobertura', 'email_operacional') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;
revoke all on function ops.enfileirar_pesquisa(text, uuid, jsonb, text) from public;
grant execute on function ops.enfileirar_pesquisa(text, uuid, jsonb, text) to vv_worker;

-- migrate:down
drop function ops.enfileirar_pesquisa(text, uuid, jsonb, text);
