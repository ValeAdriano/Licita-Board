import { EnvBanner } from './components/EnvBanner'

function App() {
  return (
    <>
      <EnvBanner />
      <main className="shell">
        <h1>VV Licitações</h1>
        <p>Fase 00 · fundação técnica. Nenhum módulo de negócio liberado ainda.</p>
        <p className="badge">EM DESENVOLVIMENTO</p>
      </main>
    </>
  )
}

export default App
