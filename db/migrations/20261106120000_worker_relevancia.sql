-- Fase 04 · O worker avalia a relevância dos editais para cada empresa: precisa LER as palavras-chave e os
-- filtros (cadastrados na Fase 02) e nada mais de priv. A nota é gravada em priv.oportunidades (já com grant).

-- migrate:up
grant select on priv.palavras_chave, priv.palavras_chave_filtros to vv_worker;

-- migrate:down
revoke select on priv.palavras_chave, priv.palavras_chave_filtros from vv_worker;
