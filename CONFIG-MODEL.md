# CONFIG-MODEL.md — Modelo de configuración de distribución

Estado: **aprobado conceptualmente (2026-09-26)**. Implementado en la demo del navegador (`apps/web/src/lib/demo-store/`). **Todavía no hay tablas Prisma**: este documento es la base para diseñarlas.

Relacionado: [`ARCHITECTURE.md`](ARCHITECTURE.md) §2 (principio 7) y §2.1 (reglas estructurales vs. configurables) · [`PROGRESS.md`](PROGRESS.md) §10.

---

## 1. Principio

GUTIP no tiene una única regla de reparto. **Cada restaurante tiene una política de distribución** que define cómo se calcula su propina. La política arranca con la **configuración estándar de GUTIP** (válida: se puede calcular y cerrar enseguida) y el restaurante la personaliza.

**Library (Hotel Faena)** es el primer caso real y el caso de prueba: GUTIP tiene que poder reproducirlo, pero Library es *una configuración*, no el producto. Nada de Library queda en el código como regla universal.

## 2. Las cinco piezas

```
POLÍTICA  → define cómo se calcula            (fija, versionada)
PERSONAL  → quiénes trabajan y en qué puesto  (datos actuales, sin versiones)
PERÍODO   → los datos variables del período   (se cargan desde el control de distribución)
MOTOR     → calcula con política + personal + datos del período
CIERRE    → congela todo en un snapshot       (inmutable)
```

| | Qué es | Ejemplos | ¿Crea versión de política? |
|---|---|---|---|
| **Configuración fija** (política) | Lo propio del restaurante, se define una vez | período, cómo se reparte, horas usadas, fuentes y su destino, estructura del pozo y grupos con %, **puestos con su peso**, excepciones de peso por persona, redondeo y sobrante, adelantos, quién maneja sobres | **Sí**, cada cambio |
| **Personal** | Las personas y su estado actual | agregar, dar de baja, cambiar el puesto habitual | No |
| **Datos del período** | Lo que cambia en cada período | monto de cada fuente por día, horas de cada persona, adelantos, cotización del dólar, decisiones manuales que pida la política | No |
| **Valores calculados** | Lo que calcula GUTIP | puntos, porcentaje, pozo de cada grupo, importe, ajuste de redondeo, adelanto aplicado, saldo, sobre final, totales | — (se recalculan; se guardan al cerrar) |

## 3. La política versionada

- Cada restaurante tiene una lista de **versiones** (1, 2, 3…) y una **versión vigente**.
- **Una versión nunca se edita.** Guardar un cambio crea una versión nueva, con: número, contenido completo (parámetros + puestos con peso), quién, cuándo, origen (`ESTANDAR`, `COPIA`, `CAMBIO`) y un resumen del cambio generado automáticamente (p. ej. "Redondeo: Centavos → Pesos enteros").
- La versión nueva queda **vigente para los próximos períodos**.
- Cada política pertenece a **un solo restaurante**. Copiar la de otro local crea una política independiente.

### Cómo nace la política de un restaurante

1. **Configuración estándar de GUTIP** (por defecto): se copia como versión 1.
2. **Copia de otra política** (p. ej. de otro local del mismo dueño).
3. *(Futuro)* **Plantilla** (p. ej. "Library") o **desde cero**.

### Configuración estándar (v1)

Es la modalidad que GUTIP implementa hoy (no una regla universal):

| Parámetro | Estándar |
|---|---|
| Período | semanal (empieza el lunes) |
| Cuándo se reparte | una vez por período, con el pozo acumulado |
| Horas | total del período, cargado al cerrar |
| Fuentes | un monto por día (pozo general) |
| Pozo | pozo único |
| Pesos | por puesto |
| Puestos iniciales | Supervisor 0,014 · Barra 0,022 · Salón 0,022 · Bacha 0,007 |
| Redondeo | centavo, mayor resto (sin sobrante posible) |
| Adelantos | se descuentan de todo el período; lo que no alcanza pasa al siguiente |
| Sobres | los prepara y entrega el Encargado |

## 4. Parámetros

| Parámetro | Tipo | Opciones (✅ implementada hoy) | Depende de |
|---|---|---|---|
| Período | enum + valores | semanal ✅ · quincenal · mensual; día de inicio; fecha ancla (quincenal); día de corte (mensual) | — |
| Cuándo se reparte | enum | por período ✅ · por día | — |
| Horas usadas | enum | total del período ✅ · del día · acumuladas a la fecha | "del día" y "acumuladas" exigen reparto por día |
| Carga de horas | enum | total al cerrar ✅ · por día | "del día" exige carga por día |
| Fuentes del pozo | **estructura** | lista de fuentes (nombre, tipo, moneda, destino: pozo general o de un grupo); hoy: un monto por día ✅ | destino "grupo" exige grupos |
| Estructura del pozo | enum + **estructura** | pozo único ✅ · % por grupo (grupos con %, que sumen 100 %, y política para un grupo vacío) | — |
| Grupo vacío | enum | repartir entre los demás · guardar para el próximo período · decidir a mano | solo con % por grupo |
| Peso de cada hora | enum + **estructura** | por puesto ✅ · por puesto con excepciones · por persona; tabla de puestos con peso; excepciones por persona | "por persona" exige peso para cada activo |
| Redondeo | enum | centavo ✅ · peso ✅ · $10 · $100; método: mayor resto ✅ | unidad > centavo con pozo no múltiplo exige política de sobrante |
| Sobrante del redondeo | enum | no hay (el pozo debe ser múltiplo de la unidad) ✅ · pasa al período siguiente · a un fondo · decidir a mano | solo con unidad > centavo |
| Descuento de adelantos | enum | de todo el período ✅ · desde su fecha · a elección / en cuotas | "desde su fecha" exige reparto por día |
| Adelanto que no alcanza | enum | pasa al período siguiente ✅ · otras políticas a definir con casos reales | — (**no es regla estructural**) |
| Quién maneja los sobres | **estructura** (acción → permisos) | solo Encargado ✅ · Encargado y Editor ✅ · permiso "Pagador" | revertir una entrega: siempre Encargado/Dueño (estructural) |
| Moneda | valores | acepta USD (sí/no); fuente de la cotización | — |

**Preparado para el futuro, sin implementar** (se agregan cuando un caso real los necesite): turnos, descuentos previos al reparto (p. ej. para la casa), elegibilidad (mínimo de horas, período de prueba), múltiples pozos más allá de fuente → destino. El cálculo se piensa como etapas en orden — fuentes → descuentos previos → pozos/grupos → elegibilidad → puntos → reparto y redondeo → adelantos → sobres — y cada etapa usa la estrategia que elige la política; una etapa sin configurar no hace nada.

Agregar una modalidad = un valor nuevo en el catálogo + su estrategia en el motor + una versión de cálculo nueva. Una opción no implementada existe en el catálogo pero **no se puede activar**.

## 5. Completitud y bloqueo del cierre

- La **configuración estándar** y las **personalizaciones completas** pueden **calcular y cerrar**.
- **"Por definir"** existe solo cuando una **personalización** deja algo incompleto (p. ej. eligió % por grupo sin cargar los %, o no hay ningún puesto con peso).

| Situación | Guardar | Vista previa | Cerrar |
|---|---|---|---|
| Estándar | ✅ | ✅ | ✅ |
| Personalizada completa | ✅ | ✅ | ✅ |
| Personalizada con algo por definir | ✅ | ✅ | ❌ (dice qué falta) |
| Opción no implementada | no se puede activar | — | — |

Lo que falta verificar de un caso de referencia (p. ej. Library contra su planilla) es una **lista de validación** que **no bloquea** el cierre.

## 6. Períodos y versiones

1. Al **empezar** un período se fija la **versión vigente** de la política.
2. Si se **cambia la política con el período abierto**: se crea una versión nueva (vigente para los próximos períodos), el período abierto **pasa a esa versión**, la vista previa se recalcula y queda registrado quién, cuándo y de qué versión a cuál. *(Futuro: aplicar un cambio solo a ese período será una opción explícita.)*
3. Al **cerrar**, el cierre queda asociado a la versión finalmente usada.
4. **Los períodos cerrados nunca se modifican.** Cambiar la política no los toca.
5. **Rehacer un período anulado**: usa por defecto **la misma versión** con la que se calculó. Usar otra versión es una elección explícita del Encargado, **con motivo**, y queda registrada. (Mientras está reabierto, un cambio de política no lo mueve de versión automáticamente.)

## 7. Snapshot del cierre

Al cerrar se guarda una sola vez, inmutable:

- período (fechas, revisión), **versión de la política** y **versión del cálculo**;
- **copia de los valores de la política usados** (aunque la versión siempre se pueda leer);
- entradas: montos por fuente y día, horas, adelantos considerados;
- por persona: nombre, puesto, grupo y %, peso aplicado (y si fue excepción), horas, puntos, porcentaje, importe, adelanto aplicado, saldo, final;
- totales, sobrante del redondeo y su destino, quién cerró y cuándo.

Los **sobres** y las **aplicaciones de adelantos** nacen del cierre: cambian de estado (preparado, entregado…) pero nunca de importe.

## 8. Library: primera configuración real

Library usa la configuración estándar con lo que sabemos de su planilla. Lo confirmado por el restaurante: **período semanal, pozo semanal repartido una vez por semana, horas totales de la semana cargadas al cerrar.**

Lista de validación (no bloquea el cierre):

- "Recepción" y "Cocina" de la planilla: ¿otras fuentes o pozos aparte?
- Pesos: peso del puesto ÷ 45 en la mayoría; en Bacha, pesos distintos entre personas → requiere "por puesto con excepciones" (próximamente).
- Redondeo: con pesos enteros se reproducen los 12 importes de la planilla (ya configurable).
- Adelantos: ¿de toda la semana o desde su fecha? ¿Qué pasa con lo que no alcanza?
- Quién prepara y entrega los sobres.
- El archivo Excel original (fórmulas, Hoja2/Hoja3) y más semanas.

Test de aceptación: `apps/web/src/lib/demo-store/policy.test.ts` → "referencia Library" (nombres anonimizados; pesos deducidos de la foto, sin confirmar).

## 9. Implementación en la demo (referencia para Prisma)

| Concepto | Demo |
|---|---|
| Catálogo de parámetros y estándar | `config.ts` (`PARAMS`, `STANDARD_VALUES`) + `lib/demo/data.ts` (`SEED_POSITIONS`) |
| Política versionada | `policy.ts` (`VenuePolicy`, `PolicyVersion`, `standardPolicy`, `copiedPolicy`, `policyGaps`) |
| Cambios de política | `policy-ops.ts` (`setConfigValue`, `addPosition`, `setPositionFactor`, `repinWeek`) |
| Período fijado a una versión | `Week.policyVersion` + `Week.policyLog` (`model.ts`) |
| Snapshot del cierre | `WeekResult.policyVersion` + `WeekResult.config` + filas con puesto y peso |
| Bloqueo del cierre | `closeWeek` rechaza si `policyGaps` no está vacío |
| Pantalla | `/configuracion` (parámetros, puestos y pesos, historial de versiones, validación de Library) |

**Pendiente para el diseño de datos:** fuentes múltiples, grupos con %, excepciones por persona y política de sobrante todavía no existen en la demo (no hubo un caso real que los requiera); el modelo ya les tiene lugar.
