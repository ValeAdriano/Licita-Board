-- Fase 02 · PR 1 · Ficha completa da empresa (spec fase-02 §3.1; RF-02.1, RF-02.2; Prompt 2.1).
--
-- * core.empresas ganha endereço, inscrições, CNAE principal, regime tributário e observações.
--   Alteração de tabela já no main: migration nova (a antiga é imutável). Só colunas de CONTEÚDO
--   entram no grant de UPDATE de vv_api; cnpj, ativo, deleted_at e created_by seguem fora.
-- * Filhas por empresa (RLS por core.has_permission, escrita por 'empresas/editar'; sem delete
--   físico): CNAEs secundários, contatos (telefone, WhatsApp, e-mail) e enquadramento (porte) com
--   DATA DE REFERÊNCIA, que é histórico (só insert; o vigente vem de core.enquadramento_em).
-- * Dado pessoal (valor e rótulo do contato) sai redigido da auditoria (LGPD).
-- * ⚖️🧾 Listas de porte e regime são as da pergunta 3 da spec, a revisar pelo contador; mudar a lista
--   é migration nova. Nada aqui aplica benefício da LC 123: só guarda e consulta (Fases 05 e 08).
-- * Dados bancários e PIX NÃO entram aqui (PR 3, depois da cifra de campo do PR 2).
-- * Exceção consciente às colunas padrão (db/AGENTS.md, regra 3): o enquadramento é histórico, sem
--   updated_at nem deleted_at. Um porte digitado errado fica na data (limitação registrada na spec,
--   pergunta 16: retificação). Endereço e observações de empresa podem ser dado pessoal (MEI): saem
--   redigidos da auditoria imutável.

-- migrate:up
alter table core.empresas
  add column inscricao_estadual  text check (char_length(inscricao_estadual) <= 30),
  add column inscricao_municipal text check (char_length(inscricao_municipal) <= 30),
  add column cnae_principal      text check (cnae_principal ~ '^[0-9]{7}$'),
  add column logradouro          text check (char_length(logradouro) <= 200),
  add column numero              text check (char_length(numero) <= 20),
  add column complemento         text check (char_length(complemento) <= 100),
  add column bairro              text check (char_length(bairro) <= 100),
  add column municipio           text check (char_length(municipio) <= 100),
  add column municipio_ibge      text check (municipio_ibge ~ '^[0-9]{7}$'),
  add column uf                  text check (uf in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI',
    'RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  add column cep                 text check (cep ~ '^[0-9]{8}$'),
  add column regime_tributario   text check (regime_tributario in (
    'MEI', 'SIMPLES_NACIONAL', 'LUCRO_PRESUMIDO', 'LUCRO_REAL')),
  add column observacoes         text check (char_length(observacoes) <= 4000);

grant update (inscricao_estadual, inscricao_municipal, cnae_principal, logradouro, numero, complemento,
              bairro, municipio, municipio_ibge, uf, cep, regime_tributario, observacoes)
  on core.empresas to vv_api;

-- CNAEs secundários.
create table core.empresa_cnaes (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id),
  cnae        text not null check (cnae ~ '^[0-9]{7}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default core.usuario_atual(),
  deleted_at  timestamptz
);
create unique index empresa_cnaes_uk on core.empresa_cnaes (empresa_id, cnae) where deleted_at is null;
create index empresa_cnaes_empresa_idx on core.empresa_cnaes (empresa_id);

-- Contatos: telefone e WhatsApp só com dígitos (DDI + DDD + número, 10 a 13); e-mail em formato simples.
create table core.empresa_contatos (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id),
  tipo        text not null check (tipo in ('telefone', 'whatsapp', 'email')),
  valor       text not null check (char_length(valor) <= 254),
  rotulo      text check (char_length(rotulo) <= 50),
  principal   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default core.usuario_atual(),
  deleted_at  timestamptz,
  check (
    (tipo = 'email' and valor ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (tipo in ('telefone', 'whatsapp') and valor ~ '^[0-9]{10,13}$')
  )
);
create unique index empresa_contatos_principal_uk on core.empresa_contatos (empresa_id, tipo)
  where principal and deleted_at is null;
create unique index empresa_contatos_valor_uk on core.empresa_contatos (empresa_id, tipo, lower(valor))
  where deleted_at is null;
create index empresa_contatos_empresa_idx on core.empresa_contatos (empresa_id);

-- Enquadramento (porte) por DATA DE REFERÊNCIA: uma linha por data, só insert (histórico).
create table core.empresa_enquadramentos (
  id              uuid primary key default core.uuid_v7(),
  empresa_id      uuid not null references core.empresas (id),
  porte           text not null check (porte in ('MEI', 'ME', 'EPP', 'DEMAIS')),
  data_referencia date not null,
  fonte           text not null check (fonte in ('declaracao', 'certidao_junta', 'outra')),
  observacao      text check (char_length(observacao) <= 500),
  created_at      timestamptz not null default now(),
  created_by      uuid default core.usuario_atual(),
  unique (empresa_id, data_referencia)
);

-- Histórico: nada de update nem delete. A ÚNICA saída é a exclusão definitiva da empresa (dupla
-- aprovação), que marca a empresa em vv.exclusao_empresa dentro da própria transação
-- (core.executar_exclusao, migration seguinte). vv_api não tem grant de delete, então a marca sozinha
-- não abre nada para ele. Serve só a tabelas que têm a coluna empresa_id.
create function core.somente_insercao_empresa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.empresa_id::text = current_setting('vv.exclusao_empresa', true) then
    return old;
  end if;
  raise exception '% é histórico: só aceita inclusão (operação % bloqueada)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
create trigger empresa_enquadramentos_historico before update or delete on core.empresa_enquadramentos
  for each row execute function core.somente_insercao_empresa();
create trigger empresa_enquadramentos_sem_truncate before truncate on core.empresa_enquadramentos
  for each statement execute function core.somente_insercao_empresa();

-- Enquadramento vigente numa data: a linha de maior data_referencia que não passa da data pedida.
-- security invoker: quem chama só vê a empresa que a RLS deixa.
create function core.enquadramento_em(p_empresa uuid, p_data date)
returns table (porte text, data_referencia date)
language sql
stable
set search_path = ''
as $$
  select e.porte, e.data_referencia
    from core.empresa_enquadramentos e
   where e.empresa_id = p_empresa and e.data_referencia <= p_data
   order by e.data_referencia desc
   limit 1
$$;
grant execute on function core.enquadramento_em(uuid, date) to vv_api;

alter table core.empresa_cnaes enable row level security;
alter table core.empresa_contatos enable row level security;
alter table core.empresa_enquadramentos enable row level security;

create policy empresa_cnaes_select on core.empresa_cnaes for select to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'visualizar'));
create policy empresa_cnaes_insert on core.empresa_cnaes for insert to vv_api
  with check (core.has_permission(empresa_id, 'empresas', 'editar'));
create policy empresa_cnaes_update on core.empresa_cnaes for update to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'editar'))
  with check (core.has_permission(empresa_id, 'empresas', 'editar'));

create policy empresa_contatos_select on core.empresa_contatos for select to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'visualizar'));
create policy empresa_contatos_insert on core.empresa_contatos for insert to vv_api
  with check (core.has_permission(empresa_id, 'empresas', 'editar'));
create policy empresa_contatos_update on core.empresa_contatos for update to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'editar'))
  with check (core.has_permission(empresa_id, 'empresas', 'editar'));

create policy empresa_enquadramentos_select on core.empresa_enquadramentos for select to vv_api
  using (core.has_permission(empresa_id, 'empresas', 'visualizar'));
create policy empresa_enquadramentos_insert on core.empresa_enquadramentos for insert to vv_api
  with check (core.has_permission(empresa_id, 'empresas', 'editar'));

-- Grants por coluna: empresa_id só entra no insert (a policy confere a empresa); depois não muda.
grant select on core.empresa_cnaes, core.empresa_contatos, core.empresa_enquadramentos to vv_api;
grant insert (empresa_id, cnae) on core.empresa_cnaes to vv_api;
grant update (cnae, deleted_at) on core.empresa_cnaes to vv_api;
grant insert (empresa_id, tipo, valor, rotulo, principal) on core.empresa_contatos to vv_api;
grant update (valor, rotulo, principal, deleted_at) on core.empresa_contatos to vv_api;
grant insert (empresa_id, porte, data_referencia, fonte, observacao) on core.empresa_enquadramentos to vv_api;

create trigger empresa_cnaes_updated_at before update on core.empresa_cnaes
  for each row execute function core.set_updated_at();
create trigger empresa_contatos_updated_at before update on core.empresa_contatos
  for each row execute function core.set_updated_at();

create trigger empresa_cnaes_audit after insert or update or delete on core.empresa_cnaes
  for each row execute function audit.registrar();
create trigger empresa_contatos_audit after insert or update or delete on core.empresa_contatos
  for each row execute function audit.registrar('empresa_id', 'valor,rotulo');
create trigger empresa_enquadramentos_audit after insert or update or delete on core.empresa_enquadramentos
  for each row execute function audit.registrar('empresa_id', 'observacao');
alter table core.empresa_cnaes enable always trigger empresa_cnaes_audit;
alter table core.empresa_contatos enable always trigger empresa_contatos_audit;
alter table core.empresa_enquadramentos enable always trigger empresa_enquadramentos_audit;
-- Os que protegem o histórico também valem em modo replica (como os da auditoria).
alter table core.empresa_enquadramentos enable always trigger empresa_enquadramentos_historico;
alter table core.empresa_enquadramentos enable always trigger empresa_enquadramentos_sem_truncate;

-- Endereço e observações da empresa saem redigidos da auditoria imutável (LGPD: MEI = pessoa física).
drop trigger empresas_audit on core.empresas;
create trigger empresas_audit after insert or update or delete on core.empresas
  for each row execute function audit.registrar('id', 'observacoes,logradouro,numero,complemento,bairro,cep');
alter table core.empresas enable always trigger empresas_audit;

-- migrate:down
drop trigger empresas_audit on core.empresas;
create trigger empresas_audit after insert or update or delete on core.empresas
  for each row execute function audit.registrar('id');
alter table core.empresas enable always trigger empresas_audit;
drop function core.enquadramento_em(uuid, date);
drop table core.empresa_enquadramentos, core.empresa_contatos, core.empresa_cnaes;
drop function core.somente_insercao_empresa();
revoke update (inscricao_estadual, inscricao_municipal, cnae_principal, logradouro, numero, complemento,
               bairro, municipio, municipio_ibge, uf, cep, regime_tributario, observacoes)
  on core.empresas from vv_api;
alter table core.empresas
  drop column inscricao_estadual, drop column inscricao_municipal, drop column cnae_principal,
  drop column logradouro, drop column numero, drop column complemento, drop column bairro,
  drop column municipio, drop column municipio_ibge, drop column uf, drop column cep,
  drop column regime_tributario, drop column observacoes;
