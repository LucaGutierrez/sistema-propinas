/**
 * Reglas del registro público (/registro → POST /api/auth/sign-up/email de Better Auth).
 *
 * El registro SOLO crea la cuenta (usuario + contraseña). No crea restaurantes ni membresías y no
 * acepta roles: el primer restaurante se crea después (/crear-restaurante) y quien lo crea queda
 * como OWNER. Email (formato, minúsculas) y contraseña (largo) los valida Better Auth con la misma
 * configuración que el login.
 *
 * Esta validación corre ANTES de que Better Auth busque el email, así el resultado es el mismo
 * exista o no la cuenta (no permite averiguar qué emails están registrados).
 */

export const MAX_SIGN_UP_NAME = 80;

/** Campos que acepta el registro; cualquier otro (image, role, restaurantId…) se rechaza. */
const ALLOWED_FIELDS = new Set(['name', 'email', 'password', 'rememberMe', 'callbackURL']);

/** Mensaje de error del cuerpo del registro, o null si es válido. */
export function signUpBodyError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return 'Datos inválidos.';
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_FIELDS.has(key))) return 'Datos inválidos.';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name === '') return 'Poné tu nombre.';
  if (name.length > MAX_SIGN_UP_NAME) {
    return `El nombre puede tener hasta ${MAX_SIGN_UP_NAME} caracteres.`;
  }
  return null;
}
