/**
 * Cliente Prisma del servidor (uno por proceso; en desarrollo se reutiliza entre recargas).
 * Solo lo importan módulos de `src/server` y las acciones del servidor: nunca un componente.
 * La conexión sale de DATABASE_URL (variable de entorno); no hay URLs en el código.
 */
import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

const globalForPrisma = globalThis as unknown as { gutipPrisma?: PrismaClient };

export function getDb(): PrismaClient {
  globalForPrisma.gutipPrisma ??= new PrismaClient();
  return globalForPrisma.gutipPrisma;
}
