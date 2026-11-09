import { useState, useCallback } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Cartao, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { STATUS_PECA, TIPO_PECA } from '../juridico/tipos'
import { EnviarAnexo } from './EnviarAnexo'
import { dia, ETAPAS, type Detalhe } from './tipos'

interface Anexo {
  id: string;
  empenhoNumero: string | null;
  etapa: string | null;
  nota: string | null;
  documentoId: string | null;
  descricao: string | null;
  status: string | null;
  validade: string | null;
  doAcompanhamento?: boolean;
  tipoPosterior?: string | null;
  linkPublico?: string | null;
}
interface DocumentoLinha { id: string; descricao: string; status: string; validade: string | null }
interface Pedido { id: string; tipo: string; titulo: string; status: string; resultado: string | null }
const COR_DOC: Record<string, 'sucesso' | 'aviso' | 'erro' | 'cinza'> = { vigente: 'sucesso', a_vencer: 'aviso', vencido: 'erro', pendente: 'aviso' }

// Anexos do contrato (por etapa do empenho) e documentos de regularidade da execução: vínculo com o repositório de documentos (a validade vem de lá).
// Pedidos de reajuste e de reequilíbrio nascem aqui como peças do jurídico (⚖️ o sistema não calcula índice nem decide o direito).
export function Anexos({ empresaId, id, d, editar }: { empresaId: string; id: string; d: Detalhe; editar: boolean }) {
  const { pode } = useAcesso()
  const [rodada, setRodada] = useState(0)
  const anexos = useGet<Anexo[]>(`/empresas/${empresaId}/contratos/${id}/anexos?rodada=${rodada}`)
  const docs = useGet<DocumentoLinha[]>(pode('documentos', 'visualizar') && editar ? `/empresas/${empresaId}/documentos` : null)
  const pedidos = useGet<Pedido[]>(`/empresas/${empresaId}/contratos/${id}/pedidos`)
  const [f, setF] = useState({ doc: '', empenho: '', etapa: '', nota: '' })
  const [modo, setModo] = useState('existente')
  const aoVincular = useCallback(() => setRodada((n) => n + 1), [])
  const [p, setP] = useState({ tipo: 'reajuste', titulo: '' })
  const { enviando, erro, enviar } = useEnvio()
  const base = `/empresas/${empresaId}/contratos/${id}`
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? anexos.erro} />
      <Cartao><h2>Anexos e documentos de regularidade</h2>
        <Legenda>Envie um arquivo ou escolha um documento já cadastrado no repositório (com antivírus, versões e alertas de validade). Sem empenho, o documento vale para o contrato inteiro (ex.: certidões durante a execução).</Legenda>
        {editar && pode('documentos', 'visualizar') ? <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={() => setModo('existente')}>Vincular existente</Botao>
          {pode('documentos', 'cadastrar') ? <Botao variante="secundario" onClick={() => setModo('enviar')}>Enviar arquivo</Botao> : null}
        </div> : null}
        {editar && pode('documentos', 'visualizar') ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modo === 'existente' ? <Selecao rotulo="Documento" value={f.doc} onChange={(v) => setF({ ...f, doc: v })} vazio="Escolha" opcoes={(docs.dados ?? []).map((x) => ({ valor: x.id, rotulo: `${x.descricao.slice(0, 60)}${x.validade ? ` · vence ${dia(x.validade)}` : ''}` }))} /> : null}
            <Selecao rotulo="Empenho (opcional)" value={f.empenho} onChange={(v) => setF({ ...f, empenho: v, etapa: v ? f.etapa : '' })} vazio="Contrato inteiro" opcoes={d.empenhos.map((e) => ({ valor: e.id, rotulo: e.numero }))} />
            <Selecao rotulo="Etapa (opcional)" value={f.etapa} onChange={(v) => setF({ ...f, etapa: v })} vazio="Sem etapa" disabled={!f.empenho} opcoes={Object.entries(ETAPAS).map(([valor, rotulo]) => ({ valor, rotulo }))} />
            <Campo rotulo="Nota (opcional)" value={f.nota} onChange={(v) => setF({ ...f, nota: v })} maxLength={300} />
            {modo === 'existente' ? <div><Botao carregando={enviando} disabled={!f.doc} onClick={() => void enviar(async () => { await chamar('POST', `${base}/anexos`, { documentoId: f.doc, empenhoId: f.empenho || null, etapa: f.etapa || null, nota: f.nota.trim() || null }); setF({ doc: '', empenho: '', etapa: '', nota: '' }); anexos.recarregar() })}>Anexar</Botao></div> : null}
          </div>
        ) : null}
        {editar && pode('documentos', 'visualizar') && pode('documentos', 'cadastrar') ? <div hidden={modo !== 'enviar'}><EnviarAnexo key={`${empresaId}/${id}`} empresaId={empresaId} base={base} destino={{ empenhoId: f.empenho || null, etapa: f.etapa || null, nota: f.nota.trim() || null }} aoVincular={aoVincular} /></div> : null}
        {anexos.carregando ? <Legenda>Carregando anexos…</Legenda> : null}
        <Aviso texto={docs.erro} />
        {(anexos.dados ?? []).length === 0 && !anexos.carregando ? <Vazio>Nenhum anexo. Cadastre o arquivo em <Link to="/cadastros">Cadastros → Documentos</Link> e anexe aqui.</Vazio> : null}
        {(anexos.dados ?? []).map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-2 border-t border-secondary pt-2">
            <strong className="[overflow-wrap:anywhere]"><bdi>{a.descricao ?? 'Documento (sem permissão para ver)'}</bdi></strong>
            {a.doAcompanhamento ? <Etiqueta cor="cinza">do acompanhamento</Etiqueta> : null}
            {a.status ? <Etiqueta cor={COR_DOC[a.status] ?? 'cinza'}>{a.status.replace('_', ' ')}</Etiqueta> : null}
            {a.validade ? <Legenda>validade {dia(a.validade)}</Legenda> : null}
            <Legenda>{a.empenhoNumero ? `Empenho ${a.empenhoNumero}${a.etapa ? ` · ${ETAPAS[a.etapa] ?? a.etapa}` : ''}` : 'Contrato inteiro'}{a.nota ? ` · ${a.nota}` : ''}</Legenda>
            {a.linkPublico ? <a href={a.linkPublico} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-secondary underline">Abrir link</a> : null}
            {editar && !a.doAcompanhamento ? <Botao variante="texto" carregando={enviando} onClick={() => void enviar(async () => { await chamar('DELETE', `${base}/anexos/${a.id}`); anexos.recarregar() })}>Remover vínculo</Botao> : null}
          </div>
        ))}
      </Cartao>
      <Cartao><h2>Pedidos ao órgão (jurídico)</h2>
        <Legenda>⚖️ Reajuste e reequilíbrio seguem o fluxo do jurídico: minuta, conferência de citações na base verificada, aprovação e protocolo humano. O sistema não calcula índice nem decide o direito.</Legenda>
        {pode('juridico', 'elaborar_peca') && d.contrato.status === 'ativo' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Selecao rotulo="Tipo" value={p.tipo} onChange={(v) => setP({ ...p, tipo: v })} opcoes={[{ valor: 'reajuste', rotulo: 'Reajuste' }, { valor: 'reequilibrio', rotulo: 'Reequilíbrio' }]} />
            <Campo rotulo="Título" value={p.titulo} onChange={(v) => setP({ ...p, titulo: v })} maxLength={200} />
            <div className="flex items-end"><Botao carregando={enviando} disabled={p.titulo.trim().length < 3} onClick={() => void enviar(async () => { await chamar('POST', `${base}/pedidos`, { tipo: p.tipo, titulo: p.titulo.trim() }); setP({ ...p, titulo: '' }); pedidos.recarregar() })}>Abrir pedido no jurídico</Botao></div>
          </div>
        ) : null}
        {(pedidos.dados ?? []).length === 0 ? <Vazio>Nenhum pedido aberto.</Vazio> : null}
        {(pedidos.dados ?? []).map((x) => (
          <Link key={x.id} to={`/juridico/pecas/${x.id}`} className="flex flex-wrap items-center gap-2 no-underline"><strong><bdi>{x.titulo}</bdi></strong><Etiqueta cor="cinza">{TIPO_PECA[x.tipo] ?? x.tipo}</Etiqueta><Etiqueta cor={(STATUS_PECA[x.status] ?? ['', 'cinza'])[1] as 'cinza'}>{(STATUS_PECA[x.status] ?? [x.status])[0]}</Etiqueta></Link>
        ))}
      </Cartao>
    </div>
  )
}
