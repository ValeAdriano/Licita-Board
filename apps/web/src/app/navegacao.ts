import {
  Bell,
  Building2,
  CalendarDays,
  ChartColumn,
  FileText,
  Gavel,
  House,
  type LucideIcon,
  Package,
  ScrollText,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

export type ItemMenu = {
  rota: string
  rotulo: string
  icone: LucideIcon
  /** false = módulo ainda não construído: abre a tela EM DESENVOLVIMENTO. */
  pronto: boolean
  /** Fase do Prompt Mestre em que o módulo entra. */
  fase?: string
  /** Aparece na barra inferior do celular (máximo 4 + "Mais"). */
  barraInferior?: boolean
}

export const MENU: ItemMenu[] = [
  { rota: '/', rotulo: 'Início', icone: House, pronto: true, barraInferior: true },
  { rota: '/agenda', rotulo: 'Agenda', icone: CalendarDays, pronto: false, fase: 'Fase 05', barraInferior: true },
  { rota: '/oportunidades', rotulo: 'Oportunidades', icone: Search, pronto: false, fase: 'Fase 04', barraInferior: true },
  { rota: '/documentos', rotulo: 'Documentos', icone: FileText, pronto: false, fase: 'Fase 03', barraInferior: true },
  { rota: '/empresas', rotulo: 'Empresas', icone: Building2, pronto: false, fase: 'Fase 02' },
  { rota: '/produtos', rotulo: 'Produtos', icone: Package, pronto: false, fase: 'Fase 02' },
  { rota: '/juridico', rotulo: 'Jurídico', icone: Gavel, pronto: false, fase: 'Fase 10' },
  { rota: '/contratos', rotulo: 'Contratos', icone: ScrollText, pronto: false, fase: 'Fase 11' },
  { rota: '/relatorios', rotulo: 'Relatórios', icone: ChartColumn, pronto: false, fase: 'Fase 12' },
  { rota: '/permissoes', rotulo: 'Usuários e permissões', icone: ShieldCheck, pronto: true },
  { rota: '/notificacoes', rotulo: 'Notificações', icone: Bell, pronto: true },
  { rota: '/conta', rotulo: 'Minha conta', icone: UserRound, pronto: true },
]

export const MODULOS_EM_DESENVOLVIMENTO = MENU.filter((i) => !i.pronto)
