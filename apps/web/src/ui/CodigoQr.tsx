import { useMemo } from 'react'
import QRCode from 'qrcode'

// QR code desenhado em SVG (sem imagem `data:` nem estilo inline: a CSP do app só aceita arquivos próprios).
// Gerado no navegador; o conteúdo (por exemplo o otpauth:// do autenticador) nunca vai para outro lugar.
export function CodigoQr({ valor, rotulo }: { valor: string; rotulo: string }) {
  const { tamanho, caminho } = useMemo(() => {
    const qr = QRCode.create(valor, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    let d = ''
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) d += `M${x + 4},${y + 4}h1v1h-1z`
    return { tamanho: n + 8, caminho: d } // 4 módulos de margem, como manda a especificação
  }, [valor])
  return (
    <svg role="img" aria-label={rotulo} viewBox={`0 0 ${tamanho} ${tamanho}`} shapeRendering="crispEdges" className="mx-auto size-52 rounded-lg bg-qr-background shadow-xs ring-1 ring-secondary">
      <path d={caminho} className="fill-qr-foreground" />
    </svg>
  )
}
