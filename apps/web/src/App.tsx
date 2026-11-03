import { Navigate, Route, Routes } from 'react-router'
import { useSessao, type Fase } from './auth/sessao'
import { AMBIENTE } from './config'
import Conta from './pages/Conta'
import Entrar from './pages/Entrar'
import Equipe from './pages/Equipe'
import Inicio from './pages/Inicio'
import Layout from './pages/Layout'
import Mfa from './pages/Mfa'
import Notificacoes from './pages/Notificacoes'
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
        <p className="legenda">Carregando…</p>
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
            <Route path="equipe" element={<Equipe />} />
            <Route path="conta" element={<Conta />} />
          </Route>
        ) : null}
        {fase === 'mfa' ? <Route path="/mfa" element={<Mfa />} /> : null}
        {fase === 'anonimo' ? (
          <>
            <Route path="/entrar" element={<Entrar />} />
            <Route path="/recuperar" element={<Recuperar />} />
            <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          </>
        ) : null}
        <Route path="*" element={<Navigate to={DESTINO_INICIAL[fase]} replace />} />
      </Routes>
    </>
  )
}
