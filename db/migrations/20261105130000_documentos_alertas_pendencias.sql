-- Fase 03 · Alertas de vencimento (um por versão e marco, sem repetir) e pendência "Atualizar documento".
-- O sistema não emite certidão nem simula renovação: a pendência leva instruções e o link do emissor, e só
-- fecha como sucesso quando um arquivo novo é liberado; a falha é registrada de verdade.

-- migrate:up
create table priv.documento_alertas (
  id           uuid primary key default core.uuid_v7(),
  documento_id uuid not null,
  empresa_id   uuid not null,
  versao_id    uuid not null references priv.documento_versoes (id) on delete cascade,
  marco_dias   int not null check (marco_dias >= 0),  -- 0 = venceu
  enviado_em   timestamptz not null default now(),
  unique (versao_id, marco_dias),
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade
);
create index documento_alertas_empresa_idx on priv.documento_alertas (empresa_id);

create table priv.documento_pendencias (
  id           uuid primary key default core.uuid_v7(),
  documento_id uuid not null,
  empresa_id   uuid not null,
  tipo         text not null default 'atualizar' check (tipo = 'atualizar'),
  status       text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  instrucoes   text not null check (char_length(instrucoes) between 1 and 1000),
  criada_por   uuid default core.usuario_atual(),
  created_at   timestamptz not null default now(),
  resolvida_em timestamptz,
  resultado    text check (resultado in ('sucesso', 'falha')),
  detalhe      text check (char_length(detalhe) <= 500),
  check ((status = 'resolvida') = (resultado is not null and resolvida_em is not null)),
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade
);
create index documento_pendencias_empresa_idx on priv.documento_pendencias (empresa_id, status);
-- No máximo uma pendência aberta por documento.
create unique index documento_pendencias_uma_aberta on priv.documento_pendencias (documento_id) where status = 'aberta';

alter table priv.documento_alertas enable row level security;
alter table priv.documento_pendencias enable row level security;
create policy documento_alertas_select on priv.documento_alertas for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
create policy documento_pendencias_select on priv.documento_pendencias for select to vv_api using (core.has_permission(empresa_id, 'documentos', 'visualizar'));
grant select on priv.documento_alertas, priv.documento_pendencias to vv_api;

create trigger documento_pendencias_audit after insert or update on priv.documento_pendencias for each row execute function audit.registrar('empresa_id');
alter table priv.documento_pendencias enable always trigger documento_pendencias_audit;

-- Pede a atualização: marca o documento "em atualização" e abre a pendência com as instruções.
create function priv.solicitar_atualizacao(p_empresa uuid, p_documento uuid, p_instrucoes text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid := core.uuid_v7();
begin
  if not core.has_permission(p_empresa, 'documentos', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from priv.documentos d where d.id = p_documento and d.empresa_id = p_empresa and d.deleted_at is null for update;
  if not found then
    raise exception 'documento não encontrado' using errcode = 'no_data_found';
  end if;
  insert into priv.documento_pendencias (id, documento_id, empresa_id, instrucoes) values (v_id, p_documento, p_empresa, p_instrucoes);
  update priv.documentos set em_atualizacao = true where id = p_documento;
  return v_id;
end;
$$;

-- A atualização não deu certo (site fora do ar, exigência do emissor...): registra a falha de verdade.
create function priv.registrar_falha_atualizacao(p_empresa uuid, p_pendencia uuid, p_detalhe text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

-- Arquivo novo liberado fecha a pendência aberta como sucesso (a única forma de "renovação" que o sistema afirma).
create function priv.fechar_pendencia_ao_liberar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status_arquivo = 'liberado' and old.status_arquivo = 'quarentena' then
    update priv.documento_pendencias set status = 'resolvida', resultado = 'sucesso', resolvida_em = now()
     where documento_id = new.documento_id and status = 'aberta';
    update priv.documentos set em_atualizacao = false where id = new.documento_id and em_atualizacao;
  end if;
  return new;
end;
$$;
create trigger documento_versoes_fecha_pendencia after update of status_arquivo on priv.documento_versoes
  for each row execute function priv.fechar_pendencia_ao_liberar();

-- Job diário do worker. p_hoje entra por parâmetro (relógio simulado nos testes). Para cada documento com
-- versão liberada e validade: alerta no MENOR marco já alcançado (30/15/10/5 do tipo) ou 0 se venceu. Se o job
-- ficou parado, só o marco mais urgente dispara (sem rajada). Idempotente por (versão, marco).
create function priv.gerar_alertas_documentos(p_hoje date)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_marco int;
  v_n int := 0;
  v_titulo text;
  v_corpo text;
begin
  for r in
    select d.id as documento_id, d.empresa_id, d.descricao, d.responsavel_id, t.antecedencias,
           v.id as versao_id, v.validade
      from priv.documentos d
      join pub.tipos_documento t on t.id = d.tipo_id
      join lateral (select x.id, x.validade from priv.documento_versoes x
                     where x.documento_id = d.id and x.status_arquivo = 'liberado' order by x.versao desc limit 1) v on true
     where d.deleted_at is null and not d.sem_vencimento and v.validade is not null
       and v.validade <= p_hoje + (select max(a) from unnest(t.antecedencias) a)
  loop
    if r.validade < p_hoje then
      v_marco := 0;
    else
      select min(a) into v_marco from unnest(r.antecedencias) a where r.validade - p_hoje <= a;
    end if;
    insert into priv.documento_alertas (documento_id, empresa_id, versao_id, marco_dias)
    values (r.documento_id, r.empresa_id, r.versao_id, v_marco)
    on conflict (versao_id, marco_dias) do nothing;
    if not found then
      continue;
    end if;
    v_n := v_n + 1;
    v_titulo := case when v_marco = 0 then 'Documento vencido' else 'Documento perto de vencer' end;
    v_corpo := left(r.descricao, 200) || case when v_marco = 0 then ' venceu em ' else ' vence em ' end || to_char(r.validade, 'DD/MM/YYYY') || '.';
    insert into core.notificacoes (usuario_id, empresa_id, modulo, tipo, titulo, corpo, link)
    select distinct u.id, r.empresa_id, 'documentos', 'documento_vencimento', v_titulo, v_corpo, '/cadastros'
      from core.vinculos vi
      join core.usuarios u on u.id = vi.usuario_id and u.ativo and u.deleted_at is null
     where vi.empresa_id = r.empresa_id and vi.ativo and vi.deleted_at is null
       and (u.id = r.responsavel_id or exists (
             select 1 from core.permissoes p
              where p.vinculo_id = vi.id and p.modulo = 'documentos' and p.acao = 'visualizar'));
  end loop;
  return v_n;
end;
$$;

revoke all on function priv.gerar_alertas_documentos(date), priv.fechar_pendencia_ao_liberar() from public;
grant execute on function priv.gerar_alertas_documentos(date) to vv_worker;
grant execute on function priv.solicitar_atualizacao(uuid, uuid, text), priv.registrar_falha_atualizacao(uuid, uuid, text) to vv_api;

-- migrate:down
drop trigger documento_versoes_fecha_pendencia on priv.documento_versoes;
drop function priv.gerar_alertas_documentos(date), priv.fechar_pendencia_ao_liberar(), priv.registrar_falha_atualizacao(uuid, uuid, text), priv.solicitar_atualizacao(uuid, uuid, text);
drop table priv.documento_pendencias, priv.documento_alertas;
