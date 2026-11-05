-- Fase 05 · cruzamento de documentos que vencem antes da abertura (RF-05.15). O worker lê só o necessário:
-- descrição, validade e situação dos documentos da empresa (nunca a chave do arquivo, hash ou nome original).

-- migrate:up
grant select (id, empresa_id, descricao, sem_vencimento, em_atualizacao, deleted_at) on priv.documentos to vv_worker;
grant select (documento_id, empresa_id, versao, validade, status_arquivo) on priv.documento_versoes to vv_worker;

-- migrate:down
revoke select (id, empresa_id, descricao, sem_vencimento, em_atualizacao, deleted_at) on priv.documentos from vv_worker;
revoke select (documento_id, empresa_id, versao, validade, status_arquivo) on priv.documento_versoes from vv_worker;
