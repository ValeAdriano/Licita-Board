# ADR-005 · IA multi-provedor: LiteLLM no worker, chave VV padrão, BYOK no Vault

- **Status:** Proposto
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre Fase 06 (6.3, 6.6, 6.7, 6.8), Fase 10.1, "Regras de IA"

## Contexto

Análise técnica e minutas jurídicas usam LLM. Requisitos: evidência verificável, nenhuma decisão final pela IA, proteção contra prompt injection, registro de modelo e prompt, eval antes de trocar modelo, envio mínimo de dados, provedor que não treina com os dados. Clientes podem querer usar a própria chave.

## Alternativas

| Alternativa | Prós | Contras |
| --- | --- | --- |
| A. **LiteLLM (lib) no worker + camada própria `llm/`** | Troca de provedor por configuração; custo por chamada; um ponto de controle | Mais uma dependência |
| B. SDK de um provedor só | Simples | Lock-in; BYOK de outro provedor impossível |
| C. Gateway externo (OpenRouter etc.) | Muitos modelos | Dados passam por terceiro adicional |

## Decisão

**A.** Toda chamada passa por `apps/worker/src/worker/llm/`:

- Provedor/modelo configurável por empresa; chave VV padrão em segredo do Railway; BYOK cifrada no Vault, lida só pelo worker.
- Prompts versionados (`llm/prompts/<nome>.vN.md`); `ops.llm_execucoes` registra provedor, modelo, versão do prompt, tokens, custo, hash da entrada.
- Texto externo entra delimitado como dado; modelo sem ferramentas de escrita; saída em JSON validada por Pydantic; inválida → `A CONFIRMAR`.
- Comparações numéricas e regra central (obrigatório não atendido ≠ ATENDE) em código (`rules/`), nunca na IA.
- Verificador de citação confere o trecho no texto extraído da página citada.
- Eval no CI quando muda prompt, modelo ou provedor (meta: recall ≥ 98%, zero ATENDE indevido).
- Só provedores com termos de não-treinamento em API; nunca enviar custo, margem ou dado pessoal.

## Consequências

- **Negativas / risco residual:** custo variável (medido desde o início); qualidade varia por provedor (eval por provedor).
- **Gatilho para reavaliar:** provedor sem opção de não-treinamento, ou LiteLLM sem manutenção.
