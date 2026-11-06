import { Bell01, Building07, File05, FileCheck02, CalendarDate, ClipboardCheck, FileSearch01, Home01, LogOut01, SearchLg, User01, Users01 } from '@untitledui/icons'
import type { ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router'
import { NavList } from '@/components/application/app-navigation/base-components/nav-list'
import { MobileNavigationHeader } from '@/components/application/app-navigation/base-components/mobile-header'
import type { NavItemDividerType, NavItemType } from '@/components/application/app-navigation/config'
import { Badge } from '@/components/base/badges/badges'
import { useSessao } from '../auth/sessao'
import { AMBIENTE } from '../config'
import { AcessoProvider, useAcesso } from '../features/acesso/contexto'
import { BuscaRapida } from '../features/busca/BuscaRapida'
import { TarefasProvider, useTarefas } from '../features/tarefas/TarefasContexto'
import { SeletorEmpresa } from '../features/acesso/SeletorEmpresa'
import { Botao, FaixaAmbiente, Marca } from '../ui'

// Shell (RF-01.14) no padrão "sidebar" do Untitled UI: menu lateral fixo no desktop (≥ 1024 px) e, no
// celular, cabeçalho com botão que abre o menu em painel. A empresa fica no topo do menu.
function Conteudo({ aoNavegar }: { aoNavegar?: () => void }) {
  const { naoLidas, pode, usuario } = useAcesso()
  const { sair } = useSessao()
  const { pathname } = useLocation()
  const { dados } = useTarefas()
  const selo = (modulo: string): ReactNode => {
    const n = dados?.contagens[modulo] ?? 0
    return n > 0 ? <Badge color="error" size="sm" type="pill-color">{n}</Badge> : undefined
  }
  // Ordem do dia a dia: o que chega (oportunidades), o que vence (agenda), o jurídico e o pós-licitação; cadastros e administração por último.
  const itens: (NavItemType | NavItemDividerType)[] = [
    { label: 'Início', href: '/', icon: Home01 },
    { label: 'Notificações', href: '/notificacoes', icon: Bell01, badge: naoLidas > 0 ? <Badge color="brand" size="sm" type="pill-color">{naoLidas}</Badge> : undefined },
    { divider: true },
    ...(pode('editais', 'visualizar') ? [{ label: 'Oportunidades', href: '/oportunidades', icon: SearchLg, badge: selo('oportunidades') }] : []),
    ...(pode('agenda', 'visualizar') ? [{ label: 'Agenda', href: '/agenda', icon: CalendarDate, badge: selo('agenda') }] : []),
    ...(pode('juridico', 'visualizar') ? [{ label: 'Jurídico', href: '/juridico', icon: File05, badge: selo('juridico') }] : []),
    ...(pode('contratos', 'visualizar') ? [{ label: 'Contratos', href: '/contratos', icon: FileCheck02, badge: selo('contratos') }] : []),
    { divider: true },
    ...(pode('empresas', 'visualizar') ? [{ label: 'Cadastros', href: '/cadastros', icon: ClipboardCheck, badge: selo('cadastros') }] : []),
    ...(pode('usuarios', 'visualizar') ? [{ label: 'Equipe', href: '/equipe', icon: Users01 }] : []),
    ...(pode('auditoria', 'visualizar') ? [{ label: 'Auditoria', href: '/auditoria', icon: FileSearch01 }] : []),
    ...(usuario?.superadmin ? [{ label: 'Plataforma', href: '/plataforma', icon: Building07 }] : []),
    { label: 'Conta', href: '/conta', icon: User01 },
  ]
  // Detalhe de edital pertence à área de Oportunidades.
  const ativo = pathname.startsWith('/editais') ? '/oportunidades' : pathname.startsWith('/agenda') ? '/agenda' : pathname.startsWith('/juridico') ? '/juridico' : pathname.startsWith('/contratos') ? '/contratos' : pathname
  return (
    <div className="flex h-full flex-col justify-between overflow-y-auto bg-primary" onClick={aoNavegar ? (e) => (e.target as HTMLElement).closest('a') && aoNavegar() : undefined}>
      <div>
        <div className="hidden px-5 pt-6 lg:block">
          <Marca />
        </div>
        <div className="px-4 pt-5">
          <SeletorEmpresa />
        </div>
        <nav aria-label="Principal">
          <NavList activeUrl={ativo} items={itens} />
        </nav>
      </div>
      <div className="flex flex-col gap-3 border-t border-secondary p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-primary">{usuario?.nome}</p>
          <p className="truncate text-sm text-tertiary">{usuario?.email}</p>
        </div>
        <Botao variante="secundario" cheio onClick={() => void sair()}>
          <span className="inline-flex items-center gap-2">
            <LogOut01 className="size-4" aria-hidden="true" /> Sair
          </span>
        </Botao>
      </div>
    </div>
  )
}

function Esqueleto() {
  return (
    <div className={`min-h-dvh bg-primary ${AMBIENTE === 'prod' ? '' : 'pt-6 [--faixa:--spacing(6)]'}`}>
      <FaixaAmbiente ambiente={AMBIENTE} />
      <MobileNavigationHeader>
        <Conteudo />
      </MobileNavigationHeader>
      <aside className="fixed top-(--faixa,0px) bottom-0 left-0 hidden w-72 border-r border-secondary lg:block">
        <Conteudo />
      </aside>
      <main className="px-4 py-8 lg:pl-72">
        <div className="lg:px-8">
          <BuscaRapida />
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default function Layout() {
  return (
    <AcessoProvider>
      <TarefasProvider>
        <Esqueleto />
      </TarefasProvider>
    </AcessoProvider>
  )
}
