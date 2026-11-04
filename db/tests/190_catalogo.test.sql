-- Catálogo (pub): conversão exata, validação de atributo tipado, escrita só de SUPERADMIN, atributo novo sem migration.
begin;
set local search_path = tap;
select plan(13);

select tests.criar_empresas_ab();
select tests.criar_usuario('super', true);

select is(pub.converter(1, 'kW', 'W'), 1000::numeric, '1 kW = 1000 W');
select is(round(pub.converter(100, 'cv', 'kW'), 6), 73.549875::numeric, '100 cv = 73,549875 kW (cv métrico)');
select is(pub.converter(1, 'TB', 'GB'), 1000::numeric, '1 TB = 1000 GB (decimal)');
select is(pub.converter(1, 'GiB', 'MiB'), 1024::numeric, '1 GiB = 1024 MiB (binária é outra unidade)');
select is(pub.converter(2500, 'mm', 'm'), 2.5::numeric, '2500 mm = 2,5 m');
select throws_ok($$ select pub.converter(1, 'kW', 'kg') $$, '22023', null, 'grandezas diferentes não convertem');
select throws_ok($$ select pub.converter(1, 'xx', 'kg') $$, 'P0002', null, 'unidade inexistente');

-- Validação do valor pelo tipo do atributo (veículos).
select lives_ok($$ select pub.validar_valor_atributo((select id from pub.atributos_def where slug = 'potencia' and categoria_id = (select id from pub.categorias where slug = 'veiculos')), 110, null, null, (select id from pub.unidades where simbolo = 'cv')) $$, 'potência numérica em cv é aceita');
select throws_ok($$ select pub.validar_valor_atributo((select id from pub.atributos_def where slug = 'potencia' and categoria_id = (select id from pub.categorias where slug = 'veiculos')), 110, null, null, (select id from pub.unidades where simbolo = 'kg')) $$, '23514', null, 'unidade de outra grandeza é recusada');
select throws_ok($$ select pub.validar_valor_atributo((select id from pub.atributos_def where slug = 'combustivel'), null, 'plutonio', null, null) $$, '23514', null, 'valor fora da lista é recusado');

-- Escrita só de SUPERADMIN; atributo novo é só uma linha.
select tests.autenticar_como('usuario_a');
select isnt_empty($$ select 1 from pub.atributos_def $$, 'usuário autenticado lê o catálogo');
select throws_ok($$ insert into pub.categorias (slug, nome) values ('invasora', 'Invasora') $$, '42501', null, 'ADMIN_EMPRESA não escreve no catálogo');
select tests.sair();
select tests.autenticar_como('super');
select lives_ok(
  $$ insert into pub.atributos_def (categoria_id, slug, nome, tipo) select id, 'cor', 'Cor', 'texto' from pub.categorias where slug = 'veiculos' $$,
  'SUPERADMIN cria atributo novo sem migration');
select tests.sair();

select * from finish();
rollback;
