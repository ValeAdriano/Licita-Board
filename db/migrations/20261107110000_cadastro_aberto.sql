-- Cadastro de conta pela própria pessoa (autocadastro): nome, e-mail, senha e a empresa dela (razão social e
-- CNPJ). Substitui core.cadastrar_conta_teste (que nasceu como atalho só de desenvolvimento): agora é o
-- cadastro normal do produto, com a empresa informada (não mais fictícia). O e-mail NÃO é verificado aqui
-- (nasce sem verificação, como no convite) e o primeiro login obriga o MFA.
--
-- O autocadastro é uma decisão de produto que o sistema só atende por convite: por isso há uma chave no
-- banco (`alter database ... set vv.cadastro = 'aberto'`, ligada por scripts/dev-up.sh) e outra na API
-- (CADASTRO_ABERTO, padrão ligado só em VV_ENV=dev). Sem a chave, a função recusa. Nunca cria SUPERADMIN.
-- ⚖️ Em produção, abrir o cadastro exige validar quem pode cadastrar qual CNPJ (hoje não há prova de posse).

-- migrate:up
drop function core.cadastrar_conta_teste(text, text, text);

create function core.cadastrar_conta(p_email text, p_nome text, p_senha_hash text, p_razao_social text, p_cnpj text)
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
begin
  if current_setting('vv.cadastro', true) is distinct from 'aberto' then
    raise exception 'cadastro não está aberto' using errcode = 'insufficient_privilege';
  end if;
  if p_senha_hash is null or p_senha_hash !~ '^\$argon2id\$' then
    raise exception 'senha inválida' using errcode = 'invalid_parameter_value';
  end if;
  insert into core.usuarios (email, nome, senha_hash, superadmin, email_verificado_em)
  values (p_email, left(btrim(p_nome), 120), p_senha_hash, false, null)
  returning id into v_usuario;
  insert into core.empresas (razao_social, cnpj) values (left(btrim(p_razao_social), 200), p_cnpj)
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
revoke all on function core.cadastrar_conta(text, text, text, text, text) from public;
grant execute on function core.cadastrar_conta(text, text, text, text, text) to vv_api;

-- migrate:down
drop function core.cadastrar_conta(text, text, text, text, text);
create function core.cadastrar_conta_teste(p_email text, p_nome text, p_senha_hash text)
returns uuid language plpgsql as $$ begin raise exception 'removida'; end; $$;
