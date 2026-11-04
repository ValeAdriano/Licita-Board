# LGPD · inventário de dados pessoais

- **Status:** Rascunho. O inventário técnico da Fase 01 está completo (atualizado em 2026-11-04 para a stack atual). As bases legais, os prazos de retenção e o contrato operador/controlador dependem do jurídico VV e **bloqueiam o 1º cliente real**.
- **Papéis:** VV = **operadora** dos dados que o cliente cadastra; cliente = **controlador**. Para os usuários da plataforma, a VV é controladora.

## Inventário (o que existe hoje, Fase 01)

| Dado | Titular | Onde fica | Finalidade | Base legal (a validar ⚖️) | Proteção | Retenção |
| --- | --- | --- | --- | --- | --- | --- |
| Nome, e-mail, telefone, OAB de usuários | Usuários | `core.usuarios` | Acesso e notificações | Execução de contrato | RLS; grants por coluna; e-mail e nome redigidos na auditoria | Enquanto ativo + `<A DEFINIR>` |
| Hash da senha (Argon2id) | Usuários | `core.usuarios.senha_hash` | Autenticar | Execução de contrato | Sem SELECT para a API; fora da auditoria | Enquanto ativo |
| Segredo TOTP e códigos de recuperação | Usuários | `core.fatores_mfa` (cifrado com a chave-mestra), `core.codigos_recuperacao` (hash) | MFA | Legítimo interesse (segurança) | Envelope (ADR-017); sem acesso da API | Até remover o fator |
| IP, user agent e plataforma das sessões | Usuários | `core.sessoes` | Segurança e tela "minhas sessões" | Legítimo interesse | Token só em hash; sem SELECT direto da API | `<A DEFINIR>` (sem expurgo ainda) |
| Hash do e-mail e IP das tentativas de login | Usuários e terceiros | `core.tentativas_login` | Bloqueio progressivo | Legítimo interesse | E-mail em hash; sem acesso da API | `<A DEFINIR>` (sem expurgo ainda) |
| IP, user agent, ações e valores antes/depois | Usuários | `audit.audit_log` | Segurança e auditoria | Legítimo interesse / obrigação legal | Insert-only (trigger `ALWAYS`); dado pessoal redigido | `<A DEFINIR>` |
| Endpoint e chaves do Web Push | Usuários | `core.dispositivos_push` | Aviso no dispositivo | Consentimento (o usuário ativa em Conta) | A API nunca lê; só o worker; revogado ao trocar a senha ou desativar a conta | Até revogar; revogados há mais de 30 dias são apagados |
| Notificações | Usuários | `core.notificacoes` | Avisos dentro do app | Execução de contrato | RLS por destinatário | `<A DEFINIR>` |
| E-mail do convidado e quem convidou | Convidados | `core.convites` | Vincular a uma empresa | Execução de contrato (pré-contratual) | RLS; vale 7 dias | `<A DEFINIR>` |
| Fila de jobs | Usuários | `ops.jobs` | Enviar e-mail e push | Execução de contrato | Payload só com identificadores, nunca token nem conteúdo | `<A DEFINIR>` (sem expurgo ainda) |
| Backup do banco | Todos | Bucket S3 externo (pgBackRest) | Recuperação de desastre | Legítimo interesse | Cifrado (aes-256-cbc) com senha fora do repositório | Retenção em `infra/backup/pgbackrest.conf`; **eliminação de um titular só sai do backup quando o conjunto expira** |

## Previsto para as próximas fases

| Dado | Titular | Onde fica | Fase |
| --- | --- | --- | --- |
| Nome, CPF, RG, cargo, poderes de representantes | Representantes | `priv.representantes` (CPF cifrado em nível de campo) | 02 |
| Procurações e assinaturas digitalizadas | Representantes | S3 privado, URL assinada de curta duração | 02 e 03 |
| OAB de advogados em peças | Advogados | `priv` (peças) | 10 |
| Contatos de órgãos (gestor, fiscal) | Servidores públicos | `priv.contratos` | 11 |

## Pendências

- [ ] Jurídico VV: bases legais, prazos de retenção por tipo de dado, contrato operador/controlador.
- [ ] Política de expurgo de `core.sessoes`, `core.tentativas_login`, `ops.jobs` e `core.notificacoes` (hoje nada é apagado; o expurgo precisa de decisão de prazo).
- [ ] Fluxo de atendimento ao titular (acesso, correção, eliminação), inclusive o efeito sobre os backups.
- [ ] Plano de resposta a incidentes com comunicação à ANPD e aos titulares.
- [ ] Confirmar com os provedores que forem contratados (VPS, bucket de backup, Resend, Cloudflare Turnstile, LLMs) o contrato de tratamento e a região dos dados.
- [ ] Nenhum dado pessoal enviado a provedor de IA (ADR-005).
