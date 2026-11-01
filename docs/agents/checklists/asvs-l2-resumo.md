# OWASP ASVS nível 2 · resumo aplicado ao VV Licitações

Checklist usado antes de cada liberação (Prompt Mestre 1.4). Não substitui o ASVS completo nem o pentest externo antes do 1º cliente real.

| Área ASVS | Controle no projeto | Como verificar |
| --- | --- | --- |
| V2 Autenticação | Senha ≥ 12, leaked password protection, MFA TOTP obrigatório por perfil, rate limit do Auth | `supabase/config.toml` + config do projeto Pro + teste e2e de login sem MFA bloqueado |
| V2 Recuperação | Token de uso único, 30 min, mensagem neutra | Teste e2e com e-mail inexistente → mesma mensagem |
| V3 Sessão | JWT 15 min, refresh rotativo, time-box 12 h, inatividade 30 min, "sair de todos" | Config Auth + teste de logout global |
| V4 Controle de acesso | RLS + `has_permission`, negar por padrão, worker valida `empresa_id` | pgTAP A x B + `001_rls_ligado` + testes do worker |
| V4 Operação crítica | Step-up MFA (token 5 min) | Teste: operação sem token recente falha |
| V5 Validação | Zod no front, constraints no banco, Pydantic no worker | Testes de constraint |
| V5 Saída | Sem `dangerouslySetInnerHTML`, CSP estrita | Semgrep + headers da Vercel |
| V6 Criptografia | Vault para PIX, banco, CPF, chaves de IA | Teste: coluna sensível não legível em claro por `authenticated` |
| V7 Logs | JSON sem PII; auditoria imutável | Teste do formatter + teste de UPDATE em `audit` falhando |
| V8 Dados | Signed URL 60 s, mínimo enviado à IA | Revisão + teste da Edge Function |
| V10 Código malicioso | Semgrep, Gitleaks, audit de dependências no CI | CI verde |
| V12 Arquivos | Quarentena + ClamAV + tipo real + tamanho + SHA-256 | Teste com arquivo EICAR |
| V13 API | Worker sem endpoint público de negócio; Edge Functions checam JWT | Revisão + teste 401 sem JWT |
| V14 Configuração | Ambientes separados, segredos fora do repo, faixa de ambiente | Gitleaks + revisão de `.env.example` |
