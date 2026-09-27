import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests contra un PostgreSQL real (TEST_DATABASE_URL): migraciones y concurrencia, lo que PGlite
// no puede probar (una sola conexión). Ver DATABASE.md §10.
export default defineConfig({
  // Los tests de servicios importan la aplicación con el mismo alias que Next (`@/…`).
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['test-pg/**/*.test.ts'],
    globalSetup: ['test-pg/global-setup.ts'],
    environment: 'node',
    // Un archivo a la vez: los tests abren varias conexiones y esperan bloqueos entre ellas.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
