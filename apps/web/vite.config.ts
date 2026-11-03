/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Front do VV Licitações (ADR-018). Em dev, /api vai para a API local na mesma origem: o cookie de
// sessão (__Host-, SameSite=Strict) e o CSRF funcionam como em produção (Caddy), sem CORS.
const API_DEV = process.env.VV_API_DEV_URL ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [
    react(),
    // PWA: o service worker guarda só os arquivos do app (shell). Resposta da API (dado das
    // empresas) nunca vai para o cache: sem runtimeCaching.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registro em main.tsx (virtual:pwa-register): atualiza e recarrega sozinho
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'VV Licitações',
        short_name: 'VV Licitações',
        description: 'Gestão de licitações públicas: agenda, prazos, documentos e propostas.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0071e3',
        background_color: '#f5f5f7',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: 'localhost',
    port: 5173,
    proxy: { '/api': { target: API_DEV, changeOrigin: false, xfwd: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
})
