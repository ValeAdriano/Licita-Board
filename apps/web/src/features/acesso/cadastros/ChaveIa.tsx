import { useState } from 'react'
import { chamar } from '../../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao } from '../../../ui'
import { dataHoraSP } from '../../agenda/comum'
import { useEnvio } from '../conta/useEnvio'
import { useAcesso } from '../contexto'
import { useGet } from '../useGet'

interface Estado { configurada: boolean; ultimos4: string | null; modelo: string | null; testeStatus: 'ok' | 'falhou' | 'pendente' | null; testeErro: string | null; testeEm: string | null; atualizadaEm: string | null; modelosDisponiveis: string[]; modeloPadrao: string }

// Chave do provedor de IA da empresa. A chave é cifrada no servidor, nunca volta para a tela (só os 4 últimos caracteres) e só o
// processo em segundo plano a usa, no momento de chamar o provedor. Cada empresa usa a sua chave e paga o seu uso.
export function ChaveIa({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const estado = useGet<Estado>(`/empresas/${empresaId}/ia`)
  const [chave, setChave] = useState('')
  const [modelo, setModelo] = useState('')
  const { enviando, erro, ok, enviar } = useEnvio()
  const editar = pode('configuracoes', 'editar')
  if (estado.erro) return <Aviso texto={estado.erro} />
  if (!estado.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  const e = estado.dados
  const formatoOk = /^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(chave.trim())
  const escolhido = modelo || e.modelo || e.modeloPadrao
  const opcoes = e.modelosDisponiveis.map((m) => ({ valor: m, rotulo: m }))
  const acao = (rotulo: string, fn: () => Promise<unknown>, variante: 'primario' | 'secundario' | 'texto' = 'secundario') => (
    <Botao variante={variante} carregando={enviando} onClick={() => void enviar(async () => { await fn(); estado.recarregar() })}>{rotulo}</Botao>
  )
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-ia">
      <h2 id="h-ia">Inteligência artificial (Anthropic)</h2>
      <Legenda>Usada para SUGERIR os requisitos técnicos de um item a partir do edital. A IA só sugere: cada sugestão traz uma citação que o sistema confere no texto do edital e só vale depois que você confirma. Vai ao provedor apenas o texto público do edital (nunca custos, margens ou dados da empresa). O uso é cobrado na sua conta do provedor.</Legenda>
      <Aviso texto={erro} />
      {ok ? <Aviso tipo="info" texto={ok} /> : null}
      {e.configurada ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta cor="sucesso">Chave cadastrada · termina em {e.ultimos4}</Etiqueta>
            {e.testeStatus === 'ok' ? <Etiqueta cor="sucesso">Testada em {dataHoraSP(e.testeEm)}</Etiqueta> : null}
            {e.testeStatus === 'falhou' ? <Etiqueta cor="erro">Teste falhou: {e.testeErro ?? 'erro'}</Etiqueta> : null}
            {e.testeStatus === 'pendente' ? <Etiqueta cor="aviso">Testando… atualize em instantes</Etiqueta> : null}
            {e.testeStatus === null ? <Etiqueta cor="cinza">Ainda não testada</Etiqueta> : null}
          </div>
          {editar ? (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full min-w-0 sm:min-w-64"><Selecao rotulo="Modelo" value={escolhido} onChange={setModelo} opcoes={opcoes} /></div>
              {acao('Salvar modelo', () => chamar('POST', `/empresas/${empresaId}/ia/modelo`, { modelo: escolhido }))}
              {acao('Testar a chave', async () => { await chamar('POST', `/empresas/${empresaId}/ia/testar`); return 'Teste pedido. Atualize em instantes para ver o resultado.' })}
              {acao('Remover a chave', () => chamar('DELETE', `/empresas/${empresaId}/ia/chave`), 'texto')}
            </div>
          ) : null}
        </div>
      ) : <Aviso tipo="info" texto="Nenhuma chave cadastrada: a sugestão de requisitos por IA está desligada para esta empresa. Os requisitos continuam podendo ser cadastrados à mão." />}
      {editar ? (
        <div className="flex flex-col gap-3 rounded-xl bg-secondary p-4">
          <h3 className="text-sm font-semibold text-secondary">{e.configurada ? 'Trocar a chave' : 'Cadastrar a chave'}</h3>
          <Campo rotulo="Chave da API (começa com sk-ant-)" type="password" autoComplete="off" spellCheck={false} value={chave} onChange={setChave} maxLength={320} erro={chave !== '' && !formatoOk} dica="Gere em console.anthropic.com. Ela é cifrada ao salvar e não aparece de novo." />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full min-w-0 sm:min-w-64"><Selecao rotulo="Modelo" value={escolhido} onChange={setModelo} opcoes={opcoes} /></div>
            <Botao carregando={enviando} disabled={!formatoOk} onClick={() => void enviar(async () => { await chamar('PUT', `/empresas/${empresaId}/ia/chave`, { chave: chave.trim(), modelo: escolhido }); setChave(''); estado.recarregar(); return 'Chave salva (cifrada). Use “Testar a chave” para conferir.' })}>Salvar chave</Botao>
          </div>
        </div>
      ) : <Legenda>Só quem tem permissão de editar as configurações da empresa cadastra ou troca a chave.</Legenda>}
    </section>
  )
}
