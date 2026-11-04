-- Fase 02 · PR 6 · Catálogo universal: unidades (com conversão exata), categorias, atributos tipados e
-- modelos técnicos compartilháveis (spec fase-02 §3.3; RF-02.7, RF-02.8, RF-02.10, RF-02.13; Prompt 2.3/2.4).
--
-- * Tudo em pub: dado público compartilhado, SEM dado comercial. Leitura para qualquer usuário
--   autenticado; escrita só de SUPERADMIN (policy com core.is_superadmin(), decisão da spec, pergunta 1).
-- * Atributo novo = linha nova (sem migration). O tipo (número, texto, lista, booleano) decide qual valor
--   pode ser preenchido; número com grandeza exige unidade da mesma grandeza; lista só aceita opção
--   cadastrada. A validação é uma função (pub.validar_valor_atributo) que o catálogo e os produtos
--   (PR 7) usam juntos.
-- * Conversão de unidade em numeric (nunca float): valor_base = valor * fator + deslocamento.
-- * Seed: unidades comuns e atributos de veículos (RF-02.13), computadores e hospitalares (exemplos do Prompt).
--   CV é o cavalo-vapor métrico (735,49875 W). ⚠️ conferir fatores com a engenharia antes de uso real.

-- migrate:up
create table pub.unidades (
  id               uuid primary key default core.uuid_v7(),
  simbolo          text not null unique check (char_length(simbolo) between 1 and 12),
  nome             text not null,
  grandeza         text not null check (grandeza ~ '^[a-z_]{3,30}$'),
  fator_para_base  numeric(30, 12) not null check (fator_para_base > 0),
  deslocamento     numeric(30, 12) not null default 0,
  base             boolean not null default false,
  created_at       timestamptz not null default now()
);
create unique index unidades_base_uk on pub.unidades (grandeza) where base;

create table pub.categorias (
  id         uuid primary key default core.uuid_v7(),
  slug       text not null unique check (slug ~ '^[a-z0-9_]{2,60}$'),
  nome       text not null check (char_length(nome) between 2 and 120),
  pai_id     uuid references pub.categorias (id),
  ordem      int not null default 0,
  created_at timestamptz not null default now()
);
create index categorias_pai_idx on pub.categorias (pai_id);

create table pub.atributos_def (
  id                uuid primary key default core.uuid_v7(),
  categoria_id      uuid not null references pub.categorias (id),
  slug              text not null check (slug ~ '^[a-z0-9_]{2,60}$'),
  nome              text not null check (char_length(nome) between 2 and 120),
  tipo              text not null check (tipo in ('numero', 'texto', 'lista', 'booleano')),
  grandeza          text,
  unidade_padrao_id uuid references pub.unidades (id),
  opcoes            jsonb,
  obrigatorio       boolean not null default false,
  ordem             int not null default 0,
  created_at        timestamptz not null default now(),
  unique (categoria_id, slug),
  check ((tipo = 'lista') = (opcoes is not null and jsonb_typeof(opcoes) = 'array' and jsonb_array_length(opcoes) > 0)),
  check (tipo = 'numero' or (grandeza is null and unidade_padrao_id is null))
);

create table pub.modelos (
  id              uuid primary key default core.uuid_v7(),
  categoria_id    uuid not null references pub.categorias (id),
  fabricante      text not null check (char_length(fabricante) between 1 and 120),
  marca           text check (char_length(marca) <= 120),
  modelo          text not null check (char_length(modelo) between 1 and 120),
  versao          text check (char_length(versao) <= 120),
  ano_modelo      int check (ano_modelo between 1900 and 2100),
  descontinuado_em date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index modelos_uk on pub.modelos (lower(fabricante), lower(modelo), coalesce(lower(versao), ''), coalesce(ano_modelo, 0));
create index modelos_categoria_idx on pub.modelos (categoria_id);

-- Valida um valor contra a definição do atributo (usada também por priv.produto_atributos).
create function pub.validar_valor_atributo(
  p_atributo uuid, p_numero numeric, p_texto text, p_booleano boolean, p_unidade uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  a record;
  v_grandeza text;
  v_preenchidos int := (p_numero is not null)::int + (p_texto is not null)::int + (p_booleano is not null)::int;
begin
  select tipo, grandeza, opcoes into a from pub.atributos_def where id = p_atributo;
  if not found then
    raise exception 'atributo inexistente' using errcode = 'foreign_key_violation';
  end if;
  if v_preenchidos <> 1 then
    raise exception 'preencha exatamente um valor' using errcode = 'check_violation';
  end if;
  if a.tipo = 'numero' and p_numero is null then raise exception 'atributo numérico pede valor_numero' using errcode = 'check_violation'; end if;
  if a.tipo = 'texto' and p_texto is null then raise exception 'atributo de texto pede valor_texto' using errcode = 'check_violation'; end if;
  if a.tipo = 'booleano' and p_booleano is null then raise exception 'atributo sim/não pede valor_booleano' using errcode = 'check_violation'; end if;
  if a.tipo = 'lista' then
    if p_texto is null or not (a.opcoes ? p_texto) then
      raise exception 'valor fora das opções da lista' using errcode = 'check_violation';
    end if;
  end if;
  if a.tipo = 'numero' and a.grandeza is not null then
    select grandeza into v_grandeza from pub.unidades where id = p_unidade;
    if v_grandeza is distinct from a.grandeza then
      raise exception 'unidade de outra grandeza (esperada: %)', a.grandeza using errcode = 'check_violation';
    end if;
  elsif p_unidade is not null then
    raise exception 'este atributo não usa unidade' using errcode = 'check_violation';
  end if;
end;
$$;

create table pub.modelo_atributos (
  modelo_id       uuid not null references pub.modelos (id) on delete cascade,
  atributo_id     uuid not null references pub.atributos_def (id),
  valor_numero    numeric(30, 12),
  valor_texto     text check (char_length(valor_texto) <= 500),
  valor_booleano  boolean,
  unidade_id      uuid references pub.unidades (id),
  primary key (modelo_id, atributo_id)
);
create function pub.modelo_atributos_validar() returns trigger language plpgsql set search_path = '' as $$
begin
  perform pub.validar_valor_atributo(new.atributo_id, new.valor_numero, new.valor_texto, new.valor_booleano, new.unidade_id);
  return new;
end;
$$;
create trigger modelo_atributos_validar before insert or update on pub.modelo_atributos
  for each row execute function pub.modelo_atributos_validar();

-- Conversão exata entre unidades da mesma grandeza.
create function pub.converter(p_valor numeric, p_de text, p_para text)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  de pub.unidades;
  para pub.unidades;
begin
  select * into de from pub.unidades where simbolo = p_de;
  select * into para from pub.unidades where simbolo = p_para;
  if de.id is null or para.id is null then
    raise exception 'unidade inexistente' using errcode = 'no_data_found';
  end if;
  if de.grandeza <> para.grandeza then
    raise exception 'unidades de grandezas diferentes (% e %)', de.grandeza, para.grandeza using errcode = 'invalid_parameter_value';
  end if;
  return (p_valor * de.fator_para_base + de.deslocamento - para.deslocamento) / para.fator_para_base;
end;
$$;

alter table pub.unidades enable row level security;
alter table pub.categorias enable row level security;
alter table pub.atributos_def enable row level security;
alter table pub.modelos enable row level security;
alter table pub.modelo_atributos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['unidades', 'categorias', 'atributos_def', 'modelos', 'modelo_atributos'] loop
    execute format('create policy %I on pub.%I for select to vv_api using ((select core.usuario_atual()) is not null)', t || '_select', t);
    execute format('create policy %I on pub.%I for insert to vv_api with check ((select core.is_superadmin()))', t || '_insert', t);
    execute format('create policy %I on pub.%I for update to vv_api using ((select core.is_superadmin())) with check ((select core.is_superadmin()))', t || '_update', t);
    execute format('create policy %I on pub.%I for delete to vv_api using ((select core.is_superadmin()))', t || '_delete', t);
    execute format('grant select, delete on pub.%I to vv_api', t);
  end loop;
end $$;
grant insert (simbolo, nome, grandeza, fator_para_base, deslocamento, base), update (nome, fator_para_base, deslocamento) on pub.unidades to vv_api;
grant insert (slug, nome, pai_id, ordem), update (nome, ordem) on pub.categorias to vv_api;
grant insert (categoria_id, slug, nome, tipo, grandeza, unidade_padrao_id, opcoes, obrigatorio, ordem),
      update (nome, grandeza, unidade_padrao_id, opcoes, obrigatorio, ordem) on pub.atributos_def to vv_api;
grant insert (categoria_id, fabricante, marca, modelo, versao, ano_modelo), update (marca, descontinuado_em) on pub.modelos to vv_api;
grant insert (modelo_id, atributo_id, valor_numero, valor_texto, valor_booleano, unidade_id),
      update (valor_numero, valor_texto, valor_booleano, unidade_id) on pub.modelo_atributos to vv_api;
grant execute on function pub.converter(numeric, text, text), pub.validar_valor_atributo(uuid, numeric, text, boolean, uuid) to vv_api;

create trigger modelos_updated_at before update on pub.modelos for each row execute function core.set_updated_at();
create trigger unidades_audit after insert or update or delete on pub.unidades for each row execute function audit.registrar('-');
create trigger categorias_audit after insert or update or delete on pub.categorias for each row execute function audit.registrar('-');
create trigger atributos_def_audit after insert or update or delete on pub.atributos_def for each row execute function audit.registrar('-');
create trigger modelos_audit after insert or update or delete on pub.modelos for each row execute function audit.registrar('-');
alter table pub.unidades enable always trigger unidades_audit;
alter table pub.categorias enable always trigger categorias_audit;
alter table pub.atributos_def enable always trigger atributos_def_audit;
alter table pub.modelos enable always trigger modelos_audit;

-- Seed: unidades (fator para a unidade base da grandeza).
insert into pub.unidades (simbolo, nome, grandeza, fator_para_base, base) values
  ('W', 'watt', 'potencia', 1, true), ('kW', 'quilowatt', 'potencia', 1000, false),
  ('cv', 'cavalo-vapor (métrico)', 'potencia', 735.49875, false), ('hp', 'horsepower', 'potencia', 745.699871582, false),
  ('N·m', 'newton-metro', 'torque', 1, true), ('kgf·m', 'quilograma-força metro', 'torque', 9.80665, false),
  ('kg', 'quilograma', 'massa', 1, true), ('g', 'grama', 'massa', 0.001, false), ('t', 'tonelada', 'massa', 1000, false),
  ('m', 'metro', 'comprimento', 1, true), ('mm', 'milímetro', 'comprimento', 0.001, false),
  ('cm', 'centímetro', 'comprimento', 0.01, false), ('km', 'quilômetro', 'comprimento', 1000, false), ('pol', 'polegada', 'comprimento', 0.0254, false),
  ('B', 'byte', 'dados', 1, true), ('KB', 'quilobyte', 'dados', 1000, false), ('MB', 'megabyte', 'dados', 1000000, false),
  ('GB', 'gigabyte', 'dados', 1000000000, false), ('TB', 'terabyte', 'dados', 1000000000000, false),
  ('KiB', 'kibibyte', 'dados', 1024, false), ('MiB', 'mebibyte', 'dados', 1048576, false),
  ('GiB', 'gibibyte', 'dados', 1073741824, false), ('TiB', 'tebibyte', 'dados', 1099511627776, false),
  ('L', 'litro', 'volume', 1, true), ('mL', 'mililitro', 'volume', 0.001, false), ('m³', 'metro cúbico', 'volume', 1000, false),
  ('s', 'segundo', 'tempo', 1, true), ('min', 'minuto', 'tempo', 60, false), ('h', 'hora', 'tempo', 3600, false),
  ('V', 'volt', 'tensao', 1, true),
  ('meses', 'meses', 'prazo', 1, true), ('anos', 'anos', 'prazo', 12, false), ('dias', 'dias', 'prazo_dias', 1, true),
  ('un', 'unidade', 'contagem', 1, true);

insert into pub.categorias (slug, nome, pai_id, ordem) values
  ('veiculos', 'Veículos', null, 10), ('computadores', 'Computadores e informática', null, 20),
  ('hospitalares', 'Equipamentos hospitalares', null, 30);
insert into pub.categorias (slug, nome, pai_id, ordem)
select s.slug, s.nome, c.id, s.ordem from pub.categorias c,
  (values ('veiculos_passeio', 'Passeio', 1), ('veiculos_utilitarios', 'Utilitários e pick-ups', 2),
          ('veiculos_caminhoes', 'Caminhões', 3), ('veiculos_onibus', 'Ônibus e vans', 4)) s(slug, nome, ordem)
 where c.slug = 'veiculos';

-- Atributos de veículos (RF-02.13); computadores e hospitalares, exemplos do Prompt 2.3.
insert into pub.atributos_def (categoria_id, slug, nome, tipo, grandeza, unidade_padrao_id, opcoes, ordem)
select c.id, a.slug, a.nome, a.tipo, a.grandeza, (select id from pub.unidades where simbolo = a.un), a.opcoes::jsonb, a.ordem
  from pub.categorias c join (values
    ('veiculos', 'motorizacao', 'Motorização', 'texto', null, null, null, 10),
    ('veiculos', 'potencia', 'Potência', 'numero', 'potencia', 'cv', null, 20),
    ('veiculos', 'torque', 'Torque', 'numero', 'torque', 'N·m', null, 30),
    ('veiculos', 'combustivel', 'Combustível', 'lista', null, null, '["gasolina","etanol","flex","diesel","eletrico","hibrido","gnv"]', 40),
    ('veiculos', 'tracao', 'Tração', 'lista', null, null, '["4x2","4x4","6x2","6x4","dianteira","traseira","integral"]', 50),
    ('veiculos', 'cambio', 'Câmbio', 'lista', null, null, '["manual","automatico","automatizado","cvt"]', 60),
    ('veiculos', 'comprimento', 'Comprimento', 'numero', 'comprimento', 'mm', null, 70),
    ('veiculos', 'largura', 'Largura', 'numero', 'comprimento', 'mm', null, 80),
    ('veiculos', 'altura', 'Altura', 'numero', 'comprimento', 'mm', null, 90),
    ('veiculos', 'entre_eixos', 'Distância entre eixos', 'numero', 'comprimento', 'mm', null, 100),
    ('veiculos', 'capacidade_carga', 'Capacidade de carga', 'numero', 'massa', 'kg', null, 110),
    ('veiculos', 'capacidade_passageiros', 'Capacidade de passageiros', 'numero', 'contagem', 'un', null, 120),
    ('veiculos', 'equipamentos', 'Equipamentos', 'texto', null, null, null, 130),
    ('veiculos', 'garantia', 'Garantia', 'numero', 'prazo', 'meses', null, 140),
    ('veiculos', 'homologacao', 'Homologação', 'texto', null, null, null, 150),
    ('computadores', 'processador', 'Processador', 'texto', null, null, null, 10),
    ('computadores', 'memoria', 'Memória', 'numero', 'dados', 'GB', null, 20),
    ('computadores', 'armazenamento', 'Armazenamento', 'numero', 'dados', 'GB', null, 30),
    ('computadores', 'tela', 'Tela', 'numero', 'comprimento', 'pol', null, 40),
    ('computadores', 'conectividade', 'Conectividade', 'texto', null, null, null, 50),
    ('computadores', 'sistema_operacional', 'Sistema operacional', 'texto', null, null, null, 60),
    ('computadores', 'garantia', 'Garantia', 'numero', 'prazo', 'meses', null, 70),
    ('hospitalares', 'capacidade', 'Capacidade', 'numero', 'volume', 'L', null, 10),
    ('hospitalares', 'registro_anvisa', 'Registro ANVISA', 'texto', null, null, null, 20),
    ('hospitalares', 'certificacoes', 'Certificações', 'texto', null, null, null, 30),
    ('hospitalares', 'garantia', 'Garantia', 'numero', 'prazo', 'meses', null, 40)
  ) a(cat, slug, nome, tipo, grandeza, un, opcoes, ordem) on a.cat = c.slug;

-- migrate:down
drop function pub.converter(numeric, text, text);
drop table pub.modelo_atributos, pub.modelos, pub.atributos_def, pub.categorias, pub.unidades;
drop function pub.modelo_atributos_validar();
drop function pub.validar_valor_atributo(uuid, numeric, text, boolean, uuid);
