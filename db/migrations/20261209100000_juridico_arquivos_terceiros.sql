-- Fase 10 · Q-43: arquivo (PDF, Word, imagem) do recurso de terceiro (10.6) e dos documentos da concorrente (10.4) pelo fluxo seguro da
-- Fase 03, no lugar de só colar o texto. O arquivo entra no repositório documental (quarentena, antivírus, tipo real, SHA-256); o worker já
-- extrai o texto de toda versão liberada para priv.documento_trechos. Aqui o banco MONTA o texto a partir desses trechos e o grava no recurso
-- (ou acrescenta ao texto da concorrente no parecer), registrando de qual versão veio. O texto continua sendo DADO de terceiro (regra 16):
-- vai para a IA delimitado, como o texto colado já ia. Só arquivos dos tipos de terceiro (pasta 'licitacao') servem, para que o fluxo não
-- leia documento privado da própria empresa. Limite do texto sobe de 60 mil para 200 mil caracteres (um recurso de 30 páginas não cabia).

-- migrate:up
insert into pub.tipos_documento (slug, nome, pasta, exige_validade, emissor_url, ordem)
values ('proposta_concorrente', 'Proposta da vencedora', 'licitacao', false, null, 385)
on conflict (slug) do nothing;

alter table priv.recursos_terceiros drop constraint recursos_terceiros_texto_check;
alter table priv.recursos_terceiros add constraint recursos_terceiros_texto_check check (char_length(texto) between 50 and 200000);
alter table priv.pareceres_recursais drop constraint pareceres_recursais_texto_concorrente_check;
alter table priv.pareceres_recursais add constraint pareceres_recursais_texto_concorrente_check check (char_length(texto_concorrente) <= 200000);

-- De qual arquivo (versão liberada) saiu o texto de um recurso de terceiro ou de um parecer.
create table priv.juridico_arquivos (
  id            uuid primary key default core.uuid_v7(),
  empresa_id    uuid not null references core.empresas (id) on delete cascade,
  recurso_id    uuid,
  parecer_id    uuid,
  documento_id  uuid not null,
  versao_id     uuid not null references priv.documento_versoes (id) on delete cascade,
  nome          text not null check (char_length(nome) between 1 and 255),
  caracteres    int not null check (caracteres >= 0),
  created_at    timestamptz not null default now(),
  created_by    uuid default core.usuario_atual(),
  foreign key (recurso_id, empresa_id) references priv.recursos_terceiros (id, empresa_id) on delete cascade,
  foreign key (parecer_id, empresa_id) references priv.pareceres_recursais (id, empresa_id) on delete cascade,
  foreign key (documento_id, empresa_id) references priv.documentos (id, empresa_id) on delete cascade,
  check (num_nonnulls(recurso_id, parecer_id) = 1),
  unique (recurso_id, versao_id),
  unique (parecer_id, versao_id)
);
create index juridico_arquivos_empresa_idx on priv.juridico_arquivos (empresa_id);
create index juridico_arquivos_recurso_idx on priv.juridico_arquivos (recurso_id);
create index juridico_arquivos_parecer_idx on priv.juridico_arquivos (parecer_id);

alter table priv.juridico_arquivos enable row level security;
create policy juridico_arquivos_select on priv.juridico_arquivos for select to vv_api using (core.has_permission(empresa_id, 'juridico', 'visualizar'));
grant select on priv.juridico_arquivos to vv_api;
create trigger juridico_arquivos_audit after insert or update or delete on priv.juridico_arquivos for each row execute function audit.registrar();
alter table priv.juridico_arquivos enable always trigger juridico_arquivos_audit;

-- Texto da última versão LIBERADA de um documento de terceiro, página a página. Interna: só as funções abaixo a chamam (já com a permissão
-- conferida). Ausente ou de outra empresa → P0002; tipo errado, verificação em curso, bloqueado ou sem texto legível → 22023.
create function priv.texto_arquivo_terceiro(p_empresa uuid, p_documento uuid, p_tipos text[], out o_versao uuid, out o_nome text, out o_texto text, out o_caracteres int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tipo text;
begin
  select t.slug into v_tipo
    from priv.documentos d join pub.tipos_documento t on t.id = d.tipo_id
   where d.id = p_documento and d.empresa_id = p_empresa and d.deleted_at is null;
  if not found then
    raise exception 'arquivo não encontrado' using errcode = 'no_data_found';
  end if;
  if not (v_tipo = any (p_tipos)) then
    raise exception 'este arquivo não é do tipo esperado (recurso ou documento da concorrente)' using errcode = 'invalid_parameter_value';
  end if;
  select id, nome_original into o_versao, o_nome
    from priv.documento_versoes
   where documento_id = p_documento and empresa_id = p_empresa and status_arquivo = 'liberado'
   order by versao desc limit 1;
  if o_versao is null then
    if exists (select 1 from priv.documento_versoes where documento_id = p_documento and empresa_id = p_empresa and status_arquivo = 'quarentena') then
      raise exception 'o arquivo ainda está em verificação (antivírus); tente de novo em instantes' using errcode = 'invalid_parameter_value';
    end if;
    raise exception 'o arquivo foi bloqueado na verificação ou ainda não foi enviado' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(sum(char_length(texto)), 0)::int into o_caracteres from priv.documento_trechos where versao_id = o_versao;
  if o_caracteres < 50 then
    raise exception 'não foi possível ler texto neste arquivo (imagem sem OCR?); cole o texto' using errcode = 'invalid_parameter_value';
  end if;
  select string_agg(p.txt, E'\n\n' order by p.pagina) into o_texto
    from (select pagina, '[página ' || pagina || E']\n' || string_agg(texto, E'\n' order by ordem) as txt
            from priv.documento_trechos where versao_id = o_versao group by pagina) p;
end;
$$;
revoke all on function priv.texto_arquivo_terceiro(uuid, uuid, text[]) from public;

-- Recurso de terceiro a partir do arquivo enviado: mesmo efeito de priv.inserir_recurso_terceiro (prazo, peça, leitura pela IA).
create function priv.inserir_recurso_terceiro_arquivo(p_empresa uuid, p_acomp uuid, p_recorrente text, p_publicado_em timestamptz, p_documento uuid, p_link text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
  v jsonb;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from priv.acompanhamentos where id = p_acomp and empresa_id = p_empresa and deleted_at is null) then
    raise exception 'acompanhamento não encontrado' using errcode = 'no_data_found';
  end if;
  select * into a from priv.texto_arquivo_terceiro(p_empresa, p_documento, array['recurso_terceiro_arquivo']);
  if char_length(a.o_texto) > 200000 then
    raise exception 'o texto do arquivo passa de 200 mil caracteres; envie só o recurso' using errcode = 'invalid_parameter_value';
  end if;
  v := priv.inserir_recurso_terceiro(p_empresa, p_acomp, p_recorrente, p_publicado_em, a.o_texto, p_link);
  insert into priv.juridico_arquivos (empresa_id, recurso_id, documento_id, versao_id, nome, caracteres)
  values (p_empresa, (v ->> 'id')::uuid, p_documento, a.o_versao, a.o_nome, a.o_caracteres);
  return v || jsonb_build_object('caracteres', a.o_caracteres);
end;
$$;
revoke all on function priv.inserir_recurso_terceiro_arquivo(uuid, uuid, text, timestamptz, uuid, text) from public;
grant execute on function priv.inserir_recurso_terceiro_arquivo(uuid, uuid, text, timestamptz, uuid, text) to vv_api;

-- Acrescenta ao texto da concorrente o texto de um arquivo (proposta ou habilitação da vencedora) e reconfere a evidência.
create function priv.anexar_arquivo_parecer(p_empresa uuid, p_parecer uuid, p_documento uuid)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a record;
  v_texto text;
  v_novo text;
begin
  if not core.has_permission(p_empresa, 'juridico', 'elaborar_peca') then
    raise exception 'sem permissão' using errcode = 'insufficient_privilege';
  end if;
  select texto_concorrente into v_texto from priv.pareceres_recursais where id = p_parecer and empresa_id = p_empresa for update;
  if not found then
    raise exception 'parecer não encontrado' using errcode = 'no_data_found';
  end if;
  select * into a from priv.texto_arquivo_terceiro(p_empresa, p_documento, array['habilitacao_concorrente', 'proposta_concorrente']);
  if exists (select 1 from priv.juridico_arquivos where parecer_id = p_parecer and versao_id = a.o_versao) then
    raise exception 'este arquivo já foi anexado ao parecer' using errcode = 'invalid_parameter_value';
  end if;
  v_novo := coalesce(nullif(btrim(v_texto), '') || E'\n\n', '') || '[arquivo: ' || a.o_nome || E']\n' || a.o_texto;
  if char_length(v_novo) > 200000 then
    raise exception 'o texto da concorrente passaria de 200 mil caracteres; envie só as páginas que importam' using errcode = 'invalid_parameter_value';
  end if;
  update priv.pareceres_recursais
     set texto_concorrente = v_novo, updated_at = now(), validacao = null, validada_em = null, bloqueado = true
   where id = p_parecer;
  insert into priv.juridico_arquivos (empresa_id, parecer_id, documento_id, versao_id, nome, caracteres)
  values (p_empresa, p_parecer, p_documento, a.o_versao, a.o_nome, a.o_caracteres);
  perform priv.enfileirar_parecer(p_empresa, p_parecer);
  return a.o_caracteres;
end;
$$;
revoke all on function priv.anexar_arquivo_parecer(uuid, uuid, uuid) from public;
grant execute on function priv.anexar_arquivo_parecer(uuid, uuid, uuid) to vv_api;

-- migrate:down
drop function priv.anexar_arquivo_parecer(uuid, uuid, uuid);
drop function priv.inserir_recurso_terceiro_arquivo(uuid, uuid, text, timestamptz, uuid, text);
drop function priv.texto_arquivo_terceiro(uuid, uuid, text[]);
drop table priv.juridico_arquivos;
-- Volta ao limite antigo: falha se já houver texto acima de 60 mil caracteres (de propósito: não se trunca texto jurídico).
alter table priv.pareceres_recursais drop constraint pareceres_recursais_texto_concorrente_check;
alter table priv.pareceres_recursais add constraint pareceres_recursais_texto_concorrente_check check (char_length(texto_concorrente) <= 60000);
alter table priv.recursos_terceiros drop constraint recursos_terceiros_texto_check;
alter table priv.recursos_terceiros add constraint recursos_terceiros_texto_check check (char_length(texto) between 50 and 60000);
delete from pub.tipos_documento where slug = 'proposta_concorrente' and not exists (select 1 from priv.documentos d where d.tipo_id = pub.tipos_documento.id);
