-- Fase 06 · Q-14: Texto extraído de fichas técnicas privadas (priv.documento_trechos), conferência automática da citação
-- da ficha (ficha_citacao_verificada em priv.analise_linhas) e produtos alternativos com ranqueamento por código (6.4).

-- migrate:up
create table priv.documento_trechos (
  id            uuid primary key default core.uuid_v7(),
  documento_id  uuid not null,
  versao_id     uuid not null references priv.documento_versoes (id) on delete cascade,
  empresa_id    uuid not null,
  pagina        int not null check (pagina >= 1),
  ordem         int not null check (ordem >= 1),
  texto         text not null check (char_length(texto) between 1 and 4000),
  origem        text not null default 'texto' check (origem in ('texto', 'ocr')),
  created_at    timestamptz not null default now(),
  unique (versao_id, pagina, ordem),
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade
);
create index documento_trechos_empresa_idx on priv.documento_trechos (empresa_id);
create index documento_trechos_doc_idx on priv.documento_trechos (documento_id, pagina, ordem);

alter table priv.documento_trechos enable row level security;
create policy documento_trechos_select on priv.documento_trechos for select to vv_api
  using (core.has_permission(empresa_id, 'documentos', 'visualizar') or core.has_permission(empresa_id, 'analises', 'visualizar'));
grant select on priv.documento_trechos to vv_api, vv_worker;
grant select (documento_id, empresa_id, versao) on priv.documento_versoes to vv_worker;

create trigger documento_trechos_audit after insert or update or delete on priv.documento_trechos
  for each row execute function audit.registrar();
alter table priv.documento_trechos enable always trigger documento_trechos_audit;

alter table priv.analise_linhas
  add column ficha_citacao_verificada boolean not null default false;

alter table priv.analises_item
  add column posicao_alternativa int check (posicao_alternativa >= 1),
  add column rotulo_alternativa text check (rotulo_alternativa in ('melhor_compativel', 'segunda_alternativa', 'terceira_alternativa', 'outra', 'reprovado')),
  add column riscos_count int not null default 0 check (riscos_count >= 0),
  add column pendencias_count int not null default 0 check (pendencias_count >= 0);

grant update (posicao_alternativa, rotulo_alternativa, riscos_count, pendencias_count) on priv.analises_item to vv_worker;
grant select (disponibilidade) on priv.produtos to vv_worker;
grant select (produto_id, empresa_id, preco_custo, preco_referencia) on priv.produto_precos to vv_worker;

-- Registra os trechos extraídos pelo worker ao liberar uma versão de documento privado e re-enfileira análises que usam a ficha.
create function priv.registrar_trechos_documento(p_versao uuid, p_trechos jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
  v_n int := 0;
  v_analise uuid;
begin
  select id, documento_id, empresa_id, status_arquivo into v
    from priv.documento_versoes
   where id = p_versao;
  if not found or v.status_arquivo <> 'liberado' then
    raise exception 'versão liberada não encontrada' using errcode = 'invalid_parameter_value';
  end if;
  delete from priv.documento_trechos where versao_id = p_versao;
  insert into priv.documento_trechos (documento_id, versao_id, empresa_id, pagina, ordem, texto, origem)
  select v.documento_id, v.id, v.empresa_id,
         greatest(coalesce(x.pagina, 1), 1),
         greatest(coalesce(x.ordem, 1), 1),
         left(btrim(x.texto), 4000),
         case when x.origem = 'ocr' then 'ocr' else 'texto' end
    from jsonb_to_recordset(coalesce(p_trechos, '[]'::jsonb)) as x(pagina int, ordem int, texto text, origem text)
   where nullif(btrim(x.texto), '') is not null;
  get diagnostics v_n = row_count;

  for v_analise in
    select distinct a.id
      from priv.analises_item a
      left join priv.produtos pr on pr.id = a.produto_id and pr.empresa_id = a.empresa_id
     where a.empresa_id = v.empresa_id
       and (pr.ficha_documento_id = v.documento_id
         or exists (select 1 from priv.analise_linhas l where l.analise_id = a.id and l.ficha_documento_id = v.documento_id))
  loop
    perform ops.enfileirar('analisar_item', v.empresa_id, jsonb_build_object('analise_id', v_analise),
                           'analise:' || v_analise || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  end loop;
  return v_n;
end;
$$;
revoke all on function priv.registrar_trechos_documento(uuid, jsonb) from public;
grant execute on function priv.registrar_trechos_documento(uuid, jsonb) to vv_worker;

-- Atualiza priv.conferir_ficha para limpar ficha_citacao_verificada antes de reenfileirar o worker.
create or replace function priv.conferir_ficha(p_empresa uuid, p_linha uuid, p_documento uuid, p_pagina int, p_trecho text, p_ressalva text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_analise uuid;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if p_documento is null or p_pagina is null or p_trecho is null or char_length(btrim(p_trecho)) < 5 then
    raise exception 'informe documento, página e o trecho da ficha técnica' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from priv.documentos where id = p_documento and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'documento não encontrado' using errcode = 'no_data_found';
  end if;
  update priv.analise_linhas
     set ficha_documento_id = p_documento, ficha_pagina = p_pagina, ficha_trecho = btrim(p_trecho), ressalva = nullif(btrim(p_ressalva), ''),
         ficha_conferida_por = core.usuario_atual(), ficha_conferida_em = now(), ficha_citacao_verificada = false
   where id = p_linha and empresa_id = p_empresa
   returning analise_id into v_analise;
  if not found then
    raise exception 'linha não encontrada' using errcode = 'no_data_found';
  end if;
  perform ops.enfileirar('analisar_item', p_empresa, jsonb_build_object('analise_id', v_analise),
                         'analise:' || v_analise || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
end;
$$;
revoke all on function priv.conferir_ficha(uuid, uuid, uuid, int, text, text) from public;
grant execute on function priv.conferir_ficha(uuid, uuid, uuid, int, text, text) to vv_api;

-- Enfileira a análise de todos os produtos ativos do catálogo (ou de uma categoria) para comparar alternativas (6.4).
create function priv.analisar_alternativas_item(p_empresa uuid, p_participacao uuid, p_categoria uuid default null)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_prod uuid;
  v_id uuid;
  v_n int := 0;
begin
  if not core.has_permission(p_empresa, 'analises', 'editar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.participacoes where id = p_participacao and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'participação não encontrada' using errcode = 'no_data_found';
  end if;
  for v_prod in
    select id from priv.produtos
     where empresa_id = p_empresa and deleted_at is null and status_comercial = 'ativo'
       and (p_categoria is null or categoria_id = p_categoria)
     order by codigo_interno
     limit 20
  loop
    insert into priv.analises_item (empresa_id, participacao_id, produto_id)
    values (p_empresa, p_participacao, v_prod)
    on conflict (participacao_id, produto_id) do update set solicitada_em = now(), solicitada_por = core.usuario_atual()
    returning id into v_id;
    perform ops.enfileirar('analisar_item', p_empresa, jsonb_build_object('analise_id', v_id),
                           'analise:' || v_id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function priv.analisar_alternativas_item(uuid, uuid, uuid) from public;
grant execute on function priv.analisar_alternativas_item(uuid, uuid, uuid) to vv_api;

-- migrate:down
drop function priv.analisar_alternativas_item(uuid, uuid, uuid);
drop function priv.registrar_trechos_documento(uuid, jsonb);
revoke select (produto_id, empresa_id, preco_custo, preco_referencia) on priv.produto_precos from vv_worker;
revoke select (disponibilidade) on priv.produtos from vv_worker;
revoke update (posicao_alternativa, rotulo_alternativa, riscos_count, pendencias_count) on priv.analises_item from vv_worker;
alter table priv.analises_item
  drop column pendencias_count,
  drop column riscos_count,
  drop column rotulo_alternativa,
  drop column posicao_alternativa;
alter table priv.analise_linhas
  drop column ficha_citacao_verificada;
revoke select (documento_id, empresa_id, versao) on priv.documento_versoes from vv_worker;
drop table priv.documento_trechos;
