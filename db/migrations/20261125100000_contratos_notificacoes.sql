-- Fase 11 · notificações dos alertas do pós-licitação (11.5) e aviso de "contratada sem contrato cadastrado".
-- O worker chama priv.gerar_alertas_contratos(hoje) uma vez por hora: cria UMA notificação por situação (idempotente por tipo + referência + marco)
-- para quem tem contratos/visualizar (pagamento vencido: só quem tem financeiro/visualizar; contrato a cadastrar: quem tem contratos/cadastrar).
-- As janelas são as mesmas da tela (apps/api/src/contratos/alertas.ts): vigência e garantia 60 dias, entrega 5 dias, pagamento só vencido.

-- migrate:up
create table priv.contrato_notificacoes (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  tipo        text not null check (tipo in ('vigencia', 'garantia', 'entrega', 'pagamento', 'contrato_a_cadastrar')),
  ref_id      uuid not null,
  marco       text not null check (marco in ('proximo', 'vencido', 'novo')),
  created_at  timestamptz not null default now(),
  unique (tipo, ref_id, marco)
);
create index contrato_notificacoes_empresa_idx on priv.contrato_notificacoes (empresa_id, created_at desc);
alter table priv.contrato_notificacoes enable row level security;
create policy contrato_notificacoes_select on priv.contrato_notificacoes for select to vv_api using (core.has_permission(empresa_id, 'contratos', 'visualizar'));
grant select on priv.contrato_notificacoes to vv_api;

create function priv.gerar_alertas_contratos(p_hoje date)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
  v_marco text;
  v_titulo text;
  v_corpo text;
  v_link text;
  v_modulo text;
begin
  for r in
    select 'vigencia'::text as tipo, c.id as ref, c.empresa_id, c.id as contrato_id, c.numero as rotulo, (c.vigencia_fim - p_hoje) as dias, c.orgao as detalhe
      from priv.contratos c where c.deleted_at is null and c.status = 'ativo' and c.vigencia_fim - p_hoje <= 60
    union all
    select 'garantia', c.id, c.empresa_id, c.id, c.numero, (c.garantia_ate - p_hoje), c.orgao
      from priv.contratos c where c.deleted_at is null and c.status = 'ativo' and c.garantia_ate is not null and c.garantia_ate - p_hoje <= 60
    union all
    select 'entrega', e.id, e.empresa_id, c.id, e.numero, (e.prazo_entrega - p_hoje), c.orgao
      from priv.empenhos e join priv.contratos c on c.id = e.contrato_id and c.empresa_id = e.empresa_id
     where c.deleted_at is null and c.status = 'ativo' and e.prazo_entrega is not null and e.etapa not in ('recebimento_definitivo', 'concluido') and e.prazo_entrega - p_hoje <= 5
    union all
    select 'pagamento', f.id, f.empresa_id, c.id, f.numero_nf, (f.vencimento - p_hoje), c.orgao
      from priv.faturas f join priv.contratos c on c.id = f.contrato_id and c.empresa_id = f.empresa_id
     where c.deleted_at is null and c.status = 'ativo' and f.pago_em is null and f.vencimento < p_hoje
  loop
    v_marco := case when r.dias < 0 then 'vencido' else 'proximo' end;
    insert into priv.contrato_notificacoes (empresa_id, tipo, ref_id, marco) values (r.empresa_id, r.tipo, r.ref, v_marco) on conflict (tipo, ref_id, marco) do nothing;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;
    v_titulo := case r.tipo when 'vigencia' then 'Vigência do contrato' when 'garantia' then 'Garantia contratual' when 'entrega' then 'Entrega do empenho' else 'Pagamento' end
                || case when v_marco = 'vencido' then ' vencida' else ' perto do prazo' end;
    v_corpo := left(r.detalhe, 120) || ' · ' || case r.tipo when 'vigencia' then 'contrato ' when 'garantia' then 'contrato ' when 'entrega' then 'empenho ' else 'NF ' end || left(r.rotulo, 60)
               || case when r.dias < 0 then ' · vencido há ' || (-r.dias) || ' dia(s)' else ' · em ' || r.dias || ' dia(s)' end;
    v_link := '/contratos/' || r.contrato_id;
    v_modulo := case when r.tipo = 'pagamento' then 'financeiro' else 'contratos' end;
    insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link)
    select distinct u.id, r.empresa_id, 'contratos', 'contrato_alerta', v_titulo, v_corpo, v_link
      from core.vinculos vi
      join core.usuarios u on u.id = vi.usuario_id and u.ativo and u.deleted_at is null
     where vi.empresa_id = r.empresa_id and vi.ativo and vi.deleted_at is null and vi.papel <> 'CLIENTE'
       and exists (select 1 from core.permissoes p where p.vinculo_id = vi.id and p.modulo = v_modulo and p.acao = 'visualizar');
  end loop;

  -- Resultado "contratada" sem contrato cadastrado para o acompanhamento: lembra quem cadastra contratos (uma vez por resultado).
  for r in
    select ri.id as ref, ri.empresa_id, a.id as acomp, coalesce(g.razao_social, 'Órgão') as orgao, coalesce(e.numero_edital, '—') as edital
      from priv.resultados_item ri
      join priv.participacoes pa on pa.id = ri.participacao_id and pa.empresa_id = ri.empresa_id
      join priv.acompanhamentos a on a.id = pa.acompanhamento_id
      left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id
     where ri.resultado_final = 'contratada'
       and not exists (select 1 from priv.contratos c where c.acompanhamento_id = a.id and c.empresa_id = a.empresa_id and c.deleted_at is null)
  loop
    insert into priv.contrato_notificacoes (empresa_id, tipo, ref_id, marco) values (r.empresa_id, 'contrato_a_cadastrar', r.ref, 'novo') on conflict (tipo, ref_id, marco) do nothing;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;
    insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link)
    select distinct u.id, r.empresa_id, 'contratos', 'contrato_a_cadastrar', 'Contratada: cadastre o contrato', left(r.orgao, 120) || ' · edital nº ' || left(r.edital, 40) || ' foi contratado e ainda não tem contrato cadastrado.', '/contratos'
      from core.vinculos vi
      join core.usuarios u on u.id = vi.usuario_id and u.ativo and u.deleted_at is null
     where vi.empresa_id = r.empresa_id and vi.ativo and vi.deleted_at is null and vi.papel <> 'CLIENTE'
       and exists (select 1 from core.permissoes p where p.vinculo_id = vi.id and p.modulo = 'contratos' and p.acao = 'cadastrar');
  end loop;
  return v_n;
end;
$$;
revoke all on function priv.gerar_alertas_contratos(date) from public;
grant execute on function priv.gerar_alertas_contratos(date) to vv_worker;

-- migrate:down
drop function priv.gerar_alertas_contratos(date);
drop table priv.contrato_notificacoes;
