-- Regras puras do banco: CNPJ (numérico e alfanumérico) e UUID v7.
begin;
set local search_path = tap;
select plan(9);

select ok(core.cnpj_valido('11222333000181'), 'CNPJ numérico válido');
select ok(core.cnpj_valido('12ABC34501DE35'), 'CNPJ alfanumérico válido (exemplo oficial da Receita)');
select ok(not core.cnpj_valido('11222333000182'), 'DV errado é rejeitado');
select ok(not core.cnpj_valido('12ABC34501DE36'), 'DV errado no alfanumérico é rejeitado');
select ok(not core.cnpj_valido('00000000000000'), 'sequência repetida é rejeitada');
select ok(not core.cnpj_valido('11.222.333/0001-81'), 'com máscara é rejeitado (armazenar sem máscara)');
select ok(not core.cnpj_valido('12abc34501de35'), 'minúsculas são rejeitadas');
select throws_ok(
  $$ insert into core.empresas (razao_social, cnpj) values ('Inválida', '11222333000100') $$,
  '23514', null,
  'empresa com CNPJ inválido não é gravada'
);
select is(substr(core.uuid_v7()::text, 15, 1), '7', 'core.uuid_v7() gera UUID versão 7');

select * from finish();
rollback;
