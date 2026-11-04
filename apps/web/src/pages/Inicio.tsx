import { CabecalhoPagina, Etiqueta, Pagina } from '../ui'
import { modulosDe, useAcesso } from '../features/acesso/contexto'
import { ConvitesRecebidos } from '../features/acesso/equipe/ConvitesRecebidos'

// Início: a empresa selecionada e os módulos que o vínculo libera. Os módulos chegam nas próximas
// fases; até lá aparecem como EM DESENVOLVIMENTO (regra 8 do AGENTS.md).
export default function Inicio() {
  const { usuario, empresa } = useAcesso()
  return (
    <Pagina>
      <CabecalhoPagina titulo={usuario ? `Olá, ${usuario.nome}` : 'VV Licitações'} subtitulo={empresa ? `${empresa.empresa} · ${empresa.papel}` : undefined} />
      <ConvitesRecebidos />
      {empresa ? (
        <>
          <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary">
            {modulosDe(empresa.permissoes).map((m) => (
              <li key={m} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5 [overflow-wrap:anywhere] capitalize">
                  <strong>{m}</strong>
                </span>
                <Etiqueta cor="aviso">EM DESENVOLVIMENTO</Etiqueta>
              </li>
            ))}
          </ul>
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
