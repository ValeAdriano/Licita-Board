-- Fase 02 · PR 1 · A exclusão definitiva da empresa passa a apagar também a ficha completa
-- (CNAEs, contatos e enquadramentos) criada em 20261104100000. O teste 080 trava a lista de FKs sem
-- cascade para core.empresas e exige que esta função acompanhe (db/AGENTS.md; spec fase-02 §3).
-- A marca vv.exclusao_empresa libera só o DELETE do histórico de enquadramento, só desta empresa e só
-- nesta transação (set_config local).

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
    delete from core.permissoes where empresa_id = p_id;
    delete from core.vinculos where empresa_id = p_id;
    delete from core.empresas where id = p_id;
    if not found then
      raise exception 'alvo % % não encontrado', p_tabela, p_id using errcode = 'no_data_found';
    end if;
  else
    raise exception 'tabela % não admite exclusão definitiva', p_tabela using errcode = 'insufficient_privilege';
  end if;
end;
$$;
