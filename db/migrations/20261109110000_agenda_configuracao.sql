-- Fase 05 · configuração da agenda por empresa: feriados estaduais/municipais PRÓPRIOS da empresa e o parâmetro "dias úteis
-- da data interna" (D-N, padrão 2). Por que por empresa e não em pub.feriados: um feriado errado mudaria o prazo de todas as
-- empresas; assim o efeito fica isolado e auditado. O worker soma pub.feriados + os da empresa ao calcular. Toda gravação é
-- por função (permissão e validação no banco) e enfileira o recálculo dos prazos da empresa.
-- ⚖️ A tabela oficial de feriados de cada município continua pendente do jurídico/operação.

-- migrate:up
create table priv.agenda_feriados (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  data        date not null check (data between date '2020-01-01' and date '2100-12-31'),
  nome        text not null check (char_length(nome) between 2 and 120),
  tipo        text not null default 'feriado' check (tipo in ('feriado', 'ponto_facultativo')),
  abrangencia text not null check (abrangencia in ('uf', 'municipio')),
  uf          text not null check (uf ~ '^[A-Z]{2}$'),
  codigo_ibge text check (codigo_ibge ~ '^[0-9]{7}$'),
  created_at  timestamptz not null default now(),
  created_by  uuid default core.usuario_atual(),
  deleted_at  timestamptz,
  check ((abrangencia = 'uf' and codigo_ibge is null) or (abrangencia = 'municipio' and codigo_ibge is not null))
);
create unique index agenda_feriados_uk on priv.agenda_feriados (empresa_id, data, abrangencia, uf, coalesce(codigo_ibge, '')) where deleted_at is null;

create table priv.agenda_parametros (
  empresa_id    uuid primary key references core.empresas (id) on delete cascade,
  dias_internos int not null default 2 check (dias_internos between 0 and 10),
  updated_at    timestamptz not null default now(),
  updated_by    uuid default core.usuario_atual()
);

alter table priv.agenda_feriados enable row level security;
alter table priv.agenda_parametros enable row level security;
create policy agenda_feriados_select on priv.agenda_feriados for select to vv_api using (core.has_permission(empresa_id, 'agenda', 'visualizar'));
create policy agenda_parametros_select on priv.agenda_parametros for select to vv_api using (core.has_permission(empresa_id, 'agenda', 'visualizar'));
grant select on priv.agenda_feriados, priv.agenda_parametros to vv_api;
grant select on priv.agenda_feriados, priv.agenda_parametros to vv_worker;
create trigger agenda_feriados_audit after insert or update on priv.agenda_feriados for each row execute function audit.registrar();
create trigger agenda_parametros_audit after insert or update on priv.agenda_parametros for each row execute function audit.registrar();
alter table priv.agenda_feriados enable always trigger agenda_feriados_audit;
alter table priv.agenda_parametros enable always trigger agenda_parametros_audit;

-- Recalcula os prazos de todos os acompanhamentos abertos da empresa (interna: sem grant).
create function priv.recalcular_agenda_empresa(p_empresa uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select ops.enfileirar('calcular_prazos', p_empresa, jsonb_build_object('acompanhamento_id', a.id),
                        'cfg:' || a.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
    from priv.acompanhamentos a
   where a.empresa_id = p_empresa and a.deleted_at is null and a.data_abertura is not null
     and a.status not in ('encerrado', 'desistiu')
$$;
revoke all on function priv.recalcular_agenda_empresa(uuid) from public;

create function priv.cadastrar_feriado_agenda(p_empresa uuid, p_data date, p_nome text, p_tipo text, p_abrangencia text, p_uf text, p_ibge text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  insert into priv.agenda_feriados (empresa_id, data, nome, tipo, abrangencia, uf, codigo_ibge)
  values (p_empresa, p_data, btrim(p_nome), p_tipo, p_abrangencia, p_uf, case when p_abrangencia = 'municipio' then p_ibge end)
  returning id into v_id;
  perform priv.recalcular_agenda_empresa(p_empresa);
  return v_id;
end;
$$;

create function priv.remover_feriado_agenda(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'agenda', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  update priv.agenda_feriados set deleted_at = now() where id = p_id and empresa_id = p_empresa and deleted_at is null;
  if not found then
    raise exception 'feriado não encontrado' using errcode = 'no_data_found';
  end if;
  perform priv.recalcular_agenda_empresa(p_empresa);
end;
$$;

create function priv.definir_dias_internos(p_empresa uuid, p_dias int)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'agenda', 'aprovar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_dias is null or p_dias not between 0 and 10 then
    raise exception 'dias fora do limite (0 a 10)' using errcode = 'invalid_parameter_value';
  end if;
  insert into priv.agenda_parametros (empresa_id, dias_internos) values (p_empresa, p_dias)
  on conflict (empresa_id) do update set dias_internos = excluded.dias_internos, updated_at = now(), updated_by = core.usuario_atual();
  perform priv.recalcular_agenda_empresa(p_empresa);
end;
$$;

grant execute on function priv.cadastrar_feriado_agenda(uuid, date, text, text, text, text, text), priv.remover_feriado_agenda(uuid, uuid),
  priv.definir_dias_internos(uuid, int) to vv_api;

-- migrate:down
drop function priv.definir_dias_internos(uuid, int), priv.remover_feriado_agenda(uuid, uuid),
  priv.cadastrar_feriado_agenda(uuid, date, text, text, text, text, text), priv.recalcular_agenda_empresa(uuid);
drop table priv.agenda_parametros, priv.agenda_feriados;
