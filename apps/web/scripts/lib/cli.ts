/**
 * Protecciones comunes de los scripts de base de datos que se corren a mano:
 * exigen --confirm, se niegan con NODE_ENV=production y, contra una base que no sea local
 * (p. ej. Neon), exigen además --allow-remote. Nunca imprimen la URL ni el host.
 */
import { existsSync } from 'node:fs';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function createStop(command: string): (message: string) => never {
  return (message) => {
    console.error(`${command}: ${message}`);
    process.exit(1);
  };
}

/** Carga apps/web/.env (sin pisar variables ya definidas) y aplica las protecciones. */
export function guardDatabaseScript(
  args: ReadonlySet<string>,
  stop: (message: string) => never,
  confirmHint: string,
): { local: boolean } {
  if (existsSync('.env')) process.loadEnvFile('.env');

  if (process.env.NODE_ENV === 'production') stop('no se ejecuta con NODE_ENV=production.');
  if (!args.has('--confirm')) stop(`no se ejecutó: agregá --confirm ${confirmHint}.`);

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
  return { local };
}

/** Error inesperado: el mensaje de Prisma puede incluir el host, se muestra solo el tipo. */
export function reportFailure(command: string): (error: unknown) => never {
  return (error) => {
    const name = error instanceof Error ? error.name : 'Error';
    console.error(`${command}: falló (${name}). Revisá la conexión y los datos.`);
    process.exit(1);
  };
}
