type Tipo = 'erro' | 'info' | 'atencao'

// Mensagem ao usuário. Erro é anunciado na hora (role=alert); info e atenção, com educação (status).
export function Aviso({ texto, tipo = 'erro' }: { texto: string | null | undefined; tipo?: Tipo }) {
  if (!texto) return null
  const classe = tipo === 'erro' ? 'aviso' : `aviso aviso--${tipo}`
  return (
    <p className={classe} role={tipo === 'erro' ? 'alert' : 'status'}>
      {texto}
    </p>
  )
}
