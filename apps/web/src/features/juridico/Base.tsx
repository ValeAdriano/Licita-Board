import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { dataHoraSP } from '../agenda/comum'
import { TIPO_BASE } from './tipos'

interface Entrada { id: string; tipo: string; numero: string | null; orgao: string | null; dispositivo: string | null; titulo: string; ementa: string | null; dataAto: string | null; linkOficial: string; verificadaEm: string | null; verificadaPor: string | null }

// Base jurídica VERIFICADA da empresa (10.1). Nasce vazia: só o jurídico cadastra e verifica na fonte oficial. A minuta só pode citar o que está aqui.
export function Base({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const lista = useGet<Entrada[]>(`/empresas/${empresaId}/juridico/base`)
  const [f, setF] = useState({ tipo: 'lei', numero: '', orgao: '', dispositivo: '', titulo: '', ementa: '', link: '' })
  const { enviando, erro, enviar } = useEnvio()
  const editar = pode('juridico', 'elaborar_peca')
  const aprovar = pode('juridico', 'aprovar_peca')
  const valido = f.titulo.trim().length >= 3 && /^https:\/\/\S+$/.test(f.link.trim()) && (f.tipo === 'constituicao' || f.numero.trim() !== '')
  const salvar = () => enviar(async () => {
    await chamar('POST', `/empresas/${empresaId}/juridico/base`, { tipo: f.tipo, numero: f.numero.trim() || null, orgao: f.orgao.trim() || null, dispositivo: f.dispositivo.trim() || null, titulo: f.titulo.trim(), ementa: f.ementa.trim() || null, linkOficial: f.link.trim() })
    setF({ ...f, numero: '', dispositivo: '', titulo: '', ementa: '', link: '' })
    lista.recarregar()
  })
  return (
    <div className="flex flex-col gap-4">
      <Aviso tipo="atencao" texto="⚖️ A base começa VAZIA: o sistema não traz nenhuma lei, acórdão ou súmula. O jurídico cadastra cada fonte com o link oficial e a verifica. Citação fora da base verificada bloqueia a minuta." />
      <Aviso texto={erro ?? lista.erro} />
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhuma entrada na base jurídica.</Vazio> : (
        <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
          {(lista.dados ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]"><strong><bdi>{e.titulo}</bdi></strong> · {TIPO_BASE[e.tipo] ?? e.tipo}{e.numero ? ` ${e.numero}` : ''}{e.orgao ? ` (${e.orgao})` : ''}{e.dispositivo ? ` · ${e.dispositivo}` : ''}<br /><a href={e.linkOficial} target="_blank" rel="noreferrer noopener">Fonte oficial</a></span>
              {e.verificadaEm ? <Etiqueta cor="sucesso">Verificada por {e.verificadaPor} em {dataHoraSP(e.verificadaEm)}</Etiqueta> : <Etiqueta cor="aviso">Não verificada (não vale como base)</Etiqueta>}
              {aprovar && !e.verificadaEm ? <Botao variante="secundario" disabled={enviando} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/juridico/base/${e.id}/verificar`); lista.recarregar() })}>Marcar como verificada</Botao> : null}
              {editar ? <Botao variante="texto" disabled={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `/empresas/${empresaId}/juridico/base/${e.id}`); lista.recarregar() })}>Remover</Botao> : null}
            </li>
          ))}
        </ul>
      )}
      {editar ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={Object.entries(TIPO_BASE).map(([valor, rotulo]) => ({ valor, rotulo }))} />
          <Campo rotulo="Número (ex.: 14.133/2021, 1234/2023, 247)" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={40} />
          <Campo rotulo="Órgão (TCU, STJ…)" value={f.orgao} onChange={(v) => setF({ ...f, orgao: v })} maxLength={40} />
          <Campo rotulo="Dispositivo (ex.: art. 165)" value={f.dispositivo} onChange={(v) => setF({ ...f, dispositivo: v })} maxLength={60} />
          <Campo rotulo="Título" value={f.titulo} onChange={(v) => setF({ ...f, titulo: v })} maxLength={300} />
          <Campo rotulo="Link oficial (https)" value={f.link} onChange={(v) => setF({ ...f, link: v })} maxLength={500} erro={f.link !== '' && !/^https:\/\/\S+$/.test(f.link.trim())} />
          <Campo rotulo="Ementa ou texto (opcional)" value={f.ementa} onChange={(v) => setF({ ...f, ementa: v })} maxLength={4000} />
          <div className="flex items-end"><Botao carregando={enviando} disabled={!valido} onClick={() => void salvar()}>Cadastrar fonte</Botao></div>
        </div>
      ) : <Legenda>Só quem elabora peças cadastra fontes; só quem aprova peças as verifica.</Legenda>}
    </div>
  )
}
