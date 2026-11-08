# Spec · Fase 03 · Gestão documental e controle de certidões

- **Status:** Aprovada em 2026-11-04 (instrução do Adriano: "continue executando as próximas etapas", com as recomendações da seção 9). ⚖️ Retenção e texto de ME/EPP seguem pendentes do jurídico e não bloqueiam o início
- **Onda:** 2 — MVP
- **Autor:** Claude Code (2026-11-04) · **Aprovação:** Adriano Vale, 2026-11-04
- **Validação jurídica:** pendente (LC 123, art. 43 §1º; prazo de guarda de documento ⚖️)
- **Fontes:** Prompt Mestre Fase 03 (3.1 a 3.6) e 1.4 (Arquivos); Plano, Fase 03; ADR-017 (arquivos em S3 e cifra), ADR-014 (fila `ops.jobs`); [Fase 02](fase-02.md)

> Estado de partida: a Fase 02 já deixou `documento_id` **sem FK** em `core.representantes` (assinatura), `core.procuracoes`, `priv.produtos` (catálogo e ficha) e `priv.fichas_tecnicas`. Esta fase cria `priv.documentos` e liga esses campos. O ambiente Docker local ainda não tem S3: o S3 de desenvolvimento (SeaweedFS) entra aqui (pergunta 1).

## 1. Escopo

**Entra:** repositório documental por empresa (pastas = tipos de documento), cadastro com versões nunca sobrescritas, upload seguro (quarentena, antivírus, tipo real, tamanho, SHA-256), download por URL assinada de 60 s com auditoria, status de vencimento e alertas configuráveis, "Atualizar documento" que gera **pendência** com instruções (sem integração oficial), serviço único de checklist documental, atestados técnicos estruturados.

**Não entra:** integração real de emissão de certidão (Fase 13); agenda e prazos jurídicos (Fase 05: o cruzamento "vence antes da sessão" usa a data da disputa que a Fase 05 cria; aqui o serviço recebe a data por parâmetro); peças jurídicas geradas (Fase 10, que só alimenta a pasta Jurídico); OCR e leitura automática do conteúdo (Fases 04 e 06).

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-03.1 | Tipos de documento em pastas (habilitação jurídica, econômico-financeira, fiscal/trabalhista, técnica, timbrado e modelos, jurídico) como dado, sem migration para tipo novo | Prompt 3.1 |
| RF-03.2 | Cadastro: empresa, tipo, descrição, arquivo original, número, emissão, validade (ou "sem vencimento"), emissor, origem, responsável, atualização, versões, hash, status | Prompt 3.2 |
| RF-03.3 | Versão nova preserva a anterior; nada é sobrescrito nem apagado | Prompt 3.2; critério |
| RF-03.4 | Upload em quarentena; só vira documento depois de antivírus, tipo real, tamanho máximo e SHA-256 conferidos; arquivo infectado é bloqueado | Prompt 3.6; ADR-017 |
| RF-03.5 | Download só por URL assinada de 60 s, depois de checar a permissão, com registro de cada download | Prompt 1.4, 3.6 |
| RF-03.6 | Status: Válido, A vencer, Vencido, Em atualização, Pendente, Erro de atualização; calculado, nunca digitado | Prompt 3.3 |
| RF-03.7 | Alertas por documento nas antecedências 30, 15, 10 e 5 dias (configurável por tipo), por notificação, push e e-mail; um alerta por documento e marco, sem repetir | Prompt 3.3; critério |
| RF-03.8 | Alerta de documento que vencerá antes de uma disputa agendada (data recebida da Fase 05) | Prompt 3.3 |
| RF-03.9 | "Atualizar documento": gera pendência com instruções e link do emissor; nunca afirma renovação sem arquivo obtido; registra sucesso ou falha real | Prompt 3.4 |
| RF-03.10 | Serviço único `checklist_documental(empresa, exigencias, data_sessao)`: válido, vencido, vencerá antes da sessão, ausente, não aplicável, dependente de conferência; sinaliza ME/EPP (LC 123, art. 43 §1º) sem tratar como dispensa | Prompt 3.5 |
| RF-03.11 | Atestados técnicos com quantidades e características estruturadas | Prompt 3.1; Plano |
| RF-03.12 | Isolamento A x B em toda tabela e endpoint; download de outra empresa negado | Prompt 1.4; AGENTS.md regra 13 |

## 3. Modelo de dados (resumo; detalhe ao aprovar)

| Tabela | Schema | Conteúdo |
| --- | --- | --- |
| `pub.tipos_documento` | pub | `slug`, `nome`, `pasta`, `exige_validade`, `antecedencias int[]` (padrão `{30,15,10,5}`), `renovavel_por_emissor`, `emissor_url` (link da pendência) — escrita só de SUPERADMIN |
| `priv.documentos` | priv | `empresa_id`, `tipo_id`, `descricao`, `numero`, `emissor`, `origem`, `responsavel_id`, `sem_vencimento`, `versao_atual_id`, `em_atualizacao`, `deleted_at` |
| `priv.documento_versoes` | priv | `documento_id`, `versao`, `arquivo_chave` (S3), `nome_original`, `tipo_real`, `tamanho`, `sha256`, `emissao`, `validade`, `status_arquivo` (`quarentena`, `liberado`, `bloqueado`), `motivo_bloqueio`; **só inserção** |
| `priv.documento_downloads` | priv | `documento_id`, `versao_id`, `usuario_id`, `em`, `ip`; só inserção |
| `priv.documento_alertas` | priv | `documento_id`, `versao_id`, `marco_dias`, `enviado_em`; único por (versão, marco) |
| `priv.documento_pendencias` | priv | `documento_id`, `tipo` (`atualizar`), `status`, `instrucoes`, `criada_por`, `resolvida_em`, `resultado` (`sucesso`, `falha`), `detalhe` |
| `priv.atestados_tecnicos` | priv | `empresa_id`, `documento_id`, `contratante`, `objeto`, `periodo`, e itens com `descricao`, `quantidade numeric`, `unidade_id` (reusa `pub.unidades`) |
| `ops.arquivos_quarentena` | ops | fila de verificação (o worker move para `documentos/{empresa}/{doc}/{versao}`) |

Status calculado por view `priv.documentos_status` (security_invoker) a partir da validade da versão atual, de `em_atualizacao` e da pendência aberta; "a vencer" = dentro da maior antecedência do tipo. Datas em America/Sao_Paulo.

## 4. Regras de negócio

1. Upload em duas etapas: a API confere a permissão (`documentos/cadastrar` ou `substituir_arquivos`) e emite presigned PUT para `quarentena/`; o worker roda ClamAV, tipo real (magic), tamanho e SHA-256 e só então move; falha = `bloqueado` com motivo, nunca liberado.
2. Download: permissão `documentos/visualizar`, presigned GET de 60 s, registro em `priv.documento_downloads` e na auditoria; URL nunca é guardada.
3. Substituir arquivo = nova versão (`documentos/substituir_arquivos`); a anterior fica legível no histórico.
4. Alertas por job diário do worker, idempotente por (versão, marco); marcos conforme o tipo; destinatários: usuários com `documentos/visualizar` e responsável.
5. "Atualizar": sem integração oficial, cria pendência com instruções e o link do emissor (Receita, PGFN, TST, Caixa, SEFAZ/prefeitura); só quando um arquivo novo é anexado e liberado a pendência fecha como `sucesso`; senão `falha` registrada. **Proibido** simular renovação, contornar CAPTCHA ou usar credencial de terceiro.
6. ⚖️ **VALIDAR JURÍDICO:** texto de sinalização ME/EPP (LC 123, art. 43 §1º: regularização fiscal tardia **não** dispensa o documento) e quantos balanços são exigíveis por edital (parâmetro do edital, não regra fixa).
7. Texto de nome de arquivo e descrição é dado, nunca instrução; exibido como texto.
8. Nenhum arquivo em `quarentena/` é servido; documento `bloqueado` não tem download.

## 5. Permissões

Módulo `documentos` (já existe). Visualizar/baixar: `visualizar`; cadastrar documento ou versão: `cadastrar` e `substituir_arquivos`; arquivar: `arquivar`; atestados: `cadastrar`/`editar`; configurar antecedências e tipos novos: SUPERADMIN. CLIENTE só visualiza (e baixa o que a empresa liberar). Sem step-up nesta fase; baixar em lote fica de fora.

## 6. Telas

Pastas por tipo com contagem e semáforo (válido, a vencer, vencido); lista de documentos com filtro por status; documento com versões, upload (progresso e resultado da verificação), download, pendência "Atualizar"; checklist (entrada: exigências de um edital; saída por item); atestados técnicos. Mobile-first, vencidos em destaque, estados completos.

## 7. Jobs

Worker: `verificar_arquivo` (ClamAV + magic + hash + mover), `alertas_documentos` (diário, relógio injetável para teste), `checklist_documental` (função pura em `rules/`, sem IA; quem decide é código). O job `checklist_documental` (`apps/worker/src/worker/checklist.py`) calcula UM acompanhamento por vez (payload só com o id) e é enfileirado ao salvar exigência, ao mudar a abertura, ao liberar versão ou mudar documento, por pedido da pessoa e uma vez por dia (desenho em §10).

## 8. Ameaças e critérios de aceite

T1 (download de outra empresa), T3 (arquivo malicioso, nome de arquivo hostil), T4 (URL assinada vazada: 60 s, uso auditado), T6 (alerta perdido ou repetido). Aceite (Prompt + plano): arquivo EICAR bloqueado no upload; versões preservadas; alertas nas datas certas (relógio simulado); vencidos em destaque; download de outra empresa negado; renovação registra sucesso ou falha real.

Plano de blocos (modo rápido): (1) S3 de desenvolvimento (SeaweedFS) no compose + cliente S3 na API e no worker; (2) tipos, documentos, versões e RLS; (3) upload/quarentena/verificação (ClamAV no compose); (4) download assinado + auditoria; (5) status e alertas; (6) pendência "Atualizar"; (7) checklist; (8) atestados; (9) telas.

## 9. Perguntas abertas (com a minha recomendação)

1. **S3 local:** S3 de desenvolvimento (SeaweedFS) e ClamAV como serviços do compose de desenvolvimento? *Recomendo:* sim (Apache/AGPL e GPL, só em dev; produção usa S3 externo do ADR-017).
2. **Tamanho máximo e tipos aceitos:** *Recomendo:* 25 MB; PDF, imagens (JPEG/PNG), DOCX/XLSX/ODT para modelos; tipo real conferido, não a extensão.
3. **Antecedências padrão** 30/15/10/5 para todos os tipos? *Recomendo:* sim, configurável por tipo; "sem vencimento" não alerta.
4. **Canal do alerta:** notificação interna + push já existem; e-mail pelo worker (Mailpit em dev). *Recomendo:* os três.
5. **Retenção:** quanto tempo guardar versão antiga e documento arquivado? ⚖️ *Recomendo:* indefinido nesta fase, decidir com o jurídico (LGPD).
6. **Pastas e tipos iniciais:** a lista do Prompt vira seed de `pub.tipos_documento`, com o emissor e o link de cada certidão. *Recomendo:* sim; o jurídico/operação revisa os links.
7. **Atestado técnico:** quantidades como `numeric` com unidade de `pub.unidades`? *Recomendo:* sim.
8. **Assinatura digitalizada e timbrado:** guardar como documentos dos tipos "assinatura" e "timbrado" ligados ao representante e à empresa? *Recomendo:* sim, ligando o `assinatura_documento_id` da Fase 02.
9. **ClamAV em produção:** custo de memória (~1 GB). *Recomendo:* aceitar; o upload só vale depois da verificação.

## 10. Estado da implementação

### 10.1 Checklist documental por edital (RF-03.10) · Q-04a, 2026-11-07

**Feito (banco, worker, API e tela Q-04b):**

- Migration `20261128100000_checklist_documental.sql`: `priv.checklist_exigencias` (por acompanhamento = empresa x edital, uma por tipo de `pub.tipos_documento`: aplicável, conferência manual, regularidade fiscal, observação; auditada) e `priv.checklist_resultados` (situação calculada, documento que valeu, validade, dias para vencer, aviso ME/EPP, data de referência, data da sessão e se estava confirmada; dado derivado, sem auditoria, como `documento_alertas`). RLS nas duas: leitura com `documentos/visualizar`; a API não tem DML direto.
- Escrita só por função: `priv.salvar_exigencia_checklist` (cria ou atualiza; regularidade fiscal, se não vier, é sugerida pela pasta `fiscal_trabalhista`), `priv.remover_exigencia_checklist`, `priv.recalcular_checklist`, todas com `documentos/editar`.
- Worker: não lê `priv.documentos`; recebe (tipo, validade, sem vencimento) da versão **liberada** mais recente por `priv.checklist_documentos` e o porte por `priv.checklist_me_epp` (security definer, execute só para `vv_worker`); grava por `priv.registrar_checklist`, que confere de novo empresa, exigências e documentos. Regra: `rules/checklist_documental.py` (inalterada).
- Data da sessão = dia (America/Sao_Paulo) da `data_abertura` do acompanhamento, confirmada **ou não** (o resultado guarda `sessao_confirmada` para a tela avisar "data provisória").
- Recálculo: gatilhos em `priv.acompanhamentos` (abertura), `priv.documento_versoes` (versão liberada) e `priv.documentos` (tipo, sem vencimento, arquivamento); rodada diária `priv.enfileirar_checklists` (um job por acompanhamento em aberto, por dia) chamada pelo agendador do worker. Chave do job por transação (vários gatilhos numa transação = um job).
- API (`apps/api/src/documentos/checklist.controller.ts`): `GET /empresas/:e/acompanhamentos/:id/checklist`, `POST .../checklist/exigencias`, `POST .../checklist/recalcular`, `DELETE /empresas/:e/checklist/exigencias/:id`.
- Testes: pgTAP `430_checklist_documental` e isolamento A x B das duas tabelas; pytest do job com banco (`tests/test_checklist.py`); e2e `checklist.e2e-spec.ts` (feliz, sem permissão, A x B).

- Tela Q-04b: aba `?aba=documentos` em `Acompanhamento.tsx`, com `features/documentos/Checklist.tsx`; seis situações calculadas, validade/dias, abertura de versão liberada por download auditado, aviso ME/EPP da API recolhido, edição de exigências por permissão e releitura a cada 2,5 s limitada a cinco tentativas. Table no desktop e cartões no celular; formulário recolhido. Vitest cobre situações, ausência de edição, POST e parada das releituras. Validação visual em navegador (360 px/desktop, claro/escuro) e integração com API real ainda pendentes.

**Pendente:** "recalculando" só reflete exigência editada depois do cálculo (versão liberada agora fica com o resultado anterior até o job rodar, segundos); quantidade de balanços exigíveis segue como "conferência manual" (§4.6).

**⚖️ A validar com o jurídico:** texto do aviso ME/EPP (LC 123, art. 43, §1º) e se o MEI entra (hoje entra: ME, EPP ou MEI no enquadramento vigente na data do cálculo; o aviso só sinaliza, nunca dispensa).


- Q-23, rodada 11: matriz e2e A x B das 10 rotas de documentos e 3 de atestados em `pesquisa.e2e-spec.ts`, nos dois sentidos, fixtures por caso, UUID inexistente, snapshot por hash e assinatura S3 simulada. POST de atestado com documento alheio pela própria empresa: 400 indistinguível de documento inexistente; leituras de versões/pendências retornam lista vazia. Checklist fora desta rodada.
