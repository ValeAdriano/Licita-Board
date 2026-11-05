import { Navigate, Route, Routes } from 'react-router'
import { useSessao, type Fase } from './auth/sessao'
import { AMBIENTE, CADASTRO_ABERTO } from './config'
import Acompanhamento from './pages/Acompanhamento'
import Agenda from './pages/Agenda'
import Analise from './pages/Analise'
import Contrato from './pages/Contrato'
import Contratos from './pages/Contratos'
import Juridico from './pages/Juridico'
import PecaPagina from './pages/Peca'
import RecursoPagina from './pages/Recurso'
import Preco from './pages/Preco'
import Proposta from './pages/Proposta'
import Auditoria from './pages/Auditoria'
import Cadastrar from './pages/Cadastrar'
import Cadastros from './pages/Cadastros'
import PaginaEdital from './pages/Edital'
import PaginaOportunidades from './pages/Oportunidades'
import Conta from './pages/Conta'
import Entrar from './pages/Entrar'
import Equipe from './pages/Equipe'
import Inicio from './pages/Inicio'
import Layout from './pages/Layout'
import Mfa from './pages/Mfa'
import Notificacoes from './pages/Notificacoes'
import Plataforma from './pages/Plataforma'
import RedefinirSenha from './pages/RedefinirSenha'
import Recuperar from './pages/Recuperar'
import { Botao, FaixaAmbiente, TelaAcesso } from './ui'

export const DESTINO_INICIAL: Record<Exclude<Fase, 'carregando' | 'sem_conexao'>, string> = {
  ativa: '/',
  mfa: '/mfa',
  anonimo: '/entrar',
}

// Cada conjunto de telas só existe na fase certa da sessão: sem sessão não há rota do app, e sessão
// aal1 de perfil interno só vê o MFA. Qualquer outro endereço volta para a tela da fase. A API confere
// de novo em toda requisição (guard + RLS): isto é conforto, não segurança.
export function Rotas() {
  const { fase, recarregar } = useSessao()

  if (fase === 'carregando') {
    return (
      <div className="tela-acesso" role="status" aria-label="Carregando">
        <p className="text-sm text-tertiary [overflow-wrap:anywhere]">Carregando…</p>
      </div>
    )
  }
  if (fase === 'sem_conexao') {
    return (
      <TelaAcesso titulo="Sem conexão">
        <p>Não foi possível falar com o servidor. Confira a internet e tente de novo.</p>
        <Botao cheio onClick={recarregar}>
          Tentar de novo
        </Botao>
      </TelaAcesso>
    )
  }
  return (
    <>
      {fase !== 'ativa' ? <FaixaAmbiente ambiente={AMBIENTE} /> : null}
      <Routes>
        {fase === 'ativa' ? (
          <Route element={<Layout />}>
            <Route index element={<Inicio />} />
            <Route path="notificacoes" element={<Notificacoes />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="agenda/acompanhamentos/:id" element={<Acompanhamento />} />
            <Route path="agenda/participacoes/:id/analise" element={<Analise />} />
            <Route path="agenda/participacoes/:id/preco" element={<Preco />} />
            <Route path="agenda/acompanhamentos/:id/proposta" element={<Proposta />} />
            <Route path="contratos" element={<Contratos />} />
            <Route path="contratos/:id" element={<Contrato />} />
            <Route path="juridico" element={<Juridico />} />
            <Route path="juridico/pecas/:id" element={<PecaPagina />} />
            <Route path="juridico/recursos/:id" element={<RecursoPagina />} />
            <Route path="cadastros" element={<Cadastros />} />
            <Route path="oportunidades" element={<PaginaOportunidades />} />
            <Route path="editais/:id" element={<PaginaEdital />} />
            <Route path="equipe" element={<Equipe />} />
            <Route path="auditoria" element={<Auditoria />} />
            <Route path="plataforma" element={<Plataforma />} />
            <Route path="conta" element={<Conta />} />
          </Route>
        ) : null}
        {fase === 'mfa' ? <Route path="/mfa" element={<Mfa />} /> : null}
        {fase === 'anonimo' ? (
          <>
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/recuperar" element={<Recuperar />} />
            {CADASTRO_ABERTO ? <Route path="/cadastrar" element={<Cadastrar />} /> : null}
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          </>
        ) : null}
        <Route path="*" element={<Navigate to={DESTINO_INICIAL[fase]} replace />} />
      </Routes>
    </>
  )
}
