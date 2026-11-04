/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Só o que pode ser público entra aqui: tudo que é VITE_* vai para o bundle (apps/web/AGENTS.md).
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_VV_ENV?: string
  readonly VITE_CADASTRO_ABERTO?: string
  readonly VITE_TURNSTILE_SITEKEY?: string
}
