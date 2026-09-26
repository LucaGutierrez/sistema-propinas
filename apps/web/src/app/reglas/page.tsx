import { redirect } from 'next/navigation';

/** "Reglas de cálculo" pasó a ser la configuración de distribución de cada local. */
export default function RulesRedirect() {
  redirect('/configuracion');
}
