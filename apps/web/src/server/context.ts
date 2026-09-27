/**
 * Fuente de datos de las pantallas que ya tienen persistencia real.
 *
 *   GUTIP_DATA_SOURCE=database   la pantalla usa la base con sesión (Better Auth) y membresías
 *   (sin definir)                la pantalla usa la demo del navegador y no toca la base
 *
 * La identidad y el restaurante YA NO salen de variables de entorno: los resuelve
 * `server/access` (sesión real + memberships). GUTIP_OPERATOR_EMAIL / GUTIP_RESTAURANT_ID solo
 * los usa db:bootstrap para inicializar un restaurante.
 */
export function databaseEnabled(): boolean {
  return process.env.GUTIP_DATA_SOURCE === 'database';
}
