import { CabecalhoPagina, Pagina } from '../ui'
import { useAcesso } from '../features/acesso/contexto'
import { ConvitesRecebidos } from '../features/acesso/equipe/ConvitesRecebidos'
import { Painel } from '../features/dashboard/Painel'

// Início: o painel da empresa selecionada (Fase 12). Cada indicador vem dos registros e só aparece para quem tem a permissão do módulo de origem.
export default function Inicio() {
  const { usuario, empresa } = useAcesso()
  return (
    <Pagina>
      <CabecalhoPagina titulo={usuario ? `Olá, ${usuario.nome}` : 'VV Licitações'} subtitulo={empresa ? `${empresa.empresa} · ${empresa.papel}` : undefined} />
      <ConvitesRecebidos />
      {empresa ? (
        <>
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
