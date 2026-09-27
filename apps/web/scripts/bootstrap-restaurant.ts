/**
 * Inicializa un restaurante de desarrollo en la base de DATABASE_URL: operador (usuario +
 * membresía OWNER), restaurante y política estándar v1 con sus puestos y porciones.
 * IDEMPOTENTE: correrlo otra vez no crea ni duplica nada. No crea personal ni períodos.
 *
 * NO es un seed automático: no está registrado como `prisma db seed` (que `migrate dev/reset`
 * correrían solos) y se ejecuta únicamente a mano:
 *
 *   pnpm --filter @propinas/web db:bootstrap --confirm [--allow-remote]
 *
 * Datos (variables de entorno o apps/web/.env; nunca en el código):
 *   GUTIP_RESTAURANT_ID    uuid del restaurante (el mismo que usa la app en GUTIP_RESTAURANT_ID)
 *   GUTIP_RESTAURANT_NAME  nombre del restaurante
 *   GUTIP_OPERATOR_EMAIL   email del usuario operador (el mismo que GUTIP_OPERATOR_EMAIL)
 *   GUTIP_OPERATOR_NAME    nombre del operador
 *
 * Protecciones: exige --confirm; se niega con NODE_ENV=production; contra una base que no sea
 * local (p. ej. Neon) exige además --allow-remote. Nunca imprime la URL ni el host.
 */
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { bootstrapRestaurant } from '@/server/policy/service';

const args = new Set(process.argv.slice(2));
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function stop(message: string): never {
  console.error(`db:bootstrap: ${message}`);
  process.exit(1);
}

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env'); // no pisa variables ya definidas

  if (process.env.NODE_ENV === 'production') stop('no se ejecuta con NODE_ENV=production.');
  if (!args.has('--confirm')) {
    stop('no se ejecutó: agregá --confirm para inicializar el restaurante (es idempotente).');
  }

  const url = process.env.DATABASE_URL;
  if (!url) stop('falta DATABASE_URL.');
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    stop('DATABASE_URL no es una URL válida.');
  }
  const local = LOCAL_HOSTS.has(host);
  if (!local && !args.has('--allow-remote')) {
    stop(
      'DATABASE_URL apunta a una base remota (no local). Si es lo que querés, agregá --allow-remote.',
    );
  }

  const input = {
    restaurantId: process.env.GUTIP_RESTAURANT_ID?.trim() ?? '',
    restaurantName: process.env.GUTIP_RESTAURANT_NAME?.trim() ?? '',
    operatorEmail: process.env.GUTIP_OPERATOR_EMAIL?.trim() ?? '',
    operatorName: process.env.GUTIP_OPERATOR_NAME?.trim() ?? '',
  };
  if (!UUID.test(input.restaurantId)) stop('GUTIP_RESTAURANT_ID tiene que ser un uuid.');
  if (!input.restaurantName) stop('falta GUTIP_RESTAURANT_NAME.');
  if (!input.operatorEmail) stop('falta GUTIP_OPERATOR_EMAIL.');
  if (!input.operatorName) stop('falta GUTIP_OPERATOR_NAME.');

  console.log(
    `db:bootstrap: base ${local ? 'local' : 'remota'}; restaurante ${input.restaurantId}`,
  );
  const db = new PrismaClient();
  try {
    const result = await bootstrapRestaurant(db, input);
    if (!result.ok) stop(result.error);
    const { created, versionId } = result.value;
    const made = Object.entries(created)
      .filter(([, done]) => done)
      .map(([what]) => what);
    console.log(
      made.length > 0
        ? `db:bootstrap: creado: ${made.join(', ')}. Política vigente: ${versionId}.`
        : `db:bootstrap: ya estaba inicializado; no se creó nada. Política vigente: ${versionId}.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // El mensaje de Prisma puede incluir el host: se muestra solo el tipo de error.
  const name = error instanceof Error ? error.name : 'Error';
  console.error(`db:bootstrap: falló (${name}). Revisá la conexión y los datos.`);
  process.exit(1);
});
