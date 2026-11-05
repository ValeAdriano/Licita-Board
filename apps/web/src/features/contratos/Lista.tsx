import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { reais } from '../precos/formato'
import { dia, type ContratoLinha } from './tipos'

export function Lista({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const lista = useGet<ContratoLinha[]>(`/empresas/${empresaId}/contratos`)
  const [f, setF] = useState({ tipo: 'contrato', numero: '', orgao: '', objeto: '', ini: '', fim: '', gestor: '', fiscal: '' })
  const { enviando, erro, enviar } = useEnvio()
  const navegar = useNavigate()
  const valido = f.numero.trim() !== '' && f.orgao.trim().length >= 2 && f.objeto.trim().length >= 3 && f.ini !== '' && f.fim !== '' && f.fim >= f.ini
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? lista.erro} />
      {pode('contratos', 'cadastrar') ? (
        <div className="grid grid-cols-1 gap-3 rounded-xl bg-secondary p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={[{ valor: 'contrato', rotulo: 'Contrato' }, { valor: 'ata', rotulo: 'Ata de registro de preços' }]} />
          <Campo rotulo="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} maxLength={80} />
          <Campo rotulo="Órgão" value={f.orgao} onChange={(v) => setF({ ...f, orgao: v })} maxLength={200} />
          <Campo rotulo="Objeto" value={f.objeto} onChange={(v) => setF({ ...f, objeto: v })} maxLength={2000} />
          <Campo rotulo="Vigência: início" type="date" value={f.ini} onChange={(v) => setF({ ...f, ini: v })} />
          <Campo rotulo="Vigência: fim" type="date" value={f.fim} onChange={(v) => setF({ ...f, fim: v })} erro={f.fim !== '' && f.ini !== '' && f.fim < f.ini} />
          <Campo rotulo="Gestor (órgão)" value={f.gestor} onChange={(v) => setF({ ...f, gestor: v })} maxLength={200} />
          <Campo rotulo="Fiscal (órgão)" value={f.fiscal} onChange={(v) => setF({ ...f, fiscal: v })} maxLength={200} />
          <div><Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => { const r = await chamar<{ id: string }>('POST', `/empresas/${empresaId}/contratos`, { tipo: f.tipo, numero: f.numero.trim(), orgao: f.orgao.trim(), objeto: f.objeto.trim(), vigenciaInicio: f.ini, vigenciaFim: f.fim, gestorOrgao: f.gestor.trim() || null, fiscalOrgao: f.fiscal.trim() || null }); navegar(`/contratos/${r.id}`) })}>Criar contrato</Botao></div>
        </div>
      ) : null}
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhum contrato cadastrado ainda.</Vazio> : null}
      <div className="flex flex-col gap-2">
        {(lista.dados ?? []).map((c) => (
          <Link key={c.id} to={`/contratos/${c.id}`} className="flex flex-col gap-1 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
            <span className="flex flex-wrap items-center gap-2"><strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{c.orgao}</bdi></strong><Etiqueta cor="cinza">{c.tipo === 'ata' ? 'Ata' : 'Contrato'} {c.numero}</Etiqueta><Etiqueta cor={c.status === 'ativo' ? 'sucesso' : 'cinza'}>{c.status}</Etiqueta></span>
            <span className="text-sm text-secondary [overflow-wrap:anywhere]"><bdi>{c.objeto}</bdi></span>
            <Legenda>Vigência {dia(c.vigenciaInicio)} a {dia(c.vigenciaFim)} · contratado {reais(c.valorTotal)} · empenhado {reais(c.empenhado)}{c.veFinanceiro ? ` · faturado ${reais(c.faturado)} · recebido ${reais(c.recebido)}` : ''}</Legenda>
          </Link>
        ))}
      </div>
    </div>
  )
}
