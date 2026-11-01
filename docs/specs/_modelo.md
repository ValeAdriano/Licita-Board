# Spec · Fase XX · <Nome>

- **Status:** Rascunho | Em revisão | Aprovada
- **Onda:** <n>
- **Autor:** <agente/pessoa> · **Aprovação:** Adriano Vale em <data>
- **Validação jurídica:** <n/a | pendente | jurídico VV em data>
- **Fontes:** Prompt Mestre Fase XX; Plano, Fase XX; ADRs <...>

## 1. Escopo

**Entra:** ...

**Não entra (e onde fica):** ...

## 2. Requisitos

| ID | Requisito | Origem |
| --- | --- | --- |
| RF-XX.1 | | Prompt X.Y |

## 3. Modelo de dados

### `<schema>.<tabela>`

| Coluna | Tipo | Nulo | Regra |
| --- | --- | --- | --- |
| id | uuid | não | v7, PK |
| empresa_id | uuid | não | FK `core.empresas` |

**Índices:** ...  **Unicidade:** ...

**RLS:**

| Operação | Policy |
| --- | --- |
| select | `core.has_permission(empresa_id, '<modulo>', 'visualizar')` |
| insert | ... |
| update | ... |
| delete | ... (normalmente nenhuma: soft delete via update) |

## 4. Regras de negócio

1. ...
2. ⚖️ VALIDAR JURÍDICO: ...
3. 🧾 VALIDAR CONTADOR: ...

## 5. Permissões

| Operação / tela | SUPERADMIN | ADMIN_EMPRESA | OPERADOR | JURÍDICO | CLIENTE | Step-up |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## 6. Telas

| Tela | Rota | Estados | Comportamento em 360 px |
| --- | --- | --- | --- |
| | | carregando, vazio, erro, sem permissão | |

## 7. Jobs e integrações

| Job | Gatilho | Idempotência | Em caso de falha |
| --- | --- | --- | --- |

## 8. Ameaças

| Ameaça (T1–T8) | Como esta fase é afetada | Controle | Teste |
| --- | --- | --- | --- |

## 9. Critérios de aceite

| # | Critério | Origem | Como será comprovado |
| --- | --- | --- | --- |
| CA-1 | | Prompt | teste `...` |

## 10. Plano de PRs

1. ...

## 11. Perguntas abertas

1. **<pergunta>** — Opções: (a) ... (b) ... Recomendação: (a), porque ...
