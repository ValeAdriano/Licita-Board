---
description: Escreve o teste pgTAP A x B de uma tabela privada
argument-hint: <schema.tabela, ex. priv.documentos>
---
Tabela: $ARGUMENTS

Siga `docs/agents/prompts/05-testes.md`, seção "Isolamento A x B", usando `db/tests/isolamento/_modelo.sql.example` como base. Cubra SELECT, INSERT, UPDATE, DELETE e, se a tabela tiver arquivo no S3, o download por URL assinada.
