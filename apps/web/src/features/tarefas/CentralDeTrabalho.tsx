import { Link } from 'react-router'
import { Aviso, Etiqueta } from '../../ui'
import { dataHoraSP } from '../agenda/comum'
import { useTarefas, type Tarefa } from './TarefasContexto'

const BARRA: Record<Tarefa['nivel'], string> = { urgente: 'bg-error-solid', atencao: 'bg-warning-solid', info: 'bg-quaternary' }
const ROTULO: Record<Tarefa['nivel'], 'erro' | 'aviso' | 'cinza'> = { urgente: 'erro', atencao: 'aviso', info: 'cinza' }
const NOME: Record<Tarefa['nivel'], string> = { urgente: 'Urgente', atencao: 'Atenção', info: 'Acompanhe' }

// "Precisa da sua atenção": o que fazer agora, com um clique até o item. O resumo no topo diz quantas pendências urgentes existem; o resto fica
// logo abaixo. Só aparecem os módulos que a pessoa pode ver (a API decide); sem pendência, a tela diz que está tudo em dia.
export function CentralDeTrabalho() {
  const { dados, carregando } = useTarefas()
  if (!dados) return carregando ? <p className="text-sm text-tertiary">Carregando o que precisa da sua atenção…</p> : null
  const urgentes = dados.itens.filter((t) => t.nivel === 'urgente').length
  const atencao = dados.itens.filter((t) => t.nivel === 'atencao').length
  const visiveis = dados.itens.slice(0, 12)
  return (
    <section aria-label="Precisa da sua atenção" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="min-w-0 flex-1">Precisa da sua atenção</h2>
        {urgentes > 0 ? <Etiqueta cor="erro">{urgentes} urgente(s)</Etiqueta> : null}
        {atencao > 0 ? <Etiqueta cor="aviso">{atencao} para hoje</Etiqueta> : null}
      </div>
      {visiveis.length === 0 ? <Aviso tipo="info" texto="Tudo em dia: nenhuma pendência no momento." /> : (
        <ul className="flex flex-col gap-2">
          {visiveis.map((t) => (
            <li key={t.id}>
              <Link to={t.link} className="flex items-stretch gap-3 rounded-xl bg-primary p-3 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
                <span aria-hidden="true" className={`w-1 shrink-0 rounded-full ${BARRA[t.nivel]}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="text-sm text-primary [overflow-wrap:anywhere]"><bdi>{t.titulo}</bdi></strong>
                  {t.detalhe || t.quando ? <span className="text-sm text-tertiary">{[t.detalhe, t.quando ? dataHoraSP(t.quando) : null].filter(Boolean).join(' · ')}</span> : null}
                </span>
                <span className="shrink-0 self-center"><Etiqueta cor={ROTULO[t.nivel]}>{NOME[t.nivel]}</Etiqueta></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {dados.total > visiveis.length ? <p className="text-sm text-tertiary">Mostrando {visiveis.length} de {dados.total}. Resolva as primeiras e as demais aparecem.</p> : null}
    </section>
  )
}
