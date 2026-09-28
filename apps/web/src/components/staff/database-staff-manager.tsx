'use client';

import {
  addStaffAction,
  setStaffActiveAction,
  setStaffPositionAction,
} from '@/app/personal/actions';
import type { StaffActions, StaffView as StaffViewModel } from '@/lib/staff/view';
import { StaffView } from './staff-view';

const actions: StaffActions = {
  add: addStaffAction,
  setPosition: setStaffPositionAction,
  setActive: setStaffActiveAction,
};

/**
 * "Personal" con los datos de la base. La página (servidor) arma la vista; cada cambio es una
 * acción del servidor que, al terminar, vuelve a renderizar la página.
 */
export function DatabaseStaffManager({ view }: { view: StaffViewModel }) {
  return <StaffView view={view} actions={actions} />;
}
