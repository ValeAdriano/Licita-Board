import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { gerarXlsx } from './xlsx.js';

// Lê o ZIP gerado (diretório central) e devolve o conteúdo de cada parte: prova que o pacote é um ZIP válido, sem depender de biblioteca.
function ler(buf: Buffer): Map<string, string> {
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const partes = new Map<string, string>();
  for (let i = 0; i < total; i++) {
    const tamComp = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nomeLen).toString('utf8');
    const dadosIni = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    partes.set(nome, inflateRawSync(buf.subarray(dadosIni, dadosIni + tamComp)).toString('utf8'));
    p += 46 + nomeLen;
  }
  return partes;
}

describe('xlsx mínimo', () => {
  const buf = gerarXlsx([
    { nome: 'Resumo', colunas: [{ titulo: 'Indicador' }, { titulo: 'Valor', tipo: 'numero' }], linhas: [['Valor ganho', '89937.7400'], ['=SOMA(A1)', 'texto <&> "x"'], ['Sem valor', null]] },
    { nome: 'Motivos/de:perda?', colunas: [{ titulo: 'Motivo' }], linhas: [['Atestado incompatível']] },
  ]);
  const partes = ler(buf);

  it('tem as partes obrigatórias e uma planilha por aba', () => {
    expect([...partes.keys()].sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    expect(partes.get('xl/workbook.xml')).toContain('name="Resumo"');
    expect(partes.get('xl/workbook.xml')).toContain('name="Motivos de perda"'); // caracteres proibidos no nome da aba saem
  });

  it('dinheiro entra como o texto decimal exato; texto vai em linha e escapado; fórmula não é avaliada', () => {
    const s1 = partes.get('xl/worksheets/sheet1.xml') ?? '';
    expect(s1).toContain('<c r="B2" s="0"><v>89937.7400</v></c>');
    expect(s1).toContain('t="inlineStr"><is><t xml:space="preserve">=SOMA(A1)</t>');
    expect(s1).toContain('texto &lt;&amp;&gt; &quot;x&quot;');
    expect(s1).toContain('<c r="B4" s="0"/>');
    expect(s1).toContain('<pane ySplit="1"');
  });

  it('o ZIP começa com a assinatura local e termina com o registro de fim', () => {
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.subarray(buf.length - 22, buf.length - 18).readUInt32LE(0)).toBe(0x06054b50);
  });
});
