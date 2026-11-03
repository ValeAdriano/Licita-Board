-- Fase 01 · PR 4 · Endurecimento do MFA após as revisões dos endpoints (T5.12–T5.14).
--
-- * Fator pendente preso à sessão que o cadastrou: outra sessão do mesmo usuário não apaga nem
--   confirma o cadastro do dono. Confirmar descarta os demais pendentes do usuário e, se já houver
--   autenticador, exige MFA recente NA CONFIRMAÇÃO (não só no cadastro): quem só tem a senha não
--   troca o autenticador do dono. Trocar encerra as outras sessões.
-- * Apagar uma sessão nunca apaga um fator verificado (sessao_id fica nulo ao verificar).
-- * Cadastro limitado a 5 por usuário a cada 15 min (contador na linha do usuário, serializado).
--   A API exige e confere a senha atual antes (reautenticação); a falha cobrada antes do Argon2 é
--   devolvida quando a senha confere (estornar_falha_verificacao), para senha certa não somar erros.
-- * Força bruta lenta: erros consecutivos zerados só por acerto bloqueiam o MFA sem prazo na 50ª.
--   Desbloqueio: core.resetar_mfa por SUPERADMIN com MFA recente e a KEK, nunca sobre si nem sobre
--   outro SUPERADMIN (decisão 2026-11-03; o último SUPERADMIN é desbloqueado por runbook com vv_owner).
--   O reset apaga fatores e códigos, encerra as sessões e INVALIDA A SENHA do alvo: quem tinha a
--   senha não chega antes do dono no novo cadastro; o dono volta pela recuperação por e-mail.
-- * cadastrar_totp devolve o vencimento do pendente.

-- migrate:up
alter table core.fatores_mfa add column sessao_id uuid references core.sessoes (id) on delete set null;
delete from core.fatores_mfa where verificado_em is null;  -- pendentes antigos sem sessão
alter table core.fatores_mfa add constraint fatores_mfa_pendente_com_sessao
  check (verificado_em is not null or sessao_id is not null);
drop index core.fatores_mfa_pendente_uk;
create unique index fatores_mfa_pendente_uk on core.fatores_mfa (sessao_id) where verificado_em is null;
alter table core.usuarios
  add column falhas_mfa_consecutivas int not null default 0,
  add column cadastros_mfa int not null default 0,
  add column janela_cadastro_mfa_em timestamptz,
  add column mfa_resetado_em timestamptz;

create or replace function core.registrar_falha_mfa()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.usuario_atual();
  v_falhas int;
  v_consecutivas int;
begin
  update core.sessoes
     set falhas_mfa = falhas_mfa + 1,
         revogada_em = case when falhas_mfa + 1 >= 5 then now() else revogada_em end
   where id = core.sessao_atual();
  update core.usuarios
     set falhas_mfa = case when ultima_falha_mfa_em > now() - interval '15 minutes' then falhas_mfa + 1 else 1 end,
         falhas_mfa_consecutivas = falhas_mfa_consecutivas + 1,
         ultima_falha_mfa_em = now()
   where id = v_usuario
  returning falhas_mfa, falhas_mfa_consecutivas into v_falhas, v_consecutivas;
  if v_consecutivas >= 50 then
    update core.usuarios set mfa_bloqueado_ate = 'infinity', falhas_mfa = 0 where id = v_usuario;
    update core.sessoes set revogada_em = now() where usuario_id = v_usuario and revogada_em is null;
  elsif v_falhas >= 10 then
    update core.usuarios set mfa_bloqueado_ate = now() + interval '15 minutes', falhas_mfa = 0 where id = v_usuario;
    update core.sessoes set revogada_em = now() where usuario_id = v_usuario and revogada_em is null;
  end if;
end;
$$;

-- Devolve a falha cobrada antes de conferir a senha, quando a senha confere (API).
create function core.estornar_falha_verificacao()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update core.sessoes set falhas_mfa = greatest(falhas_mfa - 1, 0) where id = core.sessao_atual();
  update core.usuarios
     set falhas_mfa = greatest(falhas_mfa - 1, 0),
         falhas_mfa_consecutivas = greatest(falhas_mfa_consecutivas - 1, 0)
   where id = core.usuario_atual();
end;
$$;

create or replace function core.elevar_sessao(p_metodo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update core.sessoes set aal = 'aal2', mfa_em = now(), mfa_metodo = p_metodo, falhas_mfa = 0
   where id = core.sessao_atual();
  update core.usuarios set falhas_mfa = 0, falhas_mfa_consecutivas = 0 where id = core.usuario_atual();
end;
$$;

drop function core.cadastrar_totp(bytea, text);
create function core.cadastrar_totp(p_segredo bytea, p_kek text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
  v_versao int := core.conferir_kek(p_kek);
  v_cadastros int;
begin
  if octet_length(p_segredo) < 20 then
    raise exception 'segredo TOTP curto' using errcode = '22023';
  end if;
  if core.tem_mfa() and not core.mfa_recente() then
    raise exception 'trocar o autenticador exige MFA recente' using errcode = '42501';
  end if;
  update core.usuarios
     set cadastros_mfa = case when janela_cadastro_mfa_em > now() - interval '15 minutes' then cadastros_mfa + 1 else 1 end,
         janela_cadastro_mfa_em = case when janela_cadastro_mfa_em > now() - interval '15 minutes'
                                       then janela_cadastro_mfa_em else now() end
   where id = v_usuario
  returning cadastros_mfa into v_cadastros;
  if v_cadastros > 5 then
    raise exception 'muitos cadastros de autenticador; tente mais tarde' using errcode = '54000';
  end if;
  delete from core.fatores_mfa
   where usuario_id = v_usuario and verificado_em is null
     and (sessao_id = core.sessao_atual() or criado_em <= now() - interval '15 minutes');
  insert into core.fatores_mfa (usuario_id, sessao_id, segredo_cifrado, versao_kek)
  values (v_usuario, core.sessao_atual(),
          extensions.pgp_sym_encrypt_bytea(p_segredo, p_kek, 'cipher-algo=aes256'), v_versao);
  return now() + interval '15 minutes';
end;
$$;

create or replace function core.confirmar_totp(p_codigo text, p_kek text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
  v_fator uuid;
  v_passo bigint;
  v_tinha boolean;
begin
  perform core.conferir_kek(p_kek);
  select id into v_fator from core.fatores_mfa
   where sessao_id = core.sessao_atual() and usuario_id = v_usuario and verificado_em is null
     and criado_em > now() - interval '15 minutes';
  v_passo := case when v_fator is not null then core.conferir_totp(v_fator, p_codigo, p_kek) end;
  if v_passo is null then
    perform core.registrar_falha_mfa();
    return false;
  end if;
  v_tinha := core.tem_mfa();
  if v_tinha and not core.mfa_recente() then
    raise exception 'trocar o autenticador exige MFA recente' using errcode = '42501';
  end if;
  delete from core.fatores_mfa where usuario_id = v_usuario and id <> v_fator;
  update core.fatores_mfa set verificado_em = now(), ultimo_passo = v_passo, sessao_id = null
   where id = v_fator and verificado_em is null and ultimo_passo < v_passo;
  if not found then
    raise exception 'código já usado' using errcode = '28000';
  end if;
  perform core.elevar_sessao('totp');
  if v_tinha then
    perform core.encerrar_todas_sessoes(true);
  end if;
  return true;
end;
$$;

create function core.resetar_mfa(p_usuario uuid, p_kek text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform core.conferir_kek(p_kek);
  if not core.is_superadmin() or not core.mfa_recente() or p_usuario is null
     or p_usuario = core.usuario_atual() then
    raise exception 'reset de MFA exige outro SUPERADMIN com MFA recente' using errcode = '42501';
  end if;
  if exists (select 1 from core.usuarios u where u.id = p_usuario and u.superadmin) then
    raise exception 'reset de MFA de SUPERADMIN não é feito pelo app (runbook)' using errcode = '42501';
  end if;
  update core.usuarios
     set mfa_bloqueado_ate = null, falhas_mfa = 0, falhas_mfa_consecutivas = 0,
         senha_hash = null, senha_trocada_em = now(), mfa_resetado_em = now()
   where id = p_usuario;
  if not found then
    raise exception 'usuário não encontrado' using errcode = '22023';
  end if;
  delete from core.fatores_mfa where usuario_id = p_usuario;
  delete from core.codigos_recuperacao where usuario_id = p_usuario;
  update core.sessoes set revogada_em = now() where usuario_id = p_usuario and revogada_em is null;
end;
$$;

grant execute on function core.cadastrar_totp(bytea, text), core.resetar_mfa(uuid, text),
  core.estornar_falha_verificacao() to vv_api;

-- migrate:down
update core.usuarios set mfa_bloqueado_ate = now() + interval '15 minutes' where mfa_bloqueado_ate = 'infinity';
drop function core.resetar_mfa(uuid, text), core.estornar_falha_verificacao();
drop function core.cadastrar_totp(bytea, text);
create function core.cadastrar_totp(p_segredo bytea, p_kek text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
  v_versao int := core.conferir_kek(p_kek);
begin
  if octet_length(p_segredo) < 20 then
    raise exception 'segredo TOTP curto' using errcode = '22023';
  end if;
  if core.tem_mfa() and not core.mfa_recente() then
    raise exception 'trocar o autenticador exige MFA recente' using errcode = '42501';
  end if;
  delete from core.fatores_mfa where usuario_id = v_usuario and verificado_em is null;
  insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek)
  values (v_usuario, extensions.pgp_sym_encrypt_bytea(p_segredo, p_kek, 'cipher-algo=aes256'), v_versao);
end;
$$;
grant execute on function core.cadastrar_totp(bytea, text) to vv_api;
create or replace function core.confirmar_totp(p_codigo text, p_kek text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
  v_fator uuid;
  v_passo bigint;
begin
  perform core.conferir_kek(p_kek);
  select id into v_fator from core.fatores_mfa
   where usuario_id = v_usuario and verificado_em is null and criado_em > now() - interval '15 minutes';
  v_passo := case when v_fator is not null then core.conferir_totp(v_fator, p_codigo, p_kek) end;
  if v_passo is null then
    perform core.registrar_falha_mfa();
    return false;
  end if;
  delete from core.fatores_mfa where usuario_id = v_usuario and verificado_em is not null;
  update core.fatores_mfa set verificado_em = now(), ultimo_passo = v_passo
   where id = v_fator and verificado_em is null and ultimo_passo < v_passo;
  if not found then
    raise exception 'código já usado' using errcode = '28000';
  end if;
  perform core.elevar_sessao('totp');
  return true;
end;
$$;
create or replace function core.elevar_sessao(p_metodo text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update core.sessoes set aal = 'aal2', mfa_em = now(), mfa_metodo = p_metodo, falhas_mfa = 0
   where id = core.sessao_atual();
  update core.usuarios set falhas_mfa = 0 where id = core.usuario_atual();
end;
$$;
create or replace function core.registrar_falha_mfa()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.usuario_atual();
  v_falhas int;
begin
  update core.sessoes
     set falhas_mfa = falhas_mfa + 1,
         revogada_em = case when falhas_mfa + 1 >= 5 then now() else revogada_em end
   where id = core.sessao_atual();
  update core.usuarios
     set falhas_mfa = case when ultima_falha_mfa_em > now() - interval '15 minutes' then falhas_mfa + 1 else 1 end,
         ultima_falha_mfa_em = now()
   where id = v_usuario
  returning falhas_mfa into v_falhas;
  if v_falhas >= 10 then
    update core.usuarios set mfa_bloqueado_ate = now() + interval '15 minutes', falhas_mfa = 0 where id = v_usuario;
    update core.sessoes set revogada_em = now() where usuario_id = v_usuario and revogada_em is null;
  end if;
end;
$$;
alter table core.usuarios drop column mfa_resetado_em, drop column janela_cadastro_mfa_em,
  drop column cadastros_mfa, drop column falhas_mfa_consecutivas;
drop index core.fatores_mfa_pendente_uk;
delete from core.fatores_mfa where verificado_em is null;
alter table core.fatores_mfa drop constraint fatores_mfa_pendente_com_sessao;
create unique index fatores_mfa_pendente_uk on core.fatores_mfa (usuario_id) where verificado_em is null;
alter table core.fatores_mfa drop column sessao_id;
