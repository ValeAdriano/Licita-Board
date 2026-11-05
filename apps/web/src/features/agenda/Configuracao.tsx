import { useState } from 'react'
import { chamar } from '../../api/cliente'
import { Aviso, Botao, Campo, Etiqueta, Legenda, Selecao, Vazio } from '../../ui'
import { useEnvio } from '../acesso/conta/useEnvio'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { dataSP } from './comum'

interface Feriado { id: string; data: string; nome: string; tipo: string; abrangencia: 'uf' | 'municipio'; uf: string; codigoIbge: string | null }
interface Orgao { uf: string; municipio: string | null; codigoIbge: string | null }
interface Config { diasInternos: number; padraoDiasInternos: number; feriados: Feriado[]; orgaos: Orgao[] }

// Configuração da agenda da empresa: data interna (D-N) e feriados próprios (estaduais/municipais). Valem só para esta
// empresa e recalculam os prazos dela. ⚖️ A tabela oficial de feriados de cada município ainda depende do jurídico/operação.
export function Configuracao({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const cfg = useGet<Config>(`/empresas/${empresaId}/agenda/configuracao`)
  if (cfg.erro) return <Aviso texto={cfg.erro} />
  if (!cfg.dados) return <p className="text-sm text-tertiary">Carregando…</p>
  return (
    <div className="flex flex-col gap-6">
      <Aviso tipo="info" texto="Mudar a configuração recalcula os prazos desta empresa. Os feriados nacionais já vêm calculados; aqui entram os estaduais e municipais que o sistema ainda não conhece (o aviso “feriados municipais não cadastrados” some quando há um para o município do órgão)." />
      <DiasInternos empresaId={empresaId} c={cfg.dados} pode={pode('agenda', 'aprovar')} aoMudar={cfg.recarregar} />
      <Feriados empresaId={empresaId} c={cfg.dados} pode={pode('agenda', 'editar')} aoMudar={cfg.recarregar} />
    </div>
  )
}

function DiasInternos({ empresaId, c, pode, aoMudar }: { empresaId: string; c: Config; pode: boolean; aoMudar: () => void }) {
  const [dias, setDias] = useState(String(c.diasInternos))
  const { enviando, erro, ok, enviar } = useEnvio()
  const n = Number(dias)
  const valido = Number.isInteger(n) && n >= 0 && n <= 10
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-dn">
      <h2 id="h-dn">Data interna recomendada</h2>
      <Legenda>A data interna é quando a equipe deve entregar a peça, antes do limite legal. Padrão: {c.padraoDiasInternos} dias úteis antes, às 18:00.</Legenda>
      <Aviso texto={erro} />
      {ok ? <Aviso tipo="info" texto={ok} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40"><Campo rotulo="Dias úteis antes (0 a 10)" type="number" inputMode="numeric" min={0} max={10} value={dias} onChange={setDias} disabled={!pode} erro={!valido} /></div>
        {pode ? <Botao carregando={enviando} disabled={!valido} onClick={() => void enviar(async () => { await chamar('POST', `/empresas/${empresaId}/agenda/parametros`, { diasInternos: n }); aoMudar(); return 'Salvo. Os prazos estão sendo recalculados.' })}>Salvar</Botao> : <Legenda>Só quem aprova na agenda altera.</Legenda>}
      </div>
    </section>
  )
}

function Feriados({ empresaId, c, pode, aoMudar }: { empresaId: string; c: Config; pode: boolean; aoMudar: () => void }) {
  const municipios = c.orgaos.filter((o) => o.codigoIbge && o.municipio)
  const ufs = [...new Set(c.orgaos.map((o) => o.uf))]
  const [f, setF] = useState({ data: '', nome: '', tipo: 'feriado', abrangencia: 'municipio', alvo: '' })
  const { enviando, erro, ok, enviar } = useEnvio()
  const alvos = f.abrangencia === 'municipio' ? municipios.map((o) => ({ valor: `${o.uf}|${o.codigoIbge}`, rotulo: `${o.municipio}/${o.uf}` })) : ufs.map((u) => ({ valor: u, rotulo: u }))
  const completo = f.data !== '' && f.nome.trim().length >= 2 && f.alvo !== ''
  const salvar = () =>
    enviar(async () => {
      const [uf, ibge] = f.alvo.split('|')
      await chamar('POST', `/empresas/${empresaId}/agenda/feriados`, { data: f.data, nome: f.nome.trim(), tipo: f.tipo, abrangencia: f.abrangencia, uf, codigoIbge: f.abrangencia === 'municipio' ? ibge : null })
      setF({ ...f, data: '', nome: '' })
      aoMudar()
      return 'Feriado cadastrado. Os prazos estão sendo recalculados.'
    })
  const remover = (id: string) => enviar(async () => { await chamar('DELETE', `/empresas/${empresaId}/agenda/feriados/${id}`); aoMudar() })
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6" aria-labelledby="h-fer">
      <h2 id="h-fer">Feriados próprios da empresa</h2>
      <Aviso texto={erro} />
      {ok ? <Aviso tipo="info" texto={ok} /> : null}
      {pode ? (
        c.orgaos.length === 0 ? <Vazio>Acompanhe um edital para cadastrar feriados do município ou do estado do órgão.</Vazio> : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
            <Campo rotulo="Data" type="date" value={f.data} onChange={(v) => setF({ ...f, data: v })} />
            <Campo rotulo="Nome" value={f.nome} onChange={(v) => setF({ ...f, nome: v })} maxLength={120} />
            <Selecao rotulo="Vale para" value={f.abrangencia} onChange={(v) => setF({ ...f, abrangencia: v, alvo: '' })} opcoes={[{ valor: 'municipio', rotulo: 'Município do órgão' }, { valor: 'uf', rotulo: 'Estado inteiro' }]} />
            <Selecao rotulo={f.abrangencia === 'municipio' ? 'Município' : 'Estado'} value={f.alvo} onChange={(v) => setF({ ...f, alvo: v })} vazio="Escolha" opcoes={alvos} />
            <Selecao rotulo="Tipo" value={f.tipo} onChange={(v) => setF({ ...f, tipo: v })} opcoes={[{ valor: 'feriado', rotulo: 'Feriado' }, { valor: 'ponto_facultativo', rotulo: 'Ponto facultativo' }]} />
          </div>
        )
      ) : null}
      {pode && c.orgaos.length > 0 ? <div><Botao carregando={enviando} disabled={!completo} onClick={() => void salvar()}>Cadastrar feriado</Botao></div> : null}
      {c.feriados.length === 0 ? <Vazio>Nenhum feriado próprio cadastrado.</Vazio> : (
        <ul className="flex flex-col divide-y divide-secondary overflow-hidden rounded-xl ring-1 ring-secondary">
          {c.feriados.map((x) => {
            const mun = c.orgaos.find((o) => o.codigoIbge === x.codigoIbge)?.municipio
            return (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><strong>{dataSP(`${x.data}T12:00:00-03:00`)}</strong> · <bdi>{x.nome}</bdi></span>
                <Etiqueta cor="cinza">{x.abrangencia === 'municipio' ? `${mun ?? x.codigoIbge}/${x.uf}` : `Estado ${x.uf}`}</Etiqueta>
                {x.tipo === 'ponto_facultativo' ? <Etiqueta cor="aviso">Ponto facultativo</Etiqueta> : null}
                {pode ? <Botao variante="texto" disabled={enviando} onClick={() => void remover(x.id)}>Remover</Botao> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
