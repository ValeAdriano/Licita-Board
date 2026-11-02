-- SOMENTE DADOS FICTÍCIOS (Prompt Mestre: "Nunca usar dados reais de clientes em desenvolvimento").
-- Roda no `npx supabase db reset` local. Nunca é aplicado em produção.
--
-- Usuários de desenvolvimento (senha de todos: DevLicita2026). Perfis internos pedem o cadastro
-- do autenticador (MFA) no primeiro login.
--   superadmin@vv.local  · SUPERADMIN
--   admin@demo-a.local   · ADMIN_EMPRESA da Empresa Demo A (todas as permissões)
--   cliente@demo-a.local · CLIENTE da Empresa Demo A (só visualizar, sem MFA obrigatório)
--   admin@demo-b.local   · ADMIN_EMPRESA da Empresa Demo B

do $$
declare
  v_usuarios constant jsonb := '[
    {"email": "superadmin@vv.local",  "nome": "Super Admin (dev)"},
    {"email": "admin@demo-a.local",   "nome": "Admin Demo A"},
    {"email": "cliente@demo-a.local", "nome": "Cliente Demo A"},
    {"email": "admin@demo-b.local",   "nome": "Admin Demo B"}
  ]';
  v_u jsonb;
  v_id uuid;
begin
  for v_u in select * from jsonb_array_elements(v_usuarios) loop
    v_id := gen_random_uuid();
    -- Campos de token vazios ('' e não NULL): o GoTrue falha ao ler NULL nessas colunas.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_u ->> 'email', extensions.crypt('DevLicita2026', extensions.gen_salt('bf')), now(),
      '{"provider": "email", "providers": ["email"]}', jsonb_build_object('nome', v_u ->> 'nome'),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_id, v_id::text, 'email',
      jsonb_build_object('sub', v_id::text, 'email', v_u ->> 'email', 'email_verified', true),
      now(), now(), now()
    );
  end loop;
end;
$$;

update core.usuarios set superadmin = true where email = 'superadmin@vv.local';

insert into core.empresas (razao_social, nome_fantasia, cnpj) values
  ('Empresa Demo A Comércio de Veículos Ltda (FICTÍCIA)', 'Demo A', '90000001000129'),
  ('Empresa Demo B Equipamentos Ltda (FICTÍCIA)', 'Demo B', '90000002000173');

with v as (
  insert into core.vinculos (usuario_id, empresa_id, papel)
  select u.id, e.id, x.papel
    from (values
      ('admin@demo-a.local', 'Demo A', 'ADMIN_EMPRESA'),
      ('cliente@demo-a.local', 'Demo A', 'CLIENTE'),
      ('admin@demo-b.local', 'Demo B', 'ADMIN_EMPRESA')
    ) as x (email, empresa, papel)
    join core.usuarios u on u.email = x.email
    join core.empresas e on e.nome_fantasia = x.empresa
  returning id, empresa_id, papel
)
insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
select v.id, v.empresa_id, m.slug, a.acao
  from v
 cross join core.modulos m
 cross join unnest(array[
   'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
   'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar', 'administrar_permissoes'
 ]) as a (acao)
 where v.papel <> 'CLIENTE' or a.acao = 'visualizar';
