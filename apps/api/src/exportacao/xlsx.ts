import { crc32, deflateRawSync } from 'node:zlib';

// Gerador mínimo de planilha .xlsx (Office Open XML) sem dependência: um ZIP com as partes obrigatórias e textos em linha (inlineStr). Código puro.
// Dinheiro e quantidades entram como o TEXTO decimal que veio do banco (<v> recebe a string exata): nenhum número passa por ponto flutuante aqui.
// Texto nunca vira fórmula (inlineStr não é avaliado), então não precisa do apóstrofo do CSV.
export interface Coluna { titulo: string; tipo?: 'texto' | 'numero'; largura?: number }
export interface Aba { nome: string; colunas: Coluna[]; linhas: (string | number | null)[][] }

const esc = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const letra = (i: number): string => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const DECIMAL = /^-?\d{1,18}(\.\d{1,6})?$/;

function celula(v: string | number | null, tipo: 'texto' | 'numero', ref: string, estilo: number): string {
  if (v === null || v === '') return `<c r="${ref}" s="${String(estilo)}"/>`;
  const t = String(v);
  if (tipo === 'numero' && DECIMAL.test(t)) return `<c r="${ref}" s="${String(estilo)}"><v>${t}</v></c>`;
  return `<c r="${ref}" s="${String(estilo)}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
}

function planilha(a: Aba): string {
  const cab = a.colunas.map((c, i) => celula(c.titulo, 'texto', `${letra(i)}1`, 1)).join('');
  const linhas = a.linhas.map((l, r) => `<row r="${String(r + 2)}">${a.colunas.map((c, i) => celula(l[i] ?? null, c.tipo ?? 'texto', `${letra(i)}${String(r + 2)}`, 0)).join('')}</row>`).join('');
  const cols = a.colunas.map((c, i) => `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(c.largura ?? 18)}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData><row r="1">${cab}</row>${linhas}</sheetData></worksheet>`;
}

const nomeAba = (n: string, i: number): string => esc(n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `Aba ${String(i + 1)}`);

interface Parte { nome: string; dados: Buffer }

// ZIP com deflate (método 8), CRC-32 do Node; datas fixas (reprodutível).
function zip(partes: Parte[]): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let deslocamento = 0;
  for (const p of partes) {
    const nome = Buffer.from(p.nome, 'utf8');
    const comprimido = deflateRawSync(p.dados);
    const crc = crc32(p.dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(p.dados.length, 22); local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    locais.push(local, nome, comprimido);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(p.dados.length, 24); central.writeUInt16LE(nome.length, 28); central.writeUInt32LE(deslocamento, 42);
    centrais.push(central, nome);
    deslocamento += 30 + nome.length + comprimido.length;
  }
  const tamCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(partes.length, 8); fim.writeUInt16LE(partes.length, 10); fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...locais, ...centrais, fim]);
}

export function gerarXlsx(abas: Aba[]): Buffer {
  if (abas.length === 0) throw new Error('planilha sem abas');
  const t = (s: string): Buffer => Buffer.from(s, 'utf8');
  const cabecalho = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const partes: Parte[] = [
    { nome: '[Content_Types].xml', dados: t(`${cabecalho}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { nome: '_rels/.rels', dados: t(`${cabecalho}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { nome: 'xl/workbook.xml', dados: t(`${cabecalho}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas.map((a, i) => `<sheet name="${nomeAba(a.nome, i)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`).join('')}</sheets></workbook>`) },
    { nome: 'xl/_rels/workbook.xml.rels', dados: t(`${cabecalho}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${String(i + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`).join('')}<Relationship Id="rId${String(abas.length + 1)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { nome: 'xl/styles.xml', dados: t(`${cabecalho}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${String(i + 1)}.xml`, dados: t(planilha(a)) })),
  ];
  return zip(partes);
}

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
