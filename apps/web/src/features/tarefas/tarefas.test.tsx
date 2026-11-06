import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { BuscaRapida } from '../busca/BuscaRapida'
import { CentralDeTrabalho } from './CentralDeTrabalho'
import type { Tarefa } from './TarefasContexto'

const mocks = vi.hoisted(() => ({ dados: null as null | { itens: unknown[]; contagens: Record<string, number>; total: number }, carregando: false }))
vi.mock('./TarefasContexto', () => ({ useTarefas: () => ({ dados: mocks.dados, carregando: mocks.carregando, recarregar: () => undefined }) }))
vi.mock('../acesso/contexto', () => ({ useAcesso: () => ({ pode: (m: string) => m === 'relatorios' }) }))

const tarefa = (extra: Partial<Tarefa>): Tarefa => ({ id: 'x', modulo: 'agenda', nivel: 'atencao', titulo: 'Tarefa', detalhe: null, quando: null, link: '/agenda', ...extra })

describe('Central de trabalho', () => {
  it('lista as pendências com link direto e o resumo de urgentes', () => {
    mocks.dados = { itens: [tarefa({ id: 'a', nivel: 'urgente', titulo: 'Impugnação · Prefeitura', detalhe: 'Prazo VENCIDO', link: '/agenda/acompanhamentos/9' }), tarefa({ id: 'b', titulo: 'Aprovar peça: X', link: '/juridico/pecas/7' })], contagens: {}, total: 2 }
    render(<MemoryRouter><CentralDeTrabalho /></MemoryRouter>)
    expect(screen.getByText('1 urgente(s)')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Impugnação · Prefeitura/ }).getAttribute('href')).toBe('/agenda/acompanhamentos/9')
    expect(screen.getByRole('link', { name: /Aprovar peça: X/ }).getAttribute('href')).toBe('/juridico/pecas/7')
  })

  it('sem pendência diz que está tudo em dia; com mais de 12, avisa quantas faltam mostrar', () => {
    mocks.dados = { itens: [], contagens: {}, total: 0 }
    const { unmount } = render(<MemoryRouter><CentralDeTrabalho /></MemoryRouter>)
    expect(screen.getByText(/Tudo em dia/)).toBeTruthy()
    unmount()
    mocks.dados = { itens: Array.from({ length: 15 }, (_, i) => tarefa({ id: String(i), titulo: `Item ${String(i)}` })), contagens: {}, total: 20 }
    render(<MemoryRouter><CentralDeTrabalho /></MemoryRouter>)
    expect(screen.getAllByRole('link')).toHaveLength(12)
    expect(screen.getByText(/Mostrando 12 de 20/)).toBeTruthy()
  })
})

function Local() {
  const l = useLocation()
  return <p data-testid="local">{l.pathname}{l.search}</p>
}

describe('Busca rápida', () => {
  it('Enter leva à página de busca já com o termo; termo curto não navega; "/" foca o campo', async () => {
    const u = userEvent.setup()
    render(<MemoryRouter><BuscaRapida /><Routes><Route path="*" element={<Local />} /></Routes></MemoryRouter>)
    const campo = screen.getByRole('searchbox')
    await u.keyboard('/')
    expect(document.activeElement).toBe(campo)
    await u.type(campo, 'a{Enter}')
    expect(screen.getByTestId('local').textContent).toBe('/')
    await u.clear(campo)
    await u.type(campo, 'rio branco{Enter}')
    expect(screen.getByTestId('local').textContent).toBe('/busca?q=rio%20branco')
  })
})
