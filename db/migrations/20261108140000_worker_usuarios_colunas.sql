-- Corrige 20261108120000_agenda_alertas: o grant de SELECT em core.usuarios inteira devolveu ao vv_worker a leitura de
-- senha_hash (e dos outros campos sensíveis) que 20261103030000 havia fechado. O worker volta a ler só as colunas de sempre.

-- migrate:up
revoke select on core.usuarios from vv_worker;
grant select (id, email, nome, telefone, oab, superadmin, ativo, created_at, updated_at, deleted_at,
  senha_trocada_em, bloqueado_ate) on core.usuarios to vv_worker;

-- migrate:down
-- (sem rollback: reabrir a leitura de senha_hash seria uma regressão de segurança)
