# Spec · Fase 08 · Propostas (declarações e habilitação ficam para os próximos blocos)

- **Status:** Aprovada em 2026-11-05 (instrução do Adriano: "siga desenvolvendo sem interrupções, uma fase após a outra"). Decisões abaixo são recomendações minhas, registradas para revisão.
- **Onda:** 5
- **Autor:** Claude Code (2026-11-05) · **Aprovação:** Adriano Vale, 2026-11-05
- **Validação:** modelos oficiais dos editais e papel timbrado da empresa (Operação VV) **pendentes**; texto padrão da proposta e das declarações ⚖️ **pendente do jurídico**.
- **Fontes:** Prompt Mestre Fase 08 (8.1 a 8.7); Fase 02 (representantes e poderes, `core.signatario_valido`); Fase 03 (validade de documentos); Fase 05 (acompanhamento, abertura); Fase 06 (análise técnica aprovada); Fase 07 (preço aprovado e `rules/extenso.py`).

> **Princípios:** a proposta só nasce de **preço aprovado** (Fase 07); validações são código puro e **qualquer divergência bloqueia**; o documento final recebe **hash e fica bloqueado** (nova alteração = nova versão); o sistema **nunca envia ao portal** (regra 17): a pessoa autorizada baixa o arquivo e registra o comprovante.

## 1. Escopo

**Entra neste bloco:**

- **Proposta por acompanhamento** (`priv.propostas`), versionada (v1, v2...), com tipo `inicial` ou `final`, representante, validade da proposta, prazo de entrega, garantia e condições comerciais. O conteúdo (itens, quantidades, preços unitários e totais) é um **instantâneo** dos itens com preço aprovado; custos e margens **nunca** entram na proposta.
- **Validação automática (8.6)** em `rules/proposta.py`: CNPJ da empresa, representante com poder `assinar_proposta` válido na data da sessão (procuração vigente), número do edital, quantidades contra o edital, total = quantidade × unitário e soma dos totais, preço do rascunho igual ao preço aprovado atual, marca/modelo com **análise técnica aprovada**, documentos de habilitação válidos na data da sessão. Cada divergência diz o que é e se **bloqueia**.
- **Fluxo (8.7):** `rascunho → conferência → aprovada → final`. Conferência e aprovação por pessoas diferentes quando possível (aprovar exige `propostas/aprovar`). O `final` gera o **.docx** (sem dependência nova), com valor por extenso (`rules/extenso.py`), grava no armazenamento, calcula **SHA-256** e **bloqueia** a versão. Mudar algo = nova versão.
- **Tela:** versões da proposta, itens, validação (bloqueios em vermelho), ações do fluxo e download.

**Fica para os próximos blocos:**

| Item | Por quê |
| --- | --- |
| PDF (8.2) | Exige LibreOffice na imagem do worker (peso e custo de imagem): decisão do Adriano. |
| Modelo oficial do edital e papel timbrado (8.3, 8.1) | Exige os modelos reais (Operação VV) e `docxtpl`; hoje o documento usa um modelo padrão simples. |
| Declarações (8.4) e checklist (8.5) | Dependem de identificar as declarações por edital (texto oficial/anexos). |
| Registro do comprovante de envio ao portal (8.7) | Entra com a Fase 09. |

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-08.1 | Criar proposta a partir de itens com preço aprovado; instantâneo sem custos nem margens | 8.1 |
| RF-08.2 | Validação automática com divergências bloqueantes ou de aviso, gravada na proposta | 8.6 |
| RF-08.3 | Fluxo rascunho → conferência → aprovada → final, com quem e quando; permissão por etapa | 8.7 |
| RF-08.4 | Documento final com valor por extenso, SHA-256 e bloqueio; alteração cria versão nova, as anteriores ficam | 8.2, 8.7 |
| RF-08.5 | Download pelo próprio sistema (URL temporária, permissão e auditoria); envio ao portal é humano | 8.7, regra 17 |
| RF-08.6 | Isolamento A x B e permissões do módulo `propostas` | regra 13 |

## 3. Dados e permissões

- `priv.propostas` (instantâneo em `conteudo jsonb`, `validacao jsonb`, `arquivo_chave`, `arquivo_sha256`, versão, status, quem/quando em cada etapa). Leitura com `propostas/visualizar`; criar/revalidar com `propostas/cadastrar`; conferir com `propostas/editar`; aprovar e gerar o final com `propostas/aprovar`. Gravação só por função; versão `final` imutável por gatilho.
- Dinheiro como `numeric(18,4)` / texto decimal; nada de `float`.

## 4. Critérios de aceite (deste bloco)

| ID | Critério | Prova |
| --- | --- | --- |
| CA-1 | Cada divergência da 8.6 bloqueia o avanço do fluxo e aparece na tela | pytest das regras + pgTAP |
| CA-2 | Documento final com extenso correto, hash gravado e versão bloqueada (update recusado) | pytest + pgTAP |
| CA-3 | Proposta só de preço aprovado; preço mudou depois = divergência bloqueante | pytest + e2e |
| CA-4 | Isolamento A x B de proposta e download | pgTAP + e2e |
| CA-5 | Modelo oficial do edital e papel timbrado preservados | **pendente** (modelos reais) |

## 5. Perguntas abertas (recomendação minha entre parênteses)

1. PDF: instalar LibreOffice na imagem do worker (custo de imagem) ou aceitar só Word por enquanto? (instalar quando for para produção.)
2. ⚖️ Texto-padrão da proposta e cláusulas obrigatórias por modalidade. (jurídico entrega o modelo; o código só preenche campos.)
3. Quem pode conferir e quem pode aprovar? (conferir: `propostas/editar`; aprovar: `propostas/aprovar`, idealmente outra pessoa.)

## 6. Estado

- 2026-11-05 · spec aprovada; implementação em blocos (regras puras → banco → worker → API → tela).
