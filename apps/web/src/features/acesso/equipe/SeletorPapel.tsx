import { PAPEIS, type Papel } from '../matriz'

export function SeletorPapel(props: { papel: Papel; aoMudar: (p: Papel) => void; desabilitado?: boolean }) {
  const { papel, aoMudar, desabilitado } = props
  return (
    <div className="linha" role="radiogroup" aria-label="Papel">
      {PAPEIS.map((p) => (
        <button key={p.id} type="button" role="radio" aria-checked={papel === p.id} aria-label={p.rotulo} disabled={desabilitado} className="chip chip--papel" onClick={() => aoMudar(p.id)}>
          {p.rotulo}
        </button>
      ))}
    </div>
  )
}
