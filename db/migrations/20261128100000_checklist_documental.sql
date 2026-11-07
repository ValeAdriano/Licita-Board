-- Fase 03 · Checklist documental por edital (RF-03.10; spec fase-03 §7 e §12). Q-04a.
--
-- * priv.checklist_exigencias: o que o edital exige da empresa, por acompanhamento (empresa x edital), cadastrado à mão:
--   tipo de documento (pub.tipos_documento), aplicável, conferência manual, regularidade fiscal (para o aviso ME/EPP) e
--   observação. Escrita só por função (documentos/editar); leitura com documentos/visualizar.
-- * priv.checklist_resultados: a situação de cada exigência, CALCULADA PELO WORKER (rules/checklist_documental.py, sem IA)
--   e gravada só por priv.registrar_checklist (execute só para vv_worker). A API nunca calcula nem grava resultado.
--   É dado derivado e reproduzível (como priv.documento_alertas): sem trigger de auditoria, para o recálculo diário não
--   encher o audit_log; as entradas (exigências e documentos) são auditadas.
-- * O worker não lê priv.documentos: recebe só (tipo, validade, sem vencimento) da versão LIBERADA mais recente de cada
--   documento por priv.checklist_documentos (security definer, execute só para vv_worker), como em priv.resumo_documentos.
-- * Data da sessão = data_abertura do acompanhamento (dia em America/Sao_Paulo), confirmada ou não (o resultado guarda se
--   estava confirmada). ME/EPP = enquadramento vigente na data de referência com porte ME, EPP ou MEI (⚖️ a validar).
-- * Recálculo (job `checklist_documental`, payload só com o id do acompanhamento): ao salvar exigência, ao mudar a abertura,
--   ao liberar versão ou mudar documento (gatilhos), por pedido da pessoa e uma vez por dia (priv.enfileirar_checklists).

-- migrate:up
create table priv.checklist_exigencias (
  id                  uuid primary key default core.uuid_v7(),
  empresa_id          uuid not null references core.empresas (id) on delete cascade,
  acompanhamento_id   uuid not null,
  tipo_id             uuid not null references pub.tipos_documento (id),
  aplicavel           boolean not null default true,
  conferencia_manual  boolean not null default false,
  regularidade_fiscal boolean not null default false,
  observacao          text check (char_length(observacao) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid default core.usuario_atual(),
  deleted_at          timestamptz,
  foreign key (acompanhamento_id, empresa_id) references priv.acompanhamentos (id, empresa_id) on delete cascade,
  unique (id, empresa_id)
);
create unique index checklist_exigencias_uk on priv.checklist_exigencias (acompanhamento_id, tipo_id) where deleted_at is null;
create index checklist_exigencias_empresa_idx on priv.checklist_exigencias (empresa_id);

create table priv.checklist_resultados (
  id                 uuid primary key default core.uuid_v7(),
  empresa_id         uuid not null references core.empresas (id) on delete cascade,
  exigencia_id       uuid not null unique,
  situacao           text not null check (situacao in ('valido', 'vencido', 'vence_antes_da_sessao', 'ausente', 'nao_aplicavel', 'depende_conferencia')),
  documento_id       uuid,
  validade           date,
  dias_para_vencer   int,
  aviso              text check (char_length(aviso) <= 500),
  data_referencia    date not null,
  data_sessao        date,
  sessao_confirmada  boolean not null default false,
  me_epp             boolean not null default false,
  calculado_em       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (exigencia_id, empresa_id) references priv.checklist_exigencias (id, empresa_id) on delete cascade,
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id)
);
create index checklist_resultados_empresa_idx on priv.checklist_resultados (empresa_id);

alter table priv.checklist_exigencias enable row level security;
alter table priv.checklist_resultados enable row level security;
create policy checklist_exigencias_select on priv.checklist_exigencias for select to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy checklist_resultados_select on priv.checklist_resultados for select to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
-- Sem DML direto para vv_api: exigência só por função; resultado só pelo worker.
grant select on priv.checklist_exigencias, priv.checklist_resultados to vv_api;
grant select (id, empresa_id, acompanhamento_id, tipo_id, aplicavel, conferencia_manual, regularidade_fiscal, deleted_at)
  on priv.checklist_exigencias to vv_worker;
grant select (id, slug) on pub.tipos_documento to vv_worker;

create trigger checklist_exigencias_updated_at before update on priv.checklist_exigencias for each row execute function core.set_updated_at();
create trigger checklist_resultados_updated_at before update on priv.checklist_resultados for each row execute function core.set_updated_at();
create trigger checklist_exigencias_audit after insert or update on priv.checklist_exigencias for each row execute function audit.registrar();
alter table priv.checklist_exigencias enable always trigger checklist_exigencias_audit;

-- ---------------------------------------------------------------- fila
-- Enfileira o recálculo de UM acompanhamento (interna, sem grant). Chave por transação: vários gatilhos na mesma
-- transação viram um job só.
create function priv.enfileirar_checklist(p_empresa uuid, p_acomp uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('checklist_documental', p_empresa, jsonb_build_object('acompanhamento_id', p_acomp),
                        'checklist:' || p_acomp || ':' || pg_current_xact_id()::text)
$$;
revoke all on function priv.enfileirar_checklist(uuid, uuid) from public;

-- Acompanhamentos em aberto da empresa com exigência ativa (de um tipo, ou de qualquer um).
create function priv.acompanhamentos_com_checklist(p_empresa uuid, p_tipos uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.acompanhamento_id
    from priv.checklist_exigencias e join priv.acompanhamentos a on a.id = e.acompanhamento_id
   where e.empresa_id = p_empresa and e.deleted_at is null and a.deleted_at is null and a.status not in ('encerrado', 'desistiu')
     and (p_tipos is null or e.tipo_id = any (p_tipos))
$$;
revoke all on function priv.acompanhamentos_com_checklist(uuid, uuid[]) from public;

-- ---------------------------------------------------------------- API
-- Cria ou atualiza a exigência de um tipo no acompanhamento (uma por tipo). Regularidade fiscal: se não vier, sugere
-- pela pasta do tipo (fiscal e trabalhista); a pessoa pode mudar.
create function priv.salvar_exigencia_checklist(p_empresa uuid, p_acomp uuid, p_tipo uuid, p_aplicavel boolean,
                                                p_conferencia_manual boolean, p_regularidade_fiscal boolean, p_observacao text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_pasta text;
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  select t.pasta into v_pasta from pub.tipos_documento t where t.id = p_tipo;
  if not found then
    raise exception 'tipo de documento inválido' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.checklist_exigencias (empresa_id, acompanhamento_id, tipo_id, aplicavel, conferencia_manual, regularidade_fiscal, observacao)
  values (p_empresa, p_acomp, p_tipo, coalesce(p_aplicavel, true), coalesce(p_conferencia_manual, false),
          coalesce(p_regularidade_fiscal, v_pasta = 'fiscal_trabalhista'), nullif(btrim(p_observacao), ''))
  on conflict (acompanhamento_id, tipo_id) where deleted_at is null do update
     set aplicavel = excluded.aplicavel, conferencia_manual = excluded.conferencia_manual,
         regularidade_fiscal = case when p_regularidade_fiscal is null then priv.checklist_exigencias.regularidade_fiscal else excluded.regularidade_fiscal end,
         observacao = excluded.observacao
  returning id into v_id;
  perform priv.enfileirar_checklist(p_empresa, p_acomp);
  return v_id;
end;
$$;

create function priv.remover_exigencia_checklist(p_empresa uuid, p_exigencia uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.checklist_exigencias set deleted_at = now() where id = p_exigencia and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'exigência não encontrada' using errcode = 'no_data_found';
  end if;
end;
$$;

-- A pessoa pede o recálculo agora (ex.: acabou de anexar a certidão).
create function priv.recalcular_checklist(p_empresa uuid, p_acomp uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_checklist(p_empresa, p_acomp);
end;
$$;

grant execute on function priv.salvar_exigencia_checklist(uuid, uuid, uuid, boolean, boolean, boolean, text),
  priv.remover_exigencia_checklist(uuid, uuid), priv.recalcular_checklist(uuid, uuid) to vv_api;

-- ---------------------------------------------------------------- worker
-- Documentos da empresa para o checklist: versão LIBERADA mais recente de cada documento ativo (sem descrição, número,
-- emissor nem arquivo). Documento sem versão liberada não entra (vira AUSENTE).
create function priv.checklist_documentos(p_empresa uuid)
returns table (documento_id uuid, tipo text, validade date, sem_vencimento boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, t.slug, v.validade, d.sem_vencimento
    from priv.documentos d
    join pub.tipos_documento t on t.id = d.tipo_id
    join lateral (select x.validade from priv.documento_versoes x
                   where x.documento_id = d.id and x.status_arquivo = 'liberado' order by x.versao desc limit 1) v on true
   where d.empresa_id = p_empresa and d.deleted_at is null
$$;
revoke all on function priv.checklist_documentos(uuid) from public;
grant execute on function priv.checklist_documentos(uuid) to vv_worker;

-- ⚖️ ME/EPP para o aviso da LC 123, art. 43, §1º: enquadramento vigente na data com porte ME, EPP ou MEI (a validar).
create function priv.checklist_me_epp(p_empresa uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.porte in ('ME', 'EPP', 'MEI') from core.empresa_enquadramentos e
                    where e.empresa_id = p_empresa and e.data_referencia <= p_data order by e.data_referencia desc limit 1), false)
$$;
revoke all on function priv.checklist_me_epp(uuid, date) from public;
grant execute on function priv.checklist_me_epp(uuid, date) to vv_worker;

-- Grava o resultado calculado de um acompanhamento. p_itens: [{exigencia_id, situacao, documento_id, validade,
-- dias_para_vencer, aviso}]. Confere que o acompanhamento é da empresa e que cada exigência é dele (o payload do job não
-- é confiável); resultado de exigência removida é apagado.
create function priv.registrar_checklist(p_empresa uuid, p_acomp uuid, p_itens jsonb, p_data_referencia date,
                                         p_data_sessao date, p_sessao_confirmada boolean, p_me_epp boolean)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa) then
    raise exception 'acompanhamento não é da empresa' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from jsonb_array_elements(p_itens) i
              where not exists (select 1 from priv.checklist_exigencias e where e.id = (i ->> 'exigencia_id')::uuid
                                   and e.acompanhamento_id = p_acomp and e.empresa_id = p_empresa and e.deleted_at is null))
     or exists (select 1 from jsonb_array_elements(p_itens) i
                 where i ->> 'documento_id' is not null and not exists (
                   select 1 from priv.documentos d where d.id = (i ->> 'documento_id')::uuid and d.empresa_id = p_empresa)) then
    raise exception 'exigência ou documento fora do acompanhamento' using errcode = 'insufficient_privilege';
  end if;
  delete from priv.checklist_resultados r using priv.checklist_exigencias e
   where r.exigencia_id = e.id and e.acompanhamento_id = p_acomp and e.empresa_id = p_empresa and e.deleted_at is not null;
  insert into priv.checklist_resultados (empresa_id, exigencia_id, situacao, documento_id, validade, dias_para_vencer, aviso,
                                         data_referencia, data_sessao, sessao_confirmada, me_epp, calculado_em)
  select p_empresa, (i ->> 'exigencia_id')::uuid, i ->> 'situacao', (i ->> 'documento_id')::uuid, (i ->> 'validade')::date,
         (i ->> 'dias_para_vencer')::int, left(i ->> 'aviso', 500), p_data_referencia, p_data_sessao, coalesce(p_sessao_confirmada, false),
         coalesce(p_me_epp, false), now()
    from jsonb_array_elements(p_itens) i
  on conflict (exigencia_id) do update
     set situacao = excluded.situacao, documento_id = excluded.documento_id, validade = excluded.validade,
         dias_para_vencer = excluded.dias_para_vencer, aviso = excluded.aviso, data_referencia = excluded.data_referencia,
         data_sessao = excluded.data_sessao, sessao_confirmada = excluded.sessao_confirmada, me_epp = excluded.me_epp,
         calculado_em = excluded.calculado_em;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function priv.registrar_checklist(uuid, uuid, jsonb, date, date, boolean, boolean) from public;
grant execute on function priv.registrar_checklist(uuid, uuid, jsonb, date, date, boolean, boolean) to vv_worker;

-- Rodada diária do worker (a situação muda com o calendário): um job por acompanhamento em aberto com exigência, por dia.
create function priv.enfileirar_checklists(p_hoje date)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  r record;
begin
  for r in
    select distinct e.empresa_id, e.acompanhamento_id
      from priv.checklist_exigencias e join priv.acompanhamentos a on a.id = e.acompanhamento_id
     where e.deleted_at is null and a.deleted_at is null and a.status not in ('encerrado', 'desistiu')
  loop
    perform ops.enfileirar('checklist_documental', r.empresa_id, jsonb_build_object('acompanhamento_id', r.acompanhamento_id),
                           'checklist:' || r.acompanhamento_id || ':dia:' || p_hoje);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function priv.enfileirar_checklists(date) from public;
grant execute on function priv.enfileirar_checklists(date) to vv_worker;

-- ---------------------------------------------------------------- gatilhos de recálculo
create function priv.checklist_apos_abertura()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from priv.checklist_exigencias e where e.acompanhamento_id = new.id and e.deleted_at is null) then
    perform priv.enfileirar_checklist(new.empresa_id, new.id);
  end if;
  return null;
end;
$$;
create trigger acompanhamentos_checklist after update of data_abertura, abertura_confirmada on priv.acompanhamentos
  for each row when (old.data_abertura is distinct from new.data_abertura or old.abertura_confirmada is distinct from new.abertura_confirmada)
  execute function priv.checklist_apos_abertura();

-- Versão liberada (ou documento com tipo, vencimento ou arquivamento mudado): recalcula os checklists que pedem o tipo.
create function priv.checklist_apos_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tipos uuid[];
  v_acomp uuid;
begin
  if tg_table_name = 'documento_versoes' then
    select array[d.tipo_id] into v_tipos from priv.documentos d where d.id = new.documento_id;
  else
    v_tipos := array[old.tipo_id, new.tipo_id];
  end if;
  for v_acomp in select priv.acompanhamentos_com_checklist(new.empresa_id, v_tipos) loop
    perform priv.enfileirar_checklist(new.empresa_id, v_acomp);
  end loop;
  return null;
end;
$$;
create trigger documento_versoes_checklist after update of status_arquivo on priv.documento_versoes
  for each row when (new.status_arquivo = 'liberado' and old.status_arquivo is distinct from new.status_arquivo)
  execute function priv.checklist_apos_documento();
create trigger documentos_checklist after update of tipo_id, sem_vencimento, deleted_at on priv.documentos
  for each row when (old.tipo_id is distinct from new.tipo_id or old.sem_vencimento is distinct from new.sem_vencimento
                     or old.deleted_at is distinct from new.deleted_at)
  execute function priv.checklist_apos_documento();
revoke all on function priv.checklist_apos_abertura(), priv.checklist_apos_documento() from public;

-- migrate:down
drop trigger documentos_checklist on priv.documentos;
drop trigger documento_versoes_checklist on priv.documento_versoes;
drop trigger acompanhamentos_checklist on priv.acompanhamentos;
drop function priv.checklist_apos_documento(), priv.checklist_apos_abertura(), priv.enfileirar_checklists(date),
  priv.registrar_checklist(uuid, uuid, jsonb, date, date, boolean, boolean), priv.checklist_me_epp(uuid, date),
  priv.checklist_documentos(uuid), priv.recalcular_checklist(uuid, uuid), priv.remover_exigencia_checklist(uuid, uuid),
  priv.salvar_exigencia_checklist(uuid, uuid, uuid, boolean, boolean, boolean, text), priv.acompanhamentos_com_checklist(uuid, uuid[]),
  priv.enfileirar_checklist(uuid, uuid);
revoke select (id, slug) on pub.tipos_documento from vv_worker;
drop table priv.checklist_resultados, priv.checklist_exigencias;
