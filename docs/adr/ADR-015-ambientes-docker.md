# ADR-015 · Ambientes: Docker Compose em desenvolvimento, homologação e produção

- **Status:** Proposto
- **Data:** 2026-11-02
- **Decisor:** Adriano Vale
- **Requisito relacionado:** Prompt Mestre 0.2, 0.5 (backup e restauração)
- **Substitui:** ADR-009

## Contexto

O Prompt exige DESENVOLVIMENTO, HOMOLOGAÇÃO e PRODUÇÃO separados, com bancos, buckets e chaves distintos, e proíbe dado real fora de produção. A decisão de 2026-11-02 é usar Docker em todos os ambientes.

## Alternativas

| Alternativa | Prós | Contras | Custo |
| --- | --- | --- | --- |
| A. **Compose local (dev) + VPS com Compose (prod); homologação em segunda VPS antes do 1º cliente real** | Mesmas imagens em tudo; custo baixo no início | Sem homologação permanente no começo | US$ 20–40 |
| B. Três ambientes desde o início | Atende à risca | Paga homologação sem uso | US$ 35–60 |
| C. Kubernetes gerenciado | Escala | Complexidade desproporcional para 1 pessoa e 20 usuários | US$ 70+ |

## Decisão

**A.**

- **Dev:** `compose.yml` na raiz (`postgres`, `minio`, `mailpit`, `api`, `worker`, `clamav`), `db/seed.sql` fictício, faixa laranja "DESENVOLVIMENTO" no app. Nenhuma chave de produção na máquina de dev.
- **Produção:** `infra/compose.prod.yml` numa VPS em São Paulo, Caddy com TLS, segredos como Docker secrets (arquivos `0400` fora do repositório), imagens versionadas no GHCR. O deploy roda só pelo pipeline do `main` (pull das imagens + `dbmate up` + restart).
- **Homologação:** mesma stack numa segunda VPS (ou na mesma, com outro projeto Compose e outro banco), faixa roxa e dados anonimizados. Ligada **antes** do 1º cliente real.
- **Backup:** WAL contínuo + base semanal (wal-g ou pgBackRest) cifrados para um bucket externo de outro provedor (PITR, RPO de minutos). Restauração testada e documentada a cada trimestre.
- **Hardening da VPS:** SSH só por chave, firewall liberando apenas 80/443/SSH, atualizações automáticas de segurança, Postgres e MinIO sem porta pública.

## Consequências

- **Positivas:** o que roda no notebook é o que roda em produção; PITR barato.
- **Negativas / risco residual:** servidor único = ponto único de falha (mitigado por backup fora do servidor e restauração testada; aceitável para o volume do ano 1).
- **Desvio do Prompt Mestre:** homologação adiada até o 1º cliente real. Até lá, só a equipe VV usa produção, sem dados de clientes externos.
- **Gatilho para reavaliar:** contrato do 1º cliente real (bloqueante para homologação) ou SLA de disponibilidade.
