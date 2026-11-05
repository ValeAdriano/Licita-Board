import { STATUS, TIPO } from './ics.js';

// Exportação da agenda em CSV para Excel (pt-BR): UTF-8 com BOM, separador ";" e CRLF. Código puro.
// Célula que começa com = + - @ (ou tab/CR) é prefixada com apóstrofo: texto de edital não vira fórmula no Excel.
export interface EventoCsv {
  tipo: string; status: string; dataLimite: string | Date | null; dataInterna: string | Date | null; provisorio: boolean; regraValidada: boolean
  origemPrazo: string; aviso: string | null; responsavel: string | null; prioridade: string; numeroEdital: string | null
  objeto: string; orgao: string; uf: string | null; municipio: string | null
}

const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const data = (v: string | Date | null): string => (v ? fmt.format(new Date(v)).replace(',', '') : '');
const ORIGEM: Record<string, string> = { regra: 'Regra', edital: 'Edital', manual: 'Manual' };
const PRIORIDADE: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

export function celula(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export const CABECALHO = ['Prazo (Brasília)', 'Data interna', 'Evento', 'Situação', 'Órgão', 'UF', 'Município', 'Edital', 'Objeto', 'Responsável',
  'Prioridade', 'Prazo provisório', 'Regra validada pelo jurídico', 'Origem do prazo', 'Aviso'];

export function gerarCsv(eventos: EventoCsv[]): string {
  const linhas = [CABECALHO, ...eventos.map((e) => [
    data(e.dataLimite), data(e.dataInterna), TIPO[e.tipo] ?? e.tipo, STATUS[e.status] ?? e.status, e.orgao, e.uf ?? '', e.municipio ?? '',
    e.numeroEdital ?? '', e.objeto, e.responsavel ?? '', PRIORIDADE[e.prioridade] ?? e.prioridade, e.provisorio ? 'Sim' : 'Não',
    e.regraValidada ? 'Sim' : 'Não', ORIGEM[e.origemPrazo] ?? e.origemPrazo, e.aviso ?? '',
  ])];
  return `﻿${linhas.map((l) => l.map(celula).join(';')).join('\r\n')}\r\n`;
}
