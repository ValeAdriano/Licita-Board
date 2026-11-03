# ADR-017 · Arquivos em S3 compatível e criptografia de campo em envelope

- **Status:** Aceito (2026-11-02)
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 1.4 (Dados sensíveis, Arquivos), "Padrão técnico" (S3 criptografado, KMS)
- **Substitui:** os trechos de Supabase Storage e Supabase Vault das ADR-001, ADR-005 e ADR-007

## Contexto

Sem o Supabase, precisamos de (1) armazenamento privado de arquivos com URL assinada curta e quarentena antivírus e (2) criptografia em nível de campo para PIX, dados bancários, CPF de representantes, segredos TOTP e chaves de IA (BYOK), com a chave fora do banco.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **MinIO no dev; S3 compatível privado em prod; AES-256-GCM em envelope na aplicação com chave-mestra em segredo do servidor** | API S3 igual em todos os ambientes; chave nunca toca o banco | Gerência da chave-mestra é nossa até adotar KMS | US$ 1–5 |
| B. MinIO também em prod, no mesmo servidor | Sem provedor externo | Arquivos e banco no mesmo disco; backup mais pesado | US$ 0 |
| C. `pgcrypto` no banco | Simples | Chave passa pelo SQL (logs, `pg_stat_statements`) | US$ 0 |

## Decisão

**A.**

- **Arquivos:** um bucket privado por ambiente, com prefixos `quarentena/` e `documentos/{empresa_id}/...`. Só a API e o worker têm credencial (usuários diferentes, com políticas mínimas). Upload por presigned PUT para `quarentena/`; o worker roda ClamAV + tipo real + tamanho + SHA-256 e move. Download por presigned GET de 60 s, emitido pela API depois da permissão e registrado em `audit`. Criptografia em repouso do provedor ligada.
- **Campo:** cada valor sensível é cifrado com uma DEK aleatória (AES-256-GCM); a DEK é cifrada pela chave-mestra (KEK). O banco guarda `{versao_chave, dek_cifrada, iv, dado_cifrado}` em `bytea`/`jsonb`. A KEK vem de Docker secret (prod) ou `.env` local fictício (dev) e é trocável por KMS sem mudar o formato. Implementação idêntica em TS (API) e Python (worker), com vetores de teste compartilhados.
- **Exibição:** dados sensíveis voltam mascarados por padrão; ver o valor completo exige permissão e fica auditado.
- **ADR-007** continua: nada de certificado A1 ou senha de portal até existir integração que use.

## Consequências

- **Positivas:** banco vazado sem a KEK não expõe os campos; troca de provedor S3 sem mudar código.
- **Negativas / risco residual:** KEK em arquivo no servidor (médio) até adotar KMS/gerenciador de segredos; rotação da KEK exige job de recifragem das DEKs.
- **Desvio do Prompt Mestre:** "KMS" atendido por chave-mestra em segredo do servidor até o 1º cliente real.
- **Gatilho para reavaliar:** 1º cliente real (avaliar KMS gerenciado) ou cadastro de credencial de portal (ADR-007).
