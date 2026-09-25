import { defineConfig } from 'vitest/config';

// Tests de base de datos: ejecutan el DDL real de Prisma + prisma/sql/0001_constraints.sql
// sobre PGlite (PostgreSQL compilado a WebAssembly, en memoria). Ver DATABASE.md §10.
export default defineConfig({
  test: {
    include: ['test-db/**/*.test.ts'],
    globalSetup: ['test-db/global-setup.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
