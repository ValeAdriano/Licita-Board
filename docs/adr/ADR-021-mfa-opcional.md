# ADR-021 · 2FA opcional por chave do banco (padrão continua obrigatório)

- **Status:** Aceito (2026-11-05)
- **Data:** 2026-11-05
- **Decisor:** Adriano Vale ("faça com que o 2fa não seja obrigatório")
- **Requisito relacionado:** T5.8 do `docs/threat-model.md` (perfil interno e SUPERADMIN exigem MFA), ADR-012/013

## Decisão

- O **padrão não muda**: perfil interno (qualquer vínculo ativo não CLIENTE) e SUPERADMIN precisam de MFA, e o banco só libera dado privado em sessão `aal2` (`core.mfa_ok()`).
- Existe uma chave explícita no banco, `vv.mfa = 'opcional'` (`alter database vv set vv.mfa = 'opcional'`, ligada por `scripts/dev-up.sh`). Com ela, `core.mfa_obrigatorio()` devolve falso e `core.mfa_ok()` aceita `aal1` **de quem não cadastrou TOTP**. A API e o front já tratam `mfa: nao_requerido`.
- Quem **cadastrou** TOTP continua precisando do código (a segurança de quem escolheu usar não cai). O autenticador segue disponível em Conta para quem quiser.
- A chave é do banco, não da API: uma variável de ambiente esquecida na API não poderia afrouxar a segurança que o banco aplica (RLS é a segunda camada, ADR-013).

## Consequências

- **Produção NÃO deve ter a chave.** Ligar `vv.mfa` em produção é decisão do Adriano e exige registrar o risco aceito em T5.8.
- Migration `20261108130000_mfa_opcional_dev.sql`; pgTAP `db/tests/240_mfa_opcional.test.sql` cobre os quatro casos (sem chave, com chave sem TOTP, com chave e com TOTP, chave vazia).
