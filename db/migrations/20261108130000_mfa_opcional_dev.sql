-- 2FA opcional (decisão do Adriano, 2026-11-05). Por padrão NADA muda: perfil interno e SUPERADMIN continuam
-- obrigados a ter MFA (T5.8). A exigência só cai quando o banco recebe a chave explícita
-- `alter database ... set vv.mfa = 'opcional'` (ligada por scripts/dev-up.sh, como vv.cadastro).
-- Com a chave: quem NÃO cadastrou TOTP usa a sessão aal1 como completa; quem cadastrou continua precisando
-- do código (o fator só some se a pessoa o desativar/redefinir). Produção deve ficar SEM a chave.

-- migrate:up
create or replace function core.mfa_obrigatorio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_setting('vv.mfa', true) is distinct from 'opcional'
     and (exists (select 1 from core.usuarios u where u.id = core.usuario_atual() and u.superadmin)
          or exists (select 1 from core.vinculos v where v.usuario_id = core.usuario_atual()
                      and v.ativo and v.deleted_at is null and v.papel <> 'CLIENTE'))
$$;

create or replace function core.mfa_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select core.aal_atual() = 'aal2'
      or (current_setting('vv.mfa', true) is not distinct from 'opcional' and core.aal_atual() = 'aal1' and not core.tem_mfa())
$$;

-- migrate:down
create or replace function core.mfa_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select core.aal_atual() = 'aal2'
$$;

create or replace function core.mfa_obrigatorio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from core.usuarios u where u.id = core.usuario_atual() and u.superadmin)
      or exists (select 1 from core.vinculos v where v.usuario_id = core.usuario_atual()
                  and v.ativo and v.deleted_at is null and v.papel <> 'CLIENTE')
$$;
