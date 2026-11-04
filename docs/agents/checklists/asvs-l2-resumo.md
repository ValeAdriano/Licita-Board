# OWASP ASVS nível 2 · resumo aplicado ao VV Licitações

Checklist usado antes de cada liberação (Prompt Mestre 1.4). Não substitui o ASVS completo nem o pentest externo antes do 1º cliente real.

| Área ASVS | Controle no projeto | Como verificar | Estado (2026-11-04) |
| --- | --- | --- | --- |
| V2 Autenticação | Argon2id, senha ≥ 12, senha vazada recusada (HIBP k-anonymity), MFA TOTP obrigatório para perfis internos, bloqueio progressivo por e-mail e IP | `apps/api/test/auth.e2e-spec.ts` (força bruta, limite por IP, aal1 não gere a conta), `mfa.e2e-spec.ts`, `recuperacao.e2e-spec.ts` (senha óbvia); pgTAP `040_sessoes_login`, `050_mfa`, `060_mfa_endurecimento` | testado (lista local de senhas comuns ainda curta) |
| V2 Recuperação | Token de uso único, 30 min, mensagem neutra | `recuperacao.e2e-spec.ts` (mesma resposta com e sem conta; link usado uma vez; token inventado) | testado |
| V3 Sessão | Cookie `__Host-sessao` HttpOnly/Secure/SameSite=Strict, CSRF, inatividade 30 min, absoluta 12 h, rotação do token, "sair de todos" | `auth.e2e-spec.ts` (cookie, fixação, CSRF, sessões), pgTAP `002_contexto` (sessão revogada, expirada, de outro usuário) | testado |
| V4 Controle de acesso | RLS + `core.has_permission`, negar por padrão, guard em toda rota, 404 para recurso de outra empresa | pgTAP `001_guarda_global`, `020_core_isolamento`; e2e `rotas.e2e-spec.ts` e `acesso.e2e-spec.ts` (A x B) | testado |
| V4 Operação crítica | Step-up MFA (token de 5 min, uso único, preso à sessão) para permissões; dupla aprovação para exclusão | pgTAP `070_step_up`, `080_exclusao_dupla_aprovacao`; e2e `acesso.e2e-spec.ts` | testado (preço e proposta final: fases 08+) |
| V5 Validação | Zod na API, constraints no banco, Pydantic no worker | e2e (400 sem detalhe de tabela ou índice); pgTAP `010_cnpj_uuid` | testado |
| V5 Saída | Sem `dangerouslySetInnerHTML`, CSP estrita no Caddy | Semgrep `vv-front-sinks-perigosos`; `infra/caddy/testar-cabecalhos.sh` (job `caddy`) | CSP e cabeçalhos implementados no `infra/caddy/Caddyfile` e testados com o Caddy real no CI; **deploy pendente** (VPS) |
| V6 Criptografia | Envelope com chave-mestra (ADR-017) para segredo TOTP; disco e repositório de backup cifrados | pgTAP `050_mfa` (segredo não legível por `vv_api`); `infra/backup/testar-restauracao.sh` (cifra provada) | testado; PIX, CPF e credenciais de portal chegam na Fase 02+ |
| V7 Logs | JSON sem PII; auditoria imutável | pgTAP `030_audit_log` (UPDATE e DELETE falham); testes do formatter no worker | testado |
| V8 Dados | URL assinada de 60 s, mínimo enviado à IA | Fase 03 e Fase 05 | planejado |
| V10 Código malicioso | Semgrep, Gitleaks, `npm audit`, `pip-audit` no CI | CI verde | testado |
| V12 Arquivos | Quarentena + ClamAV + tipo real + tamanho + SHA-256 | Teste com arquivo EICAR | planejado (Fase 03) |
| V13 API | Worker sem endpoint público de negócio; toda rota não pública exige sessão | e2e `rotas.e2e-spec.ts` (401 sem sessão em toda rota) | testado |
| V14 Configuração | Ambientes separados, segredos fora do repo, faixa de ambiente | Gitleaks + Semgrep `vv-credencial-no-app` + revisão de `.env.example` | testado (homologação e produção: Fase 00 pendente) |
