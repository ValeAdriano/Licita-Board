-- Fase 02 · PR 5 · Poderes, procurações e core.signatario_valido (spec fase-02 §3.2; RF-02.5, RF-02.6).
--
-- ⚖️ VALIDAR JURÍDICO: a lista de poderes abaixo é PROVISÓRIA (pub.poderes_representacao.provisorio),
-- editável por dado (sem migration) quando o jurídico VV entregar a tabela. As regras de
-- core.signatario_valido seguem a falha segura da spec §4.4:
--   * sócio-administrador vale pelos poderes que tem cadastrados (sem prazo);
--   * procurador/advogado vale só com procuração não arquivada, emitida até a data, NÃO revogada na
--     data, COM validade preenchida e não vencida, e que inclua o poder;
--   * validade nula = inválida (até o jurídico decidir se "prazo indeterminado" vale).
-- A comparação é de DATA com DATA (a data de referência do documento, America/Sao_Paulo): sem fuso escondido.

-- migrate:up
create table pub.poderes_representacao (
  slug        text primary key check (slug ~ '^[a-z_]{3,40}$'),
  nome        text not null,
  ordem       int not null default 0,
  provisorio  boolean not null default true
);
insert into pub.poderes_representacao (slug, nome, ordem) values
  ('assinar_proposta', 'Assinar proposta', 10),
  ('assinar_declaracoes', 'Assinar declarações', 20),
  ('interpor_recurso', 'Interpor recurso', 30),
  ('firmar_contrato', 'Firmar contrato', 40),
  ('receber_intimacoes', 'Receber intimações', 50),
  ('peticionar', 'Peticionar', 60);
alter table pub.poderes_representacao enable row level security;
create policy poderes_representacao_select on pub.poderes_representacao for select to vv_api
  using ((select core.usuario_atual()) is not null);
grant select on pub.poderes_representacao to vv_api;
grant usage on schema pub to vv_api;

alter table core.representantes add constraint representantes_id_empresa_uk unique (id, empresa_id);

create table core.representante_poderes (
  representante_id uuid not null,
  empresa_id       uuid not null,
  poder            text not null references pub.poderes_representacao (slug),
  primary key (representante_id, poder),
  foreign key (representante_id, empresa_id) references core.representantes (id, empresa_id) on delete cascade
);
create index representante_poderes_empresa_idx on core.representante_poderes (empresa_id);

create table core.procuracoes (
  id                uuid primary key default core.uuid_v7(),
  empresa_id        uuid not null references core.empresas (id) on delete cascade,
  representante_id  uuid not null,
  numero            text check (char_length(numero) <= 60),
  data_emissao      date not null,
  data_validade     date,
  revogada_em       date,
  substabelecida_de uuid references core.procuracoes (id),
  documento_id      uuid,  -- Fase 03 liga ao arquivo
  observacao        text check (char_length(observacao) <= 500),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid default core.usuario_atual(),
  deleted_at        timestamptz,
  unique (id, empresa_id),
  foreign key (representante_id, empresa_id) references core.representantes (id, empresa_id) on delete cascade,
  check (data_validade is null or data_validade >= data_emissao),
  check (revogada_em is null or revogada_em >= data_emissao)
);
create index procuracoes_empresa_idx on core.procuracoes (empresa_id);
create index procuracoes_representante_idx on core.procuracoes (representante_id);

create table core.procuracao_poderes (
  procuracao_id uuid not null,
  empresa_id    uuid not null,
  poder         text not null references pub.poderes_representacao (slug),
  primary key (procuracao_id, poder),
  foreign key (procuracao_id, empresa_id) references core.procuracoes (id, empresa_id) on delete cascade
);
create index procuracao_poderes_empresa_idx on core.procuracao_poderes (empresa_id);

alter table core.representante_poderes enable row level security;
alter table core.procuracoes enable row level security;
alter table core.procuracao_poderes enable row level security;

create policy representante_poderes_select on core.representante_poderes for select to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'visualizar'));
create policy representante_poderes_insert on core.representante_poderes for insert to vv_api
  with check (core.has_permission(empresa_id, 'representantes', 'editar'));
create policy representante_poderes_delete on core.representante_poderes for delete to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'editar'));
create policy procuracao_poderes_select on core.procuracao_poderes for select to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'visualizar'));
create policy procuracao_poderes_insert on core.procuracao_poderes for insert to vv_api
  with check (core.has_permission(empresa_id, 'representantes', 'editar'));
create policy procuracao_poderes_delete on core.procuracao_poderes for delete to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'editar'));

create policy procuracoes_select on core.procuracoes for select to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'visualizar'));
create policy procuracoes_insert on core.procuracoes for insert to vv_api
  with check (core.has_permission(empresa_id, 'representantes', 'cadastrar'));
create policy procuracoes_update on core.procuracoes for update to vv_api
  using (core.has_permission(empresa_id, 'representantes', 'editar') or core.has_permission(empresa_id, 'representantes', 'arquivar'))
  with check (core.has_permission(empresa_id, 'representantes', 'editar') or core.has_permission(empresa_id, 'representantes', 'arquivar'));

grant select on core.representante_poderes, core.procuracao_poderes, core.procuracoes to vv_api;
grant insert, delete on core.representante_poderes, core.procuracao_poderes to vv_api;
grant insert (empresa_id, representante_id, numero, data_emissao, data_validade, substabelecida_de, observacao)
  on core.procuracoes to vv_api;
grant update (numero, data_emissao, data_validade, revogada_em, observacao, deleted_at) on core.procuracoes to vv_api;

create trigger procuracoes_updated_at before update on core.procuracoes
  for each row execute function core.set_updated_at();
create trigger procuracoes_audit after insert or update or delete on core.procuracoes
  for each row execute function audit.registrar('empresa_id', 'numero,observacao');
create trigger representante_poderes_audit after insert or delete on core.representante_poderes
  for each row execute function audit.registrar();
create trigger procuracao_poderes_audit after insert or delete on core.procuracao_poderes
  for each row execute function audit.registrar();
alter table core.procuracoes enable always trigger procuracoes_audit;
alter table core.representante_poderes enable always trigger representante_poderes_audit;
alter table core.procuracao_poderes enable always trigger procuracao_poderes_audit;

-- A regra do signatário. security invoker: quem chama só enxerga a empresa que a RLS deixa.
create function core.signatario_valido(p_representante uuid, p_data date, p_poder text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from core.representantes r
     where r.id = p_representante and r.ativo and r.deleted_at is null
       and (
         (r.tipo = 'SOCIO_ADMINISTRADOR' and exists (
            select 1 from core.representante_poderes rp where rp.representante_id = r.id and rp.poder = p_poder))
         or exists (
            select 1
              from core.procuracoes p
              join core.procuracao_poderes pp on pp.procuracao_id = p.id
             where p.representante_id = r.id and p.deleted_at is null
               and pp.poder = p_poder
               and p.data_emissao <= p_data
               and p.data_validade is not null and p_data <= p.data_validade
               and (p.revogada_em is null or p_data < p.revogada_em))
       )
  )
$$;
grant execute on function core.signatario_valido(uuid, date, text) to vv_api;

-- migrate:down
drop function core.signatario_valido(uuid, date, text);
drop table core.procuracao_poderes, core.procuracoes, core.representante_poderes;
alter table core.representantes drop constraint representantes_id_empresa_uk;
drop table pub.poderes_representacao;
