/**
 * Define la contraseña del dueño que creó db:bootstrap (GUTIP_OPERATOR_EMAIL) para que pueda
 * iniciar sesión con Better Auth. NO crea usuarios: si el email no existe, no hace nada.
 *
 *   pnpm --filter @propinas/web db:operator-password --confirm [--allow-remote] [--reset]
 *
 * La contraseña se pide por teclado (sin mostrarla) y se confirma; también se puede pasar por
 * stdin (una línea). Nunca va en argumentos, variables de entorno ni en la salida.
 * Solo se guarda su hash (scrypt, el mismo de Better Auth) en `accounts`.
 * Si el usuario ya tiene contraseña, exige --reset; al reemplazarla cierra todas sus sesiones.
 *
 * Protecciones: exige --confirm; se niega con NODE_ENV=production; contra una base que no sea
 * local (p. ej. Neon) exige además --allow-remote. Nunca imprime la URL ni el host.
 */
import { PrismaClient } from '@prisma/client';
import { MIN_PASSWORD_LENGTH } from '@/server/auth/auth';
import { setCredentialPassword } from '@/server/auth/credentials';
import { createStop, guardDatabaseScript, reportFailure } from './lib/cli';

const COMMAND = 'db:operator-password';
const args = new Set(process.argv.slice(2));
const stop: (message: string) => never = createStop(COMMAND);

/** Lee una línea sin eco (teclado) o la primera línea de stdin (si viene de un pipe). */
async function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  process.stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (finish: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      finish();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value));
        if (ch === '\u0003') return done(() => reject(new Error('cancelado')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const { local } = guardDatabaseScript(args, stop, 'para definir la contraseña del dueño');
  const email = process.env.GUTIP_OPERATOR_EMAIL?.trim() ?? '';
  if (!email.includes('@')) stop('falta GUTIP_OPERATOR_EMAIL.');

  console.log(`${COMMAND}: base ${local ? 'local' : 'remota'}; usuario de GUTIP_OPERATOR_EMAIL`);
  const password = await readSecret(
    `Contraseña nueva (mínimo ${MIN_PASSWORD_LENGTH} caracteres): `,
  );
  if (process.stdin.isTTY) {
    const again = await readSecret('Repetila: ');
    if (again !== password) stop('las contraseñas no coinciden; no se cambió nada.');
  }

  const db = new PrismaClient();
  try {
    const result = await setCredentialPassword(db, email, password, {
      reset: args.has('--reset'),
    });
    if (!result.ok) stop(result.error);
    console.log(
      result.value.created
        ? `${COMMAND}: contraseña definida. Ya se puede iniciar sesión en /login.`
        : `${COMMAND}: contraseña reemplazada; se cerraron ${result.value.revokedSessions} sesiones.`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch(reportFailure(COMMAND));
