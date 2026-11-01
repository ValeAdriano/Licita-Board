# llm/

Abstração multi-provedor (ADR-005). Nada fora desta pasta chama SDK de LLM diretamente.

- `prompts/` guarda prompts versionados (`nome.vN.md`). Mudou o prompt, sobe a versão e roda o eval.
- Texto de edital entra delimitado como DADO, nunca como instrução. O modelo não tem ferramentas de escrita.
- Saída sempre validada por schema (Pydantic). Saída inválida vira A CONFIRMAR, nunca ATENDE.
- Nunca enviar custos, margens ou dados pessoais ao provedor.
