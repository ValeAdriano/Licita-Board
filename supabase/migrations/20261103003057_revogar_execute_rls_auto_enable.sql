-- Infra · Advisor de segurança do projeto remoto (lints 0028/0029).
--
-- * public.rls_auto_enable() é criada pela plataforma Supabase quando o projeto nasce com "RLS
--   automático": é a função do event trigger ensure_rls (ddl_command_end), security definer, dona
--   postgres, com EXECUTE para PUBLIC, anon e authenticated. Fica exposta em /rest/v1/rpc.
-- * Event trigger não depende de EXECUTE para disparar, então revogar não desliga o RLS automático.
-- * A função não existe no stack local do CLI nem em projeto criado sem RLS automático: por isso o
--   bloco condicional. Não alteramos a função (é da plataforma), só os grants.
-- * Revoke feito por quem não é dono só emite WARNING e não muda nada; a conferência abaixo faz o
--   push falhar em vez de registrar a migration como aplicada sem efeito.
-- * Se a plataforma recriar a função (ex.: desligar e religar o RLS automático), os grants voltam:
--   conferir o advisor (0028/0029) depois de cada deploy de banco.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
    if has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
       or has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') then
      raise exception 'revoke sem efeito em public.rls_auto_enable(): rode como dono (postgres)';
    end if;
  end if;
end;
$$;

-- down:
-- do $$ begin
--   if to_regprocedure('public.rls_auto_enable()') is not null then
--     grant execute on function public.rls_auto_enable() to public, anon, authenticated;
--   end if;
-- end $$;
