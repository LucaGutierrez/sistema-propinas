/**
 * Sesión del pedido actual (Server Components, Server Actions, Route Handlers).
 * La identidad sale SIEMPRE de la cookie de sesión validada por Better Auth contra `sessions`;
 * nunca de datos que mande el navegador.
 */
import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth, type Auth } from './auth';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/** Usuario de una sesión válida para esos encabezados, o null. */
export async function sessionUserFrom(
  auth: Auth,
  requestHeaders: Headers,
): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, email, name } = session.user;
  return { id, email, name };
}

/**
 * Usuario con sesión en este pedido, o null si no hay sesión (o venció / fue revocada).
 * Memoizado POR PEDIDO (`cache` de React): el layout y la página comparten la misma consulta.
 * No se guarda nada entre pedidos: cada pedido nuevo vuelve a validar la sesión en la base.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  return sessionUserFrom(getAuth(), await headers());
});
