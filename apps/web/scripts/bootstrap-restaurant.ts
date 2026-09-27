/**
 * Inicializa un restaurante en la base de DATABASE_URL: dueño (usuario + membresía OWNER),
 * restaurante y política estándar v1 con sus puestos y porciones.
 * IDEMPOTENTE: correrlo otra vez no crea ni duplica nada. No crea personal ni períodos.
 * TODO O NADA: si algo falla, no queda nada creado.
 *
 * NO es un seed automático: no está registrado como `prisma db seed` (que `migrate dev/reset`
 * correrían solos) y se ejecuta únicamente a mano:
 *
 *   pnpm --filter @propinas/web db:bootstrap --confirm [--allow-remote]
 *
 * Datos (variables de entorno o apps/web/.env; nunca en el código):
 *   GUTIP_RESTAURANT_ID    uuid del restaurante
 *   GUTIP_RESTAURANT_NAME  nombre del restaurante
 *   GUTIP_OPERATOR_EMAIL   email del dueño (si ya existe ese usuario, se reutiliza: nunca se duplica)
 *   GUTIP_OPERATOR_NAME    nombre del dueño
 *
 * El usuario queda listo para Better Auth (misma tabla `users`) pero SIN contraseña: para poder
 * iniciar sesión se le define después con `db:operator-password` (se pide por teclado).
 * La aplicación ya no usa estas variables para autorizar: usa la sesión y las membresías.
 *
 * Protecciones: exige --confirm; se niega con NODE_ENV=production; contra una base que no sea
 * local (p. ej. Neon) exige además --allow-remote. Nunca imprime la URL ni el host.
 */
import { PrismaClient } from '@prisma/client';
import { bootstrapRestaurant } from '@/server/policy/service';
import { createStop, guardDatabaseScript, reportFailure } from './lib/cli';

const COMMAND = 'db:bootstrap';
const args = new Set(process.argv.slice(2));
const stop: (message: string) => never = createStop(COMMAND);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const { local } = guardDatabaseScript(
    args,
    stop,
    'para inicializar el restaurante (es idempotente)',
  );

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

  console.log(`${COMMAND}: base ${local ? 'local' : 'remota'}; restaurante ${input.restaurantId}`);
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
        ? `${COMMAND}: creado: ${made.join(', ')}. Política vigente: ${versionId}.`
        : `${COMMAND}: ya estaba inicializado; no se creó nada. Política vigente: ${versionId}.`,
    );
    const password = await db.account.count({
      where: { userId: result.value.userId, providerId: 'credential' },
    });
    if (password === 0) {
      console.log(
        `${COMMAND}: el dueño todavía no tiene contraseña. Definila con: pnpm --filter @propinas/web db:operator-password --confirm${local ? '' : ' --allow-remote'}`,
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch(reportFailure(COMMAND));
