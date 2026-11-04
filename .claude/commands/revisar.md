---
description: Revisa a branch atual contra DoD, segurança e spec
---
Siga `docs/agents/prompts/revisao-pr.md` sobre `git diff main...HEAD`. Se o diff tocar `db/`, rode também o subagente `revisor-migration`; se tocar auth, storage, permissões, IA ou uploads, rode `revisor-seguranca`. Entregue achados ordenados por gravidade, com arquivo:linha.
