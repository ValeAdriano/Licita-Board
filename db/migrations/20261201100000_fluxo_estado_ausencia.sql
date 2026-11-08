-- Q-34 + Q-35 · "não encontrado" (P0002 → 404) separado de "estado/validação" (22023 → 400), no padrão do Q-31b
-- (20261130100000_fluxo_nao_encontrado).
-- Q-34: descartar_sugestao, aprovar_tese e usar_tese davam 22023 também para registro ausente ou de outra empresa;
--       agora checam a existência na empresa logo depois da permissão e levantam no_data_found.
-- Q-35 (inverso): funções que davam no_data_found para registro existente no estado errado. Onde a mesma condição
--       misturava as duas coisas, a existência vira um "if not exists" próprio (P0002) e a condição de estado que já
--       existia passa a 22023: editar_tese, arquivar_tese, decidir_exclusao, abrir_pedido_contratual, concluir_upload,
--       confirmar_requisito, pedir_minuta_peca, pedir_pdf_peca, pedir_pdf_proposta, registrar_download,
--       registrar_download_edital, registrar_empenho, registrar_falha_atualizacao, registrar_verificacao,
--       salvar_proposta, solicitar_coleta_manual. definir_modelo_ia e pedir_teste_chave_ia ("cadastre a chave
--       primeiro": a empresa existe, falta configurar) só trocam o código.
-- Só muda o código (e a mensagem, onde ela dizia "não encontrado" para um erro de estado). Regra de negócio, ordem de
-- permissão, filtros de existência (os mesmos do corpo anterior), assinatura, security definer, search_path, grants,
-- RLS, has_permission e audit inalterados (create or replace preserva dono e grants). Cabeçalhos e corpos vêm de
-- pg_get_functiondef do banco com todas as migrations anteriores aplicadas.

-- migrate:up
CREATE OR REPLACE FUNCTION priv.descartar_sugestao(p_empresa uuid, p_id uuid, p_justificativa text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.sugestoes_pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'sugestão não encontrada' using errcode = 'no_data_found';
  end if;
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'o descarte exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.sugestoes_pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa), decidida_por = core.usuario_atual(), decidida_em = now()
   where id = p_id and empresa_id = p_empresa and status in ('nova', 'intempestiva');
  if not found then
    raise exception 'só se descarta uma sugestão nova ou intempestiva' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_tese(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.teses where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.teses set status = 'aprovada', aprovada_por = core.usuario_atual(), aprovada_em = now()
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status = 'rascunho' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se aprova uma tese em rascunho, conferida e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.usar_tese(p_empresa uuid, p_peca uuid, p_tese uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.teses where id = p_tese and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao')) then
    raise exception 'a tese só se usa numa peça em triagem, minuta ou revisão' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.teses t join priv.pecas p on p.tipo = t.tipo_peca
                  where t.id = p_tese and t.empresa_id = p_empresa and t.deleted_at is null and t.status = 'aprovada' and p.id = p_peca) then
    raise exception 'só se usa uma tese aprovada e do mesmo tipo da peça' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.peca_teses (empresa_id, peca_id, tese_id) values (p_empresa, p_peca, p_tese) on conflict (peca_id, tese_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.editar_tese(p_empresa uuid, p_id uuid, p_titulo text, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.teses where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.teses set titulo = btrim(p_titulo), texto = btrim(p_texto), status = 'rascunho', aprovada_por = null, aprovada_em = null,
         validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status in ('rascunho', 'aprovada');
  if not found then
    raise exception 'tese arquivada não se edita' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_tese(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.arquivar_tese(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.teses where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.teses set status = 'arquivada' where id = p_id and empresa_id = p_empresa and deleted_at is null and status <> 'arquivada';
  if not found then
    raise exception 'a tese já está arquivada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION core.decidir_exclusao(p_aprovacao uuid, p_aprovar boolean, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ap core.aprovacoes_exclusao;
begin
  if not core.is_superadmin() then
    raise exception 'só SUPERADMIN decide exclusão definitiva' using errcode = 'insufficient_privilege';
  end if;
  if p_aprovar is null then
    raise exception 'informe aprovar (true) ou rejeitar (false)' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_ap from core.aprovacoes_exclusao where id = p_aprovacao for update;
  if v_ap.id is null then
    raise exception 'pedido de exclusão inexistente' using errcode = 'no_data_found';
  end if;
  if v_ap.status <> 'pendente' then
    raise exception 'pedido de exclusão já decidido' using errcode = 'invalid_parameter_value';
  end if;
  if v_ap.solicitado_por = core.usuario_atual() then
    raise exception 'quem solicitou não pode aprovar a própria exclusão (dupla aprovação)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_ap.expira_em <= now() then
    raise exception 'pedido de exclusão expirado' using errcode = 'insufficient_privilege';
  end if;
  -- Pedido de conta que perdeu o SUPERADMIN (ou foi desativada) não pode mais ser aprovado.
  if p_aprovar and not exists (
    select 1 from core.usuarios u
     where u.id = v_ap.solicitado_por and u.superadmin and u.ativo and u.deleted_at is null
  ) then
    raise exception 'solicitante não é mais SUPERADMIN ativo; rejeite o pedido' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'exclusao_definitiva', null, 'decidir_exclusao:' || p_aprovacao);

  if p_aprovar then
    perform core.executar_exclusao(v_ap.alvo_tabela, v_ap.alvo_id);
  end if;

  update core.aprovacoes_exclusao
     set status = case when p_aprovar then 'executada' else 'rejeitada' end,
         decidido_por = core.usuario_atual(),
         decidido_em = now()
   where id = p_aprovacao;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.abrir_pedido_contratual(p_empresa uuid, p_contrato uuid, p_tipo text, p_titulo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acomp uuid;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('reajuste', 'reequilibrio') then
    raise exception 'tipo de pedido inválido' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'contrato não encontrado' using errcode = 'no_data_found';
  end if;
  select acompanhamento_id into v_acomp from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo';
  if not found then
    raise exception 'só se abre pedido de um contrato ativo' using errcode = 'invalid_parameter_value';
  end if;
  if v_acomp is null then
    raise exception 'o pedido jurídico precisa do edital do contrato: cadastre o contrato a partir do resultado contratado' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pecas (empresa_id, acompanhamento_id, contrato_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_acomp, p_contrato, p_tipo, btrim(p_titulo), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.concluir_upload(p_empresa uuid, p_versao uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (core.has_permission(p_empresa, 'documentos', 'cadastrar') or core.has_permission(p_empresa, 'documentos', 'substituir_arquivos')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.documento_versoes where id = p_versao and empresa_id = p_empresa) then
    raise exception 'versão não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.documento_versoes set enviado_em = now()
   where id = p_versao and empresa_id = p_empresa and status_arquivo = 'quarentena' and enviado_em is null;
  if not found then
    raise exception 'versão já enviada ou fora da quarentena' using errcode = 'invalid_parameter_value';
  end if;
  perform ops.enfileirar('verificar_arquivo', p_empresa, jsonb_build_object('versao_id', p_versao), 'verificar:' || p_versao);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.confirmar_requisito(p_empresa uuid, p_requisito uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_part uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.requisitos_item where id = p_requisito and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'requisito não encontrado' using errcode = 'no_data_found';
  end if;
  update priv.requisitos_item set confirmado_por = core.usuario_atual(), confirmado_em = now()
   where id = p_requisito and empresa_id = p_empresa and deleted_at is null and confirmado_em is null returning participacao_id into v_part;
  if not found then
    raise exception 'requisito já confirmado' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.reanalisar_participacao(p_empresa, v_part);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.definir_modelo_ia(p_empresa uuid, p_modelo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set modelo = p_modelo, atualizada_por = core.usuario_atual(), atualizada_em = now() where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_teste_chave_ia(p_empresa uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set teste_status = 'pendente', teste_erro = null, teste_em = null where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'invalid_parameter_value';
  end if;
  perform ops.enfileirar('testar_chave_ia', p_empresa, jsonb_build_object('empresa_id', p_empresa), 'testeia:' || p_empresa || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_minuta_peca(p_empresa uuid, p_peca uuid, p_instrucao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta')) then
    raise exception 'a IA só minuta uma peça em triagem ou minuta (antes da revisão)' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from priv.pecas_ia where peca_id = p_peca and status = 'pendente' and created_at > now() - interval '15 minutes') then
    raise exception 'já há uma minuta em andamento para esta peça' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from priv.pecas_ia where peca_id = p_peca and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite de minutas por peça atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  insert into priv.pecas_ia (empresa_id, peca_id, instrucao) values (p_empresa, p_peca, nullif(btrim(p_instrucao), '')) returning id into v_id;
  perform ops.enfileirar('minutar_peca', p_empresa, jsonb_build_object('minuta_id', v_id), 'minuta:' || v_id);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_pdf_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa and status in ('final', 'protocolada', 'respondida')) then
    raise exception 'só a peça com documento final tem PDF' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_pdf_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and status = 'final' and deleted_at is null) then
    raise exception 'só a proposta final tem PDF' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_download(p_empresa uuid, p_versao uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.documento_versoes where id = p_versao and empresa_id = p_empresa) then
    raise exception 'versão não encontrada' using errcode = 'no_data_found';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and empresa_id = p_empresa and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível (em verificação ou bloqueado)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.documento_downloads (documento_id, empresa_id, versao_id, usuario_id, ip)
  values (v.documento_id, p_empresa, p_versao, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION pub.registrar_download_edital(p_arquivo uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not core.pode_ver_editais() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from pub.edital_arquivos where id = p_arquivo) then
    raise exception 'arquivo não encontrado' using errcode = 'no_data_found';
  end if;
  select id, arquivo_chave into v from pub.edital_arquivos where id = p_arquivo and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível (em verificação ou bloqueado)' using errcode = 'invalid_parameter_value';
  end if;
  insert into ops.edital_downloads (arquivo_id, usuario_id, ip) values (p_arquivo, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_empenho(p_empresa uuid, p_contrato uuid, p_tipo text, p_numero text, p_emitido date, p_prazo date, p_responsavel uuid, p_itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_it record;
  v_saldo numeric;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'contrato não encontrado' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo') then
    raise exception 'só se registra empenho de um contrato ativo' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'informe ao menos um item' using errcode = 'invalid_parameter_value'; end if;
  insert into priv.empenhos (empresa_id, contrato_id, tipo, numero, emitido_em, prazo_entrega, responsavel_id) values (p_empresa, p_contrato, p_tipo, btrim(p_numero), p_emitido, p_prazo, p_responsavel) returning id into v_id;
  insert into priv.empenho_etapas (empresa_id, empenho_id, etapa) values (p_empresa, v_id, 'pedido_recebido');
  for v_it in select (x ->> 'contrato_item_id')::uuid as item, (x ->> 'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) x loop
    select ci.quantidade - coalesce((select sum(ei.quantidade) from priv.empenho_itens ei where ei.contrato_item_id = ci.id), 0) into v_saldo
      from priv.contrato_itens ci where ci.id = v_it.item and ci.empresa_id = p_empresa and ci.contrato_id = p_contrato;
    if v_saldo is null then raise exception 'item não pertence ao contrato' using errcode = 'invalid_parameter_value'; end if;
    if v_it.qtd is null or v_it.qtd <= 0 or v_it.qtd > v_saldo then raise exception 'quantidade acima do saldo do contrato (saldo %)', v_saldo using errcode = 'invalid_parameter_value'; end if;
    insert into priv.empenho_itens (empresa_id, empenho_id, contrato_item_id, quantidade) values (p_empresa, v_id, v_it.item, v_it.qtd);
  end loop;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_falha_atualizacao(p_empresa uuid, p_pendencia uuid, p_detalhe text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_doc uuid;
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.documento_pendencias where id = p_pendencia and empresa_id = p_empresa) then
    raise exception 'pendência não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.documento_pendencias
     set status = 'resolvida', resultado = 'falha', resolvida_em = now(), detalhe = left(p_detalhe, 500)
   where id = p_pendencia and empresa_id = p_empresa and status = 'aberta'
   returning documento_id into v_doc;
  if not found then
    raise exception 'pendência já resolvida' using errcode = 'invalid_parameter_value';
  end if;
  update priv.documentos set em_atualizacao = false where id = v_doc;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_verificacao(p_versao uuid, p_status text, p_tipo_real text, p_tamanho bigint, p_sha256 text, p_motivo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_chave text;
begin
  if p_status not in ('liberado', 'bloqueado') then
    raise exception 'status inválido' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.documento_versoes where id = p_versao) then
    raise exception 'versão não encontrada' using errcode = 'no_data_found';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and status_arquivo = 'quarentena' for update;
  if not found then
    raise exception 'versão não está em quarentena' using errcode = 'invalid_parameter_value';
  end if;
  v_chave := case when p_status = 'liberado'
                  then 'documentos/' || v.empresa_id || '/' || v.documento_id || '/' || v.versao else v.arquivo_chave end;
  update priv.documento_versoes
     set status_arquivo = p_status, tipo_real = p_tipo_real, tamanho = p_tamanho, sha256 = p_sha256,
         motivo_bloqueio = case when p_status = 'bloqueado' then left(p_motivo, 300) end, arquivo_chave = v_chave
   where id = p_versao;
  return v_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.salvar_proposta(p_empresa uuid, p_id uuid, p_representante uuid, p_validade integer, p_prazo integer, p_garantia integer, p_condicoes text, p_local text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.propostas
     set representante_id = p_representante, validade_dias = p_validade, prazo_entrega_dias = p_prazo, garantia_meses = p_garantia,
         condicoes = nullif(btrim(p_condicoes), ''), local_assinatura = nullif(btrim(p_local), ''), validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null;
  if not found then
    raise exception 'só se edita uma proposta em rascunho' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION ops.solicitar_coleta_manual(p_empresa uuid, p_fonte text, p_inicio date, p_fim date, p_uf text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fonte uuid;
  v_id uuid := core.uuid_v7();
begin
  if not (core.is_superadmin() or core.has_permission(p_empresa, 'editais', 'cadastrar')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 31 then
    raise exception 'período inválido (até 31 dias)' using errcode = 'invalid_parameter_value';
  end if;
  if p_uf is not null and p_uf !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from ops.execucoes where tipo = 'manual' and solicitada_por = core.usuario_atual()
                                              and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'limite de pesquisas manuais por hora atingido' using errcode = 'program_limit_exceeded';
  end if;
  if not exists (select 1 from ops.fontes where slug = p_fonte) then
    raise exception 'fonte inexistente' using errcode = 'no_data_found';
  end if;
  select id into v_fonte from ops.fontes where slug = p_fonte and ativa;
  if v_fonte is null then
    raise exception 'fonte desativada' using errcode = 'invalid_parameter_value';
  end if;
  insert into ops.execucoes (id, fonte_id, tipo, agendada_para, janela_ini, janela_fim, solicitada_por, detalhe)
  values (v_id, v_fonte, 'manual', now(), p_inicio::timestamptz, (p_fim + 1)::timestamptz, core.usuario_atual(),
          jsonb_build_object('uf', p_uf));
  perform ops.enfileirar('coletar_fonte', null, jsonb_build_object('execucao_id', v_id), 'coleta_manual:' || v_id);
  return v_id;
end;
$function$;

-- migrate:down
-- Restaura os corpos vigentes antes desta migration (pg_get_functiondef de cada uma).
CREATE OR REPLACE FUNCTION priv.descartar_sugestao(p_empresa uuid, p_id uuid, p_justificativa text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'o descarte exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.sugestoes_pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa), decidida_por = core.usuario_atual(), decidida_em = now()
   where id = p_id and empresa_id = p_empresa and status in ('nova', 'intempestiva');
  if not found then
    raise exception 'só se descarta uma sugestão nova ou intempestiva' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_tese(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set status = 'aprovada', aprovada_por = core.usuario_atual(), aprovada_em = now()
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status = 'rascunho' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se aprova uma tese em rascunho, conferida e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.usar_tese(p_empresa uuid, p_peca uuid, p_tese uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao')) then
    raise exception 'a tese só se usa numa peça em triagem, minuta ou revisão' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.teses t join priv.pecas p on p.tipo = t.tipo_peca
                  where t.id = p_tese and t.empresa_id = p_empresa and t.deleted_at is null and t.status = 'aprovada' and p.id = p_peca) then
    raise exception 'só se usa uma tese aprovada e do mesmo tipo da peça' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.peca_teses (empresa_id, peca_id, tese_id) values (p_empresa, p_peca, p_tese) on conflict (peca_id, tese_id) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.editar_tese(p_empresa uuid, p_id uuid, p_titulo text, p_texto text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set titulo = btrim(p_titulo), texto = btrim(p_texto), status = 'rascunho', aprovada_por = null, aprovada_em = null,
         validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and deleted_at is null and status in ('rascunho', 'aprovada');
  if not found then
    raise exception 'tese não encontrada ou arquivada' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_tese(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.arquivar_tese(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.teses set status = 'arquivada' where id = p_id and empresa_id = p_empresa and deleted_at is null and status <> 'arquivada';
  if not found then
    raise exception 'tese não encontrada' using errcode = 'no_data_found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION core.decidir_exclusao(p_aprovacao uuid, p_aprovar boolean, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ap core.aprovacoes_exclusao;
begin
  if not core.is_superadmin() then
    raise exception 'só SUPERADMIN decide exclusão definitiva' using errcode = 'insufficient_privilege';
  end if;
  if p_aprovar is null then
    raise exception 'informe aprovar (true) ou rejeitar (false)' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_ap from core.aprovacoes_exclusao where id = p_aprovacao for update;
  if v_ap.id is null or v_ap.status <> 'pendente' then
    raise exception 'pedido de exclusão inexistente ou já decidido' using errcode = 'no_data_found';
  end if;
  if v_ap.solicitado_por = core.usuario_atual() then
    raise exception 'quem solicitou não pode aprovar a própria exclusão (dupla aprovação)'
      using errcode = 'insufficient_privilege';
  end if;
  if v_ap.expira_em <= now() then
    raise exception 'pedido de exclusão expirado' using errcode = 'insufficient_privilege';
  end if;
  -- Pedido de conta que perdeu o SUPERADMIN (ou foi desativada) não pode mais ser aprovado.
  if p_aprovar and not exists (
    select 1 from core.usuarios u
     where u.id = v_ap.solicitado_por and u.superadmin and u.ativo and u.deleted_at is null
  ) then
    raise exception 'solicitante não é mais SUPERADMIN ativo; rejeite o pedido' using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_step_up, 'exclusao_definitiva', null, 'decidir_exclusao:' || p_aprovacao);

  if p_aprovar then
    perform core.executar_exclusao(v_ap.alvo_tabela, v_ap.alvo_id);
  end if;

  update core.aprovacoes_exclusao
     set status = case when p_aprovar then 'executada' else 'rejeitada' end,
         decidido_por = core.usuario_atual(),
         decidido_em = now()
   where id = p_aprovacao;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.abrir_pedido_contratual(p_empresa uuid, p_contrato uuid, p_tipo text, p_titulo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acomp uuid;
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo not in ('reajuste', 'reequilibrio') then
    raise exception 'tipo de pedido inválido' using errcode = 'invalid_parameter_value';
  end if;
  select acompanhamento_id into v_acomp from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo';
  if not found then
    raise exception 'contrato ativo não encontrado' using errcode = 'no_data_found';
  end if;
  if v_acomp is null then
    raise exception 'o pedido jurídico precisa do edital do contrato: cadastre o contrato a partir do resultado contratado' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.pecas (empresa_id, acompanhamento_id, contrato_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_acomp, p_contrato, p_tipo, btrim(p_titulo), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.concluir_upload(p_empresa uuid, p_versao uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (core.has_permission(p_empresa, 'documentos', 'cadastrar') or core.has_permission(p_empresa, 'documentos', 'substituir_arquivos')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.documento_versoes set enviado_em = now()
   where id = p_versao and empresa_id = p_empresa and status_arquivo = 'quarentena' and enviado_em is null;
  if not found then
    raise exception 'versão não encontrada ou já enviada' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('verificar_arquivo', p_empresa, jsonb_build_object('versao_id', p_versao), 'verificar:' || p_versao);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.confirmar_requisito(p_empresa uuid, p_requisito uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_part uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.requisitos_item set confirmado_por = core.usuario_atual(), confirmado_em = now()
   where id = p_requisito and empresa_id = p_empresa and deleted_at is null and confirmado_em is null returning participacao_id into v_part;
  if not found then
    raise exception 'requisito não encontrado ou já confirmado' using errcode = 'no_data_found';
  end if;
  perform priv.reanalisar_participacao(p_empresa, v_part);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.definir_modelo_ia(p_empresa uuid, p_modelo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set modelo = p_modelo, atualizada_por = core.usuario_atual(), atualizada_em = now() where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'no_data_found';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_teste_chave_ia(p_empresa uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'configuracoes', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.empresa_ia set teste_status = 'pendente', teste_erro = null, teste_em = null where empresa_id = p_empresa;
  if not found then
    raise exception 'cadastre a chave primeiro' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('testar_chave_ia', p_empresa, jsonb_build_object('empresa_id', p_empresa), 'testeia:' || p_empresa || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_minuta_peca(p_empresa uuid, p_peca uuid, p_instrucao text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_peca and empresa_id = p_empresa and status in ('triagem', 'minuta')) then
    raise exception 'a IA só minuta uma peça em triagem ou minuta (antes da revisão)' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from priv.pecas_ia where peca_id = p_peca and status = 'pendente' and created_at > now() - interval '15 minutes') then
    raise exception 'já há uma minuta em andamento para esta peça' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from priv.pecas_ia where peca_id = p_peca and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite de minutas por peça atingido hoje (controle de custo)' using errcode = '54000';
  end if;
  insert into priv.pecas_ia (empresa_id, peca_id, instrucao) values (p_empresa, p_peca, nullif(btrim(p_instrucao), '')) returning id into v_id;
  perform ops.enfileirar('minutar_peca', p_empresa, jsonb_build_object('minuta_id', v_id), 'minuta:' || v_id);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_pdf_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa and status in ('final', 'protocolada', 'respondida')) then
    raise exception 'só a peça com documento final tem PDF' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.pedir_pdf_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and status = 'final' and deleted_at is null) then
    raise exception 'só a proposta final tem PDF' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_download(p_empresa uuid, p_versao uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'documentos', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and empresa_id = p_empresa and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível' using errcode = 'no_data_found';
  end if;
  insert into priv.documento_downloads (documento_id, empresa_id, versao_id, usuario_id, ip)
  values (v.documento_id, p_empresa, p_versao, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION pub.registrar_download_edital(p_arquivo uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
begin
  if not core.pode_ver_editais() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, arquivo_chave into v from pub.edital_arquivos where id = p_arquivo and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível' using errcode = 'no_data_found';
  end if;
  insert into ops.edital_downloads (arquivo_id, usuario_id, ip) values (p_arquivo, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_empenho(p_empresa uuid, p_contrato uuid, p_tipo text, p_numero text, p_emitido date, p_prazo date, p_responsavel uuid, p_itens jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_it record;
  v_saldo numeric;
begin
  if not core.has_permission(p_empresa, 'contratos', 'editar') then raise exception 'sem permissão' using errcode = 'insufficient_privilege'; end if;
  if not exists (select 1 from priv.contratos where id = p_contrato and empresa_id = p_empresa and deleted_at is null and status = 'ativo') then
    raise exception 'contrato ativo não encontrado' using errcode = 'no_data_found';
  end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'informe ao menos um item' using errcode = 'invalid_parameter_value'; end if;
  insert into priv.empenhos (empresa_id, contrato_id, tipo, numero, emitido_em, prazo_entrega, responsavel_id) values (p_empresa, p_contrato, p_tipo, btrim(p_numero), p_emitido, p_prazo, p_responsavel) returning id into v_id;
  insert into priv.empenho_etapas (empresa_id, empenho_id, etapa) values (p_empresa, v_id, 'pedido_recebido');
  for v_it in select (x ->> 'contrato_item_id')::uuid as item, (x ->> 'quantidade')::numeric as qtd from jsonb_array_elements(p_itens) x loop
    select ci.quantidade - coalesce((select sum(ei.quantidade) from priv.empenho_itens ei where ei.contrato_item_id = ci.id), 0) into v_saldo
      from priv.contrato_itens ci where ci.id = v_it.item and ci.empresa_id = p_empresa and ci.contrato_id = p_contrato;
    if v_saldo is null then raise exception 'item não pertence ao contrato' using errcode = 'invalid_parameter_value'; end if;
    if v_it.qtd is null or v_it.qtd <= 0 or v_it.qtd > v_saldo then raise exception 'quantidade acima do saldo do contrato (saldo %)', v_saldo using errcode = 'invalid_parameter_value'; end if;
    insert into priv.empenho_itens (empresa_id, empenho_id, contrato_item_id, quantidade) values (p_empresa, v_id, v_it.item, v_it.qtd);
  end loop;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_falha_atualizacao(p_empresa uuid, p_pendencia uuid, p_detalhe text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_doc uuid;
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.documento_pendencias
     set status = 'resolvida', resultado = 'falha', resolvida_em = now(), detalhe = left(p_detalhe, 500)
   where id = p_pendencia and empresa_id = p_empresa and status = 'aberta'
   returning documento_id into v_doc;
  if not found then
    raise exception 'pendência não encontrada ou já resolvida' using errcode = 'no_data_found';
  end if;
  update priv.documentos set em_atualizacao = false where id = v_doc;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_verificacao(p_versao uuid, p_status text, p_tipo_real text, p_tamanho bigint, p_sha256 text, p_motivo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v record;
  v_chave text;
begin
  if p_status not in ('liberado', 'bloqueado') then
    raise exception 'status inválido' using errcode = 'invalid_parameter_value';
  end if;
  select * into v from priv.documento_versoes where id = p_versao and status_arquivo = 'quarentena' for update;
  if not found then
    raise exception 'versão não está em quarentena' using errcode = 'no_data_found';
  end if;
  v_chave := case when p_status = 'liberado'
                  then 'documentos/' || v.empresa_id || '/' || v.documento_id || '/' || v.versao else v.arquivo_chave end;
  update priv.documento_versoes
     set status_arquivo = p_status, tipo_real = p_tipo_real, tamanho = p_tamanho, sha256 = p_sha256,
         motivo_bloqueio = case when p_status = 'bloqueado' then left(p_motivo, 300) end, arquivo_chave = v_chave
   where id = p_versao;
  return v_chave;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.salvar_proposta(p_empresa uuid, p_id uuid, p_representante uuid, p_validade integer, p_prazo integer, p_garantia integer, p_condicoes text, p_local text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'cadastrar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas
     set representante_id = p_representante, validade_dias = p_validade, prazo_entrega_dias = p_prazo, garantia_meses = p_garantia,
         condicoes = nullif(btrim(p_condicoes), ''), local_assinatura = nullif(btrim(p_local), ''), validacao = null, validada_em = null, bloqueada = true
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null;
  if not found then
    raise exception 'só se edita um rascunho existente' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION ops.solicitar_coleta_manual(p_empresa uuid, p_fonte text, p_inicio date, p_fim date, p_uf text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fonte uuid;
  v_id uuid := core.uuid_v7();
begin
  if not (core.is_superadmin() or core.has_permission(p_empresa, 'editais', 'cadastrar')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_inicio is null or p_fim is null or p_fim < p_inicio or p_fim - p_inicio > 31 then
    raise exception 'período inválido (até 31 dias)' using errcode = 'invalid_parameter_value';
  end if;
  if p_uf is not null and p_uf !~ '^[A-Z]{2}$' then
    raise exception 'UF inválida' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from ops.execucoes where tipo = 'manual' and solicitada_por = core.usuario_atual()
                                              and created_at > now() - interval '1 hour') >= 6 then
    raise exception 'limite de pesquisas manuais por hora atingido' using errcode = 'program_limit_exceeded';
  end if;
  select id into v_fonte from ops.fontes where slug = p_fonte and ativa;
  if v_fonte is null then
    raise exception 'fonte inexistente ou desativada' using errcode = 'no_data_found';
  end if;
  insert into ops.execucoes (id, fonte_id, tipo, agendada_para, janela_ini, janela_fim, solicitada_por, detalhe)
  values (v_id, v_fonte, 'manual', now(), p_inicio::timestamptz, (p_fim + 1)::timestamptz, core.usuario_atual(),
          jsonb_build_object('uf', p_uf));
  perform ops.enfileirar('coletar_fonte', null, jsonb_build_object('execucao_id', v_id), 'coleta_manual:' || v_id);
  return v_id;
end;
$function$;
