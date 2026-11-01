# Prompt · 05 Testes, isolamento e persistência

> Troque `<...>`.

Escreva/complete os testes da Fase <XX> para **"<área>"**.

## Isolamento A x B (obrigatório para toda tabela de `priv`)

Arquivo: `supabase/tests/isolamento/<schema>_<tabela>.test.sql`, a partir de `_modelo.sql.example`.

- Fixtures: duas empresas (A, B), um usuário por empresa com permissão total na própria empresa, MFA `aal2`.
- Como usuário A: SELECT de linhas de B → vazio; UPDATE e DELETE de B → 0 linhas; INSERT com `empresa_id` de B → erro `42501`.
- Mover linha de A para B via UPDATE (`set empresa_id = B`) → bloqueado pelo `with check`.
- Se houver arquivo em Storage: A não gera signed URL nem baixa objeto de B.
- Usuário com vínculo **inativo** ou `deleted_at` preenchido → não lê nada.
- Usuário sem a ação específica (ex.: tem `visualizar`, não tem `editar`) → UPDATE bloqueado.

## Permissões

Para cada ação da matriz usada na fase: um teste positivo (tem permissão → consegue) e um negativo (não tem → bloqueado).

## Persistência

Criar → sair (nova sessão) → entrar → dado continua igual. No e2e, recarregar a página.

## Regras de negócio

Casos de borda da spec. Prazos com feriado, fim de semana, virada de ano; dinheiro com centavos, milhões, arredondamento.

Rode tudo e informe o resultado real. Teste que não rodou é "implementado sem teste" no relatório.
