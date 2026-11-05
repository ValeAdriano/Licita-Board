-- Fase 05 · Quem pode ser responsável por um acompanhamento, evento ou participação: usuários ativos da empresa
-- com agenda/visualizar. Quem só tem agenda/visualizar enxerga nome e id deles (não e-mail nem permissões).

-- migrate:up
create function priv.responsaveis_agenda(p_empresa uuid)
returns table (usuario_id uuid, nome text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'agenda', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  return query
    select distinct u.id, u.nome
      from core.vinculos v
      join core.usuarios u on u.id = v.usuario_id and u.ativo and u.deleted_at is null
      join core.permissoes p on p.vinculo_id = v.id and p.modulo = 'agenda' and p.acao = 'visualizar'
     where v.empresa_id = p_empresa and v.ativo and v.deleted_at is null
     order by u.nome;
end;
$$;
grant execute on function priv.responsaveis_agenda(uuid) to vv_api;

-- migrate:down
drop function priv.responsaveis_agenda(uuid);
