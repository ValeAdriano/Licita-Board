-- Fase 04 · Download de arquivo de edital: permissão (editais/visualizar em alguma empresa), arquivo liberado e
-- REGISTRO de quem baixou. A API só assina a URL de 60 s com a chave devolvida aqui.

-- migrate:up
create table ops.edital_downloads (
  id         uuid primary key default core.uuid_v7(),
  arquivo_id uuid not null references pub.edital_arquivos (id),
  usuario_id uuid not null references core.usuarios (id),
  em         timestamptz not null default now(),
  ip         inet
);
create index edital_downloads_idx on ops.edital_downloads (arquivo_id, em desc);
alter table ops.edital_downloads enable row level security;
create policy edital_downloads_select on ops.edital_downloads for select to vv_api using ((select core.is_superadmin()));
grant select on ops.edital_downloads to vv_api;

create function pub.registrar_download_edital(p_arquivo uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v record;
begin
  if not core.pode_ver_editais() then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select id, arquivo_chave into v from pub.edital_arquivos where id = p_arquivo and status_arquivo = 'liberado';
  if not found then
    raise exception 'arquivo indisponível' using errcode = 'no_data_found';
  end if;
  insert into ops.edital_downloads (arquivo_id, usuario_id, ip) values (p_arquivo, core.usuario_atual(), core.ip_atual());
  return v.arquivo_chave;
end;
$$;
grant execute on function pub.registrar_download_edital(uuid) to vv_api;

-- migrate:down
drop function pub.registrar_download_edital(uuid);
drop table ops.edital_downloads;
