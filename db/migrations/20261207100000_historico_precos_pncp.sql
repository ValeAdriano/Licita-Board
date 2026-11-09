-- migrate:up
-- Fase 07 · Bloco 7.5: Histórico comercial de preços vencedores (PNCP).
-- * pub.precos_historicos e pub.preco_historico_versoes: dados públicos homologados (só vv_worker escreve; vv_api lê com pode_ver_editais).
-- * LGPD (RF-07.10 / CA-8): fornecedor pessoa física nunca tem CNPJ/CPF nem nome gravado (checks no banco).
-- * ops.resultado_coletas: controle de revisita periódica dos editais encerrados.
-- * ops.solicitar_coleta_resultados_edital: dispara coleta sob demanda por edital (máx. 1 por edital por hora -> 54000 / 429).

create table pub.precos_historicos (
  id                  uuid primary key default core.uuid_v7(),
  fonte_id            uuid not null references ops.fontes (id),
  id_externo          text not null check (char_length(btrim(id_externo)) between 3 and 200),
  edital_id           uuid not null references pub.editais (id),
  edital_item_id      uuid not null,
  fornecedor_tipo     text not null
                      check (fornecedor_tipo in ('pj', 'pessoa_fisica', 'estrangeiro', 'nao_informado')),
  fornecedor_cnpj     text
                      check (fornecedor_cnpj is null or (fornecedor_cnpj ~ '^[0-9A-Z]{14}$' and core.cnpj_valido(fornecedor_cnpj))),
  fornecedor_nome     text
                      check (fornecedor_nome is null or char_length(btrim(fornecedor_nome)) between 1 and 300),
  fornecedor_porte    text
                      check (fornecedor_porte is null or char_length(fornecedor_porte) <= 60),
  beneficio_me_epp    boolean,
  marca               text check (marca is null or char_length(marca) <= 120),
  modelo              text check (modelo is null or char_length(modelo) <= 120),
  quantidade          numeric(18, 4) check (quantidade is null or quantidade >= 0),
  unidade_medida      text check (unidade_medida is null or char_length(unidade_medida) <= 60),
  valor_unitario      numeric(18, 4) check (valor_unitario is null or valor_unitario >= 0),
  valor_total         numeric(18, 4) check (valor_total is null or valor_total >= 0),
  percentual_desconto numeric(9, 4),
  classificacao       int check (classificacao is null or classificacao >= 1),
  data_resultado      timestamptz,
  situacao            text not null check (char_length(btrim(situacao)) between 1 and 80),
  cancelado           boolean not null default false,
  hash_conteudo       text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  versao              int not null default 1 check (versao >= 1),
  link_origem         text not null check (link_origem ~ '^https://[^\s]+$' and char_length(link_origem) <= 500),
  primeira_coleta_em  timestamptz not null default now(),
  ultima_coleta_em    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (fonte_id, id_externo),
  foreign key (edital_item_id, edital_id) references pub.edital_itens (id, edital_id),
  -- LGPD (RF-07.10 / CA-8): pessoa física nunca tem documento nem nome gravado.
  check (fornecedor_cnpj is null or fornecedor_tipo = 'pj'),
  check (fornecedor_nome is null or fornecedor_tipo in ('pj', 'estrangeiro'))
);

create index precos_historicos_item_idx on pub.precos_historicos (edital_item_id);
create index precos_historicos_edital_idx on pub.precos_historicos (edital_id);
create index precos_historicos_fornecedor_idx on pub.precos_historicos (fornecedor_cnpj) where fornecedor_cnpj is not null;
create index precos_historicos_data_idx on pub.precos_historicos (data_resultado desc);
create index precos_historicos_valor_idx on pub.precos_historicos (valor_unitario);

create table pub.preco_historico_versoes (
  id                 uuid primary key default core.uuid_v7(),
  preco_historico_id uuid not null references pub.precos_historicos (id) on delete cascade,
  versao             int not null check (versao >= 1),
  coletada_em        timestamptz not null default now(),
  hash_conteudo      text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  campos_alterados   text[] not null default '{}',
  conteudo           jsonb not null,
  unique (preco_historico_id, versao)
);

create table ops.resultado_coletas (
  edital_id              uuid primary key references pub.editais (id) on delete cascade,
  ultima_verificacao_em  timestamptz,
  proxima_verificacao_em timestamptz not null default now(),
  itens_total            int not null default 0 check (itens_total >= 0),
  itens_com_resultado    int not null default 0 check (itens_com_resultado >= 0),
  status                 text not null default 'aguardando'
                         check (status in ('aguardando', 'parcial', 'completo', 'fora_da_janela', 'falhou')),
  erro_tipo              text check (erro_tipo is null or char_length(erro_tipo) <= 100),
  falhas_consecutivas    int not null default 0 check (falhas_consecutivas >= 0)
);

create index resultado_coletas_proxima_idx on ops.resultado_coletas (proxima_verificacao_em)
  where status not in ('completo', 'fora_da_janela');

alter table pub.precos_historicos enable row level security;
alter table pub.preco_historico_versoes enable row level security;
alter table ops.resultado_coletas enable row level security;

create policy precos_historicos_select on pub.precos_historicos
  for select to vv_api
  using ((select core.pode_ver_editais()));

create policy preco_historico_versoes_select on pub.preco_historico_versoes
  for select to vv_api
  using ((select core.pode_ver_editais()));

create policy resultado_coletas_select on ops.resultado_coletas
  for select to vv_api
  using ((select core.is_superadmin()));

grant select on pub.precos_historicos, pub.preco_historico_versoes, ops.resultado_coletas to vv_api;
grant select, insert, update on pub.precos_historicos, ops.resultado_coletas to vv_worker;
grant select, insert on pub.preco_historico_versoes to vv_worker;

create trigger precos_historicos_updated_at
  before update on pub.precos_historicos
  for each row execute function core.set_updated_at();

create trigger preco_historico_versoes_imutavel
  before update or delete on pub.preco_historico_versoes
  for each row execute function pub.imutavel();

alter table ops.execucoes drop constraint execucoes_tipo_check;
alter table ops.execucoes add constraint execucoes_tipo_check
  check (tipo in ('principal', 'incremental', 'manual', 'importacao', 'resultados'));

update ops.fontes
   set parametros = jsonb_set(
     coalesce(parametros, '{}'::jsonb),
     '{resultados}',
     '{"janela_dias": 365, "revisita_dias": 7, "max_editais_por_execucao": 200, "horarios": ["03:00"]}'::jsonb,
     true
   )
 where slug = 'pncp';

create function ops.solicitar_coleta_resultados_edital(
  p_empresa uuid,
  p_edital uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_chave text;
  v_job_id uuid;
begin
  if not (core.is_superadmin() or core.has_permission(p_empresa, 'editais', 'visualizar')) then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from pub.editais where id = p_edital) then
    raise exception 'edital não encontrado' using errcode = 'no_data_found';
  end if;
  if exists (
    select 1 from ops.jobs
     where tipo = 'coletar_resultados_edital'
       and payload ->> 'edital_id' = p_edital::text
       and created_at > now() - interval '1 hour'
  ) then
    raise exception 'a coleta de resultados deste edital já foi solicitada na última hora' using errcode = 'program_limit_exceeded';
  end if;

  v_chave := 'res:edital:' || p_edital::text || ':' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD-HH24');
  insert into ops.jobs (tipo, empresa_id, payload, chave_idempotencia)
  values ('coletar_resultados_edital', p_empresa, jsonb_build_object('edital_id', p_edital), v_chave)
  on conflict (chave_idempotencia) do update set updated_at = now()
  returning id into v_job_id;

  perform pg_notify('ops_jobs', 'coletar_resultados_edital');
  return v_job_id;
end;
$$;
revoke all on function ops.solicitar_coleta_resultados_edital(uuid, uuid) from public;
grant execute on function ops.solicitar_coleta_resultados_edital(uuid, uuid) to vv_api;

-- migrate:down
drop function ops.solicitar_coleta_resultados_edital(uuid, uuid);
delete from ops.jobs where tipo in ('coletar_resultados_pncp', 'coletar_resultados_edital');
delete from ops.execucoes where tipo = 'resultados';
alter table ops.execucoes drop constraint execucoes_tipo_check;
alter table ops.execucoes add constraint execucoes_tipo_check
  check (tipo in ('principal', 'incremental', 'manual', 'importacao'));
drop table ops.resultado_coletas, pub.preco_historico_versoes, pub.precos_historicos;
