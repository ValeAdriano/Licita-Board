import { CabecalhoPagina, Pagina } from '../ui'
import { useAcesso } from '../features/acesso/contexto'
import { ConvitesRecebidos } from '../features/acesso/equipe/ConvitesRecebidos'
import { Painel } from '../features/dashboard/Painel'
import { Link } from 'react-router'
import { CentralDeTrabalho } from '../features/tarefas/CentralDeTrabalho'

// Início: o painel da empresa selecionada (Fase 12). Cada indicador vem dos registros e só aparece para quem tem a permissão do módulo de origem.
export default function Inicio() {
  const { usuario, empresa, pode } = useAcesso()
  return (
    <Pagina>
      <CabecalhoPagina titulo={usuario ? `Olá, ${usuario.nome}` : 'VV Licitações'} subtitulo={empresa ? `${empresa.empresa} · ${empresa.papel}` : undefined} />
      <ConvitesRecebidos />
      {empresa ? (
        <>
          <Atalhos />
          {pode('relatorios', 'visualizar') ? <CentralDeTrabalho /> : null}
          <Painel key={empresa.empresaId} empresaId={empresa.empresaId} />
          {empresa.papel === 'SUPERADMIN' ? (
            <p>Você acessa esta empresa como equipe da plataforma. Convide o administrador dela em Equipe.</p>
          ) : empresa.permissoes.length === 0 ? (
            <p>Seu acesso a esta empresa ainda não tem permissões.</p>
          ) : null}
        </>
      ) : (
        <p className="px-4 py-10 text-center text-sm text-tertiary">Você ainda não tem acesso a nenhuma empresa. Quando um administrador te convidar, o convite aparece aqui.</p>
      )}
    </Pagina>
  )
}

// Atalhos do que mais se faz: cada um leva direto à tela com o formulário já à vista (um clique do Início).
function Atalhos() {
  const { pode } = useAcesso()
  const itens = [
    pode('editais', 'cadastrar') ? { to: '/oportunidades?aba=buscar', rotulo: 'Buscar ou importar edital' } : null,
    pode('editais', 'visualizar') ? { to: '/oportunidades', rotulo: 'Triar oportunidades' } : null,
    pode('juridico', 'elaborar_peca') ? { to: '/juridico', rotulo: 'Nova peça jurídica' } : null,
    pode('documentos', 'cadastrar') ? { to: '/cadastros', rotulo: 'Cadastrar documento' } : null,
  ].filter((x): x is { to: string; rotulo: string } => x !== null)
  if (itens.length === 0) return null
  return (
    <nav aria-label="Atalhos" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {itens.map((i) => <Link key={i.to} to={i.to} className="shrink-0 rounded-lg bg-secondary px-3 py-2 text-sm font-semibold whitespace-nowrap text-secondary no-underline ring-1 ring-secondary hover:bg-secondary_hover">{i.rotulo}</Link>)}
    </nav>
  )
}
