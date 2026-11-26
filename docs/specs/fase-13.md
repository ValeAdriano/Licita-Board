# Spec · Fase 13 · Integrações, automações avançadas e expansão

- **Status:** `Rascunho` em 2026-11-26 (Claude Code, Q-39). **Aguarda aprovação do Adriano** e as respostas de §9; nada aqui vira código antes disso.
- **Onda:** 8 (expansão), contínua
- **Autor:** Claude Code · **Aprovação:** pendente
- **Validação:** ⚖️ 13.5 (lançamento automático de prazos a partir de publicações) depende das regras de prazo da agenda, ainda não validadas pelo jurídico; 13.2 e 13.1 dependem de termos de uso e de contratos com terceiros.
- **Fontes:** Prompt Mestre Fase 13 (13.1 a 13.6) e "Padrão técnico" (monitoramento); plano de desenvolvimento, Fase 13 (conectores BLL, BNC, Licitanet, ComprasBR, Portal de Compras Públicas, Licitações-e, DOM/SC; WhatsApp pela Meta Cloud API; virada SaaS); regras 4, 15, 16 e 17 do AGENTS.md; ADR-018 (Web Push). Código conferido: conectores em `apps/worker/src/worker/pesquisa/` (PNCP), `ops.fontes`/`ops.execucoes`/`ops.fonte_checagens`/`ops.cobertura_resultados` (migration `20261106100000`), coletor de resultados PNCP e `ops.resultado_coletas` (migration `20261207100000`), `.ics` e CSV/Excel da agenda, e-mail (`worker/email.py`) e push (`worker/push.py`), pendência "Atualizar documento" da Fase 03, painel de cobertura em `/plataforma` (`apps/api/src/pesquisa/pesquisa.controller.ts`).

> **Princípios:** fase de **expansão**, feita em blocos independentes, cada um com spec curta própria antes do código (esta spec é o guarda-chuva: escopo, ordem, dependências e decisões). Cada integração é **isolada** (falha de uma não derruba as outras), **testada com fixture gravada** (nunca rede real no CI), com **painel de saúde**, e só existe com **termo de uso, contrato ou autorização** que a permita. Nada protocola, envia proposta ou dá lance (regra 17). Texto vindo de fonte externa é dado, nunca instrução (regra 16). Mensagem externa nunca leva dado sensível (13.3).

## 1. Escopo e divisão em blocos

| Bloco | Prompt | O que entra | Depende de | Recomendação de ordem |
| --- | --- | --- | --- | --- |
| **13.6 Auditoria contínua de qualidade** | 13.6 | Painel e rotina diária que acusam: editais esperados não encontrados (amostra de cobertura), duplicidades, produtos possivelmente mal classificados, fichas técnicas vencidas/antigas, documentos pendentes, alertas não enviados, prazos com cálculo divergente, erros de integração | só o que já existe | **1º**: sem dependência externa e protege o que já está no ar |
| **13.5 Monitoramento de resultados** | 13.5 | Para editais acompanhados: detectar publicação de adjudicação, homologação, ata de registro de preços, contrato, decisão de recurso e resposta a impugnação (PNCP primeiro), registrar como documento posterior (9.5) e **propor** o lançamento na agenda | coletor PNCP de resultados (7.5), 9.5, agenda ⚖️ | **2º** |
| **13.3 Notificações externas** | 13.3 | Calendário (assinatura `.ics` por pessoa, além do download que já existe), WhatsApp pela API oficial, e-mail já existente estendido a prazos jurídicos; texto sem dado sensível | conta Meta Business e custo (Adriano) | **3º** (calendário logo; WhatsApp quando houver conta) |
| **13.1 Novas fontes** | 13.1 | Um conector por portal, só com termos que permitam (plano: BLL, BNC, Licitanet, ComprasBR, Portal de Compras Públicas, Licitações-e, DOM/SC; Compras.gov.br já em decisão, Q-17) | análise de termos por portal (Adriano/jurídico) | **4º**, um portal por vez |
| **13.4 Especializações por categoria** | 13.4 | Pacotes por categoria (veículos, máquinas, equipamentos, tecnologia, hospitalar, mobiliário, serviços): atributos de catálogo, palavras-chave de busca, checklist de requisitos técnicos e documentos típicos | dados da operação por categoria | conforme a demanda comercial |
| **13.2 Renovação de certidões** | 13.2 | Emissão/consulta automática de certidões **só** por integração oficial ou autorizada; até lá continua a pendência com link do emissor (Fase 03) | existência de API oficial ou convênio por emissor | por último; pode nunca sair para alguns emissores |

**Fora desta fase (e onde fica):**

| Item | Onde fica |
| --- | --- |
| Virada SaaS (onboarding, planos, cobrança, pentest externo) | Plano, Fase 13, mas é decisão de negócio: pergunta 6; recomendação: spec própria fora da 13 |
| Raspagem de portal que exige login ou proíbe automação | Nunca (termos de uso; regra 17) |
| Lance, envio de proposta ou protocolo automático | Nunca (regra 17) |
| Embeddings na busca de editais | Q-18 (decisão de custo/ADR), independente desta fase |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-13.1 | Cada fonte nova é um conector isolado, com teste por fixture gravada, registro em `ops.fontes`, checagem de saúde e entrada no painel de cobertura; falha de uma fonte não para as outras | 13.1, plano |
| RF-13.2 | Nenhuma fonte entra sem o registro da base de uso (termo, contrato ou autorização) em `ops.fontes` | 13.1, 13.2 |
| RF-13.3 | Certidões só são emitidas/consultadas automaticamente por integração oficial ou autorizada; o documento obtido passa pelo mesmo fluxo da Fase 03 (quarentena, antivírus, validade) | 13.2 |
| RF-13.4 | Notificação externa (e-mail, WhatsApp, calendário) leva só o tipo do aviso, o prazo e um link; nunca órgão + valor, CPF, custo, margem, motivo jurídico ou conteúdo de peça | 13.3, LGPD |
| RF-13.5 | Opt-in por pessoa e por canal, com descadastro em um clique; sem opt-in, nada sai | 13.3, LGPD |
| RF-13.6 | Publicações de resultado de editais acompanhados viram documento posterior (9.5) com origem e link oficial, e **propõem** o evento da agenda; o lançamento é confirmado por pessoa enquanto as regras de prazo não forem validadas | 13.5, ⚖️ |
| RF-13.7 | Auditoria de qualidade diária com achados por tipo, empresa e gravidade, sem expor dado de uma empresa a outra; achados de plataforma só para SUPERADMIN | 13.6, T1 |
| RF-13.8 | Pacote de categoria é dado (atributos, palavras-chave, checklist), nunca código por categoria; empresa ativa os pacotes que quiser | 13.4 |
| RF-13.9 | Todo bloco novo com tabela em `priv` tem teste A x B; toda rota nova, e2e A x B | regra 13 |

## 3. Bloco 13.6 · Auditoria contínua de qualidade (detalhado, por ser o primeiro)

### 3.1 Verificações (todas em `rules/qualidade.py`, código puro; o worker só lê e grava)

| Código | O que verifica | Escopo | Gravidade |
| --- | --- | --- | --- |
| `edital_nao_encontrado` | item da amostra de cobertura (`ops.amostra_cobertura`) sem edital capturado após N horas da publicação | plataforma | alta |
| `edital_duplicado` | mesmo `(fonte, id_externo)` normalizado, ou mesmo órgão + número + objeto em fontes diferentes sem vínculo | plataforma | média |
| `fonte_com_erro` | fonte com checagem falhando ou sem execução há mais de 2 ciclos | plataforma | alta |
| `produto_classificacao_suspeita` | produto cuja categoria diverge da categoria mais comum dos itens em que foi usado (heurística; só aviso) | empresa | baixa |
| `ficha_desatualizada` | ficha técnica com `valida_ate` vencida, `situacao` diferente de vigente ou `data_emissao` há mais de 24 meses (prazo: pergunta 7) | empresa | média |
| `documento_pendente` | documento exigido por edital acompanhado vencido ou ausente (já existe no checklist; aqui vira contagem) | empresa | alta |
| `alerta_nao_enviado` | alerta da agenda/contrato que deveria ter saído e não tem registro de envio (push/app/e-mail) | empresa | alta |
| `prazo_divergente` | prazo gravado diferente do recálculo atual pela mesma regra e mesmos feriados (indica regra/feriado alterado ou bug) | empresa | alta |
| `job_falhando` | tipo de job com falhas repetidas nas últimas 24 h (`ops.jobs`/`ops.execucoes`) | plataforma | média |

### 3.2 Modelo de dados (proposta)

- `ops.qualidade_rodadas` (id, iniciada_em, concluida_em, versao_regras, erro) e `ops.qualidade_achados` (id, rodada_id, codigo, gravidade, `empresa_id` nulo = plataforma, referência `tabela` + `registro_id`, detalhe jsonb **sem PII**, resolvido_em, resolvido_por, nota). RLS: achado com `empresa_id` só para quem tem `relatorios/visualizar` naquela empresa; achado de plataforma só SUPERADMIN. Escrita só pelo worker (`vv_worker`) e "marcar resolvido" por função.
- Teste A x B de `ops.qualidade_achados` (achado da empresa A invisível para B), mesmo estando em `ops`.

### 3.3 Telas

- **Plataforma (SUPERADMIN):** aba "Qualidade" no painel de cobertura: achados de plataforma por código, com tendência.
- **Empresa:** card "Qualidade dos dados" no Início (só com achados; indicador zerado não vira cartão, padrão 7 do COMECE-AQUI §3) e lista com link direto ao item.

### 3.4 Critérios de aceite do bloco

| # | Critério | Prova |
| --- | --- | --- |
| CA-1 | Cada verificação acusa o caso conhecido e não acusa o caso limpo | pytest de `rules/qualidade.py` (≥ 80%) com fixtures |
| CA-2 | `prazo_divergente` acusa prazo gravado com feriado alterado depois | pytest com banco |
| CA-3 | Achado da empresa A não aparece para B; achado de plataforma só para SUPERADMIN | pgTAP isolamento + e2e |
| CA-4 | Rodada repetida no mesmo dia não duplica achado aberto | pytest com banco |

## 4. Bloco 13.5 · Monitoramento de resultados (esboço)

- Fonte inicial: PNCP (o coletor de resultados da 7.5 já existe). Para cada edital acompanhado e ainda não encerrado, consultar periodicamente os documentos/atos publicados do processo (a confirmar no manual da API do PNCP quais atos vêm estruturados) e registrar como `priv.documentos_posteriores` com `origem = 'pncp'`, link oficial e hash.
- **Proposta de evento:** homologação, resultado de recurso e resposta a impugnação geram uma sugestão na agenda ("publicado em X: confirme para lançar o prazo"), não o evento direto, enquanto a regra de prazo correspondente não estiver validada (⚖️). Pergunta 3.
- Idempotente por `(edital, ato, hash)`; ato já registrado à mão (9.5) não duplica (casar por tipo + data + número).
- Critérios: fixture gravada do PNCP com atos reais públicos anonimizados, A x B (documento posterior de A não vira de B mesmo para edital acompanhado pelas duas).

## 5. Bloco 13.3 · Notificações externas (esboço)

- **Calendário:** URL de assinatura `.ics` por pessoa (token próprio, revogável, só leitura, só eventos dos módulos que a pessoa vê; título genérico "Prazo · impugnação" + link; nada de órgão/valor). Token tratado como segredo (hash no banco, rotação).
- **WhatsApp:** Meta Cloud API com **modelos de mensagem aprovados** (exigência da própria Meta), opt-in por pessoa, texto "Você tem um prazo vencendo hoje no VV Licitações: <link>". Custo por conversa (pergunta 2). Credenciais no gerenciador de segredos, só no worker.
- **E-mail:** o relatório diário e os alertas já existem; incluir prazos jurídicos com o mesmo texto genérico.
- Critérios: composição sem dado sensível testada (lista de proibidos: CNPJ, valores, nomes de órgão, motivo), opt-out funcionando, falha do canal externo registrada sem derrubar os outros.

## 6. Blocos 13.1, 13.2 e 13.4 (esboço)

- **13.1:** para cada portal, uma ficha antes do código: base de uso (termos, API pública, contrato), formato, limites de taxa, campos, cobertura esperada e plano de teste com fixture. Só depois a spec curta e o conector. Começar pelo de maior volume para a carteira da VV (pergunta 4).
- **13.2:** levantar por emissor (Receita/PGFN, TST, Caixa/FGTS, estaduais, municipais) se há API oficial, convênio ou serviço autorizado (ex.: integradores com contrato). Sem isso, nada muda: a pendência com link do emissor da Fase 03 continua. Certificado digital da empresa **nunca** fica no sistema sem ADR específico (pergunta 5).
- **13.4:** pacote = linhas em tabelas `pub` já existentes (categorias, atributos, palavras-chave) + checklist técnico padrão; carga por migration de dados fictícia em dev e pela operação em produção.

## 7. Permissões (sugestão de padrão)

| Operação | SUPERADMIN | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE |
| --- | --- | --- | --- | --- | --- |
| Ver achados de qualidade da empresa (`relatorios/visualizar`) | sim | sim | conforme vínculo | conforme vínculo | não |
| Ver achados de plataforma e saúde das fontes | sim | não | não | não | não |
| Ligar canais externos para si (calendário, WhatsApp) | sim | sim | sim | sim | conforme vínculo |
| Ativar pacote de categoria na empresa (`produtos/editar`) | sim | sim | não | não | não |
| Confirmar evento proposto por 13.5 (`agenda/editar`) | sim | sim | sim | sim | não |

## 8. Ameaças (proposta para `docs/threat-model.md`)

| Ameaça | Controle | Teste |
| --- | --- | --- |
| **T1** · achado de qualidade, documento posterior ou assinatura de calendário de A vistos por B | RLS por `empresa_id`; token de calendário por pessoa e escopo | A x B por bloco |
| **T3 (fonte externa)** · conteúdo de portal com instrução ou arquivo malicioso | regra 16; arquivos pelo fluxo da Fase 03 (quarentena, tipo real, ClamAV) | fixtures hostis |
| **T7 (nova)** · vazamento por canal externo (WhatsApp, e-mail, calendário em celular de terceiro) | texto genérico, opt-in, revogação, token só leitura | teste de composição |
| **T8 (nova)** · bloqueio/ação legal por uso de portal fora dos termos | base de uso obrigatória em `ops.fontes`; revisão antes do conector | revisão |
| **T6** · prazo lançado errado a partir de publicação | evento só proposto até a validação jurídica | e2e |

## 9. Perguntas abertas

1. **Ordem dos blocos.** (a) 13.6 → 13.5 → 13.3 (calendário) → 13.1 → 13.4 → 13.2; (b) começar por 13.1 (mais fontes) para ganhar cobertura; (c) começar por 13.3 (WhatsApp) pelo valor percebido. **Recomendação: (a)**: 13.6 e 13.5 não têm dependência externa nem custo novo.
2. **WhatsApp:** (a) não por enquanto (push + e-mail + calendário); (b) sim, com conta Meta Business da VV e custo por conversa; (c) só para prazos jurídicos no dia. **Recomendação: (c)** quando houver conta; até lá (a). Custo mensal novo: precisa do seu ok (AGENTS.md §9).
3. **13.5 lança o prazo sozinho?** (a) não: propõe e a pessoa confirma, até o jurídico validar as regras; (b) sim, com selo ⚖️. **Recomendação: (a)**.
4. **Primeiro portal novo (13.1):** qual tem mais editais relevantes para a carteira da VV? (BLL, BNC, Licitanet, ComprasBR, Portal de Compras Públicas, Licitações-e, DOM/SC.) Precisa da sua resposta; sem ela, recomendo a ficha de termos de todos antes de qualquer código.
5. **13.2 com certificado digital da empresa:** (a) nunca armazenar certificado; só integrações que não exijam; (b) aceitar certificado A1 cifrado com a KEK, com ADR e uso restrito ao worker. **Recomendação: (a)** agora; (b) só com ADR e análise de risco.
6. **Virada SaaS** (cadastro aberto, planos, cobrança) fica nesta fase? (a) não: spec própria quando houver decisão comercial; (b) sim. **Recomendação: (a)**.
7. **Retenção dos achados de qualidade e idade máxima da ficha técnica:** achados (a) 180 dias e depois só a contagem; (b) para sempre; ficha "antiga" a partir de 24 meses de emissão (ou outro prazo da operação). **Recomendação: (a) e 24 meses**, ajustável por empresa.

## 10. Plano de entregas (itens para a fila)

| Item | Bloco | Conteúdo | Tier | Migration |
| --- | --- | --- | --- | --- |
| 13.6-a | 13.6 | `rules/qualidade.py` com as verificações de §3.1 e testes primeiro | médio | não |
| 13.6-b | 13.6 | `ops.qualidade_rodadas`/`ops.qualidade_achados`, RLS, job diário, pgTAP + A x B | alto | sim |
| 13.6-c | 13.6 | API + telas (plataforma e Início) + e2e A x B | médio | não |
| 13.5-a | 13.5 | Ficha da API do PNCP para atos pós-disputa (o que vem estruturado) e fixtures gravadas | alto | não |
| 13.5-b | 13.5 | Coletor de atos → documentos posteriores + evento proposto; pytest com banco + e2e | alto | talvez (`origem`) |
| 13.3-a | 13.3 | Assinatura `.ics` por pessoa com token revogável | médio | sim |
| 13.3-b | 13.3 | WhatsApp (só após pergunta 2) | alto | sim |
| 13.1-x | 13.1 | Uma ficha de termos por portal; depois um conector por portal | alto | conforme o portal |
| 13.4-x | 13.4 | Um pacote por categoria, com dados da operação | baixo | dados |
| 13.2-x | 13.2 | Levantamento por emissor; integração só onde houver base oficial | alto | conforme o emissor |
