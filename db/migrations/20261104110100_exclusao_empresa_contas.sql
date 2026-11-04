-- Fase 02 · PR 3 · A exclusão definitiva da empresa também apaga as contas bancárias (20261104110000).
-- As revelações (core.revelacoes_dados) caem em cascade; o teste 080 trava as duas listas de FKs.

-- migrate:up
create or replace function core.executar_exclusao(p_tabela text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tabela = 'core.empresas' then
    perform set_config('vv.exclusao_empresa', p_id::text, true);
    -- Dependentes de core primeiro; dados de priv (Fase 02+) entram aqui por migration.
    delete from core.empresa_contas where empresa_id = p_id;
    delete from core.empresa_enquadramentos where empresa_id = p_id;
    delete from core.empresa_contatos where empresa_id = p_id;
    delete from core.empresa_cnaes where empresa_id = p_id;
    delete from core.permissoes where empresa_id = p_id;
    delete from core.vinculos where empresa_id = p_id;
    delete from core.empresas where id = p_id;
    if not found then
      raise exception 'alvo % % não encontrado', p_tabela, p_id using errcode = 'no_data_found';
    end if;
    -- A marca não sobra no resto da transação.
    perform set_config('vv.exclusao_empresa', '', true);
  else
    raise exception 'tabela % não admite exclusão definitiva', p_tabela using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- migrate:down
create or replace function core.executar_exclusao(p_tabela text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tabela = 'core.empresas' then
    perform set_config('vv.exclusao_empresa', p_id::text, true);
    delete from core.empresa_enquadramentos where empresa_id = p_id;
    delete from core.empresa_contatos where empresa_id = p_id;
    delete from core.empresa_cnaes where empresa_id = p_id;
    delete from core.permissoes where empresa_id = p_id;
    delete from core.vinculos where empresa_id = p_id;
    delete from core.empresas where id = p_id;
    if not found then
      raise exception 'alvo % % não encontrado', p_tabela, p_id using errcode = 'no_data_found';
    end if;
    perform set_config('vv.exclusao_empresa', '', true);
  else
    raise exception 'tabela % não admite exclusão definitiva', p_tabela using errcode = 'insufficient_privilege';
  end if;
end;
$$;
