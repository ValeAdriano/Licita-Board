# Relatório de fase · Fase XX · <Nome>

- **Status:** Aguardando aceite | Aceito em <data>
- **Período:** <início> a <fim>
- **Commit/tag de referência:** <sha ou tag>
- **Resumo em uma linha:** <a fase está / não está concluída, porque ...>

## 1. Funcionalidades

### Testado e aprovado
| Requisito | Evidência (teste / CI / print) |
| --- | --- |

### Implementado sem teste
| Requisito | Por que sem teste | Plano |
| --- | --- | --- |

### Não implementado
| Requisito | Motivo | Vai para |
| --- | --- | --- |

### Limitações conhecidas
- ...

## 2. Arquivos e componentes criados
<`git diff --stat` resumido por pasta>

## 3. Alterações no banco
| Migration | Tabelas/funções | Teste A x B |
| --- | --- | --- |

## 4. Integrações operacionais
| Integração | Estado | Evidência |
| --- | --- | --- |

## 5. Testes e resultados
| Suíte | Comando | Resultado |
| --- | --- | --- |
| Web | `npm test` | |
| Worker | `uv run pytest --cov` | |
| Banco | `npx supabase test db` | |
| Isolamento | `scripts/check_isolation_coverage.py` | |
| SAST / segredos | Semgrep, Gitleaks | |

## 6. Critérios de aceite
| # | Critério | Status (COMPROVADO / PARCIAL / NÃO) | Evidência |
| --- | --- | --- | --- |

Evidências em `docs/phase-reports/evidencias/fase-XX/`.

## 7. Erros conhecidos
## 8. Dependências pendentes
## 9. Riscos novos e atualização do modelo de ameaças
## 10. Próxima fase recomendada
