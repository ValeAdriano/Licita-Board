import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC no lugar do esbuild: o NestJS precisa de emitDecoratorMetadata para a injeção de dependência.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts'] } },
      // e2e com Postgres real: DATABASE_URL_TEST aponta para um banco com db/migrations (papel vv_api).
      { extends: true, test: { name: 'e2e', include: ['test/**/*.e2e-spec.ts'] } },
    ],
  },
});
