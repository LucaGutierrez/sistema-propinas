import { describe, expect, it } from 'vitest';
import {
  ID,
  closeSettlement,
  event,
  markDelivered,
  markPrepared,
  payment,
  revertDelivery,
  settlement,
  useDatabase,
  uuid,
  voidSettlement,
} from './helpers';

const db = useDatabase();

const S1 = uuid(300);
const S2 = uuid(301);
const PAY1 = uuid(400);
const PAY2 = uuid(401);

const closedSettlement = settlement(S1) + closeSettlement(S1);

describe('liquidación semanal: CHECK y unicidad', () => {
  it('la semana termina exactamente 6 días después de empezar', async () => {
    await db.fails(settlement(S1, { end: '2026-09-28' }), /ck_weekly_settlements_week/);
    await db.fails(settlement(S1, { end: '2026-09-26' }), /ck_weekly_settlements_week/);
    await db.exec(settlement(S1));
  });

  it('la revisión es >= 1', async () => {
    await db.fails(settlement(S1, { revision: 0 }), /ck_weekly_settlements_revision/);
  });

  it('cerrar exige totales, fecha y usuario', async () => {
    await db.exec(settlement(S1));
    await db.fails(
      `UPDATE weekly_settlements SET status = 'CLOSED', closed_at = now(), closed_by = '${ID.U1}' WHERE id = '${S1}';`,
      /ck_weekly_settlements_closed/,
    );
  });

  it('total final = total - adelantos', async () => {
    await db.exec(settlement(S1));
    await db.fails(
      `UPDATE weekly_settlements SET total_cents = 1000, total_advances_cents = 100, total_final_cents = 1000 WHERE id = '${S1}';`,
      /ck_weekly_settlements_totals/,
    );
  });

  it('anular exige quién, cuándo y un motivo de al menos 10 caracteres', async () => {
    await db.exec(closedSettlement);
    await db.fails(voidSettlement(S1, 'oops'), /ck_weekly_settlements_voided/);
    await db.exec(voidSettlement(S1));
  });

  it('una sola liquidación vigente por semana (aunque cambie la revisión)', async () => {
    await db.exec(settlement(S1));
    await db.fails(settlement(S2, { revision: 2 }), /ux_weekly_settlements_active/);
  });

  it('no se repite la combinación restaurante + semana + revisión', async () => {
    await db.exec(settlement(S1));
    await db.fails(settlement(S2), /weekly_settlements_restaurant_id_week_start_revision_key/);
  });

  it('tras anular, la semana se puede re-liquidar como revisión 2 apuntando a la anulada', async () => {
    await db.exec(closedSettlement + voidSettlement(S1));
    await db.exec(settlement(S2, { revision: 2, supersedes: S1 }));
  });

  it('una liquidación solo puede ser reemplazada una vez', async () => {
    await db.exec(
      closedSettlement + voidSettlement(S1) + settlement(S2, { revision: 2, supersedes: S1 }),
    );
    await db.fails(
      settlement(uuid(302), {
        start: '2026-09-28',
        end: '2026-10-04',
        revision: 3,
        supersedes: S1,
      }),
      /weekly_settlements_supersedes_settlement_id_key/,
    );
  });
});

describe('liquidación semanal: estados e inmutabilidad', () => {
  it('OPEN -> CLOSED, OPEN -> VOIDED y CLOSED -> VOIDED están permitidos', async () => {
    await db.exec(settlement(S1) + closeSettlement(S1) + voidSettlement(S1));
    await db.exec(settlement(S2, { start: '2026-09-28', end: '2026-10-04' }) + voidSettlement(S2));
  });

  it('una CLOSED no vuelve a OPEN', async () => {
    await db.exec(closedSettlement);
    await db.fails(
      `UPDATE weekly_settlements SET status = 'OPEN' WHERE id = '${S1}';`,
      /INVALID_TRANSITION/,
    );
  });

  it('una VOIDED es terminal', async () => {
    await db.exec(closedSettlement + voidSettlement(S1));
    await db.fails(
      `UPDATE weekly_settlements SET status = 'CLOSED' WHERE id = '${S1}';`,
      /(INVALID_TRANSITION|IMMUTABLE)/,
    );
    await db.fails(
      `UPDATE weekly_settlements SET status = 'OPEN' WHERE id = '${S1}';`,
      /(INVALID_TRANSITION|IMMUTABLE)/,
    );
  });

  it('una CLOSED no puede cambiar su período, revisión ni totales', async () => {
    await db.exec(closedSettlement);
    const immutable = /IMMUTABLE: a CLOSED settlement/;
    await db.fails(
      `UPDATE weekly_settlements SET total_cents = 5, total_final_cents = 5 WHERE id = '${S1}';`,
      immutable,
    );
    await db.fails(
      `UPDATE weekly_settlements SET week_start = '2026-09-28', week_end = '2026-10-04' WHERE id = '${S1}';`,
      immutable,
    );
    await db.fails(`UPDATE weekly_settlements SET revision = 2 WHERE id = '${S1}';`, immutable);
  });

  it('una liquidación no se borra', async () => {
    await db.exec(settlement(S1));
    await db.fails(`DELETE FROM weekly_settlements WHERE id = '${S1}';`, /cannot be deleted/);
  });

  it('no se puede anular con un sobre ya ENTREGADO', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1, { status: 'DELIVERED' }));
    await db.fails(voidSettlement(S1), /cannot void a settlement with DELIVERED payments/);
  });

  it('sí se puede anular con sobres PENDING o PREPARED', async () => {
    await db.exec(
      closedSettlement +
        payment(PAY1, S1, { status: 'PENDING' }) +
        payment(PAY2, S1, { employee: ID.E2, status: 'PREPARED' }) +
        voidSettlement(S1),
    );
  });
});

describe('sobre semanal (weekly_payments): CHECK y unicidad', () => {
  it('importe final = total - adelantos, y nunca negativo', async () => {
    await db.exec(closedSettlement);
    await db.fails(
      payment(PAY1, S1, { gross: 1000, advances: 200, net: 700 }),
      /ck_weekly_payments_amounts/,
    );
    await db.fails(
      payment(PAY1, S1, { gross: 100, advances: 200, net: -100 }),
      /ck_weekly_payments_amounts/,
    );
    await db.exec(payment(PAY1, S1, { gross: 1000, advances: 200 }));
  });

  it('el período abarca 7 días', async () => {
    await db.exec(closedSettlement);
    await db.fails(
      payment(PAY1, S1).replace(`'2026-09-27'`, `'2026-09-30'`),
      /ck_weekly_payments_period/,
    );
  });

  it('un solo sobre por empleado y liquidación', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1));
    await db.fails(payment(PAY2, S1), /weekly_payments_settlement_id_employee_id_key/);
    await db.exec(payment(PAY2, S1, { employee: ID.E2 }));
  });

  it('un sobre solo puede reemplazar a otro una vez', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1));
    await db.exec(
      voidSettlement(S1) +
        settlement(S2, { revision: 2, supersedes: S1 }) +
        closeSettlement(S2) +
        payment(PAY2, S2, { supersedes: PAY1, previouslyDelivered: 800 }),
    );
    await db.fails(
      payment(uuid(402), S2, { employee: ID.E2, supersedes: PAY1 }),
      /weekly_payments_supersedes_payment_id_key/,
    );
  });

  it('DELIVERED exige fecha/hora y usuario que entregó', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1, { status: 'PREPARED' }));
    await db.fails(
      `UPDATE weekly_payments SET status = 'DELIVERED', delivered_at = now() WHERE id = '${PAY1}';`,
      /ck_weekly_payments_delivered_has_who_when/,
    );
    await db.fails(
      `UPDATE weekly_payments SET status = 'DELIVERED', delivered_by = '${ID.U1}' WHERE id = '${PAY1}';`,
      /ck_weekly_payments_delivered_has_who_when/,
    );
  });

  it('los datos de entrega solo existen si el sobre está DELIVERED', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1, { status: 'PREPARED' }));
    await db.fails(
      `UPDATE weekly_payments SET delivered_by = '${ID.U1}' WHERE id = '${PAY1}';`,
      /ck_weekly_payments_delivery_only_when_delivered/,
    );
  });

  it('PREPARED y DELIVERED exigen quién y cuándo lo preparó', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1));
    await db.fails(
      `UPDATE weekly_payments SET status = 'PREPARED' WHERE id = '${PAY1}';`,
      /ck_weekly_payments_prepared_has_who_when/,
    );
  });

  it('un sobre PENDING no conserva datos de preparación', async () => {
    await db.exec(closedSettlement + payment(PAY1, S1, { status: 'PREPARED' }));
    await db.fails(
      `UPDATE weekly_payments SET status = 'PENDING' WHERE id = '${PAY1}';`,
      /ck_weekly_payments_pending_is_clean/,
    );
    await db.exec(
      `UPDATE weekly_payments SET status = 'PENDING', prepared_at = NULL, prepared_by = NULL WHERE id = '${PAY1}';`,
    );
  });
});

describe('sobre semanal: transiciones e inmutabilidad', () => {
  const start = closedSettlement + payment(PAY1, S1);

  it('ciclo normal PENDING -> PREPARED -> DELIVERED, registrando quién y cuándo', async () => {
    await db.exec(start + markPrepared(PAY1) + markDelivered(PAY1));
    const rows = await db.rows<{ status: string; delivered_by: string; has_time: boolean }>(
      `SELECT status::text AS status, delivered_by::text AS delivered_by, delivered_at IS NOT NULL AS has_time
       FROM weekly_payments WHERE id = '${PAY1}'`,
    );
    expect(rows[0]).toEqual({ status: 'DELIVERED', delivered_by: ID.U1, has_time: true });
  });

  it('no se puede saltar de PENDING a DELIVERED', async () => {
    await db.exec(start);
    await db.fails(markDelivered(PAY1), /INVALID_TRANSITION/);
  });

  it('PREPARED puede volver a PENDING (limpiando la preparación)', async () => {
    await db.exec(start + markPrepared(PAY1));
    await db.exec(
      `UPDATE weekly_payments SET status = 'PENDING', prepared_at = NULL, prepared_by = NULL WHERE id = '${PAY1}';`,
    );
  });

  it('un sobre DELIVERED no puede anularse directamente: primero se revierte la entrega', async () => {
    await db.exec(start + markPrepared(PAY1) + markDelivered(PAY1));
    await db.fails(
      `UPDATE weekly_payments SET status = 'VOIDED', delivered_at = NULL, delivered_by = NULL WHERE id = '${PAY1}';`,
      /INVALID_TRANSITION/,
    );
    await db.fails(
      `UPDATE weekly_payments SET status = 'PENDING' WHERE id = '${PAY1}';`,
      /INVALID_TRANSITION/,
    );
  });

  it('la reversión DELIVERED -> PREPARED limpia los datos de entrega en la fila', async () => {
    await db.exec(start + markPrepared(PAY1) + markDelivered(PAY1) + revertDelivery(PAY1));
    const rows = await db.rows<{
      status: string;
      delivered_at: string | null;
      delivered_by: string | null;
    }>(
      `SELECT status::text AS status, delivered_at::text AS delivered_at, delivered_by::text AS delivered_by
       FROM weekly_payments WHERE id = '${PAY1}'`,
    );
    expect(rows[0]).toEqual({ status: 'PREPARED', delivered_at: null, delivered_by: null });
  });

  it('un sobre VOIDED es terminal', async () => {
    await db.exec(start + `UPDATE weekly_payments SET status = 'VOIDED' WHERE id = '${PAY1}';`);
    await db.fails(
      `UPDATE weekly_payments SET status = 'PENDING' WHERE id = '${PAY1}';`,
      /INVALID_TRANSITION/,
    );
    await db.fails(markPrepared(PAY1), /INVALID_TRANSITION/);
  });

  it('los importes y la identidad del sobre son inmutables', async () => {
    await db.exec(start);
    const immutable = /IMMUTABLE: the amounts and identity/;
    await db.fails(
      `UPDATE weekly_payments SET net_cents = 999, gross_cents = 1199 WHERE id = '${PAY1}';`,
      immutable,
    );
    await db.fails(
      `UPDATE weekly_payments SET advances_cents = 0, net_cents = 1000 WHERE id = '${PAY1}';`,
      immutable,
    );
    await db.fails(
      `UPDATE weekly_payments SET employee_id = '${ID.E2}' WHERE id = '${PAY1}';`,
      immutable,
    );
    await db.fails(
      `UPDATE weekly_payments SET employee_name_snapshot = 'Otro' WHERE id = '${PAY1}';`,
      immutable,
    );
    await db.fails(
      `UPDATE weekly_payments SET previously_delivered_cents = 5 WHERE id = '${PAY1}';`,
      immutable,
    );
  });

  it('un sobre no se borra', async () => {
    await db.exec(start);
    await db.fails(`DELETE FROM weekly_payments WHERE id = '${PAY1}';`, /cannot be deleted/);
  });
});

describe('bitácora de eventos del sobre', () => {
  const start = closedSettlement + payment(PAY1, S1);

  it('un evento CREATED no necesita motivo', async () => {
    await db.exec(start + event(PAY1, 'CREATED'));
  });

  it.each(['DELIVERY_REVERTED', 'VOIDED', 'PREPARATION_UNDONE'] as const)(
    '%s exige un motivo de al menos 10 caracteres',
    async (type) => {
      await db.exec(start);
      const authorizedBy = type === 'DELIVERY_REVERTED' ? ID.U1 : null;
      await db.fails(event(PAY1, type, { authorizedBy }), /ck_wpe_reason_required/);
      await db.fails(event(PAY1, type, { authorizedBy, reason: 'oops' }), /ck_wpe_reason_required/);
      await db.fails(
        event(PAY1, type, { authorizedBy, reason: '            ' }),
        /ck_wpe_reason_required/,
      );
      await db.exec(event(PAY1, type, { authorizedBy, reason: 'importe mal calculado el martes' }));
    },
  );

  it('revertir una entrega exige quién autorizó', async () => {
    await db.exec(start);
    await db.fails(
      event(PAY1, 'DELIVERY_REVERTED', {
        reason: 'importe mal calculado el martes',
        from: 'DELIVERED',
        to: 'PREPARED',
      }),
      /ck_wpe_revert_needs_authorizer/,
    );
  });

  it('es de solo inserción: no se actualiza, borra ni trunca', async () => {
    await db.exec(start + event(PAY1, 'CREATED'));
    await db.fails(
      `UPDATE weekly_payment_events SET reason = 'editado' WHERE payment_id = '${PAY1}';`,
      /append-only/,
    );
    await db.fails(
      `DELETE FROM weekly_payment_events WHERE payment_id = '${PAY1}';`,
      /append-only/,
    );
    await db.fails(`TRUNCATE weekly_payment_events;`, /append-only/);
  });

  it('el registro de auditoría también es de solo inserción', async () => {
    await db.exec(
      `INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, payload)
       VALUES ('${ID.R1}', '${ID.U1}', 'payment.delivery_reverted', 'weekly_payment', '${PAY1}', '{"reason":"x"}');`,
    );
    await db.fails(`UPDATE audit_log SET action = 'otra';`, /append-only/);
    await db.fails(`DELETE FROM audit_log;`, /append-only/);
    await db.fails(`TRUNCATE audit_log;`, /append-only/);
  });
});

describe('corrección tras una entrega (DATABASE.md §6): nada se modifica en silencio', () => {
  it('entrega -> reversión con motivo -> anulación -> re-liquidación -> nueva entrega', async () => {
    // 1. Sobre entregado
    await db.exec(
      closedSettlement +
        payment(PAY1, S1) +
        markPrepared(PAY1) +
        markDelivered(PAY1) +
        event(PAY1, 'DELIVERED', { from: 'PREPARED', to: 'DELIVERED' }),
    );

    // 2. No se puede anular la liquidación mientras haya entregas
    await db.fails(voidSettlement(S1), /cannot void a settlement with DELIVERED payments/);

    // 3. Reversión autorizada y con motivo
    await db.exec(
      event(PAY1, 'DELIVERY_REVERTED', {
        reason: 'las horas del martes estaban mal cargadas',
        authorizedBy: ID.U1,
        from: 'DELIVERED',
        to: 'PREPARED',
      }) + revertDelivery(PAY1),
    );

    // 4. Ahora sí: sobres y liquidación anulados
    await db.exec(
      `UPDATE weekly_payments SET status = 'VOIDED' WHERE id = '${PAY1}';` +
        event(PAY1, 'VOIDED', {
          reason: 'liquidación anulada para corregir',
          from: 'PREPARED',
          to: 'VOIDED',
        }) +
        voidSettlement(S1),
    );

    // 5. Re-liquidación (revisión 2) con el sobre nuevo apuntando al anulado
    await db.exec(
      settlement(S2, { revision: 2, supersedes: S1 }) +
        closeSettlement(S2) +
        payment(PAY2, S2, {
          gross: 1200,
          advances: 200,
          supersedes: PAY1,
          previouslyDelivered: 800,
        }),
    );

    // 6. Nueva entrega
    await db.exec(markPrepared(PAY2) + markDelivered(PAY2));

    // Toda la historia sigue en la bitácora, y los importes originales no cambiaron
    const events = await db.rows<{ event_type: string }>(
      `SELECT event_type::text AS event_type FROM weekly_payment_events WHERE payment_id = '${PAY1}' ORDER BY occurred_at, event_type`,
    );
    expect(events.map((e) => e.event_type).sort()).toEqual([
      'DELIVERED',
      'DELIVERY_REVERTED',
      'VOIDED',
    ]);
    const original = await db.rows<{ net_cents: string; status: string }>(
      `SELECT net_cents::text AS net_cents, status::text AS status FROM weekly_payments WHERE id = '${PAY1}'`,
    );
    expect(original[0]).toEqual({ net_cents: '800', status: 'VOIDED' });
    const replacement = await db.rows<{ net_cents: string; previously_delivered_cents: string }>(
      `SELECT net_cents::text AS net_cents, previously_delivered_cents::text AS previously_delivered_cents
       FROM weekly_payments WHERE id = '${PAY2}'`,
    );
    expect(replacement[0]).toEqual({ net_cents: '1000', previously_delivered_cents: '800' });
  });
});
