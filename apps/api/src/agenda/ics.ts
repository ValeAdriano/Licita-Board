// Exportação da agenda em iCalendar (RFC 5545). Código puro: sem I/O e sem relógio (o "agora" entra por parâmetro).
// O arquivo é um instantâneo: o calendário externo NÃO se atualiza sozinho quando o prazo é recalculado.

export interface EventoIcs {
  id: string; tipo: string; status: string; dataLimite: string | null; provisorio: boolean; regraValidada: boolean
  aviso: string | null; responsavel: string | null; numeroEdital: string | null; objeto: string; orgao: string
}

export const TIPO: Record<string, string> = {
  disputa: 'Disputa', esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', resposta_administracao: 'Resposta da Administração',
  intencao_recurso: 'Intenção de recurso', razoes_recurso: 'Razões de recurso', contrarrazoes: 'Contrarrazões',
  regularizacao_fiscal_me_epp: 'Regularização fiscal ME/EPP', alteracao_edital: 'Alteração do edital', documento_vence: 'Documento vence antes da disputa',
}
export const STATUS: Record<string, string> = {
  sugerido: 'Sugerido', em_elaboracao: 'Em elaboração', em_revisao: 'Em revisão', aprovado: 'Aprovado', protocolado: 'Protocolado',
  respondido: 'Respondido', prazo_perdido: 'Prazo perdido', dispensado: 'Dispensado',
}

export const escaparTexto = (t: string): string => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// Linhas com mais de 75 OCTETOS são dobradas (CRLF + espaço), sem cortar um caractere UTF-8 ao meio.
export function dobrar(linha: string): string {
  const partes: string[] = []
  let atual = ''
  let bytes = 0
  let limite = 75
  for (const c of linha) {
    const n = Buffer.byteLength(c, 'utf8')
    if (bytes + n > limite) {
      partes.push(atual)
      atual = ''
      bytes = 0
      limite = 74 // a continuação começa com um espaço
    }
    atual += c
    bytes += n
  }
  partes.push(atual)
  return partes.join('\r\n ')
}

export const utc = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export function gerarIcs(eventos: EventoIcs[], agora: Date): string {
  const L: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VV Licitações//Agenda//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:VV Licitações · Agenda', 'X-WR-TIMEZONE:America/Sao_Paulo']
  for (const e of eventos) {
    if (!e.dataLimite) continue
    const inicio = new Date(e.dataLimite)
    if (Number.isNaN(inicio.getTime())) continue
    const nome = TIPO[e.tipo] ?? e.tipo
    const notas = [
      `Órgão: ${e.orgao}`, e.numeroEdital ? `Edital nº ${e.numeroEdital}` : '', `Objeto: ${e.objeto}`, `Situação: ${STATUS[e.status] ?? e.status}`,
      e.responsavel ? `Responsável: ${e.responsavel}` : '',
      e.provisorio ? 'PRAZO PROVISÓRIO: a data de abertura ainda não foi confirmada.' : '',
      e.regraValidada ? '' : 'Regra de prazo ainda NÃO validada pelo jurídico. Confira sempre o edital.',
      e.aviso ?? '', 'Instantâneo da agenda do VV Licitações: este arquivo não se atualiza se o prazo for recalculado.',
    ].filter(Boolean)
    L.push('BEGIN:VEVENT', `UID:${e.id}@vv-licitacoes`, `DTSTAMP:${utc(agora)}`, `DTSTART:${utc(inicio)}`,
      `SUMMARY:${escaparTexto(`${nome} · ${e.orgao}`)}`, `DESCRIPTION:${escaparTexto(notas.join('\n'))}`,
      `STATUS:${e.provisorio ? 'TENTATIVE' : 'CONFIRMED'}`, 'TRANSP:TRANSPARENT')
    if (e.status !== 'prazo_perdido' && e.status !== 'protocolado' && e.status !== 'respondido' && e.status !== 'dispensado') {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escaparTexto(`${nome} em 1 dia`)}`, 'TRIGGER:-P1D', 'END:VALARM')
    }
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return `${L.map(dobrar).join('\r\n')}\r\n`
}
