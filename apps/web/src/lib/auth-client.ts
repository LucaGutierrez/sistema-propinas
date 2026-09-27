/**
 * Cliente de Better Auth para el navegador: habla con /api/auth (mismo origen). Iniciar y cerrar
 * sesión pasan por las rutas HTTP de Better Auth para que apliquen su límite de intentos y su
 * control de origen. La cookie de sesión es httpOnly: este código nunca la lee ni la guarda.
 */
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient();
