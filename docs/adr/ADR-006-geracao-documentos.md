# ADR-006 · Geração de documentos: `docxtpl` + LibreOffice headless

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 8.1–8.7, 10.3, 10.8

## Contexto

Propostas, declarações e peças jurídicas precisam sair em Word e PDF, preservando o modelo do edital ou o papel timbrado da empresa, com hash no documento final.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **`docxtpl` (Jinja em DOCX) + LibreOffice headless para PDF** | Preserva o modelo do cliente; usuário edita o modelo no Word | Container maior (fontes + LibreOffice) |
| B. Gerar HTML → PDF | Fácil de estilizar | Não preserva DOCX do edital; Word é exigência |
| C. API paga (Docmosis, Carbone cloud) | Pronto | Documento sensível sai para terceiro; custo |

## Decisão

**A.** Renderização no worker; PDF via `soffice --headless --convert-to pdf` em container com fontes do timbrado instaladas. Documento final recebe SHA-256 e fica imutável; alteração gera nova versão.

## Consequências

- **Negativas / risco residual:** fidelidade do PDF depende das fontes instaladas (teste visual por modelo).
- **Gatilho para reavaliar:** modelos de edital que `docxtpl` não consiga preservar.
