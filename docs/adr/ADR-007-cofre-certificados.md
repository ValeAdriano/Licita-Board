# ADR-007 · Certificados A1 e senhas de portal

- **Status:** Proposto — **decisão pendente do Adriano**
- **Data:** 2026-11-01
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.4 (Dados sensíveis), 4.3 (credenciais autorizadas no cofre)

## Contexto

O Prompt exige certificados digitais A1 e senhas de portais em **cofre separado**, nunca em log, nunca visíveis após o cadastro, com cada uso auditado. O Vault do Supabase fica no mesmo banco dos dados. Hoje o sistema **nunca protocola nem acessa portal com login**: captura é por API pública (PNCP) e renovação de certidões no MVP é pendência manual.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **Adiar: não armazenar A1 nem senha de portal até existir integração que use** | Zero superfície de ataque; nada a proteger | Cadastro de credencial fica indisponível | US$ 0 |
| B. Cofre separado agora (Infisical ou Doppler) | Atende o Prompt à risca | Infra e custo sem uso real | US$ 0–20 |
| C. Supabase Vault | Simples | Não é "cofre separado"; mesmo raio de explosão do banco | US$ 0 |

## Decisão (recomendada)

**A.** O sistema não cadastra certificado A1 nem senha de portal até a primeira integração que precise (Fase 13). A tela correspondente, se aparecer antes, fica como EM DESENVOLVIMENTO. Quando necessário, nova ADR escolhe entre Infisical/Doppler/KMS com acesso só pelo worker e auditoria de cada uso.

Vault do Supabase continua sendo usado para PIX, dados bancários, CPF de representantes e chaves de IA (BYOK), que não são credenciais de portal.

## Consequências

- **Desvio do Prompt Mestre:** nenhum enquanto o dado não é armazenado.
- **Gatilho para reavaliar:** primeira integração autenticada com portal ou emissor de certidão.
