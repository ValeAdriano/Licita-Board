import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CodigoQr } from './CodigoQr'

const URI = 'otpauth://totp/VV%20Licita%C3%A7%C3%B5es:pessoa@exemplo.com?secret=JBSWY3DPEHPK3PXP&issuer=VV%20Licita%C3%A7%C3%B5es'

describe('CodigoQr', () => {
  it('desenha o QR em SVG (sem imagem data: nem estilo inline, por causa da CSP)', () => {
    render(<CodigoQr valor={URI} rotulo="QR do autenticador" />)
    const svg = screen.getByRole('img', { name: 'QR do autenticador' })
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('style')).toBeNull()
    const d = svg.querySelector('path')?.getAttribute('d') ?? ''
    expect((d.match(/M/g) ?? []).length).toBeGreaterThan(200) // centenas de módulos escuros
    const lado = Number(svg.getAttribute('viewBox')?.split(' ')[2])
    expect(lado).toBeGreaterThanOrEqual(29 + 8) // versão 3 (29) ou maior, mais a margem
  })

  it('conteúdos diferentes geram desenhos diferentes', () => {
    const { container, rerender } = render(<CodigoQr valor={URI} rotulo="qr" />)
    const a = container.querySelector('path')?.getAttribute('d')
    rerender(<CodigoQr valor={URI.replace('JBSWY3DPEHPK3PXP', 'GEZDGNBVGY3TQOJQ')} rotulo="qr" />)
    expect(container.querySelector('path')?.getAttribute('d')).not.toBe(a)
  })
})
