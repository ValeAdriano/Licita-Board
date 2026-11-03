import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import { chamar, definirCredenciais, ErroApi, limparCredenciais, observarCliente } from '../api/cliente';
import { apagarToken, gravarToken, lerToken } from './armazenamento';

// Estado da sessão no app (spec fase-01 PR 6). A verdade é a API: o app só reflete o que ela diz e
// some com a tela ao perder a sessão. Inatividade de 30 min encerra também do lado do app.
export type EstadoMfa = 'verificar' | 'cadastrar' | 'nao_requerido';
export type Fase = 'carregando' | 'sem_conexao' | 'anonimo' | 'mfa' | 'ativa';
export type Elevacao = 'verificar' | 'confirmar' | 'recuperacao';
export type EscopoStepUp = 'alterar_permissoes' | 'exclusao_definitiva' | 'preco_abaixo_minimo' | 'proposta_final' | 'aprovar_peca';

export const INATIVIDADE_MS = 30 * 60 * 1000;

export function expirou(ultimaAtividade: number, agora: number, limite = INATIVIDADE_MS): boolean {
  return agora - ultimaAtividade >= limite;
}

type RespostaLogin = { mfa: EstadoMfa; token?: string; csrf?: string };
type RespostaSessao = { aal: 'aal1' | 'aal2'; mfa: EstadoMfa; csrf?: string };

interface Sessao {
  fase: Fase;
  mfa: EstadoMfa;
  entrar(email: string, senha: string, captcha?: string): Promise<void>;
  cadastrarTotp(senha: string): Promise<{ uri: string }>;
  elevar(tipo: Elevacao, codigo: string): Promise<void>;
  // Step-up (spec §6 regra 10): código novo do autenticador → credencial de uso único (5 min) para
  // uma operação crítica do escopo. Rotaciona o token da sessão.
  stepUp(escopo: EscopoStepUp, codigo: string): Promise<string>;
  // Troca logada: a API encerra as outras sessões e troca o token desta (o nativo regrava).
  trocarSenha(atual: string, nova: string): Promise<void>;
  concluirMfa(): void;
  // Lança ErroApi se o servidor não encerrou a sessão (a tela avisa e oferece tentar de novo).
  sair(): Promise<void>;
  registrarAtividade(): void;
  recarregar(): void;
}

const Contexto = createContext<Sessao | null>(null);

export function useSessao(): Sessao {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSessao fora do SessaoProvider');
  return s;
}

const plataforma = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

// Token rotacionado: vale já em memória; se o SecureStore falhar, a sessão segue até fechar o app
// (a operação no servidor já aconteceu, não vira erro na tela).
function aplicarRotacao(r: { token?: string }): void {
  if (!r.token) return;
  definirCredenciais({ token: r.token });
  void gravarToken(r.token).catch(() => {});
}

type Inicio = { fase: 'anonimo' | 'sem_conexao' } | { fase: 'sessao'; mfa: EstadoMfa };

// Sessão guardada: a API diz em que fase está. Sem rede, o token fica (não é sessão perdida).
async function lerSessaoGuardada(): Promise<Inicio> {
  const token = await lerToken().catch(() => null);
  if (plataforma !== 'web' && !token) return { fase: 'anonimo' };
  definirCredenciais({ token });
  try {
    const s = await chamar<RespostaSessao>('GET', '/auth/sessao');
    definirCredenciais({ csrf: s.csrf ?? null });
    return { fase: 'sessao', mfa: s.mfa };
  } catch (e) {
    return { fase: e instanceof ErroApi && e.status === 0 ? 'sem_conexao' : 'anonimo' };
  }
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [fase, setFase] = useState<Fase>('carregando');
  const [mfa, setMfa] = useState<EstadoMfa>('nao_requerido');
  const ultima = useRef(0); // gravado ao entrar e a cada uso
  const relendo = useRef(false);

  const esquecer = useCallback(async () => {
    limparCredenciais();
    await apagarToken().catch(() => {});
    setFase('anonimo');
  }, []);

  const aplicar = useCallback((estado: EstadoMfa) => {
    setMfa(estado);
    setFase(estado === 'nao_requerido' ? 'ativa' : 'mfa');
    ultima.current = Date.now();
  }, []);

  const iniciar = useCallback(
    (r: Inicio) => {
      if (r.fase === 'sessao') aplicar(r.mfa);
      else if (r.fase === 'sem_conexao') setFase('sem_conexao');
      else void esquecer();
    },
    [aplicar, esquecer],
  );

  useEffect(() => {
    observarCliente({
      aoPerderSessao: () => void esquecer(),
      aoUsar: () => {
        ultima.current = Date.now();
      },
      // Várias chamadas em paralelo podem receber o 403 "MFA": uma releitura basta. Sem rede, o
      // estado fica como está; o relógio de inatividade só avança se a API confirmar que falta MFA.
      aoExigirMfa: () => {
        if (relendo.current) return;
        relendo.current = true;
        void chamar<RespostaSessao>('GET', '/auth/sessao', undefined, { fundo: true })
          .then((s) => {
            if (s.mfa !== 'nao_requerido') aplicar(s.mfa);
          })
          .catch(() => {})
          .finally(() => {
            relendo.current = false;
          });
      },
    });
    void lerSessaoGuardada().then(iniciar);
  }, [iniciar, esquecer, aplicar]);

  const sair = useCallback(async () => {
    try {
      await chamar('POST', '/auth/logout');
    } catch (e) {
      if (!(e instanceof ErroApi && e.status === 401)) throw e;
    }
    await esquecer();
  }, [esquecer]);

  // Por inatividade a tela some de qualquer jeito; o servidor também expira em 30 min.
  const expirar = useCallback(async () => {
    await chamar('POST', '/auth/logout').catch(() => {});
    await esquecer();
  }, [esquecer]);

  // Confere a cada 30 s e na hora em que o app (ou a aba) volta ao primeiro plano.
  useEffect(() => {
    if (fase !== 'ativa' && fase !== 'mfa') return;
    const conferir = () => {
      if (expirou(ultima.current, Date.now())) void expirar();
    };
    const id = setInterval(conferir, 30000);
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') conferir();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [fase, expirar]);

  const valor = useMemo<Sessao>(
    () => ({
      fase,
      mfa,
      async entrar(email, senha, captcha) {
        limparCredenciais();
        const r = await chamar<RespostaLogin>('POST', '/auth/login', { email, senha, plataforma, captcha });
        if (r.token) await gravarToken(r.token);
        definirCredenciais({ token: r.token ?? null, csrf: r.csrf ?? null });
        aplicar(r.mfa);
      },
      cadastrarTotp: (senha) => chamar<{ uri: string }>('POST', '/auth/mfa/cadastrar', { senha }),
      // Elevação a aal2 troca o token (sem fixação de sessão): o nativo regrava o novo.
      async elevar(tipo, codigo) {
        aplicarRotacao(await chamar<{ token?: string }>('POST', `/auth/mfa/${tipo}`, { codigo }));
      },
      async stepUp(escopo, codigo) {
        const r = await chamar<{ stepUp: string; token?: string }>('POST', '/auth/mfa/step-up', { codigo, escopo });
        aplicarRotacao(r);
        return r.stepUp;
      },
      async trocarSenha(atual, nova) {
        aplicarRotacao(await chamar<{ token?: string }>('POST', '/auth/senha', { atual, nova }));
      },
      concluirMfa: () => aplicar('nao_requerido'),
      sair,
      registrarAtividade() {
        ultima.current = Date.now();
      },
      recarregar() {
        setFase('carregando');
        void lerSessaoGuardada().then(iniciar);
      },
    }),
    [fase, mfa, aplicar, sair, iniciar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function precisaCaptcha(e: unknown): boolean {
  return e instanceof ErroApi && e.status === 400 && e.message === 'CAPTCHA';
}

// O servidor não encerrou a sessão: não finge que saiu (computador compartilhado).
export function mensagemSair(e: unknown): string {
  const motivo = e instanceof ErroApi ? e.message : 'Algo deu errado.';
  return `Não foi possível encerrar a sessão no servidor. ${motivo} Tente de novo.`;
}
