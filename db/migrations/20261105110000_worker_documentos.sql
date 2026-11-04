-- Fase 03 · O worker precisa LER a chave da versão em quarentena para verificá-la (a liberação em si só
-- acontece por priv.registrar_verificacao). Só as colunas necessárias, só leitura.

-- migrate:up
grant select (id, arquivo_chave, status_arquivo) on priv.documento_versoes to vv_worker;

-- migrate:down
revoke select (id, arquivo_chave, status_arquivo) on priv.documento_versoes from vv_worker;
