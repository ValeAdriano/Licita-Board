-- Cadastro de conta de TESTE (só desenvolvimento): cria usuário com e-mail já verificado, uma empresa
-- FICTÍCIA e o vínculo ADMIN_EMPRESA com todas as permissões, como `scripts/criar-usuario.mjs --ficticio`,
-- mas pela API, para testar o sistema à mão. Nunca cria SUPERADMIN.
--
-- Três travas independentes (o sistema real só cria usuário por convite):
--   1. esta função recusa se o banco não estiver marcado como dev (`alter database ... set vv.ambiente = 'dev'`,
--      feito por scripts/dev-up.sh; produção não tem a marca);
--   2. a API só expõe a rota com VV_ENV=dev;
--   3. o front só mostra a tela quando VITE_VV_ENV=dev.

-- migrate:up
create function core.cadastrar_conta_teste(p_email text, p_nome text, p_senha_hash text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid;
  v_empresa uuid;
  v_vinculo uuid;
  v_base int[];
  v_d1 int;
  v_d2 int;
  v_cnpj text;
begin
  if current_setting('vv.ambiente', true) is distinct from 'dev' then
    raise exception 'cadastro de conta de teste só existe em desenvolvimento' using errcode = 'insufficient_privilege';
  end if;
  if p_senha_hash is null or p_senha_hash !~ '^\$argon2id\$' then
    raise exception 'senha inválida' using errcode = 'invalid_parameter_value';
  end if;
  insert into core.usuarios (email, nome, senha_hash, superadmin, email_verificado_em)
  values (p_email, left(btrim(p_nome), 120), p_senha_hash, false, now())
  returning id into v_usuario;

  -- CNPJ numérico fictício com dígitos verificadores válidos (tenta de novo se colidir).
  loop
    v_base := array(select (random() * 9)::int from generate_series(1, 12));
    v_d1 := (select sum(x * p) from unnest(v_base, array[5,4,3,2,9,8,7,6,5,4,3,2]) as t(x, p)) % 11;
    v_d1 := case when v_d1 < 2 then 0 else 11 - v_d1 end;
    v_d2 := (select sum(x * p) from unnest(v_base || v_d1, array[6,5,4,3,2,9,8,7,6,5,4,3,2]) as t(x, p)) % 11;
    v_d2 := case when v_d2 < 2 then 0 else 11 - v_d2 end;
    v_cnpj := array_to_string(v_base, '') || v_d1::text || v_d2::text;
    exit when not exists (select 1 from core.empresas where cnpj = v_cnpj);
  end loop;
  insert into core.empresas (razao_social, cnpj)
  values ('Empresa Fictícia ' || substr(md5(random()::text), 1, 6) || ' Ltda', v_cnpj)
  returning id into v_empresa;
  insert into core.vinculos (usuario_id, empresa_id, papel) values (v_usuario, v_empresa, 'ADMIN_EMPRESA')
  returning id into v_vinculo;
  insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
  select v_vinculo, v_empresa, m.slug, a
    from core.modulos m,
         unnest(array['visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
                      'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar',
                      'administrar_permissoes']) a;
  return v_usuario;
end;
$$;
revoke all on function core.cadastrar_conta_teste(text, text, text) from public;
grant execute on function core.cadastrar_conta_teste(text, text, text) to vv_api;

-- migrate:down
drop function core.cadastrar_conta_teste(text, text, text);
