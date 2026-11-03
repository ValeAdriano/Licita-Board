import type { ReactNode } from 'react'

// Página de acesso (login, MFA, recuperação): um cartão centrado, sem navegação.
export function TelaAcesso({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="tela-acesso">
      <div className="tela-acesso__caixa entra">
        <div className="marca">
          VV Licitações
          <small>Gestão de licitações públicas</small>
        </div>
        <section className="cartao pilha pilha--grande" aria-labelledby="titulo-acesso">
          <h1 id="titulo-acesso">{titulo}</h1>
          {children}
        </section>
      </div>
    </main>
  )
}
