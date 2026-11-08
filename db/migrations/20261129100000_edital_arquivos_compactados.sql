-- Fase 04 · decisão 6 (Q-13a): anexo de edital em ZIP tem os arquivos internos extraídos com segurança pelo worker.
-- Cada arquivo extraído vira uma linha comum de pub.edital_arquivos ligada ao ZIP de origem (arquivo_pai_id, mesmo
-- edital), para auditoria e para a tela mostrar "dentro de X.zip". O compactado em si registra o resultado:
-- extraido, pendente (RAR, 7z, ZIP dentro de ZIP, protegido por senha) ou recusado (limite estourado, nome inseguro).
-- Tabela pública: as policies e os grants existentes (leitura vv_api, escrita só vv_worker) valem para as colunas novas.

-- migrate:up
alter table pub.edital_arquivos
  add column arquivo_pai_id    uuid,
  add column status_compactado text check (status_compactado in ('extraido', 'pendente', 'recusado')),
  add column motivo_compactado text check (char_length(motivo_compactado) <= 300),
  add constraint edital_arquivos_pai_fk foreign key (arquivo_pai_id, edital_id) references pub.edital_arquivos (id, edital_id),
  add constraint edital_arquivos_pai_nao_proprio check (arquivo_pai_id is distinct from id),
  add constraint edital_arquivos_motivo_compactado check (motivo_compactado is null or status_compactado is not null);
create index edital_arquivos_pai_idx on pub.edital_arquivos (arquivo_pai_id) where arquivo_pai_id is not null;

-- migrate:down
drop index pub.edital_arquivos_pai_idx;
alter table pub.edital_arquivos
  drop constraint edital_arquivos_motivo_compactado,
  drop constraint edital_arquivos_pai_nao_proprio,
  drop constraint edital_arquivos_pai_fk,
  drop column motivo_compactado,
  drop column status_compactado,
  drop column arquivo_pai_id;
