-- Helpers de teste (schema `tests`), port de supabase/tests/000_helpers. Roda primeiro e NÃO faz
-- rollback: os demais arquivos usam estas funções. Só existe no banco descartável de teste.
do $$ begin
  if current_database() = 'vv' then
    raise exception 'helpers de teste não entram no banco vv (use um banco descartável)';
  end if;
end $$;
create schema if not exists tap;
create extension if not exists pgtap with schema tap;
grant usage on schema tap to vv_api, vv_worker;
create schema if not exists tests;
revoke all on schema tests from public;
grant usage on schema tests to vv_api;

-- Cria (ou reaproveita) um usuário fictício <ident>@teste.local, com e-mail já verificado.
create or replace function tests.criar_usuario(p_ident text, p_superadmin boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into core.usuarios (email, nome, superadmin, email_verificado_em)
  values (p_ident || '@teste.local', 'Teste ' || p_ident, p_superadmin, now())
  on conflict (email) do update set superadmin = excluded.superadmin
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function tests.usuario_id(p_ident text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.usuarios where email = p_ident || '@teste.local';
$$;

create or replace function tests.empresa_id(p_letra text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.empresas where razao_social = 'Empresa Teste ' || p_letra;
$$;

create or replace function tests.vinculo_id(p_ident text, p_letra text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.vinculos
   where usuario_id = tests.usuario_id(p_ident) and empresa_id = tests.empresa_id(p_letra);
$$;

-- Vincula usuário à empresa com as permissões dadas (padrão: todas as ações em todos os módulos).
create or replace function tests.vincular(
  p_ident text,
  p_letra text,
  p_papel text default 'ADMIN_EMPRESA',
  p_permissoes text[] default null  -- formato 'modulo:acao'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vinculo uuid;
begin
  insert into core.vinculos (usuario_id, empresa_id, papel)
  values (tests.usuario_id(p_ident), tests.empresa_id(p_letra), p_papel)
  returning id into v_vinculo;

  if p_permissoes is null then
    insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
    select v_vinculo, tests.empresa_id(p_letra), m.slug, a.acao
      from core.modulos m
     cross join unnest(array[
       'visualizar', 'cadastrar', 'editar', 'arquivar', 'substituir_arquivos', 'gerar_documentos',
       'ver_custos_margens', 'elaborar_peca', 'aprovar_peca', 'aprovar', 'exportar',
       'administrar_permissoes'
     ]) as a(acao);
  else
    insert into core.permissoes (vinculo_id, empresa_id, modulo, acao)
    select v_vinculo, tests.empresa_id(p_letra), split_part(x, ':', 1), split_part(x, ':', 2)
      from unnest(p_permissoes) x;
  end if;
  return v_vinculo;
end;
$$;

-- Empresa A + usuario_a (ADMIN_EMPRESA, tudo) e Empresa B + usuario_b. CNPJs fictícios com DV válido.
create or replace function tests.criar_empresas_ab()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into core.empresas (razao_social, cnpj) values
    ('Empresa Teste A', '11222333000181'),
    ('Empresa Teste B', '12ABC34501DE35');
  perform tests.criar_usuario('usuario_a');
  perform tests.criar_usuario('usuario_b');
  perform tests.vincular('usuario_a', 'A');
  perform tests.vincular('usuario_b', 'B');
end;
$$;

-- Cena da Fase 06 para os testes de isolamento: um edital com 1 item, e em CADA empresa (A e B) um acompanhamento, uma
-- participação, um produto, um requisito, uma análise e uma linha de matriz. Rodar depois de criar_empresas_ab().
create or replace function tests.cena_analise()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_ed uuid;
  v_it uuid;
  v_cat uuid := (select id from pub.categorias where slug = 'veiculos');
  v_letra text;
  v_emp uuid;
  v_ac uuid;
  v_part uuid;
  v_prod uuid;
  v_req uuid;
  v_an uuid;
begin
  insert into pub.orgaos (cnpj, razao_social, uf, codigo_ibge) values ('11222333000181', 'Órgão Fictício', 'PR', '4106902') returning id into v_org;
  insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo)
  values ((select id from ops.fontes where slug = 'pncp'), 'AN-1', v_org, 'Objeto', repeat('a', 64)) returning id into v_ed;
  insert into pub.edital_itens (edital_id, numero_item, descricao) values (v_ed, 1, 'Item 1') returning id into v_it;
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.acompanhamentos (empresa_id, edital_id) values (v_emp, v_ed) returning id into v_ac;
    insert into priv.participacoes (empresa_id, acompanhamento_id, item_id) values (v_emp, v_ac, v_it) returning id into v_part;
    insert into priv.produtos (empresa_id, categoria_id, codigo_interno, descricao) values (v_emp, v_cat, 'P-' || v_letra, 'Produto ' || v_letra) returning id into v_prod;
    insert into priv.requisitos_item (empresa_id, participacao_id, nome, operador, valor_numero, citacao_edital)
    values (v_emp, v_part, 'Potência mínima ' || v_letra, '>=', 100, 'potência mínima de 100 cv') returning id into v_req;
    insert into priv.analises_item (empresa_id, participacao_id, produto_id) values (v_emp, v_part, v_prod) returning id into v_an;
    insert into priv.analise_linhas (empresa_id, analise_id, requisito_id, resultado) values (v_emp, v_an, v_req, 'A CONFIRMAR');
  end loop;
end;
$$;

-- Cena da Fase 07: depois de cena_analise(), uma precificação com uma linha de custo em CADA empresa.
create or replace function tests.cena_preco()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
  v_prec uuid;
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.precificacoes (empresa_id, participacao_id, quantidade)
    values (v_emp, (select id from priv.participacoes where empresa_id = v_emp), 10) returning id into v_prec;
    insert into priv.preco_linhas (empresa_id, precificacao_id, nome, tipo, categoria, forma, valor)
    values (v_emp, v_prec, 'Aquisição ' || v_letra, 'aquisicao', 'custo', 'por_unidade', 100);
  end loop;
end;
$$;

-- Cena da Fase 08: depois de cena_analise(), uma proposta (rascunho) em CADA empresa.
create or replace function tests.cena_proposta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.propostas (empresa_id, acompanhamento_id, versao, conteudo, total)
    values (v_emp, (select id from priv.acompanhamentos where empresa_id = v_emp), 1, '[]'::jsonb, 0);
  end loop;
end;
$$;

-- Tentativa de DML como o usuário autenticado: devolve true se foi BLOQUEADA (permissão negada pelo grant/RLS, ou 0 linhas afetadas pelo filtro
-- da policy) e false se alguma linha foi alterada. Serve aos testes de isolamento A x B de tabelas com ou sem DML direto para vv_api.
create or replace function tests.dml_bloqueado(p_sql text)
returns boolean
language plpgsql
as $$
declare
  v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n = 0;
exception when insufficient_privilege then
  return true;
end;
$$;

-- Leitura como o usuário autenticado: nº de linhas visíveis, ou -1 se a API nem tem SELECT na tabela (tabelas só do worker). Em ambos os
-- casos "A não lê B" vale: o teste exige <= 0 para B e <> 0 para A (0 linhas próprias é falha da cena).
create or replace function tests.leitura(p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') x' into v_n;
  return v_n;
exception when insufficient_privilege then
  return -1;
end;
$$;

-- Token de step-up (uso único, 5 min) para a sessão atual do usuário de teste: simula o TOTP novo que a API recebe em /auth/mfa/step-up.
create or replace function tests.step_up(p_usuario text, p_escopo text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into core.step_up_tokens (usuario_id, escopo, sessao_id, mfa_em, expira_em)
  values (tests.usuario_id(p_usuario), p_escopo, tests.sessao_id(p_usuario), now(), now() + interval '5 minutes')
  returning id into v_id;
  return v_id;
end;
$$;

-- Cena dos cadastros (Fases 02 a 05): depois de cena_analise(), uma linha em CADA empresa (A e B) nas tabelas de documentos, atestados, fichas,
-- agenda, importações, oportunidades e palavras-chave. Serve aos testes de isolamento dessas tabelas.
create or replace function tests.cena_cadastros()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
  v_doc uuid;
  v_ver uuid;
  v_usr uuid;
  v_prod uuid;
  v_ac uuid;
  v_ev uuid;
  v_at uuid;
  v_edital uuid := (select id from pub.editais limit 1);
  v_item uuid := (select id from pub.edital_itens limit 1);
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    v_usr := (select id from core.usuarios where email like 'usuario_' || lower(v_letra) || '%' limit 1);
    insert into priv.documentos (empresa_id, tipo_id, descricao) values (v_emp, (select id from pub.tipos_documento limit 1), 'Documento ' || v_letra) returning id into v_doc;
    insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original) values (v_emp, v_doc, 1, 'k-' || v_letra, 'a.pdf') returning id into v_ver;
    insert into priv.documento_trechos (empresa_id, documento_id, versao_id, pagina, ordem, texto) values (v_emp, v_doc, v_ver, 1, 1, 'Trecho ' || v_letra);
    insert into priv.documento_alertas (empresa_id, documento_id, versao_id, marco_dias) values (v_emp, v_doc, v_ver, 30);
    insert into priv.documento_downloads (empresa_id, documento_id, versao_id, usuario_id) values (v_emp, v_doc, v_ver, v_usr);
    insert into priv.documento_pendencias (empresa_id, documento_id, instrucoes) values (v_emp, v_doc, 'Atualizar ' || v_letra);
    insert into priv.atestados_tecnicos (empresa_id, documento_id, contratante, objeto) values (v_emp, v_doc, 'Contratante ' || v_letra, 'Objeto do atestado') returning id into v_at;
    insert into priv.atestado_itens (empresa_id, atestado_id, descricao, quantidade, unidade_id) values (v_emp, v_at, 'Item do atestado', 1, (select id from pub.unidades limit 1));
    v_prod := (select id from priv.produtos where empresa_id = v_emp limit 1);
    insert into priv.produto_atributos (empresa_id, produto_id, atributo_id, valor_texto) values (v_emp, v_prod, (select id from pub.atributos_def where tipo = 'texto' limit 1), 'Valor ' || v_letra);
    insert into priv.produto_precos (empresa_id, produto_id) values (v_emp, v_prod);
    insert into priv.fichas_tecnicas (empresa_id, produto_id, versao_ficha, fabricante, modelo) values (v_emp, v_prod, 1, 'Fabricante ' || v_letra, 'Modelo 1');
    v_ac := (select id from priv.acompanhamentos where empresa_id = v_emp limit 1);
    insert into priv.agenda_eventos (empresa_id, acompanhamento_id, tipo) values (v_emp, v_ac, 'esclarecimento') returning id into v_ev;
    insert into priv.agenda_alertas (empresa_id, evento_id, usuario_id, marco) values (v_emp, v_ev, v_usr, 'D-5');
    insert into priv.agenda_evento_historico (empresa_id, evento_id, campo) values (v_emp, v_ev, 'status');
    insert into priv.agenda_feriados (empresa_id, data, nome, abrangencia, uf) values (v_emp, date '2026-12-24', 'Recesso ' || v_letra, 'uf', 'PR');
    insert into priv.agenda_parametros (empresa_id) values (v_emp);
    insert into priv.importacoes (empresa_id, tipo, url) values (v_emp, 'url', 'https://exemplo.test/edital-' || v_letra);
    insert into priv.oportunidades (empresa_id, edital_id, item_id, nota, faixa, versao_regra, edital_versao) values (v_emp, v_edital, v_item, 50, 'media', 'v1', 1);
    insert into priv.palavras_chave (empresa_id, tipo, termo, termo_normalizado) values (v_emp, 'palavra', 'trator ' || v_letra, 'trator ' || lower(v_letra));
    insert into priv.palavras_chave_filtros (empresa_id, tipo, uf) values (v_emp, 'uf', 'PR');
  end loop;
end;
$$;

-- Cena da Fase 09: depois de cena_analise(), um resultado de item em CADA empresa.
create or replace function tests.cena_resultado()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.resultados_item (empresa_id, participacao_id, resultado_final)
    values (v_emp, (select id from priv.participacoes where empresa_id = v_emp), 'arrematada');
  end loop;
end;
$$;

-- Cena da Fase 10: depois de cena_analise(), uma entrada da base jurídica e uma peça em CADA empresa.
create or replace function tests.cena_juridico()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.base_juridica (empresa_id, tipo, numero, dispositivo, titulo, link_oficial)
    values (v_emp, 'lei', '14.133/2021', 'art. 165', 'Lei 14.133/2021, art. 165 (' || v_letra || ')', 'https://www.planalto.gov.br/exemplo');
    insert into priv.pecas (empresa_id, acompanhamento_id, tipo, titulo)
    values (v_emp, (select id from priv.acompanhamentos where empresa_id = v_emp), 'impugnacao', 'Peça ' || v_letra);
  end loop;
end;
$$;

-- Cena da Fase 11: em CADA empresa, um contrato com 1 item, um empenho com 1 item, uma entrega, uma fatura, um evento e etapas.
create or replace function tests.cena_contrato()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_letra text;
  v_emp uuid;
  v_c uuid;
  v_ci uuid;
  v_e uuid;
  v_ei uuid;
begin
  foreach v_letra in array array['A', 'B'] loop
    v_emp := tests.empresa_id(v_letra);
    insert into priv.contratos (empresa_id, numero, orgao, objeto, vigencia_inicio, vigencia_fim, valor_total) values (v_emp, 'CT-' || v_letra, 'Órgão', 'Objeto', date '2026-01-01', date '2026-12-31', 1000) returning id into v_c;
    insert into priv.contrato_itens (empresa_id, contrato_id, numero_item, descricao, quantidade, valor_unitario) values (v_emp, v_c, 1, 'Item', 10, 100) returning id into v_ci;
    insert into priv.empenhos (empresa_id, contrato_id, numero, emitido_em) values (v_emp, v_c, 'EMP-1', date '2026-02-01') returning id into v_e;
    insert into priv.empenho_itens (empresa_id, empenho_id, contrato_item_id, quantidade) values (v_emp, v_e, v_ci, 5) returning id into v_ei;
    insert into priv.empenho_etapas (empresa_id, empenho_id, etapa) values (v_emp, v_e, 'pedido_recebido');
    insert into priv.entregas (empresa_id, empenho_item_id, quantidade, entregue_em) values (v_emp, v_ei, 2, date '2026-03-01');
    insert into priv.faturas (empresa_id, contrato_id, numero_nf, emitida_em, valor, vencimento) values (v_emp, v_c, 'NF-1', date '2026-03-05', 200, date '2026-04-05');
    insert into priv.contrato_eventos (empresa_id, contrato_id, tipo, data, descricao) values (v_emp, v_c, 'ocorrencia', date '2026-03-10', 'Ocorrência de teste');
  end loop;
end;
$$;

-- Token fictício e determinístico da sessão de teste de um usuário.
create or replace function tests.token(p_ident text, p_sessao text default 'sessao-teste')
returns text
language sql
immutable
as $$
  select 'token-teste|' || p_ident || '|' || p_sessao;
$$;

create or replace function tests.sessao_id(p_ident text, p_sessao text default 'sessao-teste')
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from core.sessoes where token_hash = core.hash_token(tests.token(p_ident, p_sessao));
$$;

-- Garante uma sessão viva com o aal pedido (MFA há p_mfa_ha_seg segundos) e devolve o token.
create or replace function tests.garantir_sessao(
  p_ident text, p_aal text default 'aal2', p_sessao text default 'sessao-teste', p_mfa_ha_seg int default 3600
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := tests.token(p_ident, p_sessao);
begin
  insert into core.sessoes (usuario_id, token_hash, aal, mfa_em, plataforma)
  values (tests.usuario_id(p_ident), core.hash_token(v_token), p_aal,
          case when p_aal = 'aal2' then now() - make_interval(secs => p_mfa_ha_seg) end, 'web')
  on conflict (token_hash) do update
    set aal = excluded.aal, mfa_em = excluded.mfa_em, revogada_em = null,
        ultimo_uso_em = now(), expira_em = now() + interval '12 hours';
  return v_token;
end;
$$;

-- Simula uma requisição da API: sessão viva + contexto pelo token + papel vv_api.
--   p_mfa_ha_seg:  há quantos segundos foi a última verificação TOTP desta sessão (aal2). Cada valor
--                  diferente simula uma nova verificação MFA (o step-up gera um token por verificação).
--   p_fator_idade: idade do fator TOTP verificado do usuário (step-up exige ≥ 24 h).
-- Security invoker (SET ROLE não é permitido em security definer): chamar como superusuário.
drop function if exists tests.autenticar_como(text, text, text);
create or replace function tests.autenticar_como(
  p_ident text,
  p_aal text default 'aal2',
  p_mfa_ha_seg int default 3600,
  p_sessao text default 'sessao-teste',
  p_fator_idade interval default interval '30 days'
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_usuario uuid := tests.usuario_id(p_ident);
begin
  if p_aal = 'aal2' then
    update core.fatores_mfa set verificado_em = now() - p_fator_idade
     where usuario_id = v_usuario and verificado_em is not null;
    if not found then
      insert into core.fatores_mfa (usuario_id, segredo_cifrado, versao_kek, verificado_em)
      values (v_usuario, extensions.pgp_sym_encrypt_bytea(convert_to('segredo-de-teste-' || p_ident, 'UTF8'), tests.kek()),
              1, now() - p_fator_idade);
    end if;
  end if;
  perform tests.garantir_sessao(p_ident, p_aal, p_sessao, p_mfa_ha_seg);
  update core.sessoes set mfa_metodo = case when p_aal = 'aal2' then 'totp' end
   where token_hash = core.hash_token(tests.token(p_ident, p_sessao));
  perform core.definir_contexto(tests.token(p_ident, p_sessao));
  perform set_config('role', 'vv_api', true);
end;
$$;

create or replace function tests.sair()
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  perform set_config('app.sessao_hash', '', true),
          set_config('app.usuario_id', '', true),
          set_config('app.sessao_id', '', true),
          set_config('app.aal', '', true),
          set_config('app.tx', '', true),
          set_config('app.req_tx', '', true),
          set_config('app.ip', '', true),
          set_config('app.user_agent', '', true);
end;
$$;

-- Só os helpers de leitura/sessão ficam acessíveis a vv_api; os que criam dados (e podem criar
-- SUPERADMIN) só rodam como superusuário.
revoke all on all functions in schema tests from public;
grant execute on function tests.usuario_id(text), tests.empresa_id(text), tests.vinculo_id(text, text),
  tests.autenticar_como(text, text, int, text, interval), tests.sessao_id(text, text), tests.token(text, text),
  tests.sair(), tests.dml_bloqueado(text), tests.leitura(text), tests.step_up(text, text) to vv_api;

-- KEK fictícia do banco de teste (em produção: db/scripts/registrar-kek.sh, como vv_owner).
create or replace function tests.kek()
returns text
language sql
immutable
as $$
  select 'kek-de-teste-nao-usar-em-producao-0123456789'
$$;
grant execute on function tests.kek() to vv_api;
insert into core.chaves_mestras (versao, verificador)
values (1, extensions.pgp_sym_encrypt('vv-kek-ok', tests.kek(), 'cipher-algo=aes256'))
on conflict (versao) do nothing;

set search_path = tap;
select plan(1);
select has_function('tests', 'criar_empresas_ab', 'helpers de teste instalados');
select * from finish();
