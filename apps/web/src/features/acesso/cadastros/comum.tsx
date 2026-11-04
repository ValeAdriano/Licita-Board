import { useEffect, useState } from 'react'

// Peças pequenas dos cadastros (Fase 02): seletor nativo, data em pt-BR e valor que some sozinho.
export interface Opcao {
  valor: string
  rotulo: string
}

export function Selecao(props: { rotulo: string; value: string; onChange: (v: string) => void; opcoes: Opcao[]; vazio?: string; disabled?: boolean }) {
  return (
    <label className="campo">
      <span className="campo__rotulo">{props.rotulo}</span>
      <select className="campo__entrada" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        {props.vazio !== undefined ? <option value="">{props.vazio}</option> : null}
        {props.opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Caixa(props: { rotulo: string; marcado: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="campo" style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--e2)' }}>
      <input type="checkbox" checked={props.marcado} onChange={(e) => props.onChange(e.target.checked)} style={{ width: 22, height: 22 }} />
      <span>{props.rotulo}</span>
    </label>
  )
}

export const dataBr = (iso?: string | null): string => (iso ? iso.split('-').reverse().join('/') : '—')

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
export const opcoesUf: Opcao[] = UFS.map((u) => ({ valor: u, rotulo: u }))

// Valor sensível revelado: fica na tela por 20 segundos e some (nada em armazenamento).
export function useValorTemporario(segundos = 20) {
  const [valor, setValor] = useState<{ chave: string; texto: string } | null>(null)
  useEffect(() => {
    if (!valor) return
    const t = setTimeout(() => setValor(null), segundos * 1000)
    return () => clearTimeout(t)
  }, [valor, segundos])
  return { valor, mostrar: (chave: string, texto: string) => setValor({ chave, texto }), esconder: () => setValor(null) }
}

// Texto livre de formulário → nulo quando vazio.
export const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim())
