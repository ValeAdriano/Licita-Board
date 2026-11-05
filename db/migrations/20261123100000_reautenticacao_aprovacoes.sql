-- Reautenticação (step-up) nas aprovações críticas (Prompt Mestre 7/8/10; S5 do roadmap): aprovar peça jurídica ('aprovar_peca'), aprovar proposta
-- final ('proposta_final') e aprovar preço ABAIXO do mínimo ('preco_abaixo_minimo'). Exige o token de uso único gerado com TOTP novo (core.iniciar_step_up).
-- Só na CHAVE DE DESENVOLVIMENTO do ADR-021 (vv.mfa = 'opcional') quem NÃO cadastrou autenticador dispensa o token; quem cadastrou continua
-- precisando dele. Produção não tem a chave. As versões antigas (sem token) são removidas: nada contorna a exigência.

-- migrate:up
create function core.exigir_step_up(p_token uuid, p_escopo text, p_empresa uuid, p_alvo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if current_setting('vv.mfa', true) is not distinct from 'opcional' and not core.tem_mfa() then
    return;
  end if;
  if p_token is null then
    raise exception 'esta aprovação exige reautenticação com o código do autenticador (%)', p_escopo using errcode = 'insufficient_privilege';
  end if;
  perform core.consumir_step_up(p_token, p_escopo, p_empresa, p_alvo);
end;
$$;
grant execute on function core.exigir_step_up(uuid, text, uuid, text) to vv_api;

drop function priv.aprovar_peca(uuid, uuid);
create function priv.aprovar_peca(p_empresa uuid, p_id uuid, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;
grant execute on function priv.aprovar_peca(uuid, uuid, uuid) to vv_api;

drop function priv.aprovar_proposta(uuid, uuid);
create function priv.aprovar_proposta(p_empresa uuid, p_id uuid, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;
grant execute on function priv.aprovar_proposta(uuid, uuid, uuid) to vv_api;

drop function priv.aprovar_preco(uuid, uuid, text);
create function priv.aprovar_preco(p_empresa uuid, p_id uuid, p_justificativa text, p_step_up uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'precos', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select calculado_em, erro_calculo, abaixo_do_minimo into v from priv.precificacoes where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'precificação não encontrada' using errcode = 'no_data_found';
  end if;
  if v.calculado_em is null or v.erro_calculo is not null then
    raise exception 'só se aprova um preço calculado sem erro' using errcode = 'invalid_parameter_value';
  end if;
  if v.abaixo_do_minimo and char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'preço abaixo do mínimo exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  if v.abaixo_do_minimo then
    perform core.exigir_step_up(p_step_up, 'preco_abaixo_minimo', p_empresa, 'preco:' || p_id);
  end if;
  update priv.precificacoes
     set aprovado_por = core.usuario_atual(), aprovado_em = now(), justificativa_abaixo = case when v.abaixo_do_minimo then btrim(p_justificativa) end
   where id = p_id;
end;
$$;
grant execute on function priv.aprovar_preco(uuid, uuid, text, uuid) to vv_api;

-- migrate:down
-- Restaura as versões anteriores (sem token), como nas migrations 20261117100000, 20261112100000 e 20261111100000.
drop function priv.aprovar_preco(uuid, uuid, text, uuid);
drop function priv.aprovar_proposta(uuid, uuid, uuid);
drop function priv.aprovar_peca(uuid, uuid, uuid);
drop function core.exigir_step_up(uuid, text, uuid, text);

create function priv.aprovar_peca(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'juridico', 'aprovar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.pecas set status = 'aprovada', revisado_por = core.usuario_atual(), revisado_em = now(), aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'revisao' and not bloqueada and validada_em is not null;
  if not found then
    raise exception 'só se aprova uma peça em revisão, validada e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_peca(p_empresa, p_id);
end;
$$;
grant execute on function priv.aprovar_peca(uuid, uuid) to vv_api;

create function priv.aprovar_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.propostas set status = 'aprovada', aprovado_por = core.usuario_atual(), aprovado_em = now()
   where id = p_id and empresa_id = p_empresa and status = 'conferencia' and deleted_at is null and not bloqueada;
  if not found then
    raise exception 'só se aprova uma proposta conferida e sem divergência bloqueante' using errcode = 'invalid_parameter_value';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$$;
grant execute on function priv.aprovar_proposta(uuid, uuid) to vv_api;

create function priv.aprovar_preco(p_empresa uuid, p_id uuid, p_justificativa text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.has_permission(p_empresa, 'precos', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select calculado_em, erro_calculo, abaixo_do_minimo into v from priv.precificacoes where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'precificação não encontrada' using errcode = 'no_data_found';
  end if;
  if v.calculado_em is null or v.erro_calculo is not null then
    raise exception 'só se aprova um preço calculado sem erro' using errcode = 'invalid_parameter_value';
  end if;
  if v.abaixo_do_minimo and char_length(btrim(coalesce(p_justificativa, ''))) < 10 then
    raise exception 'preço abaixo do mínimo exige justificativa (mínimo 10 caracteres)' using errcode = 'invalid_parameter_value';
  end if;
  update priv.precificacoes
     set aprovado_por = core.usuario_atual(), aprovado_em = now(), justificativa_abaixo = case when v.abaixo_do_minimo then btrim(p_justificativa) end
   where id = p_id;
end;
$$;
grant execute on function priv.aprovar_preco(uuid, uuid, text) to vv_api;
