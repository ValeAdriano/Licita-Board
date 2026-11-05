import { Link } from 'react-router'
import { Aviso, Botao, Etiqueta, Legenda } from '../../ui'
import { useAcesso } from '../acesso/contexto'
import { useGet } from '../acesso/useGet'
import { reais } from '../precos/formato'
import { BannerFontes } from '../pesquisa/BannerFontes'

interface Indicadores {
  hoje: string; oportunidadesNovas: number | null; disputasFuturas: number | null; propostasPendentes: number | null; analisesPendentes: number | null
  prazosJuridicosAbertos: number | null; prazosJuridicosVencidos: number | null; documentosVencendo: number | null; documentosVencidos: number | null
  licitacoesGanhas: number | null; valorGanho: string | null; contratosAtivos: number | null; entregasPendentes: number | null; valoresAReceber: string | null
}
interface Comercial { participacoes: number; vitorias: number; derrotas: number; taxaSucessoPct: string | null; valorDisputado: string; valorGanho: string; motivos: { motivo: string; total: number }[]; produtos: { produto: string; total: number }[]; orgaos: { orgao: string; total: number }[] }

function Cartao({ titulo, valor, to, alerta }: { titulo: string; valor: string; to: string; alerta?: boolean }) {
  return (
    <Link to={to} className="flex flex-col gap-1 rounded-xl bg-primary p-4 no-underline shadow-xs ring-1 ring-secondary hover:bg-primary_hover">
      <span className="text-sm text-tertiary">{titulo}</span>
      <strong className={`text-2xl ${alerta ? 'text-error-primary' : 'text-primary'}`}>{valor}</strong>
    </Link>
  )
}

// Painel da empresa (Fase 12): cada número vem direto dos registros e só aparece para quem tem a permissão do módulo de origem.
export function Painel({ empresaId }: { empresaId: string }) {
  const { pode } = useAcesso()
  const ind = useGet<Indicadores>(pode('agenda', 'visualizar') ? `/empresas/${empresaId}/dashboard` : null)
  const com = useGet<Comercial>(pode('agenda', 'visualizar') ? `/empresas/${empresaId}/relatorios/comercial` : null)
  if (!pode('agenda', 'visualizar')) return null
  if (ind.erro) return <Aviso texto={ind.erro} />
  const d = ind.dados
  if (!d) return <p className="text-sm text-tertiary">Carregando o painel…</p>
  const n = (v: number | null) => (v === null ? null : String(v))
  const cartoes: { titulo: string; valor: string | null; to: string; alerta?: boolean }[] = [
    { titulo: 'Novas oportunidades', valor: n(d.oportunidadesNovas), to: '/oportunidades' },
    { titulo: 'Disputas futuras', valor: n(d.disputasFuturas), to: '/agenda?aba=acompanhados' },
    { titulo: 'Propostas pendentes', valor: n(d.propostasPendentes), to: '/agenda?aba=acompanhados' },
    { titulo: 'Análises técnicas pendentes', valor: n(d.analisesPendentes), to: '/agenda?aba=acompanhados' },
    { titulo: 'Prazos jurídicos abertos', valor: n(d.prazosJuridicosAbertos), to: '/agenda?aba=prazos' },
    { titulo: 'Prazos jurídicos vencidos', valor: n(d.prazosJuridicosVencidos), to: '/agenda?aba=prazos', alerta: (d.prazosJuridicosVencidos ?? 0) > 0 },
    { titulo: 'Certidões vencendo (30 dias)', valor: n(d.documentosVencendo), to: '/cadastros' },
    { titulo: 'Documentos vencidos', valor: n(d.documentosVencidos), to: '/cadastros', alerta: (d.documentosVencidos ?? 0) > 0 },
    { titulo: 'Licitações ganhas', valor: n(d.licitacoesGanhas), to: '/agenda?aba=resultados' },
    { titulo: 'Valor ganho', valor: d.valorGanho === null ? null : reais(d.valorGanho), to: '/agenda?aba=resultados' },
    { titulo: 'Contratos ativos', valor: n(d.contratosAtivos), to: '/contratos' },
    { titulo: 'Entregas pendentes', valor: n(d.entregasPendentes), to: '/contratos' },
    { titulo: 'Valores a receber', valor: d.valoresAReceber === null ? null : reais(d.valoresAReceber), to: '/contratos' },
  ]
  const c = com.dados
  return (
    <section className="flex flex-col gap-4" aria-label="Painel">
      {pode('editais', 'visualizar') ? <BannerFontes /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.filter((x): x is { titulo: string; valor: string; to: string; alerta?: boolean } => x.valor !== null).map((x) => <Cartao key={x.titulo} {...x} />)}
      </div>
      {c ? (
        <div className="flex flex-col gap-3 rounded-xl bg-primary p-4 shadow-xs ring-1 ring-secondary md:p-6">
          <div className="flex flex-wrap items-center gap-3"><h2 className="min-w-0 flex-1">Resultado comercial</h2>
            {pode('agenda', 'exportar') ? <Botao variante="secundario" onClick={() => window.location.assign(`/api/empresas/${empresaId}/relatorios/resultados.csv`)}>Exportar resultados (CSV)</Botao> : null}</div>
          <div className="flex flex-wrap items-center gap-2"><Etiqueta cor="marca">{c.participacoes} participação(ões)</Etiqueta><Etiqueta cor="sucesso">{c.vitorias} vitória(s)</Etiqueta><Etiqueta cor="erro">{c.derrotas} derrota(s)</Etiqueta>
            <Etiqueta cor="cinza">Taxa de sucesso {c.taxaSucessoPct === null ? '—' : `${c.taxaSucessoPct.replace('.', ',')}%`}</Etiqueta></div>
          <Legenda>Valor disputado {reais(c.valorDisputado)} · valor ganho {reais(c.valorGanho)}. Taxa = vitórias ÷ (vitórias + derrotas), só com resultado registrado.</Legenda>
          {c.motivos.length ? <Legenda>Motivos de perda: {c.motivos.map((m) => `${m.motivo} (${m.total})`).join(' · ')}</Legenda> : null}
          {c.produtos.length ? <Legenda>Mais ofertados: {c.produtos.map((p) => `${p.produto} (${p.total})`).join(' · ')}</Legenda> : null}
          {c.orgaos.length ? <Legenda>Órgãos onde mais ganhamos: {c.orgaos.map((o) => `${o.orgao} (${o.total})`).join(' · ')}</Legenda> : null}
        </div>
      ) : null}
    </section>
  )
}
