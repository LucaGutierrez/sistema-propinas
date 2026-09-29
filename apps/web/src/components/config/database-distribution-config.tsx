'use client';

import {
  addPositionAction,
  setPolicyValueAction,
  setPortionAction,
  setPortionDisplayAction,
} from '@/app/configuracion/actions';
import type { DistributionConfigActions, DistributionConfigView } from '@/lib/policy/view';
import { DistributionConfigView as View } from './distribution-config-view';

const actions: DistributionConfigActions = {
  setValue: setPolicyValueAction,
  addPosition: addPositionAction,
  setPortion: setPortionAction,
  setPortionDisplay: setPortionDisplayAction,
};

/**
 * "Configuración de distribución" con los datos de la base. La página (servidor) lee la política
 * y la pasa ya armada; cada cambio es una acción del servidor que, al terminar, vuelve a
 * renderizar la página con la versión nueva.
 */
export function DatabaseDistributionConfig({ view }: { view: DistributionConfigView }) {
  return <View view={view} actions={actions} />;
}
