import { LoadingState } from '@/components/gutip/loading';

/**
 * Mientras el servidor arma la pantalla (sesión + datos de la base), se muestra un esqueleto en
 * lugar de dejar la pantalla anterior quieta: el clic siempre tiene una respuesta visible.
 */
export default function Loading() {
  return <LoadingState />;
}
