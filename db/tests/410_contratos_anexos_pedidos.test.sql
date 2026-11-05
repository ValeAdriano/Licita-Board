-- Anexos do contrato (vínculo a documentos do repositório) e pedidos de reajuste/reequilíbrio como peças jurídicas; permissões e A x B.
begin;
set local search_path = tap;
select plan(12);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['contratos:visualizar', 'documentos:visualizar']);
select tests.criar_usuario('juridico');
select tests.vincular('juridico', 'A', 'JURIDICO', array['juridico:visualizar', 'juridico:elaborar_peca']);
select tests.cena_analise();
select tests.cena_cadastros();
select tests.cena_contrato();
create temp table g (nome text primary key, id uuid);
grant all on g to public;
insert into g select 'ct', id from priv.contratos where empresa_id = tests.empresa_id('A');
insert into g select 'doc', id from priv.documentos where empresa_id = tests.empresa_id('A');
insert into g select 'emp', id from priv.empenhos where empresa_id = tests.empresa_id('A');
insert into g select 'docb', id from priv.documentos where empresa_id = tests.empresa_id('B');

select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'anx', priv.anexar_documento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'doc'), null, null, 'Certidão de regularidade') $$, 'anexa um documento ao contrato');
select lives_ok($$ select priv.anexar_documento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'doc'), (select id from g where nome = 'emp'), 'entrega', 'Comprovante de entrega') $$, 'anexa o mesmo documento a uma etapa do empenho');
select throws_ok($$ select priv.anexar_documento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'doc'), null, null, null) $$, '23505', null, 'o mesmo vínculo não se repete');
select throws_ok($$ select priv.anexar_documento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'docb'), null, null, null) $$, 'P0002', null, 'documento de outra empresa não existe para A');
select lives_ok($$ select priv.remover_anexo_contrato(tests.empresa_id('A'), (select id from g where nome = 'anx')) $$, 'remove o anexo');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.anexar_documento_contrato(tests.empresa_id('A'), (select id from g where nome = 'ct'), (select id from g where nome = 'doc'), null, null, null) $$, '42501', null, 'só visualizar não anexa');
select tests.sair();

select tests.autenticar_como('juridico');
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'reajuste', 'Pedido de reajuste') $$, '22023', null, 'contrato sem edital ligado não gera pedido jurídico');
select tests.sair();
update priv.contratos set acompanhamento_id = (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')) where empresa_id = tests.empresa_id('A');
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'reajuste', 'Pedido de reajuste') $$, '42501', null, 'sem elaborar peça não abre pedido');
select tests.sair();
select tests.autenticar_como('juridico');
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'recurso', 'Tipo errado') $$, '22023', null, 'só reajuste ou reequilíbrio');
select lives_ok($$ insert into g select 'ped', priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'reequilibrio', 'Pedido de reequilíbrio econômico-financeiro') $$, 'abre o pedido como peça jurídica');
select is((select tipo || ':' || status || ':' || (contrato_id = (select id from g where nome = 'ct'))::text from priv.pecas where id = (select id from g where nome = 'ped')), 'reequilibrio:triagem:true', 'a peça nasce em triagem, ligada ao contrato');
select tests.sair();
select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.abrir_pedido_contratual(tests.empresa_id('A'), (select id from g where nome = 'ct'), 'reajuste', 'Invasor') $$, '42501', null, 'B não abre pedido no contrato de A');

select * from finish();
rollback;
