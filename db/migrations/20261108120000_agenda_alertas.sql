-- Fase 05 · Alertas da agenda (D-5, D-3, D-1, no dia, escalonamento) e e-mail do alerta. Um alerta por evento, marco e
-- usuário (idempotente): o worker roda a cada hora e nunca repete. A tabela só o worker lê e grava (sem grant à API).

-- migrate:up
create table priv.agenda_alertas (
  id          uuid primary key default core.uuid_v7(),
  empresa_id  uuid not null references core.empresas (id) on delete cascade,
  evento_id   uuid not null,
  usuario_id  uuid not null references core.usuarios (id),
  marco       text not null check (marco in ('D-5', 'D-3', 'D-1', 'D0', 'escalonado', 'perdido')),
  enviado_em  timestamptz not null default now(),
  foreign key (evento_id, empresa_id) references priv.agenda_eventos (id, empresa_id) on delete cascade,
  unique (evento_id, marco, usuario_id)
);
create index agenda_alertas_empresa_idx on priv.agenda_alertas (empresa_id);
alter table priv.agenda_alertas enable row level security;
grant select, insert on priv.agenda_alertas to vv_worker;
-- vv_worker precisa ler papéis e permissões para saber quem recebe cada alerta.
grant select on core.vinculos, core.permissoes, core.usuarios to vv_worker;
grant update (status) on priv.agenda_eventos to vv_worker;

create or replace function ops.enfileirar_pesquisa(p_tipo text, p_empresa uuid, p_payload jsonb, p_chave text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_tipo not in ('coletar_fonte', 'detalhar_edital', 'baixar_arquivo_edital', 'verificar_arquivo_edital',
                    'extrair_texto', 'indexar_trechos', 'avaliar_relevancia', 'importar_edital',
                    'apurar_cobertura', 'email_operacional', 'calcular_prazos', 'email_agenda') then
    raise exception 'tipo de job não permitido ao worker' using errcode = 'insufficient_privilege';
  end if;
  perform ops.enfileirar(p_tipo, p_empresa, p_payload, p_chave);
end;
$$;

-- migrate:down
drop table priv.agenda_alertas;
