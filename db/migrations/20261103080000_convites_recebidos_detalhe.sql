-- Fase 01 · PR 8 · Convite recebido mostra quem é a empresa e quem convidou (threat-model T3.1c).
--
-- O nome da empresa é texto livre de terceiro: quem recebe um convite precisa ver o CNPJ e o nome de
-- quem convidou antes de aceitar (convite de empresa homônima ou de autor desconhecido). A função
-- ganha duas colunas; as regras de quem enxerga o quê continuam idênticas.

-- migrate:up
drop function core.meus_convites();

create function core.meus_convites()
returns table (id uuid, empresa text, papel text, permissoes text[], convidado_em timestamptz, expira_em timestamptz,
               cnpj text, convidado_por text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(e.nome_fantasia, e.razao_social), c.papel, c.permissoes, c.created_at, c.expira_em,
         e.cnpj, a.nome
    from core.convites c
    join core.empresas e on e.id = c.empresa_id
    join core.usuarios u on u.id = c.usuario_id
    left join core.usuarios a on a.id = c.criado_por
   where c.usuario_id = core.usuario_atual()
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
     and u.ativo and u.deleted_at is null and u.email_verificado_em is not null
     and e.ativo and e.deleted_at is null
     and core.administra_empresa(c.criado_por, c.empresa_id)
     and core.autor_cobre_convite(c.criado_por, c.empresa_id, c.permissoes)
   order by c.created_at desc;
$$;

grant execute on function core.meus_convites() to vv_api;

-- migrate:down
drop function core.meus_convites();

create function core.meus_convites()
returns table (id uuid, empresa text, papel text, permissoes text[], convidado_em timestamptz, expira_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, coalesce(e.nome_fantasia, e.razao_social), c.papel, c.permissoes, c.created_at, c.expira_em
    from core.convites c
    join core.empresas e on e.id = c.empresa_id
    join core.usuarios u on u.id = c.usuario_id
   where c.usuario_id = core.usuario_atual()
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
     and u.ativo and u.deleted_at is null and u.email_verificado_em is not null
     and e.ativo and e.deleted_at is null
     and core.administra_empresa(c.criado_por, c.empresa_id)
     and core.autor_cobre_convite(c.criado_por, c.empresa_id, c.permissoes)
   order by c.created_at desc;
$$;

grant execute on function core.meus_convites() to vv_api;
