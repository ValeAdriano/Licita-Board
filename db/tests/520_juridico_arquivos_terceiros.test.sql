-- Fase 10 · Q-43: recurso de terceiro e documentos da concorrente a partir de arquivo liberado (texto de priv.documento_trechos).
begin;
set local search_path = tap;
select plan(20);

select tests.criar_empresas_ab();
select tests.criar_usuario('so_ver');
select tests.vincular('so_ver', 'A', 'OPERADOR', array['juridico:visualizar']);
select tests.cena_analise();
select tests.cena_juridico();
select tests.cena_resultado();
create temp table g (nome text primary key, id uuid);
grant all on g to public;

-- Arquivos de teste (fictícios): nome, empresa, tipo, status da versão e se tem texto extraído.
create function pg_temp.arquivo(p_nome text, p_letra text, p_tipo text, p_status text, p_paginas text[])
returns void language plpgsql as $$
declare
  v_doc uuid;
  v_ver uuid;
  i int;
begin
  insert into priv.documentos (empresa_id, tipo_id, descricao, sem_vencimento)
  values (tests.empresa_id(p_letra), (select id from pub.tipos_documento where slug = p_tipo), 'Arquivo ' || p_nome, true) returning id into v_doc;
  insert into priv.documento_versoes (empresa_id, documento_id, versao, arquivo_chave, nome_original, status_arquivo)
  values (tests.empresa_id(p_letra), v_doc, 1, 'k-' || p_nome, p_nome || '.pdf', p_status) returning id into v_ver;
  for i in 1 .. coalesce(array_length(p_paginas, 1), 0) loop
    insert into priv.documento_trechos (empresa_id, documento_id, versao_id, pagina, ordem, texto) values (tests.empresa_id(p_letra), v_doc, v_ver, i, 1, p_paginas[i]);
  end loop;
  insert into g values (p_nome, v_doc);
end;
$$;
select pg_temp.arquivo('rec_a', 'A', 'recurso_terceiro_arquivo', 'liberado', array['A recorrente alega que a proposta da empresa não atende ao item 3.2 do edital.', 'Pede a desclassificação da proposta vencedora.']);
select pg_temp.arquivo('rec_b', 'B', 'recurso_terceiro_arquivo', 'liberado', array['Recurso de outra empresa, com texto suficiente para ser lido pelo sistema.']);
select pg_temp.arquivo('privado_a', 'A', 'contrato_social', 'liberado', array['Contrato social da própria empresa, que o fluxo do jurídico não pode ler.']);
select pg_temp.arquivo('quarentena_a', 'A', 'recurso_terceiro_arquivo', 'quarentena', null);
select pg_temp.arquivo('imagem_a', 'A', 'recurso_terceiro_arquivo', 'liberado', null);
select pg_temp.arquivo('hab_a', 'A', 'habilitacao_concorrente', 'liberado', array['Certidão negativa de débitos válida até 01/10/2026, emitida pela Receita.']);

-- Recurso a partir do arquivo
select tests.autenticar_como('usuario_a');
select lives_ok($$ insert into g select 'r', (priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'Concorrente S/A', now(), (select id from g where nome = 'rec_a'), null) ->> 'id')::uuid $$, 'insere o recurso a partir do arquivo liberado');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'privado_a'), null) $$, '22023', null, 'documento privado da própria empresa não serve de recurso');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'quarentena_a'), null) $$, '22023', 'o arquivo ainda está em verificação (antivírus); tente de novo em instantes', 'arquivo em quarentena ainda não serve');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'imagem_a'), null) $$, '22023', null, 'arquivo sem texto legível pede o texto colado');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'rec_b'), null) $$, 'P0002', null, 'arquivo de outra empresa: não encontrado');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('B')), 'X Ltda', now(), (select id from g where nome = 'rec_a'), null) $$, 'P0002', null, 'acompanhamento de outra empresa: não encontrado');
select throws_ok($$ select priv.texto_arquivo_terceiro(tests.empresa_id('A'), (select id from g where nome = 'rec_a'), array['recurso_terceiro_arquivo']) $$, '42501', null, 'a API não chama a função interna que lê o texto');
select tests.sair();

select ok((select texto like E'[página 1]\nA recorrente alega%' and texto like E'%\n\n[página 2]\nPede a desclassificação%' from priv.recursos_terceiros where id = (select id from g where nome = 'r')), 'o texto do recurso vem das páginas do arquivo, em ordem');
select is((select nome || ':' || caracteres from priv.juridico_arquivos where recurso_id = (select id from g where nome = 'r')), 'rec_a.pdf:' || (char_length('A recorrente alega que a proposta da empresa não atende ao item 3.2 do edital.') + char_length('Pede a desclassificação da proposta vencedora.')), 'registra de qual arquivo veio o texto');
select is((select count(*)::int from ops.jobs where tipo = 'ler_recurso' and empresa_id = tests.empresa_id('A')), 1, 'pede a leitura pela IA como o recurso colado');
select is((select tipo || ':' || status from priv.pecas p join priv.recursos_terceiros r on r.peca_id = p.id where r.id = (select id from g where nome = 'r')), 'contrarrazoes:triagem', 'abre a peça de contrarrazões');

select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'rec_a'), null) $$, '42501', null, 'B não insere recurso em A');
select tests.sair();
select tests.autenticar_como('so_ver');
select throws_ok($$ select priv.inserir_recurso_terceiro_arquivo(tests.empresa_id('A'), (select id from priv.acompanhamentos where empresa_id = tests.empresa_id('A')), 'X Ltda', now(), (select id from g where nome = 'rec_a'), null) $$, '42501', null, 'só visualizar não insere recurso');
select tests.sair();

-- Parecer: acrescenta o texto do arquivo ao texto colado
update priv.resultados_item set resultado_final = 'perdida', motivo_perda = 'Perdeu no lance', gatilho_recursal = true;
select tests.autenticar_como('usuario_a');
insert into g select 'p', priv.abrir_parecer(tests.empresa_id('A'), (select participacao_id from priv.resultados_item where empresa_id = tests.empresa_id('A')), 'Concorrente S/A', 'Texto colado da proposta.');
select tests.sair();
update priv.pareceres_recursais set validacao = '[]'::jsonb, validada_em = now(), bloqueado = false where id = (select id from g where nome = 'p');
select tests.autenticar_como('usuario_a');
select is(priv.anexar_arquivo_parecer(tests.empresa_id('A'), (select id from g where nome = 'p'), (select id from g where nome = 'hab_a')), char_length('Certidão negativa de débitos válida até 01/10/2026, emitida pela Receita.'), 'anexa a habilitação da vencedora');
select throws_ok($$ select priv.anexar_arquivo_parecer(tests.empresa_id('A'), (select id from g where nome = 'p'), (select id from g where nome = 'hab_a')) $$, '22023', 'este arquivo já foi anexado ao parecer', 'o mesmo arquivo não entra duas vezes');
select throws_ok($$ select priv.anexar_arquivo_parecer(tests.empresa_id('A'), (select id from g where nome = 'p'), (select id from g where nome = 'rec_a')) $$, '22023', null, 'arquivo de recurso não é documento da concorrente');
select throws_ok($$ select priv.anexar_arquivo_parecer(tests.empresa_id('A'), gen_random_uuid(), (select id from g where nome = 'hab_a')) $$, 'P0002', null, 'parecer inexistente: não encontrado');
select tests.sair();
select is((select texto_concorrente from priv.pareceres_recursais where id = (select id from g where nome = 'p')),
  E'Texto colado da proposta.\n\n[arquivo: hab_a.pdf]\n[página 1]\nCertidão negativa de débitos válida até 01/10/2026, emitida pela Receita.', 'o texto do arquivo entra depois do texto colado');
select ok((select bloqueado and validada_em is null from priv.pareceres_recursais where id = (select id from g where nome = 'p')), 'o texto novo invalida a conferência da evidência até o worker refazer');

select tests.autenticar_como('usuario_b');
select throws_ok($$ select priv.anexar_arquivo_parecer(tests.empresa_id('A'), (select id from g where nome = 'p'), (select id from g where nome = 'hab_a')) $$, '42501', null, 'B não anexa arquivo ao parecer de A');
select tests.sair();

select * from finish();
rollback;
