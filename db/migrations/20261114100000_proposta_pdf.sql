-- Fase 08 · PDF da proposta final (decisão do Adriano, 2026-11-05: instalar LibreOffice na imagem do worker). O PDF é convertido do .docx
-- final e guardado com o seu próprio SHA-256. A versão final segue imutável: a única mudança permitida depois do final é GRAVAR o PDF
-- uma vez (colunas arquivo_pdf_*), nunca alterar o conteúdo nem o .docx.

-- migrate:up
alter table priv.propostas
  add column arquivo_pdf_chave text,
  add column arquivo_pdf_sha256 text check (arquivo_pdf_sha256 ~ '^[0-9a-f]{64}$'),
  add check ((arquivo_pdf_chave is null) = (arquivo_pdf_sha256 is null));

create or replace function priv.propostas_final_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'final' then
    -- só vale gravar o PDF uma vez; qualquer outra coluna (exceto updated_at) tem de ficar igual
    if old.arquivo_pdf_chave is null and new.arquivo_pdf_chave is not null
       and (to_jsonb(old) - 'arquivo_pdf_chave' - 'arquivo_pdf_sha256' - 'updated_at') = (to_jsonb(new) - 'arquivo_pdf_chave' - 'arquivo_pdf_sha256' - 'updated_at') then
      return new;
    end if;
    raise exception 'proposta final é imutável: crie uma nova versão' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

grant update (arquivo_pdf_chave, arquivo_pdf_sha256) on priv.propostas to vv_worker;

-- Pede o PDF de uma proposta final que ainda não o tem (idempotente: o worker só converte se faltar).
create function priv.pedir_pdf_proposta(p_empresa uuid, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not core.has_permission(p_empresa, 'propostas', 'visualizar') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.propostas where id = p_id and empresa_id = p_empresa and status = 'final' and deleted_at is null) then
    raise exception 'só a proposta final tem PDF' using errcode = 'no_data_found';
  end if;
  perform priv.enfileirar_proposta(p_empresa, p_id);
end;
$$;
grant execute on function priv.pedir_pdf_proposta(uuid, uuid) to vv_api;

-- migrate:down
drop function priv.pedir_pdf_proposta(uuid, uuid);
create or replace function priv.propostas_final_imutavel() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'final' then
    raise exception 'proposta final é imutável: crie uma nova versão' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
alter table priv.propostas drop column arquivo_pdf_sha256, drop column arquivo_pdf_chave;
