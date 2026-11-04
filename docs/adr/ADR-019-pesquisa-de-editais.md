# ADR-019 · Pesquisa de editais: bibliotecas de texto, dois consumidores e arquivos em memória até o veredito

- **Status:** Aceito (2026-11-04, spec da Fase 04 aprovada com as recomendações)
- **Data:** 2026-11-04
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 4.1, 4.5; spec `docs/specs/fase-04.md`; ADR-014, ADR-017

## Decisões

1. **Texto de PDF:** `pypdfium2` (BSD-3/Apache-2.0) + Pillow (HPND) + Tesseract (`tesseract-ocr-por`, Apache-2.0) por subprocesso; planilha com `openpyxl` (MIT, valores, nunca fórmula); DOCX lido do `document.xml` **sem parser XML**. **Não** usamos PyMuPDF (AGPL-3.0, regra 7 do `AGENTS.md`).
2. **Dois consumidores na fila** (`ops.jobs`): um para jobs curtos e para o agendador (e-mail, push, verificação de documento, importação, relevância, alertas) e outro para os longos da pesquisa (`coletar_fonte`, `baixar_arquivo_edital`, `extrair_texto`, `indexar_trechos`), com a coleta na frente dos downloads. Sem isso a coleta das 07h esperaria atrás de centenas de arquivos e o vigia a daria como perdida.
3. **Arquivo de edital em memória até o veredito:** o worker baixa (https, host da lista da fonte, sem redirecionar, até 100 MB), verifica (tipo real, ClamAV, SHA-256) e só então grava `editais/{edital}/{sha256}` no S3. Nada não verificado vai ao bucket, o que dispensa a pasta de quarentena para esse caminho. Compactados (ZIP/RAR/7z) são guardados, mas o texto fica pendente.
4. **Limite de taxa por host compartilhado no processo** (não por instância do cliente), com retry de 1 a 16 s e `User-Agent` identificando o robô.
5. **Data da sessão não é deduzida:** a fonte não a informa; `pub.editais.data_sessao` fica nulo até a Fase 05 definir de onde vem (prazos legais dependem dela).
6. **Embeddings (decidido, ainda não implementado):** modelo local no worker (384 dimensões, coluna `pub.trechos.embedding` já criada quando há `pgvector`); a relevância hoje usa só termos e filtros, e a semelhança entra como parâmetro opcional da regra.

## Consequências

- Mais duas dependências Python (`pypdfium2`, `openpyxl`) e a imagem do worker ganha Tesseract.
- Um job longo ocupa o consumidor pesado: arquivos esperam a coleta terminar. Aceito; gatilho para reavaliar: coleta acima de 30 min ou fila de arquivos acumulando por mais de um dia.
- A visibilidade de job de 5 min do `ops.pegar_jobs` não protege jobs longos com mais de um consumidor pesado; por isso há **um** consumidor pesado.
