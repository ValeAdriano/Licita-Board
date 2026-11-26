-- Q-44 · Pedido de reajuste/reequilíbrio também para contrato sem edital (cadastrado à mão, sem acompanhamento).
-- A peça de pedido passa a poder existir só ligada ao contrato: priv.pecas.acompanhamento_id fica opcional, mas só para
-- reajuste/reequilíbrio com contrato (as demais peças continuam exigindo o acompanhamento do edital).
-- O worker passa a ler SÓ número e órgão do contrato (cabeçalho do documento final), nunca valores.
-- ⚖️ Nada muda no mérito: o sistema não calcula índice nem decide o direito ao reequilíbrio.

-- migrate:up
alter table priv.pecas alter column acompanhamento_id drop not null;
alter table priv.pecas add constraint pecas_origem_ck
  check (acompanhamento_id is not null or (contrato_id is not null and tipo in ('reajuste', 'reequilibrio')));

grant select (id, empresa_id, numero, orgao) on priv.contratos to vv_worker;

create or replace function priv.abrir_pedido_contratual(p_empresa uuid, p_contrato uuid, p_tipo text, p_titulo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
  -- Sem edital (contrato cadastrado à mão), a peça fica ligada só ao contrato.
  insert into priv.pecas (empresa_id, acompanhamento_id, contrato_id, tipo, titulo, status, triado_por, triado_em, elaborado_por)
  values (p_empresa, v_acomp, p_contrato, p_tipo, btrim(p_titulo), 'triagem', core.usuario_atual(), now(), core.usuario_atual())
  returning id into v_id;
  return v_id;
end;
$$;

-- migrate:down
-- Falha de propósito se já houver peça sem acompanhamento: apague-as (ou ligue ao acompanhamento) antes de voltar.
create or replace function priv.abrir_pedido_contratual(p_empresa uuid, p_contrato uuid, p_tipo text, p_titulo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;
revoke select (id, empresa_id, numero, orgao) on priv.contratos from vv_worker;
alter table priv.pecas drop constraint pecas_origem_ck;
alter table priv.pecas alter column acompanhamento_id set not null;
