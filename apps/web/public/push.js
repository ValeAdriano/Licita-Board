// Web Push (ADR-018): importado pelo service worker gerado (vite.config.ts, workbox.importScripts).
// O push só traz um aviso genérico: título e texto curtos, sem dado da notificação. Para onde o clique
// leva NÃO vem do payload: é sempre o caminho fixo abaixo, no próprio app (sem redirecionamento aberto).
const DESTINO = '/notificacoes'

self.addEventListener('push', (event) => {
  let dados = {}
  try {
    dados = event.data ? event.data.json() : {}
  } catch {
    dados = {}
  }
  const texto = (v, padrao, max) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : padrao)
  event.waitUntil(
    self.registration.showNotification(texto(dados.titulo, 'VV Licitações', 80), {
      body: texto(dados.corpo, 'Você tem uma nova notificação.', 160),
      tag: texto(dados.tag, 'vv-notificacao', 80),
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if (new URL(janela.url).origin === self.location.origin && 'focus' in janela) {
          // navigate falha em janela não controlada (ou perde o que está em edição): cai para abrir uma nova.
          return janela
            .navigate(DESTINO)
            .then((j) => (j ?? janela).focus())
            .catch(() => self.clients.openWindow(DESTINO))
        }
      }
      return self.clients.openWindow(DESTINO)
    }),
  )
})
