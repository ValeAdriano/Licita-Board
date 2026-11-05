import { useState } from 'react'
import { Link } from 'react-router'
import { chamar } from '../../api/cliente'
import { Aviso, AreaTexto, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { dataHoraSP, type Acompanhado } from '../agenda/comum'

interface Linha { id: string; recorrente: string; publicadoEm: string; pecaId: string; leituraStatus: string; alegacoes: number; riscos: number }
export const LEITURA: Record<string, [string, 'cinza' | 'aviso' | 'sucesso' | 'erro']> = {
  pendente: ['IA lendo…', 'aviso'], concluida: ['Alegações extraídas', 'sucesso'], falhou: ['Leitura falhou', 'erro'], desligada: ['IA desligada: cadastre as alegações', 'cinza'],
}

// Recursos interpostos por OUTROS licitantes (10.6). Inserir lança o prazo de contrarrazões na agenda, abre a peça e pede à IA a leitura das alegações.
export function Recursos({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const lista = useGet<Linha[]>(`/empresas/${empresaId}/juridico/recursos`)
  const acomps = useGet<Acompanhado[]>(pode('agenda', 'visualizar') ? `/empresas/${empresaId}/agenda/acompanhamentos` : null)
  const [f, setF] = useState({ acomp: '', recorrente: '', quando: '', link: '', texto: '' })
  const { enviando, erro, enviar } = useEnvio()
  return (
    <div className="flex flex-col gap-4">
      <Aviso texto={erro ?? lista.erro} />
      {pode('juridico', 'elaborar_peca') ? (
        <div className="flex flex-col gap-3 rounded-xl bg-secondary p-4">
          <Legenda>Cole o texto do recurso interposto pelo concorrente. O sistema lança o prazo de contrarrazões na agenda (a partir da divulgação), abre a peça e a IA lista as alegações; você define a defesa de cada uma. ⚖️ A regra do prazo ainda não foi validada pelo jurídico: confira o edital.</Legenda>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Selecao rotulo="Edital acompanhado" value={f.acomp} onChange={(v) => setF({ ...f, acomp: v })} vazio="Escolha" opcoes={(acomps.dados ?? []).map((a) => ({ valor: a.id, rotulo: `${a.orgao}${a.numeroEdital ? ` · nº ${a.numeroEdital}` : ''}`.slice(0, 80) }))} />
            <Campo rotulo="Licitante recorrente" value={f.recorrente} onChange={(v) => setF({ ...f, recorrente: v })} maxLength={200} />
            <Campo rotulo="Divulgação do recurso (Brasília)" type="datetime-local" value={f.quando} onChange={(v) => setF({ ...f, quando: v })} />
            <Campo rotulo="Link do recurso (opcional)" value={f.link} onChange={(v) => setF({ ...f, link: v })} maxLength={500} />
          </div>
          <AreaTexto rotulo="Texto do recurso" value={f.texto} onChange={(v) => setF({ ...f, texto: v })} rows={8} maxLength={60000} />
          <div><Botao carregando={enviando} disabled={!f.acomp || f.recorrente.trim().length < 2 || !f.quando || f.texto.trim().length < 50}
            onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/juridico/acompanhamentos/${f.acomp}/recursos`, { recorrente: f.recorrente.trim(), publicadoEm: `${f.quando.slice(0, 16)}:00-03:00`, texto: f.texto.trim(), link: f.link.trim() || null }); setF({ ...f, recorrente: '', texto: '', link: '' }); lista.recarregar() })}>Inserir recurso e abrir contrarrazões</Botao></div>
        </div>
      ) : null}
      {(lista.dados ?? []).length === 0 && !lista.carregando ? <Vazio>Nenhum recurso de terceiro inserido.</Vazio> : null}
      <div className="flex flex-col gap-2">
        {(lista.dados ?? []).map((r) => {
          const [rotulo, cor] = LEITURA[r.leituraStatus] ?? [r.leituraStatus, 'cinza' as const]
          return (
            <Link key={r.id} to={`/juridico/recursos/${r.id}`} className="flex flex-col gap-1 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
              <span className="flex flex-wrap items-center gap-2"><strong className="text-md text-primary [overflow-wrap:anywhere]"><bdi>{r.recorrente}</bdi></strong><Etiqueta cor={cor}>{rotulo}</Etiqueta>{r.riscos ? <Etiqueta cor="erro">{r.riscos} ponto(s) de risco</Etiqueta> : null}</span>
              <Legenda>Divulgado em {dataHoraSP(r.publicadoEm)} · {r.alegacoes} alegação(ões)</Legenda>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
