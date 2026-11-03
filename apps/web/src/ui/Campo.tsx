import { useId, type InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string
}

export function Campo({ rotulo, id, className, ...resto }: Props) {
  const auto = useId()
  const idCampo = id ?? auto
  return (
    <div className="campo">
      <label className="campo__rotulo" htmlFor={idCampo}>
        {rotulo}
      </label>
      <input {...resto} id={idCampo} className={['campo__entrada', className].filter(Boolean).join(' ')} />
    </div>
  )
}
