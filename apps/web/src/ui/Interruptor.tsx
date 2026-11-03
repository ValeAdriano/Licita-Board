export function Interruptor({ rotulo, marcado, aoMudar, desabilitado }: { rotulo: string; marcado: boolean; aoMudar: (v: boolean) => void; desabilitado?: boolean }) {
  return (
    <label className="interruptor">
      <input type="checkbox" role="switch" checked={marcado} disabled={desabilitado} onChange={(e) => aoMudar(e.target.checked)} />
      <span className="interruptor__trilho" aria-hidden="true" />
      <span>{rotulo}</span>
    </label>
  )
}
