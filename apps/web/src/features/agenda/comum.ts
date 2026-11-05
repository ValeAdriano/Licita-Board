// Tipos, rótulos e datas da agenda (Fase 05). Todo horário é de Brasília; prazo é calculado pelo worker
// (rules/prazos.py), aqui só se exibe. Dinheiro chega como string e nunca vira number.
export const TZ = 'America/Sao_Paulo'

export interface EventoAgenda {
  id: string; tipo: string; status: string; dataLimite: string | null; dataInterna: string | null; provisorio: boolean; regraValidada: boolean
  origemPrazo: string; clausula: string | null; aviso: string | null; responsavelId: string | null; responsavel: string | null
  acompanhamentoId: string; prioridade: string; statusAcompanhamento: string; editalId: string; numeroEdital: string | null
  objeto: string; orgao: string; uf: string | null; municipio: string | null
}

export interface Acompanhado {
  id: string; status: string; prioridade: string; dataAbertura: string | null; aberturaConfirmada: boolean; confiabilidade: string
  responsavelId: string | null; responsavel: string | null; editalId: string; numeroEdital: string | null; objeto: string; editalAlterado: boolean; aberturaReconfirmar: boolean
  orgao: string; uf: string | null; municipio: string | null; itens: number; proximoPrazo: string | null; prazosPerdidos: number
}

export const TIPO_EVENTO: Record<string, string> = {
  disputa: 'Disputa', esclarecimento: 'Pedido de esclarecimento', impugnacao: 'Impugnação', resposta_administracao: 'Resposta da Administração',
  intencao_recurso: 'Intenção de recurso', razoes_recurso: 'Razões de recurso', contrarrazoes: 'Contrarrazões',
  regularizacao_fiscal_me_epp: 'Regularização fiscal ME/EPP', alteracao_edital: 'Alteração do edital', documento_vence: 'Documento vence antes da disputa',
}
export const STATUS_EVENTO: Record<string, string> = {
  sugerido: 'Sugerido', em_elaboracao: 'Em elaboração', em_revisao: 'Em revisão', aprovado: 'Aprovado', protocolado: 'Protocolado',
  respondido: 'Respondido', prazo_perdido: 'Prazo perdido', dispensado: 'Dispensado',
}
export const ABERTOS = ['sugerido', 'em_elaboracao', 'em_revisao', 'aprovado']
export const STATUS_ACOMP: Record<string, string> = {
  acompanhando: 'Acompanhando', em_elaboracao: 'Em elaboração', aguardando_sessao: 'Aguardando sessão', em_disputa: 'Em disputa', encerrado: 'Encerrado', desistiu: 'Desistiu',
}
export const PRIORIDADE: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }
export const STATUS_PART: Record<string, string> = {
  avaliando: 'Avaliando', vai_participar: 'Vai participar', nao_vai: 'Não vai', proposta_enviada: 'Proposta enviada', em_disputa: 'Em disputa',
  arrematada: 'Arrematada', habilitacao: 'Habilitação', vencida: 'Vencida', perdida: 'Perdida', desclassificada: 'Desclassificada', cancelada: 'Cancelada',
}
export const SITUACAO: Record<string, string> = { a_confirmar: 'A confirmar', pendente: 'Pendente', em_andamento: 'Em andamento', ok: 'OK', nao_se_aplica: 'Não se aplica' }
export const FATOS: Record<string, string> = {
  resposta_administracao: 'Peça protocolada (resposta da Administração)', intencao_recurso: 'Sessão realizada (intenção de recurso)',
  razoes_recurso: 'Intenção registrada (razões de recurso)', contrarrazoes: 'Recurso de terceiro (contrarrazões)', regularizacao_fiscal_me_epp: 'Vencedora com restrição (regularização ME/EPP)',
}

export type CorEtiqueta = 'cinza' | 'aviso' | 'sucesso' | 'erro' | 'marca'
export const corDoStatus = (s: string): CorEtiqueta =>
  s === 'prazo_perdido' ? 'erro' : s === 'protocolado' || s === 'respondido' ? 'sucesso' : s === 'dispensado' ? 'cinza' : s === 'aprovado' ? 'marca' : 'aviso'

// ---- datas (America/Sao_Paulo) ----
const fmtDia = new Intl.DateTimeFormat('en-CA', { timeZone: TZ })
export const diaSP = (v: string | Date): string => fmtDia.format(new Date(v))
export const horaSP = (v: string | Date): string => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v))
export const dataHoraSP = (v: string | null | undefined): string => (v ? new Date(v).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—')
export const dataSP = (v: string | null | undefined): string => (v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: TZ }) : '—')
// Brasília não tem horário de verão desde 2019: o deslocamento é fixo em -03:00.
export const paraIsoSP = (local: string): string => `${local.slice(0, 16)}:00-03:00`
export const paraCampoLocal = (iso: string | null | undefined): string => (iso ? `${diaSP(iso)}T${horaSP(iso)}` : '')
export const inicioDoDia = (dia: string): string => `${dia}T00:00:00-03:00`

export const hojeSP = (): string => diaSP(new Date())
const utc = (dia: string): Date => new Date(`${dia}T00:00:00Z`)
export const somarDias = (dia: string, n: number): string => {
  const d = utc(dia)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const diaDaSemana = (dia: string): number => utc(dia).getUTCDay() // 0 = domingo
export const inicioDaSemana = (dia: string): string => somarDias(dia, -diaDaSemana(dia))
export const mesDe = (dia: string): string => dia.slice(0, 7)
export const somarMeses = (dia: string, n: number): string => {
  const d = utc(dia.slice(0, 7) + '-01')
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}
/** Grade do mês (domingo a sábado) com as semanas completas. */
export function grade(dia: string): string[][] {
  const primeiro = dia.slice(0, 7) + '-01'
  const ultimo = somarDias(somarMeses(primeiro, 1), -1)
  const inicio = inicioDaSemana(primeiro)
  const fim = somarDias(inicioDaSemana(ultimo), 6)
  const semanas: string[][] = []
  for (let d = inicio; d <= fim; d = somarDias(d, 7)) semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(d, i)))
  return semanas
}
const maiuscula = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1)
export const tituloDoMes = (dia: string): string => maiuscula(utc(dia).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' }))
export const tituloDoDia = (dia: string): string => maiuscula(utc(dia).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' }))
// Rótulo curto para a grade do mês.
export const TIPO_CURTO: Record<string, string> = {
  disputa: 'Disputa', esclarecimento: 'Esclarec.', impugnacao: 'Impugnação', resposta_administracao: 'Resposta', intencao_recurso: 'Int. recurso',
  razoes_recurso: 'Razões', contrarrazoes: 'Contrarrazões', regularizacao_fiscal_me_epp: 'Regul. ME/EPP', alteracao_edital: 'Retificação', documento_vence: 'Doc. vence',
}
export const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
