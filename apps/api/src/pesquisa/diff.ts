// Comparação entre duas versões coletadas de um edital (Fase 05, RF-05.9). Código puro: só mostra FATOS (o que mudou);
// nunca conclui consequência jurídica. Dinheiro e quantidade chegam como string decimal e são comparados como string.

export type Formato = 'texto' | 'data' | 'dinheiro' | 'booleano';
export interface Mudanca { campo: string; rotulo: string; formato: Formato; antes: string | null; depois: string | null }
export interface DiffItem { numeroItem: number; descricao: string; tipo: 'adicionado' | 'removido' | 'alterado'; mudancas: Mudanca[] }
export interface DiffArquivo { titulo: string | null; tipo: string; url: string; situacao: 'novo' | 'removido' }
export interface Diff { de: number; para: number; campos: Mudanca[]; itens: DiffItem[]; arquivos: DiffArquivo[]; alteraProposta: boolean }

interface Conteudo { campos?: Record<string, unknown>; itens?: Record<string, unknown>[]; arquivos?: { url?: string; tipo?: string; titulo?: string }[] }

const CAMPOS: Record<string, [string, Formato]> = {
  objeto: ['Objeto', 'texto'], situacao: ['Situação', 'texto'], modalidade: ['Modalidade', 'texto'], modo_disputa: ['Modo de disputa', 'texto'],
  criterio_julgamento: ['Critério de julgamento', 'texto'], srp: ['Registro de preços (SRP)', 'booleano'], numero_edital: ['Número do edital', 'texto'],
  processo: ['Processo', 'texto'], valor_estimado: ['Valor estimado', 'dinheiro'], data_publicacao: ['Publicação', 'data'],
  data_abertura_propostas: ['Início das propostas', 'data'], data_encerramento_propostas: ['Fim das propostas', 'data'], data_sessao: ['Sessão', 'data'],
  link_origem: ['Link de origem', 'texto'], link_portal: ['Link do portal', 'texto'],
};
const CAMPOS_ITEM: Record<string, [string, Formato]> = {
  descricao: ['Descrição', 'texto'], quantidade: ['Quantidade', 'texto'], unidade_medida: ['Unidade', 'texto'], valor_unitario_estimado: ['Valor unitário estimado', 'dinheiro'],
  valor_total_estimado: ['Valor total estimado', 'dinheiro'], situacao: ['Situação', 'texto'], beneficio: ['Benefício', 'texto'], criterio_julgamento: ['Critério', 'texto'],
};
// Mudança nestes campos altera o que o licitante propõe: gera o aviso "avalie reabrir o prazo" (decisão humana, ⚖️).
const ALTERA_PROPOSTA_ITEM = new Set(['descricao', 'quantidade', 'unidade_medida']);
const LIMITE_TEXTO = 2000;

const texto = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const t = typeof v === 'string' ? v : typeof v === 'boolean' || typeof v === 'number' ? String(v) : JSON.stringify(v);
  return t.length > LIMITE_TEXTO ? `${t.slice(0, LIMITE_TEXTO)}…` : t;
};

// Datas chegam em formatos diferentes ("2026-11-06 08:59:00-03:00" ou ISO com Z): compara pelo instante e devolve ISO,
// que todo navegador lê. Texto que não é data fica como veio.
const instante = (v: string | null): string | null => {
  if (v === null) return null;
  const t = new Date(v.includes('T') ? v : v.replace(' ', 'T'));
  return Number.isNaN(t.getTime()) ? v : t.toISOString();
};

function mudancas(antes: Record<string, unknown>, depois: Record<string, unknown>, mapa: Record<string, [string, Formato]>): Mudanca[] {
  const r: Mudanca[] = [];
  for (const [campo, [rotulo, formato]] of Object.entries(mapa)) {
    const a = formato === 'data' ? instante(texto(antes[campo])) : texto(antes[campo]);
    const d = formato === 'data' ? instante(texto(depois[campo])) : texto(depois[campo]);
    if (a !== d) r.push({ campo, rotulo, formato, antes: a, depois: d });
  }
  return r;
}

export function compararVersoes(de: number, para: number, antes: Conteudo, depois: Conteudo): Diff {
  const campos = mudancas(antes.campos ?? {}, depois.campos ?? {}, CAMPOS);
  const itensA = new Map((antes.itens ?? []).map((i) => [Number(i['numero_item']), i]));
  const itensD = new Map((depois.itens ?? []).map((i) => [Number(i['numero_item']), i]));
  const itens: DiffItem[] = [];
  let altera = campos.some((c) => c.campo === 'objeto');
  for (const [n, i] of [...itensD].sort((x, y) => x[0] - y[0])) {
    const antigo = itensA.get(n);
    const desc = texto(i['descricao']) ?? '';
    if (!antigo) { itens.push({ numeroItem: n, descricao: desc, tipo: 'adicionado', mudancas: [] }); altera = true; continue; }
    const m = mudancas(antigo, i, CAMPOS_ITEM);
    if (m.length) { itens.push({ numeroItem: n, descricao: desc, tipo: 'alterado', mudancas: m }); if (m.some((x) => ALTERA_PROPOSTA_ITEM.has(x.campo))) altera = true; }
  }
  for (const [n, i] of [...itensA].sort((x, y) => x[0] - y[0])) {
    if (!itensD.has(n)) { itens.push({ numeroItem: n, descricao: texto(i['descricao']) ?? '', tipo: 'removido', mudancas: [] }); altera = true; }
  }
  const chave = (a: { url?: string; titulo?: string }): string => a.url ?? a.titulo ?? '';
  const arqA = new Map((antes.arquivos ?? []).map((a) => [chave(a), a]));
  const arqD = new Map((depois.arquivos ?? []).map((a) => [chave(a), a]));
  const arquivos: DiffArquivo[] = [];
  for (const [k, a] of arqD) if (!arqA.has(k)) arquivos.push({ titulo: a.titulo ?? null, tipo: a.tipo ?? 'outro', url: a.url ?? '', situacao: 'novo' });
  for (const [k, a] of arqA) if (!arqD.has(k)) arquivos.push({ titulo: a.titulo ?? null, tipo: a.tipo ?? 'outro', url: a.url ?? '', situacao: 'removido' });
  return { de, para, campos, itens, arquivos, alteraProposta: altera };
}
