export type Tema = 'claro' | 'escuro' | 'sistema'
const CHAVE = 'vv.tema'
const ouvintes = new Set<() => void>()
const sistema = window.matchMedia?.('(prefers-color-scheme: dark)')
function validar(valor: string | null): Tema {
  return valor === 'claro' || valor === 'escuro' ? valor : 'sistema'
}
function ler(): Tema {
  try { return validar(localStorage.getItem(CHAVE)) } catch { return 'sistema' }
}
let tema = ler()
export function obterTema(): Tema { return tema }
function aplicar() {
  const escuro = tema === 'escuro' || (tema === 'sistema' && sistema?.matches === true)
  document.documentElement.classList.toggle('dark-mode', escuro)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', escuro ? '#0c0e12' : '#ffffff')
  ouvintes.forEach((ouvir) => ouvir())
}
export function definirTema(novo: Tema) {
  tema = novo
  try { localStorage.setItem(CHAVE, novo) } catch { /* Continua nesta aba se o armazenamento estiver indisponível. */ }
  aplicar()
}
export function observarTema(ouvir: () => void) {
  ouvintes.add(ouvir)
  return () => { ouvintes.delete(ouvir) }
}
sistema?.addEventListener('change', aplicar)
window.addEventListener('storage', (evento) => {
  if (evento.key === CHAVE || evento.key === null) {
    tema = ler()
    aplicar()
  }
})
// Importado antes do React: nenhuma renderização espera um efeito para receber o tema.
aplicar()
