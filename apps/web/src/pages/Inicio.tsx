import { modulosDe, useAcesso } from '../features/acesso/contexto'
import { ConvitesRecebidos } from '../features/acesso/equipe/ConvitesRecebidos'

// Início: a empresa selecionada e os módulos que o vínculo libera. Os módulos chegam nas próximas
// fases; até lá aparecem como EM DESENVOLVIMENTO (regra 8 do AGENTS.md).
export default function Inicio() {
  const { usuario, empresa } = useAcesso()
  return (
    <div className="conteudo__miolo entra">
      <h1>{usuario ? `Olá, ${usuario.nome}` : 'VV Licitações'}</h1>
      <ConvitesRecebidos />
      {empresa ? (
        <>
          <p className="legenda">
            {empresa.empresa} · {empresa.papel}
          </p>
          <ul className="lista" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {modulosDe(empresa.permissoes).map((m) => (
              <li key={m} className="lista__item" style={{ cursor: 'default' }}>
                <span className="lista__texto" style={{ textTransform: 'capitalize' }}>
                  <strong>{m}</strong>
                </span>
                <span className="tag tag--aviso">EM DESENVOLVIMENTO</span>
              </li>
            ))}
          </ul>
          {empresa.permissoes.length === 0 ? <p>Seu acesso a esta empresa ainda não tem permissões.</p> : null}
        </>
      ) : (
        <p className="vazio">Você ainda não tem acesso a nenhuma empresa. Quando um administrador te convidar, o convite aparece aqui.</p>
      )}
    </div>
  )
}
