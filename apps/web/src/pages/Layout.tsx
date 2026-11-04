import { Bell, Building2, CircleUser, ClipboardList, House, ScrollText, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { AMBIENTE } from '../config'
import { AcessoProvider, useAcesso } from '../features/acesso/contexto'
import { SeletorEmpresa } from '../features/acesso/SeletorEmpresa'
import { FaixaAmbiente } from '../ui'

// Shell (RF-01.14): menu lateral no desktop, abas embaixo no celular; empresa no cabeçalho.
function Esqueleto() {
  const { naoLidas, pode, usuario } = useAcesso()
  const item = (to: string, rotulo: string, icone: React.ReactNode, selo = 0) => (
    <NavLink key={to} to={to} end={to === '/'} className="nav__item" aria-label={selo > 0 ? `${rotulo}, ${selo} não lidas` : rotulo}>
      {icone}
      <span>{rotulo}</span>
      {selo > 0 ? (
        <span className="nav__selo" aria-hidden="true">
          {selo}
        </span>
      ) : null}
    </NavLink>
  )
  return (
    <div className={AMBIENTE === 'prod' ? 'shell' : 'shell shell--faixa'}>
      <FaixaAmbiente ambiente={AMBIENTE} />
      <nav className="nav" aria-label="Principal">
        {item('/', 'Início', <House size={22} aria-hidden="true" />)}
        {item('/notificacoes', 'Notificações', <Bell size={22} aria-hidden="true" />, naoLidas)}
        {pode('empresas', 'visualizar') ? item('/cadastros', 'Cadastros', <ClipboardList size={22} aria-hidden="true" />) : null}
        {pode('usuarios', 'visualizar') ? item('/equipe', 'Equipe', <Users size={22} aria-hidden="true" />) : null}
        {pode('auditoria', 'visualizar') ? item('/auditoria', 'Auditoria', <ScrollText size={22} aria-hidden="true" />) : null}
        {usuario?.superadmin ? item('/plataforma', 'Plataforma', <Building2 size={22} aria-hidden="true" />) : null}
        {item('/conta', 'Conta', <CircleUser size={22} aria-hidden="true" />)}
      </nav>
      <div className="shell__lado">
        <header className="topo">
          <span className="topo__titulo">VV Licitações</span>
          <span className="espaco" />
          <SeletorEmpresa />
        </header>
        <main className="conteudo">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default function Layout() {
  return (
    <AcessoProvider>
      <Esqueleto />
    </AcessoProvider>
  )
}
