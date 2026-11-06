import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAcesso } from '../features/acesso/contexto'
import { useGet } from '../features/acesso/useGet'
import { Acompanhados } from '../features/agenda/Acompanhados'
import { Calendario } from '../features/agenda/Calendario'
import { Configuracao } from '../features/agenda/Configuracao'
import { ABERTOS, inicioDoDia, hojeSP, somarDias, TIPO_EVENTO } from '../features/agenda/comum'
import { ListaEventos } from '../features/agenda/ListaEventos'
import { Resumo } from '../features/agenda/Resumo'
import { Historico } from '../features/resultados/Historico'
import { Abas, Botao, CabecalhoPagina, Etiqueta, Pagina, Selecao, AvisoNota } from '../ui'

type Aba = 'calendario' | 'prazos' | 'acompanhados' | 'resultados' | 'configuracao'
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
  // Exportações (.ics e planilha) levam os filtros atuais e os últimos 30 dias de prazos.
  const exportacao = [statusParam && `status=${statusParam}`, `de=${encodeURIComponent(inicioDoDia(somarDias(hoje, -30)))}`, tipo && `tipo=${tipo}`, responsavel && `responsavel=${responsavel}`].filter(Boolean).join('&')
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
            <Botao variante="secundario" onClick={() => window.location.assign(`/api/empresas/${empresaId}/agenda/calendario.ics?${exportacao}`)}>Baixar .ics</Botao>
            {pode('agenda', 'exportar') ? <Botao variante="secundario" onClick={() => window.location.assign(`/api/empresas/${empresaId}/agenda/eventos.csv?${exportacao}`)}>Exportar planilha</Botao> : null}
            <span className="flex items-center gap-2"><Botao variante="secundario" disabled>Importar planilha</Botao><Etiqueta cor="aviso">EM DESENVOLVIMENTO</Etiqueta></span>
          </>
        }
      />
      <AvisoNota tipo="atencao" resumo="Prazos ainda não validados pelo jurídico: confira sempre o edital." texto="Os prazos seguem as regras do Prompt Mestre e ainda NÃO foram validados pelo jurídico (aparecem com o selo “⚖️ Regra não validada”). Prazo calculado sobre abertura não confirmada é provisório. Confira sempre o edital." />
      <Resumo key={empresaId} empresaId={empresaId} />
      <Abas
        rotulo="Agenda"
        ativa={aba}
        aoMudar={(a) => setParams(a === 'calendario' ? {} : { aba: a })}
        abas={[{ id: 'calendario', rotulo: 'Calendário' }, { id: 'prazos', rotulo: 'Prazos' }, { id: 'acompanhados', rotulo: 'Editais acompanhados' }, { id: 'resultados', rotulo: 'Resultados' }, { id: 'configuracao', rotulo: 'Configuração' }]}
      />
      {aba === 'calendario' || aba === 'prazos' ? filtros : null}
      {aba === 'calendario' ? <Calendario key={empresaId + base} empresaId={empresaId} filtro={base} /> : null}
      {aba === 'prazos' ? <ListaEventos key={empresaId + base + janela} empresaId={empresaId} filtro={base + janela} /> : null}
      {aba === 'resultados' ? <Historico key={empresaId} empresaId={empresaId} /> : null}
      {aba === 'configuracao' ? <Configuracao key={empresaId} empresaId={empresaId} /> : null}
      {aba === 'acompanhados' ? <Acompanhados key={empresaId} empresaId={empresaId} /> : null}
    </Pagina>
  )
}
