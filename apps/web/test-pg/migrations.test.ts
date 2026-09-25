import { describe, expect, inject, it } from 'vitest';
import { prisma } from './global-setup';

describe('migraciones sobre PostgreSQL real', () => {
  it('prisma migrate deploy deja la base igual a schema.prisma (migrate diff vacío)', () => {
    // --exit-code: 0 = sin diferencias, 2 = hay diferencias (execFileSync lanza).
    const output = prisma(
      [
        'migrate',
        'diff',
        '--from-url',
        inject('pgUrl'),
        '--to-schema-datamodel',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      inject('pgUrl'),
    );
    expect(output).toMatch(/No difference detected/);
  });
});
