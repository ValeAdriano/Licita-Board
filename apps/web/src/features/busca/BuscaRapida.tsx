import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAcesso } from '../acesso/contexto'

// Busca em qualquer tela: digite e Enter. Atalhos: "/" ou Ctrl/Cmd + K focam o campo. Leva à página de busca já com o resultado.
export function BuscaRapida() {
  const { pode } = useAcesso()
  const navegar = useNavigate()
  const { pathname } = useLocation()
  const [q, setQ] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const ao = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null
      const digitando = alvo !== null && (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName) || alvo.isContentEditable)
      if ((e.key === '/' && !digitando) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        campo.current?.focus()
        campo.current?.select()
      }
    }
    document.addEventListener('keydown', ao)
    return () => document.removeEventListener('keydown', ao)
  }, [])
  if (!pode('relatorios', 'visualizar') || pathname === '/busca') return null
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const t = q.trim()
    if (t.length < 2) return
    void navegar(`/busca?q=${encodeURIComponent(t)}`)
    setQ('')
    campo.current?.blur()
  }
  return (
    <form role="search" onSubmit={enviar} className="nao-imprimir mb-4 flex max-w-xl items-center gap-2">
      <input ref={campo} type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} aria-label="Buscar em editais, contratos, peças, documentos e produtos"
        placeholder="Buscar editais, contratos, peças, documentos…  ( / )"
        className="w-full rounded-lg bg-primary px-3.5 py-2 text-md text-primary shadow-xs ring-1 ring-primary outline-hidden placeholder:text-placeholder focus:ring-2 focus:ring-brand" />
    </form>
  )
}
