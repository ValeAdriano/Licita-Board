import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Acompanhados } from '../features/agenda/Acompanhados'
import { Calendario } from '../features/agenda/Calendario'
import { ABERTOS, inicioDoDia, hojeSP, somarDias, TIPO_EVENTO } from '../features/agenda/comum'
import { ListaEventos } from '../features/agenda/ListaEventos'
import { Resumo } from '../features/agenda/Resumo'
import { Abas, Aviso, Botao, CabecalhoPagina, Etiqueta, Pagina, Selecao } from '../ui'

type Aba = 'calendario' | 'prazos' | 'acompanhados'
const SITUACOES = [
  { valor: 'abertos', rotulo: 'Em aberto' }, { valor: 'todos', rotulo: 'Todos' }, { valor: 'prazo_perdido', rotulo: 'Prazo perdido' },
  { valor: 'concluidos', rotulo: 'Concluídos (protocolado, respondido, dispensado)' },
]
const PERIODOS = [
  { valor: 'proximos', rotulo: 'Próximos 30 dias' }, { valor: 'vencidos', rotulo: 'Já vencidos' }, { valor: 'todos', rotulo: 'Todo o período' },
]

// Agenda (Fase 05): calendário, lista de prazos e editais acompanhados da empresa selecionada. Quem calcula
// os prazos é o worker (regras versionadas); a tela mostra e deixa registrar status, override e fatos.
export default function Agenda() {
  const { empresa, pode } = useAcesso()
  const [params, setParams] = useSearchParams()
  const [situacao, setSituacao] = useState('abertos')
  const [tipo, setTipo] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [periodo, setPeriodo] = useState('proximos')
  const aba = (params.get('aba') as Aba | null) ?? 'calendario'
  const empresaId = empresa?.empresaId ?? null
  const responsaveis = useGet<{ id: string; nome: string }[]>(empresaId ? `/empresas/${empresaId}/agenda/responsaveis` : null)
  if (!empresa || !empresaId) return <p className="py-10 text-center text-sm text-tertiary">Selecione uma empresa.</p>
  if (!pode('agenda', 'visualizar')) return <p className="py-10 text-center text-sm text-tertiary">Você não tem permissão para ver a agenda de {empresa.empresa}.</p>

  const statusParam = situacao === 'abertos' ? ABERTOS.join(',') : situacao === 'prazo_perdido' ? 'prazo_perdido' : situacao === 'concluidos' ? 'protocolado,respondido,dispensado' : ''
  const base = `${statusParam ? `&status=${statusParam}` : ''}${tipo ? `&tipo=${tipo}` : ''}${responsavel ? `&responsavel=${responsavel}` : ''}`
  const hoje = hojeSP()
  const janela = periodo === 'proximos' ? `&de=${encodeURIComponent(inicioDoDia(hoje))}&ate=${encodeURIComponent(inicioDoDia(somarDias(hoje, 31)))}` : periodo === 'vencidos' ? `&ate=${encodeURIComponent(inicioDoDia(hoje))}` : ''
  const filtros = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Selecao rotulo="Situação" value={situacao} onChange={setSituacao} opcoes={SITUACOES} />
      <Selecao rotulo="Evento" value={tipo} onChange={setTipo} vazio="Todos" opcoes={Object.entries(TIPO_EVENTO).map(([valor, rotulo]) => ({ valor, rotulo }))} />
      <Selecao rotulo="Responsável" value={responsavel} onChange={setResponsavel} vazio="Todos" opcoes={(responsaveis.dados ?? []).map((r) => ({ valor: r.id, rotulo: r.nome }))} />
      {aba === 'prazos' ? <Selecao rotulo="Período" value={periodo} onChange={setPeriodo} opcoes={PERIODOS} /> : null}
    </div>
  )

  return (
    <Pagina larga>
      <CabecalhoPagina
        titulo="Agenda"
        subtitulo={empresa.empresa}
        acoes={
          <>
            <span className="flex items-center gap-2 text-sm text-tertiary"><Etiqueta cor="aviso">EM DESENVOLVIMENTO</Etiqueta> Importar e exportar Excel</span>
            <Botao variante="secundario" disabled>Importar planilha</Botao>
          </>
        }
      />
      <Aviso tipo="atencao" texto="Os prazos seguem as regras do Prompt Mestre e ainda NÃO foram validados pelo jurídico (aparecem com o selo “⚖️ Regra não validada”). Prazo calculado sobre abertura não confirmada é provisório. Confira sempre o edital." />
      <Resumo key={empresaId} empresaId={empresaId} />
      <Abas
        rotulo="Agenda"
        ativa={aba}
        aoMudar={(a) => setParams(a === 'calendario' ? {} : { aba: a })}
        abas={[{ id: 'calendario', rotulo: 'Calendário' }, { id: 'prazos', rotulo: 'Prazos' }, { id: 'acompanhados', rotulo: 'Editais acompanhados' }]}
      />
      {aba !== 'acompanhados' ? filtros : null}
      {aba === 'calendario' ? <Calendario key={empresaId + base} empresaId={empresaId} filtro={base} /> : null}
      {aba === 'prazos' ? <ListaEventos key={empresaId + base + janela} empresaId={empresaId} filtro={base + janela} /> : null}
      {aba === 'acompanhados' ? <Acompanhados key={empresaId} empresaId={empresaId} /> : null}
    </Pagina>
  )
}
