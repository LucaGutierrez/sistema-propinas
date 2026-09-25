import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    /** DDL que Prisma generaría para prisma/schema.prisma (sin conectarse a ninguna base). */
    ddl: string;
  }
}

/**
 * Genera una sola vez el DDL a partir de schema.prisma con la CLI de Prisma
 * (`migrate diff --from-empty --to-schema-datamodel`). Así los tests nunca duplican
 * la definición de tablas: si cambia el esquema, cambia lo que se prueba.
 */
export default function setup(project: TestProject): void {
  const webDir = fileURLToPath(new URL('..', import.meta.url));
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

  const ddl = execFileSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    {
      cwd: webDir,
      encoding: 'utf8',
      // validate/diff no se conectan a la base; la URL solo tiene que existir.
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? 'postgresql://user:password@localhost:5432/propinas',
      },
    },
  );

  if (!ddl.includes('CREATE TABLE "daily_distributions"')) {
    throw new Error('Prisma did not generate the expected DDL; check prisma/schema.prisma');
  }
  project.provide('ddl', ddl);
}
