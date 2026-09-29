'use client';

import { useMemo } from 'react';
import { currentVersion } from '@/lib/demo-store/policy';
import { addPosition, setConfigValue, setPositionFactor } from '@/lib/demo-store/policy-ops';
import { newId, useDemoStore } from '@/lib/demo-store/store';
import type { DistributionConfigActions, DistributionConfigView } from '@/lib/policy/view';
import { DistributionConfigView as View } from './distribution-config-view';

/** "Configuración de distribución" con los datos de la demo (navegador). */
export function DemoDistributionConfig() {
  const { venue, perms, viewAs, apply } = useDemoStore();

  const view = useMemo<DistributionConfigView | null>(() => {
    if (!venue) return null;
    const closedBy = (number: number) =>
      venue.weeks.filter((w) => w.status === 'CERRADA' && w.result?.policyVersion === number)
        .length;
    const versions = [...venue.policy.versions]
      .sort((a, b) => b.number - a.number)
      .map((v) => ({ ...v, closedPeriods: closedBy(v.number) }));
    const current = currentVersion(venue.policy);
    const peopleByPosition: Record<string, number> = {};
    for (const s of venue.staff) {
      if (s.active) peopleByPosition[s.positionId] = (peopleByPosition[s.positionId] ?? 0) + 1;
    }
    return {
      source: 'demo',
      venueName: venue.name,
      current: { ...current, closedPeriods: closedBy(current.number) },
      versions,
      peopleByPosition,
      // La demo muestra las porciones como decimal (la preferencia es de la base).
      portionDisplay: 'DECIMAL',
      canEdit: perms.configureDistribution,
    };
  }, [venue, perms.configureDistribution]);

  const by = viewAs?.name ?? 'Encargado';
  const now = () => new Date().toISOString();
  const actions: DistributionConfigActions = {
    setValue: async (key, value) => apply((v) => setConfigValue(v, key, value, by, now())),
    addPosition: async (name, factor) =>
      apply((v) => addPosition(v, { id: newId('puesto'), name, factor }, by, now())),
    setPortion: async (positionId, factor) =>
      apply((v) => setPositionFactor(v, positionId, factor, by, now())),
  };

  return <View view={view} actions={actions} />;
}
