# LGPD · inventário de dados pessoais

- **Status:** Rascunho (Fase 01 completa; contrato operador/controlador redigido pelo jurídico VV — bloqueante para o 1º cliente real)
- **Papéis:** VV = **operadora** dos dados que o cliente cadastra; cliente = **controlador**. Para usuários da plataforma, a VV é controladora.

## Inventário

| Dado | Titular | Onde fica | Finalidade | Base legal (a validar ⚖️) | Proteção | Retenção |
| --- | --- | --- | --- | --- | --- | --- |
| Nome, e-mail, telefone de usuários | Usuários | `auth.users`, `core.usuarios` | Acesso e notificações | Execução de contrato | RLS | Enquanto ativo + `<A DEFINIR>` |
| IP, user agent, ações | Usuários | `audit.audit_log` | Segurança e auditoria | Legítimo interesse / obrigação | Insert-only | `<A DEFINIR>` |
| Nome, CPF, RG, cargo, poderes de representantes | Representantes | `core.representantes` | Assinatura de documentos de licitação | Execução de contrato (do cliente) | CPF no Vault, mascarado | Fim do contrato + `<A DEFINIR>` |
| Procurações | Representantes | Storage `documentos` | Comprovar poderes | Execução de contrato | Bucket privado, signed URL | Validade + `<A DEFINIR>` |
| OAB de advogados | Advogados | `core.representantes` | Assinatura de peças | Execução de contrato | RLS | Fim do contrato |
| Contatos de órgãos (gestor, fiscal) | Servidores públicos | `priv.contratos` | Execução contratual | Execução de contrato | RLS | Fim do contrato + `<A DEFINIR>` |
| Assinaturas digitalizadas | Representantes | Storage `documentos` | Documentos gerados | Execução de contrato | Bucket privado | Fim do contrato |

## Pendências

- [ ] Jurídico VV: bases legais, prazos de retenção por tipo de documento, contrato operador/controlador.
- [ ] Fluxo de atendimento ao titular (acesso, correção, eliminação) — Fase 01/12.
- [ ] Plano de resposta a incidentes com comunicação à ANPD e aos titulares.
- [ ] Confirmar com provedores (Supabase, Railway, Vercel, LLMs, Resend) DPA e região dos dados.
- [ ] Nenhum dado pessoal enviado a provedor de IA (ADR-005).
