-- Q-36b + Q-37 · fecha o padrão "não encontrado" (P0002 → 404) x "estado/validação" (22023 → 400) nas funções de fluxo
-- que restavam (modelos: 20261130100000_fluxo_nao_encontrado e 20261201100000_fluxo_estado_ausencia).
-- Q-36b: core.salvar_vinculo e core.revogar_convite davam o mesmo 42501 (e a mesma mensagem) para registro ausente, de
--        outra empresa ou sem permissoes:administrar_permissoes (e, no convite, já aceito ou revogado). Agora ausente,
--        de outra empresa ou sem permissão de administrar → no_data_found (a API devolve 404 sem revelar existência);
--        convite já aceito ou revogado → 22023. Os demais 42501 (step-up ausente, errado ou já usado; teto de concessão)
--        continuam 42501 (403, que abre o modal de reautenticação no app).
-- Q-37: aprovar_peca, descartar_peca, devolver_peca, enviar_revisao_peca, protocolar_peca, registrar_resultado_peca,
--       salvar_minuta, aprovar_proposta, conferir_proposta e devolver_proposta davam 22023 também para registro ausente
--       ou de outra empresa; agora checam a existência na empresa logo depois da permissão (mesmos filtros de
--       pedir_pdf_peca / pedir_pdf_proposta) e levantam no_data_found. O 22023 de estado continua igual.
-- Só muda o código (e a mensagem do erro de ausência). Regra de negócio, ordem de permissão, assinatura, security
-- definer, search_path, grants, RLS, has_permission e audit inalterados (create or replace preserva dono e grants).
-- Corpos vêm de pg_get_functiondef do banco com todas as migrations anteriores aplicadas.

-- migrate:up
CREATE OR REPLACE FUNCTION core.salvar_vinculo(p_vinculo uuid, p_papel text, p_ativo boolean, p_permissoes text[], p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'vínculo não encontrado' using errcode = 'no_data_found';
  end if;
  if p_papel is null or p_ativo is null then
    raise exception 'papel e situação são obrigatórios' using errcode = 'invalid_parameter_value';
  end if;
  perform core.validar_permissoes(p_papel, p_permissoes);
  perform core.validar_teto_concessao(v_empresa, p_vinculo, p_permissoes);
  -- Reativar um vínculo devolve todas as permissões dele: vale o teto sobre o conjunto inteiro (T2.4).
  if p_ativo and exists (select 1 from core.vinculos v where v.id = p_vinculo and not v.ativo) then
    perform core.validar_teto_concessao(v_empresa, null, p_permissoes);
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'salvar_vinculo:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  update core.vinculos set papel = p_papel, ativo = p_ativo
   where id = p_vinculo and (papel, ativo) is distinct from (p_papel, p_ativo);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), core.usuario_atual()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);

  -- Convites de quem deixou de administrar a empresa, ou que agora excedem o que o autor tem, caem junto.
  update core.convites c set revogado_em = now(), revogado_por = core.usuario_atual()
   where c.empresa_id = v_empresa and c.aceito_em is null and c.revogado_em is null
     and (not core.administra_empresa(c.criado_por, v_empresa)
          or not core.autor_cobre_convite(c.criado_por, v_empresa, c.permissoes));
end;
$function$;

CREATE OR REPLACE FUNCTION core.revogar_convite(p_convite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa uuid;
  v_decidido boolean;
begin
  select c.empresa_id, (c.aceito_em is not null or c.revogado_em is not null) into v_empresa, v_decidido
    from core.convites c where c.id = p_convite;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'convite não encontrado' using errcode = 'no_data_found';
  end if;
  if v_decidido then
    raise exception 'o convite já foi aceito ou revogado' using errcode = 'invalid_parameter_value';
  end if;
  update core.convites set revogado_em = now(), revogado_por = core.usuario_atual() where id = p_convite;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_peca(p_empresa uuid, p_id uuid, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null) then
    raise exception 'só se aprova uma peça em revisão, validada e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform core.exigir_step_up(p_step_up, 'aprovar_peca', p_empresa, 'peca:' || p_id);
  update priv.pecas set status = 'aprovada', revisado_por = core.usuario_atual(), revisado_em = now(), aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.descartar_peca(p_empresa uuid, p_id uuid, p_justificativa text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'o descarte exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa)
   where id = p_id and empresa_id = p_empresa and status in ('sugerida', 'triagem', 'minuta');
  if not found then
    raise exception 'só se descarta uma peça sugerida, em triagem ou em minuta' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.devolver_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.pecas set status = 'minuta', revisado_por = null, revisado_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('revisao', 'aprovada');
  if not found then
    raise exception 'só se devolve uma peça em revisão ou aprovada (a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.enviar_revisao_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.pecas set status = 'revisao' where id = p_id and empresa_id = p_empresa and status = 'minuta' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só vai à revisão uma minuta validada e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.protocolar_peca(p_empresa uuid, p_id uuid, p_numero text, p_quando timestamp with time zone, p_comprovante text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_evento uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  if char_length(btrim(coalesce(p_numero, ''))) < 2 or p_quando is null then
    raise exception 'informe o número do protocolo e a data e hora' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pecas set status = 'protocolada', protocolo_numero = btrim(p_numero), protocolado_em = p_quando, protocolado_por = core.usuario_atual(),
         comprovante = nullif(btrim(p_comprovante), '')
   where id = p_id and empresa_id = p_empresa and status = 'final' returning evento_id into v_evento;
  if not found then
    raise exception 'só se protocola uma peça com documento final' using errcode = 'invalid_parameter_value';
  end if;
  if v_evento is not null then
    update priv.agenda_eventos set status = 'protocolado' where id = v_evento and empresa_id = p_empresa and status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_resultado_peca(p_empresa uuid, p_id uuid, p_resultado text, p_obs text, p_quando timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.pecas set status = 'respondida', resultado = p_resultado, resultado_obs = nullif(btrim(p_obs), ''), resultado_em = coalesce(p_quando, now())
   where id = p_id and empresa_id = p_empresa and status = 'protocolada';
  if not found then
    raise exception 'só se registra resultado de uma peça protocolada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.salvar_minuta(p_empresa uuid, p_id uuid, p_minuta text, p_clausulas text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa) then
    raise exception 'peça não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.pecas set minuta = p_minuta, clausulas = nullif(btrim(p_clausulas), ''), status = 'minuta', elaborado_por = core.usuario_atual(),
         minuta_origem = case when minuta_origem = 'manual' then 'manual' else 'ia_revisada' end,
         validacao = null, validada_em = null, bloqueada = true, revisado_por = null, revisado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao');
  if not found then
    raise exception 'a minuta só se edita antes da aprovação' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_proposta(p_empresa uuid, p_id uuid, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada) then
    raise exception 'só se aprova uma proposta conferida e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform core.exigir_step_up(p_step_up, 'proposta_final', p_empresa, 'proposta:' || p_id);
  update priv.propostas set status = 'aprovada', aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.conferir_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.propostas set status = 'conferencia', conferido_por = core.usuario_atual(), conferido_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se confere um rascunho validado e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.devolver_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'proposta não encontrada' using errcode = 'no_data_found';
  end if;
  update priv.propostas set status = 'rascunho', conferido_por = null, conferido_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('conferencia', 'aprovada') and deleted_at is null;
  if not found then
    raise exception 'só se devolve uma proposta em conferência ou aprovada (e a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

-- migrate:down
-- Restaura os corpos vigentes antes desta migration (pg_get_functiondef de cada uma).
CREATE OR REPLACE FUNCTION core.salvar_vinculo(p_vinculo uuid, p_papel text, p_ativo boolean, p_permissoes text[], p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa uuid;
begin
  select v.empresa_id into v_empresa from core.vinculos v where v.id = p_vinculo and v.deleted_at is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'sem permissão para alterar este vínculo' using errcode = 'insufficient_privilege';
  end if;
  if p_papel is null or p_ativo is null then
    raise exception 'papel e situação são obrigatórios' using errcode = 'invalid_parameter_value';
  end if;
  perform core.validar_permissoes(p_papel, p_permissoes);
  perform core.validar_teto_concessao(v_empresa, p_vinculo, p_permissoes);
  -- Reativar um vínculo devolve todas as permissões dele: vale o teto sobre o conjunto inteiro (T2.4).
  if p_ativo and exists (select 1 from core.vinculos v where v.id = p_vinculo and not v.ativo) then
    perform core.validar_teto_concessao(v_empresa, null, p_permissoes);
  end if;
  perform core.consumir_step_up(p_step_up, 'alterar_permissoes', v_empresa, 'salvar_vinculo:' || p_vinculo);

  perform 1 from core.vinculos where empresa_id = v_empresa for update;

  delete from core.permissoes p
   where p.vinculo_id = p_vinculo and (p.modulo || ':' || p.acao) <> all (p_permissoes);

  update core.vinculos set papel = p_papel, ativo = p_ativo
   where id = p_vinculo and (papel, ativo) is distinct from (p_papel, p_ativo);

  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao, created_by)
  select distinct p_vinculo, v_empresa, split_part(x, ':', 1), split_part(x, ':', 2), core.usuario_atual()
    from unnest(p_permissoes) x
  on conflict (vinculo_id, modulo, acao) do nothing;

  perform core.garantir_admin(v_empresa);

  -- Convites de quem deixou de administrar a empresa, ou que agora excedem o que o autor tem, caem junto.
  update core.convites c set revogado_em = now(), revogado_por = core.usuario_atual()
   where c.empresa_id = v_empresa and c.aceito_em is null and c.revogado_em is null
     and (not core.administra_empresa(c.criado_por, v_empresa)
          or not core.autor_cobre_convite(c.criado_por, v_empresa, c.permissoes));
end;
$function$;

CREATE OR REPLACE FUNCTION core.revogar_convite(p_convite uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_empresa uuid;
begin
  select c.empresa_id into v_empresa from core.convites c
   where c.id = p_convite and c.aceito_em is null and c.revogado_em is null;
  if v_empresa is null or not core.has_permission(v_empresa, 'permissoes', 'administrar_permissoes') then
    raise exception 'convite inexistente, já decidido ou sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update core.convites set revogado_em = now(), revogado_por = core.usuario_atual() where id = p_convite;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_peca(p_empresa uuid, p_id uuid, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.pecas where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null) then
    raise exception 'só se aprova uma peça em revisão, validada e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform core.exigir_step_up(p_step_up, 'aprovar_peca', p_empresa, 'peca:' || p_id);
  update priv.pecas set status = 'aprovada', revisado_por = core.usuario_atual(), revisado_em = now(), aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.descartar_peca(p_empresa uuid, p_id uuid, p_justificativa text)
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
  update priv.pecas set status = 'descartada', justificativa_descarte = btrim(p_justificativa)
   where id = p_id and empresa_id = p_empresa and status in ('sugerida', 'triagem', 'minuta');
  if not found then
    raise exception 'só se descarta uma peça sugerida, em triagem ou em minuta' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.devolver_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.pecas set status = 'minuta', revisado_por = null, revisado_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('revisao', 'aprovada');
  if not found then
    raise exception 'só se devolve uma peça em revisão ou aprovada (a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.enviar_revisao_peca(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.pecas set status = 'revisao' where id = p_id and empresa_id = p_empresa and status = 'minuta' and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só vai à revisão uma minuta validada e sem citação fora da base verificada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.protocolar_peca(p_empresa uuid, p_id uuid, p_numero text, p_quando timestamp with time zone, p_comprovante text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_evento uuid;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_numero, ''))) < 2 or p_quando is null then
    raise exception 'informe o número do protocolo e a data e hora' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pecas set status = 'protocolada', protocolo_numero = btrim(p_numero), protocolado_em = p_quando, protocolado_por = core.usuario_atual(),
         comprovante = nullif(btrim(p_comprovante), '')
   where id = p_id and empresa_id = p_empresa and status = 'final' returning evento_id into v_evento;
  if not found then
    raise exception 'só se protocola uma peça com documento final' using errcode = 'invalid_parameter_value';
  end if;
  if v_evento is not null then
    update priv.agenda_eventos set status = 'protocolado' where id = v_evento and empresa_id = p_empresa and status in ('sugerido', 'em_elaboracao', 'em_revisao', 'aprovado');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.registrar_resultado_peca(p_empresa uuid, p_id uuid, p_resultado text, p_obs text, p_quando timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.pecas set status = 'respondida', resultado = p_resultado, resultado_obs = nullif(btrim(p_obs), ''), resultado_em = coalesce(p_quando, now())
   where id = p_id and empresa_id = p_empresa and status = 'protocolada';
  if not found then
    raise exception 'só se registra resultado de uma peça protocolada' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.salvar_minuta(p_empresa uuid, p_id uuid, p_minuta text, p_clausulas text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.pecas set minuta = p_minuta, clausulas = nullif(btrim(p_clausulas), ''), status = 'minuta', elaborado_por = core.usuario_atual(),
         minuta_origem = case when minuta_origem = 'manual' then 'manual' else 'ia_revisada' end,
         validacao = null, validada_em = null, bloqueada = true, revisado_por = null, revisado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('triagem', 'minuta', 'revisao');
  if not found then
    raise exception 'a minuta só se edita antes da aprovação' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.aprovar_proposta(p_empresa uuid, p_id uuid, p_step_up uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada) then
    raise exception 'só se aprova uma proposta conferida e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform core.exigir_step_up(p_step_up, 'proposta_final', p_empresa, 'proposta:' || p_id);
  update priv.propostas set status = 'aprovada', aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION priv.conferir_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'conferencia', conferido_por = core.usuario_atual(), conferido_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'rascunho' and deleted_at is null and validada_em is not null and not bloqueada;
  if not found then
    raise exception 'só se confere um rascunho validado e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION priv.devolver_proposta(p_empresa uuid, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not core.has_permission(p_empresa, 'propostas', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'rascunho', conferido_por = null, conferido_em = null, aprovado_por = null, aprovado_em = null
   where id = p_id and empresa_id = p_empresa and status in ('conferencia', 'aprovada') and deleted_at is null;
  if not found then
    raise exception 'só se devolve uma proposta em conferência ou aprovada (e a final é imutável)' using errcode = 'invalid_parameter_value';
  end if;
end;
$function$;
