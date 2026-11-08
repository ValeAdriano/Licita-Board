-- Fase 04 · decisão 6 (Q-13a): arquivo extraído de ZIP fica ligado ao ZIP de origem, do mesmo edital;
-- o resultado do compactado é extraido/pendente/recusado; só o worker escreve, a API só lê.
begin;
set local search_path = tap;
select plan(10);

select tests.criar_empresas_ab();
insert into pub.orgaos (cnpj, razao_social, uf) values ('11222333000181', 'Prefeitura Fictícia', 'PR');
insert into pub.editais (fonte_id, id_externo, orgao_id, objeto, hash_conteudo)
select (select id from ops.fontes where slug = 'pncp'), 'FICTICIO-' || n, (select id from pub.orgaos), 'Aquisição de cadeiras', repeat('a', 64)
  from generate_series(1, 2) n;
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'ed1', id from pub.editais where id_externo = 'FICTICIO-1';
insert into g select 'ed2', id from pub.editais where id_externo = 'FICTICIO-2';

set local role vv_worker;
with x as (
  insert into pub.edital_arquivos (edital_id, titulo, url_origem, sha256, status_arquivo, status_compactado)
  values ((select id from g where nome = 'ed1'), 'anexos.zip', 'https://pncp.gov.br/arq/1', repeat('1', 64), 'liberado', 'extraido')
  returning id)
insert into g select 'zip', id from x;
select lives_ok($$ insert into pub.edital_arquivos (edital_id, titulo, url_origem, sha256, status_arquivo, arquivo_pai_id)
  values ((select id from g where nome = 'ed1'), 'termo.pdf', 'https://pncp.gov.br/arq/1', repeat('2', 64), 'liberado', (select id from g where nome = 'zip')) $$,
  'o worker grava o arquivo extraído ligado ao ZIP de origem');
select is((select a.titulo from pub.edital_arquivos f join pub.edital_arquivos a on a.id = f.arquivo_pai_id where f.titulo = 'termo.pdf'),
  'anexos.zip', 'o extraído aponta o ZIP de origem ("dentro de anexos.zip")');
select throws_ok($$ insert into pub.edital_arquivos (edital_id, url_origem, sha256, arquivo_pai_id)
  values ((select id from g where nome = 'ed2'), 'https://pncp.gov.br/arq/1', repeat('3', 64), (select id from g where nome = 'zip')) $$,
  '23503', null, 'ZIP de origem de outro edital é recusado');
select throws_ok($$ update pub.edital_arquivos set arquivo_pai_id = id where id = (select id from g where nome = 'zip') $$,
  '23514', null, 'o arquivo não é pai de si mesmo');
select throws_ok($$ update pub.edital_arquivos set status_compactado = 'aberto' where id = (select id from g where nome = 'zip') $$,
  '23514', null, 'status do compactado fora da lista é recusado');
select throws_ok($$ update pub.edital_arquivos set status_compactado = null, motivo_compactado = 'x' where id = (select id from g where nome = 'zip') $$,
  '23514', null, 'motivo sem status do compactado é recusado');
select lives_ok($$ update pub.edital_arquivos set status_compactado = 'recusado', motivo_compactado = 'razão de compressão acima de 100:1'
  where id = (select id from g where nome = 'zip') $$, 'o worker registra o ZIP recusado com o motivo');
reset role;

select tests.autenticar_como('usuario_a');
select is((select count(*)::int from pub.edital_arquivos where arquivo_pai_id is not null), 1, 'a API lê a ligação com o ZIP');
select is((select motivo_compactado from pub.edital_arquivos where status_compactado = 'recusado'), 'razão de compressão acima de 100:1',
  '... e o resultado do compactado');
select throws_ok($$ update pub.edital_arquivos set status_compactado = 'extraido' $$, '42501', null, 'a API não altera arquivo de edital');
select tests.sair();

select * from finish();
rollback;
