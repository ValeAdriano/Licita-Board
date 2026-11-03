-- Fase 01 · PR 2b · MFA TOTP conferido no banco e códigos de recuperação (spec fase-01 §4 e
-- decisões 1 e 7; ADR-012, ADR-017).
--
-- * O segredo TOTP fica em core.fatores_mfa sem grant para a aplicação, cifrado com a chave-mestra
--   (KEK) por pgp_sym_encrypt. A API passa a KEK como parâmetro ligado a cada chamada; o banco só
--   aceita a KEK que bate com o verificador (core.chaves_mestras, PR 2a). Um SQLi na API, que não tem
--   a KEK, não cadastra fator nem eleva a sessão. Rotação da KEK ainda não existe (ADR-017).
-- * TOTP RFC 6238 (SHA-1, 30 s, 6 dígitos), janela de ±1 passo, sem reuso de passo nem por
--   concorrência (update condicional em ultimo_passo).
-- * Força bruta: 5 erros na sessão encerram a sessão; 10 erros do usuário em 15 min bloqueiam o MFA
--   por 15 min e encerram todas as sessões dele. Só MFA certo zera o contador do usuário.
-- * Fator novo, quando já existe um verificado, só com MFA nos últimos 5 min. Fator pendente vale
--   15 min. Códigos de recuperação: 10, de alta entropia (≥ 20 caracteres, ~100 bits), por SHA-256; gerar de novo
--   invalida os antigos; exige MFA nos últimos 5 min. Sessão guarda o método (totp | recuperacao).

-- migrate:up
alter table core.sessoes
  add column falhas_mfa int not null default 0,
  add column mfa_metodo text check (mfa_metodo in ('totp', 'recuperacao'));
alter table core.usuarios
  add column falhas_mfa int not null default 0,
  add column ultima_falha_mfa_em timestamptz,
  add column mfa_bloqueado_ate timestamptz;

create table core.fatores_mfa (
  id               uuid primary key default core.uuid_v7(),
  usuario_id       uuid not null references core.usuarios (id) on delete cascade,
  tipo             text not null default 'totp' check (tipo = 'totp'),
  segredo_cifrado  bytea not null,
  versao_kek       int not null references core.chaves_mestras (versao),
  criado_em        timestamptz not null default now(),
  verificado_em    timestamptz,
  ultimo_passo     bigint not null default 0
);
create unique index fatores_mfa_verificado_uk on core.fatores_mfa (usuario_id) where verificado_em is not null;
create unique index fatores_mfa_pendente_uk on core.fatores_mfa (usuario_id) where verificado_em is null;

create table core.codigos_recuperacao (
  id           uuid primary key default core.uuid_v7(),
  usuario_id   uuid not null references core.usuarios (id) on delete cascade,
  codigo_hash  bytea not null check (octet_length(codigo_hash) = 32),
  criado_em    timestamptz not null default now(),
  usado_em     timestamptz,
  unique (usuario_id, codigo_hash)
);

alter table core.fatores_mfa enable row level security;
alter table core.codigos_recuperacao enable row level security;
-- Sem policy e sem grant para ninguém da aplicação: só as funções abaixo.

create trigger fatores_mfa_audit after insert or update of verificado_em or delete on core.fatores_mfa
  for each row execute function audit.registrar('-', 'segredo_cifrado');
create trigger codigos_recuperacao_audit after insert or update or delete on core.codigos_recuperacao
  for each row execute function audit.registrar('-', 'codigo_hash');
alter table core.fatores_mfa enable always trigger fatores_mfa_audit;
alter table core.codigos_recuperacao enable always trigger codigos_recuperacao_audit;

-- HOTP/TOTP (RFC 4226/6238). Interna: sem grant.
create function core.totp(p_segredo bytea, p_passo bigint)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_h bytea := extensions.hmac(int8send(p_passo), p_segredo, 'sha1');
  v_o int := get_byte(v_h, 19) & 15;
  v_bin bigint;
begin
  v_bin := ((get_byte(v_h, v_o) & 127)::bigint << 24) | (get_byte(v_h, v_o + 1)::bigint << 16)
         | (get_byte(v_h, v_o + 2)::bigint << 8) | get_byte(v_h, v_o + 3)::bigint;
  return lpad((v_bin % 1000000)::text, 6, '0');
end;
$$;

-- Passo aceito (ou nulo) para o fator dado, acima do último usado. Interna.
create function core.conferir_totp(p_fator uuid, p_codigo text, p_kek text)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_segredo bytea;
  v_ultimo bigint;
  v_atual bigint := floor(extract(epoch from now()) / 30)::bigint;
begin
  if p_codigo !~ '^[0-9]{6}$' then
    return null;
  end if;
  select extensions.pgp_sym_decrypt_bytea(f.segredo_cifrado, p_kek), f.ultimo_passo
    into v_segredo, v_ultimo
    from core.fatores_mfa f where f.id = p_fator;
  for d in -1..1 loop
    if v_atual + d > v_ultimo and core.totp(v_segredo, v_atual + d) = p_codigo then
      return v_atual + d;
    end if;
  end loop;
  return null;
end;
$$;

-- Erro de código. Sessão: 5 erros a encerram. Usuário: 10 erros em 15 min bloqueiam o MFA e
-- encerram todas as sessões. Interna.
create function core.registrar_falha_mfa()
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

create function core.elevar_sessao(p_metodo text)
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

-- Sessão do contexto e MFA não bloqueado. Interna para as funções de MFA.
create function core.exigir_sessao_mfa()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.usuario_atual();
begin
  if v_usuario is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  if exists (select 1 from core.usuarios u where u.id = v_usuario and u.mfa_bloqueado_ate > now()) then
    raise exception 'MFA bloqueado temporariamente' using errcode = '28000';
  end if;
  return v_usuario;
end;
$$;

-- Perfil interno (qualquer vínculo ativo não CLIENTE) ou SUPERADMIN precisa de MFA.
create function core.mfa_obrigatorio()
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

create function core.tem_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from core.fatores_mfa f
                  where f.usuario_id = core.usuario_atual() and f.verificado_em is not null)
$$;

create function core.mfa_recente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from core.sessao_valida() s where s.aal = 'aal2' and s.mfa_em > now() - interval '5 minutes')
$$;

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

-- Confirma o fator pendente (até 15 min); ele substitui o verificado anterior e a sessão vira aal2.
create function core.confirmar_totp(p_codigo text, p_kek text)
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
  -- O verificado anterior sai antes (índice único de um verificado por usuário); se o update não
  -- achar a linha, o erro desfaz a função inteira, inclusive o delete.
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

create function core.verificar_totp(p_codigo text, p_kek text)
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
  select id into v_fator from core.fatores_mfa where usuario_id = v_usuario and verificado_em is not null;
  v_passo := case when v_fator is not null then core.conferir_totp(v_fator, p_codigo, p_kek) end;
  if v_passo is not null then
    update core.fatores_mfa set ultimo_passo = v_passo where id = v_fator and ultimo_passo < v_passo;
  end if;
  if v_passo is null or not found then
    perform core.registrar_falha_mfa();
    return false;
  end if;
  perform core.elevar_sessao('totp');
  return true;
end;
$$;

create function core.gerar_codigos_recuperacao(p_codigos text[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
begin
  if not core.mfa_recente() then
    raise exception 'gerar códigos exige MFA nos últimos 5 minutos' using errcode = '42501';
  end if;
  if cardinality(p_codigos) <> 10 or (select count(distinct c) from unnest(p_codigos) c) <> 10
     or exists (select 1 from unnest(p_codigos) c where coalesce(char_length(c), 0) < 20) then
    raise exception 'são 10 códigos distintos de pelo menos 20 caracteres' using errcode = '22023';
  end if;
  delete from core.codigos_recuperacao where usuario_id = v_usuario;
  insert into core.codigos_recuperacao (usuario_id, codigo_hash)
  select v_usuario, core.hash_token(upper(c)) from unnest(p_codigos) c;
end;
$$;

create function core.usar_codigo_recuperacao(p_codigo text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := core.exigir_sessao_mfa();
begin
  update core.codigos_recuperacao set usado_em = now()
   where usuario_id = v_usuario and codigo_hash = core.hash_token(upper(p_codigo)) and usado_em is null;
  if not found then
    perform core.registrar_falha_mfa();
    return false;
  end if;
  perform core.elevar_sessao('recuperacao');
  return true;
end;
$$;

-- Troca logada de senha: quem tem ou precisa de MFA precisa de MFA nos últimos 5 min (T5.8).
create or replace function core.trocar_senha(p_senha_hash text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if core.usuario_atual() is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  if (core.tem_mfa() or core.mfa_obrigatorio()) and not core.mfa_recente() then
    raise exception 'trocar a senha exige MFA recente' using errcode = '42501';
  end if;
  update core.usuarios set senha_hash = p_senha_hash, senha_trocada_em = now()
   where id = core.usuario_atual();
  update core.sessoes set falhas_mfa = 0 where id = core.sessao_atual();
  perform core.encerrar_todas_sessoes(true);
end;
$$;

-- Erro de senha atual na troca logada conta como falha de verificação (sessão roubada não testa senhas).
create function core.registrar_falha_verificacao()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select core.registrar_falha_mfa()
$$;

grant execute on function core.mfa_obrigatorio(), core.tem_mfa(), core.mfa_recente(),
  core.cadastrar_totp(bytea, text), core.confirmar_totp(text, text), core.verificar_totp(text, text),
  core.gerar_codigos_recuperacao(text[]), core.usar_codigo_recuperacao(text),
  core.registrar_falha_verificacao() to vv_api;

-- migrate:down
create or replace function core.trocar_senha(p_senha_hash text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if core.usuario_atual() is null then
    raise exception 'sessão inválida' using errcode = '28000';
  end if;
  update core.usuarios set senha_hash = p_senha_hash, senha_trocada_em = now()
   where id = core.usuario_atual();
  perform core.encerrar_todas_sessoes(true);
end;
$$;
drop function core.registrar_falha_verificacao(), core.usar_codigo_recuperacao(text),
  core.gerar_codigos_recuperacao(text[]), core.verificar_totp(text, text), core.confirmar_totp(text, text),
  core.cadastrar_totp(bytea, text), core.mfa_recente(), core.tem_mfa(), core.mfa_obrigatorio(),
  core.exigir_sessao_mfa(), core.elevar_sessao(text), core.registrar_falha_mfa(),
  core.conferir_totp(uuid, text, text), core.totp(bytea, bigint);
drop table core.codigos_recuperacao, core.fatores_mfa;
alter table core.usuarios drop column mfa_bloqueado_ate, drop column ultima_falha_mfa_em, drop column falhas_mfa;
alter table core.sessoes drop column mfa_metodo, drop column falhas_mfa;
