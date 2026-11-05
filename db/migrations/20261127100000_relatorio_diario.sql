-- Fase 12 · 12.2 Relatório diário por e-mail. OPT-IN por pessoa e por empresa (ninguém recebe sem ter ligado). O worker enfileira uma mensagem por
-- assinatura ativa depois das 7h de Brasília (idempotente por pessoa + empresa + dia); cada seção só entra se a pessoa ainda tem a permissão do módulo
-- de origem. O e-mail leva contagens e links, nunca valores financeiros, custos ou margens.

-- migrate:up
create table priv.relatorio_diario_assinaturas (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  usuario_id  uuid not null references core.usuarios (id) on delete cascade,
  ativo       boolean not null default true,
  ultimo_envio date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (empresa_id, usuario_id)
);
alter table priv.relatorio_diario_assinaturas enable row level security;
-- O relatório lê, sem RLS, as contagens que a pessoa pode ver (a permissão é conferida no código do worker).
grant select on priv.contrato_notificacoes to vv_worker;

-- O worker não lê priv.documentos (metadados do repositório): só a contagem de vencidos e a vencer, por função.
create function priv.resumo_documentos(p_empresa uuid)
returns table (vencidos int, a_vencer int)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where s.status = 'vencido')::int, count(*) filter (where s.status = 'a_vencer')::int
    from priv.documentos d join priv.documentos_status s on s.documento_id = d.id where d.empresa_id = p_empresa and d.deleted_at is null
$$;
revoke all on function priv.resumo_documentos(uuid) from public;
grant execute on function priv.resumo_documentos(uuid) to vv_worker;

-- A API não lê a tabela direto (sem policy para vv_api): a pessoa consulta a própria assinatura pela função abaixo.
grant select on priv.relatorio_diario_assinaturas to vv_worker;
grant update (ultimo_envio) on priv.relatorio_diario_assinaturas to vv_worker;
create trigger relatorio_diario_updated_at before update on priv.relatorio_diario_assinaturas for each row execute function core.set_updated_at();
create trigger relatorio_diario_audit after insert or update on priv.relatorio_diario_assinaturas for each row execute function audit.registrar();
alter table priv.relatorio_diario_assinaturas enable always trigger relatorio_diario_audit;

-- A pessoa liga ou desliga a PRÓPRIA assinatura nesta empresa (precisa de vínculo ativo e de qualquer permissão de visualização).
create function priv.minha_assinatura_relatorio(p_empresa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select a.ativo from priv.relatorio_diario_assinaturas a where a.empresa_id = p_empresa and a.usuario_id = core.usuario_atual()), false)
$$;
grant execute on function priv.minha_assinatura_relatorio(uuid) to vv_api;

create function priv.definir_relatorio_diario(p_empresa uuid, p_ativo boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if core.usuario_atual() is null or not exists (
       select 1 from core.vinculos v join core.permissoes p on p.vinculo_id = v.id
        where v.usuario_id = core.usuario_atual() and v.empresa_id = p_empresa and v.ativo and v.deleted_at is null and p.acao = 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  insert into priv.relatorio_diario_assinaturas (empresa_id, usuario_id, ativo) values (p_empresa, core.usuario_atual(), p_ativo)
  on conflict (empresa_id, usuario_id) do update set ativo = excluded.ativo;
end;
$$;
grant execute on function priv.definir_relatorio_diario(uuid, boolean) to vv_api;

-- Rodada do worker: uma mensagem por assinatura ativa ainda não enviada hoje (a chave de idempotência garante que repetir a rodada não duplica).
create function priv.enfileirar_relatorios_diarios(p_hoje date)
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
    select a.id, a.empresa_id, a.usuario_id from priv.relatorio_diario_assinaturas a
      join core.usuarios u on u.id = a.usuario_id and u.ativo and u.deleted_at is null
     where a.ativo and (a.ultimo_envio is null or a.ultimo_envio < p_hoje)
       and exists (select 1 from core.vinculos v where v.usuario_id = a.usuario_id and v.empresa_id = a.empresa_id and v.ativo and v.deleted_at is null)
  loop
    perform ops.enfileirar('relatorio_diario', r.empresa_id, jsonb_build_object('assinatura_id', r.id, 'data', p_hoje),
                           'relatorio:' || r.usuario_id || ':' || r.empresa_id || ':' || p_hoje);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function priv.enfileirar_relatorios_diarios(date) from public;
grant execute on function priv.enfileirar_relatorios_diarios(date) to vv_worker;

-- migrate:down
drop function priv.enfileirar_relatorios_diarios(date);
drop function priv.resumo_documentos(uuid);
drop function priv.definir_relatorio_diario(uuid, boolean);
drop function priv.minha_assinatura_relatorio(uuid);
drop table priv.relatorio_diario_assinaturas;
