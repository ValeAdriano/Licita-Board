import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { type Transaction, sql } from 'kysely';
import { z } from 'zod';
import { type RequisicaoVV, dadosDe, sessaoDe, validar } from '../auth/requisicao.js';
import { Permissao } from '../auth/sessao.guard.js';
import { ContextoService } from '../db/contexto.service.js';
import type { Database } from '../db/db.module.js';

const TIPOS = ['edital', 'documento', 'produto', 'peca', 'resultado', 'contrato'] as const;
type Tipo = (typeof TIPOS)[number];
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filtroSchema = z.object({
  q: z.string().trim().min(2).max(100), tipos: z.string().max(100).optional(), de: data.optional(), ate: data.optional(), uf: z.string().regex(/^[A-Za-z]{2}$/).optional(),
}).strict();
export interface Achado { tipo: Tipo; id: string; titulo: string; subtitulo: string | null; data: string | null; situacao: string | null; link: string }

// Pesquisa histórica avançada (spec fase-12, 12.4): texto + filtros combinados em editais, documentos, produtos, peças jurídicas, resultados e contratos.
// Cada tipo só é consultado se a pessoa tem a permissão de visualizar o módulo de origem (e a RLS confere de novo): nunca revela o que ela não pode ver.
// Devolve só título, resumo curto, data, situação e link; o conteúdo (minuta, valores) fica no módulo de origem.
@Controller()
export class BuscaController {
  constructor(private readonly contexto: ContextoService) {}

  private q<T>(req: RequisicaoVV, fn: (tx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.contexto.comContexto(dadosDe(req, sessaoDe(req).token), fn);
  }

  @Permissao('relatorios', 'visualizar')
  @Get('empresas/:empresa/busca')
  async buscar(@Req() req: RequisicaoVV, @Param('empresa') empresa: string, @Query() consulta: unknown) {
    const f = validar(filtroSchema, consulta);
    const pedidos = f.tipos ? (f.tipos.split(',').filter((t): t is Tipo => (TIPOS as readonly string[]).includes(t))) : [...TIPOS];
    const e = empresa;
    const termo = f.q;
    const like = `%${termo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const de = f.de ?? null;
    const ate = f.ate ?? null;
    const uf = f.uf?.toUpperCase() ?? null;
    return this.q(req, async (tx): Promise<Record<string, Achado[] | null>> => {
      const pode = async (modulo: string): Promise<boolean> => (await sql<{ ok: boolean }>`select core.has_permission(${e}::uuid, ${modulo}, 'visualizar') as ok`.execute(tx)).rows[0]?.ok === true;
      const saida: Record<string, Achado[] | null> = {};
      const busca = async (tipo: Tipo, modulo: string, consultar: () => Promise<Achado[]>): Promise<void> => {
        if (!pedidos.includes(tipo)) return;
        saida[tipo] = (await pode(modulo)) ? await consultar() : null; // null = sem permissão (a tela esconde o grupo)
      };
      await busca('edital', 'editais', async () => (await sql<Achado>`
        select 'edital'::text as tipo, e.id::text, g.razao_social || coalesce(' · edital nº ' || e.numero_edital, '') as titulo, left(e.objeto, 220) as subtitulo,
               e.data_publicacao::date::text as data, e.situacao as situacao, '/editais/' || e.id as link
          from pub.editais e join pub.orgaos g on g.id = e.orgao_id
         where (e.objeto_tsv @@ websearch_to_tsquery('pub.pt_unaccent', ${termo}) or extensions.unaccent(e.objeto) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(e.numero_edital) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(g.razao_social) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(e.processo) ilike extensions.unaccent(${like}) escape '\\')
           and (${uf}::text is null or g.uf = ${uf}::text) and (${de}::date is null or e.data_publicacao::date >= ${de}::date) and (${ate}::date is null or e.data_publicacao::date <= ${ate}::date)
         order by e.data_publicacao desc nulls last limit 20`.execute(tx)).rows);
      await busca('documento', 'documentos', async () => (await sql<Achado>`
        select 'documento'::text as tipo, d.id::text, d.descricao as titulo, concat_ws(' · ', d.numero, d.emissor) as subtitulo, s.validade::text as data, s.status as situacao, '/cadastros' as link
          from priv.documentos d join priv.documentos_status s on s.documento_id = d.id
         where d.empresa_id = ${e}::uuid and d.deleted_at is null and (extensions.unaccent(d.descricao) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(d.numero) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(d.emissor) ilike extensions.unaccent(${like}) escape '\\')
           and (${de}::date is null or s.validade >= ${de}::date) and (${ate}::date is null or s.validade <= ${ate}::date)
         order by d.descricao limit 20`.execute(tx)).rows);
      await busca('produto', 'produtos', async () => (await sql<Achado>`
        select 'produto'::text as tipo, p.id::text, p.descricao as titulo, p.codigo_interno as subtitulo, p.created_at::date::text as data, null::text as situacao, '/cadastros' as link
          from priv.produtos p
         where p.empresa_id = ${e}::uuid and p.deleted_at is null and (extensions.unaccent(p.descricao) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(p.codigo_interno) ilike extensions.unaccent(${like}) escape '\\')
           and (${de}::date is null or p.created_at::date >= ${de}::date) and (${ate}::date is null or p.created_at::date <= ${ate}::date)
         order by p.descricao limit 20`.execute(tx)).rows);
      await busca('peca', 'juridico', async () => (await sql<Achado>`
        select 'peca'::text as tipo, p.id::text, p.titulo, p.tipo as subtitulo, p.created_at::date::text as data, p.status as situacao, '/juridico/pecas/' || p.id as link
          from priv.pecas p
         where p.empresa_id = ${e}::uuid and (extensions.unaccent(p.titulo) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(p.minuta) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(p.protocolo_numero) ilike extensions.unaccent(${like}) escape '\\')
           and (${de}::date is null or p.created_at::date >= ${de}::date) and (${ate}::date is null or p.created_at::date <= ${ate}::date)
         order by p.created_at desc limit 20`.execute(tx)).rows);
      await busca('resultado', 'agenda', async () => (await sql<Achado>`
        select 'resultado'::text as tipo, r.id::text, g.razao_social || coalesce(' · item ' || i.numero_item, '') as titulo,
               concat_ws(' · ', r.vencedora_nome, left(r.motivo_perda, 120)) as subtitulo, r.ocorrido_em::date::text as data, r.resultado_final as situacao, '/agenda/acompanhamentos/' || a.id as link
          from priv.resultados_item r join priv.participacoes pa on pa.id = r.participacao_id join priv.acompanhamentos a on a.id = pa.acompanhamento_id
          left join pub.editais e on e.id = a.edital_id left join pub.orgaos g on g.id = e.orgao_id left join pub.edital_itens i on i.id = pa.item_id
         where r.empresa_id = ${e}::uuid and (extensions.unaccent(g.razao_social) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(e.objeto) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(e.numero_edital) ilike extensions.unaccent(${like}) escape '\\'
                or extensions.unaccent(r.vencedora_nome) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(r.motivo_perda) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(r.vencedora_marca_modelo) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(pa.marca) ilike extensions.unaccent(${like}) escape '\\')
           and (${uf}::text is null or g.uf = ${uf}::text) and (${de}::date is null or r.ocorrido_em::date >= ${de}::date) and (${ate}::date is null or r.ocorrido_em::date <= ${ate}::date)
         order by r.ocorrido_em desc limit 20`.execute(tx)).rows);
      await busca('contrato', 'contratos', async () => (await sql<Achado>`
        select 'contrato'::text as tipo, c.id::text, c.orgao || ' · ' || c.tipo || ' ' || c.numero as titulo, left(c.objeto, 200) as subtitulo, c.vigencia_fim::text as data, c.status as situacao, '/contratos/' || c.id as link
          from priv.contratos c
         where c.empresa_id = ${e}::uuid and c.deleted_at is null and (extensions.unaccent(c.numero) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(c.orgao) ilike extensions.unaccent(${like}) escape '\\' or extensions.unaccent(c.objeto) ilike extensions.unaccent(${like}) escape '\\')
           and (${de}::date is null or c.vigencia_fim >= ${de}::date) and (${ate}::date is null or c.vigencia_fim <= ${ate}::date)
         order by c.vigencia_fim desc limit 20`.execute(tx)).rows);
      return saida;
    });
  }
}
