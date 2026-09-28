'use client';

import { useMemo } from 'react';
import { addStaff, setStaffActive, setStaffPosition } from '@/lib/demo-store/model';
import { currentVersion } from '@/lib/demo-store/policy';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import type { StaffActions, StaffView as StaffViewModel } from '@/lib/staff/view';
import { StaffView } from './staff-view';

/** "Personal" con los datos de la demo (navegador). */
export function DemoStaffManager() {
  const { venue, perms, apply } = useDemoStore();

  const view = useMemo<StaffViewModel | null>(() => {
    if (!venue) return null;
    const current = currentVersion(venue.policy);
    return {
      venueName: venue.name,
      policyVersion: current.number,
      positions: current.positions.map(({ id, name, factor }) => ({ id, name, factor })),
      members: venue.staff.map(({ id, name, positionId, active }) => ({
        id,
        name,
        positionId,
        active,
      })),
      canEdit: perms.manageStaff,
    };
  }, [venue, perms.manageStaff]);

  const actions: StaffActions = {
    add: async (name, positionId) =>
      apply((s) => addStaff(s, { id: newId('persona'), name, positionId })),
    setPosition: async (memberId, positionId) =>
      apply((s) => setStaffPosition(s, memberId, positionId)),
    setActive: async (memberId, active) => apply((s) => setStaffActive(s, memberId, active)),
  };

  return <StaffView view={view} actions={actions} />;
}
