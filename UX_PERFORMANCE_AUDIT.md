# GUTIP — UX & Performance Audit

Fecha: 2026-09-28 · Commit auditado: `d98b068` (el que está en producción) · Autor: auditoría asistida (Claude)

> **Alcance y método.** Recorrí la aplicación como un dueño nuevo sobre una **copia local idéntica a producción** (mismo commit, `next build` + `next start`, PostgreSQL local descartable `gutip_audit`, `GUTIP_DATA_SOURCE=database`), y la **demo** (mismo build, `GUTIP_DATA_SOURCE=demo`) para ver el flujo de Semana/Sobres que todavía no existe con base de datos. En producción solo hice lecturas: pedidos HTTP públicos, el panel de Vercel (Deployments, Observability, Settings → Functions) y una consulta **de solo lectura** a Neon sobre las claves del límite de intentos (sin imprimir IPs). **No** inicié sesión en producción desde el navegador, no creé datos en producción, no cambié código, variables, Neon ni Vercel. Todos los datos de prueba (cuentas `marta-audit@example.com`, restaurante "Parrilla La Esquina", personas "Sofía Ramos", "Juan Pérez", "Leo Salinas") son **locales** y descartables.
>
> Cuando algo no se pudo medir con precisión lo digo explícitamente.

---

# Flujo principal de reparto

Esta es la sección central del informe: **hoy un dueño que se registra no puede hacer su primer reparto**.

## Problema actual

La pregunta del usuario — *"Acabo de registrarme. Tengo un restaurante. ¿Cómo reparto las propinas de esta semana?"* — **no tiene respuesta en la aplicación real**:

- El menú en modo base tiene solo **Inicio, Personal, Configuración de distribución, Mi sesión, Crear restaurante**. No existe ningún lugar para cargar propina ni horas, ni para calcular, cerrar o entregar sobres.
- La pantalla que haría eso (**"Semana actual"**, `/semana`) existe solo en la demo; en modo base muestra *"Semana actual: todavía no disponible"* (`apps/web/src/app/semana/page.tsx:11`).
- Aun así, la app **manda al usuario a buscarla**: Configuración dice *"Las horas, pozos y adelantos de cada semana se cargan en "Semana actual""* (`src/components/config/distribution-config-view.tsx:116`), pero "Semana actual" no está en el menú. Es un callejón sin salida.
- El Inicio muestra tarjetas **Repartos 0 · Semanas 0 · Adelantos 0 · Sobres 0** que no son clickeables ni llevan a ninguna parte: sugieren que esas funciones existen, pero no hay forma de llegar a ellas.

**Lo que sí existe y funciona:** el motor de cálculo (`packages/tip-engine`, 257 tests), el esquema de base para todo el flujo (`weekly_settlements`, `period_hours`, `daily_distributions` con alcance `PERIOD`, `tip_entries`, `advances`, `weekly_payments` + eventos, con triggers de inmutabilidad) y **un prototipo completo de la interfaz en la demo** (Semana actual, vista previa, cierre, sobres, historial, anular semana). **Falta la capa del servidor (servicios + acciones con `requireAccess`) y la interfaz conectada a la base.** No hay ningún servicio de semanas/repartos/sobres en `src/server/` (solo `access`, `auth`, `policy`, `restaurants`, `staff`).

## Flujo actual

Recorrido real (modo base, local, idéntico a producción):

| Paso | Qué esperaba | Qué encontré | Dónde me trabé / qué me hizo dudar |
|---|---|---|---|
| 1. Entrar a la web | Una portada que diga qué es GUTIP | `/` redirige directo a **Iniciar sesión** (sin explicación del producto) | "¿Qué es esto? ¿Es para mí?" |
| 2. Registrarme | Formulario simple | `/registro`: Nombre, Email, Contraseña (mín. 10). Funciona. Errores de a uno, abajo del formulario | Sin "mostrar contraseña"; el error no marca el campo |
| 3. Crear restaurante | Nombre y listo | `/crear-restaurante`: funciona. Texto *"Empieza vacío, con la configuración estándar de distribución…"* | "¿Qué es la configuración estándar de distribución?" |
| 4. Qué hago ahora | Una guía: "1) cargá tu personal, 2) empezá tu primera semana" | Inicio con 5 tarjetas en 0 y 3 botones (Personal / Configuración / Mi sesión). El botón destacado arriba a la derecha es **"Crear otro restaurante"** | Nada me dice el siguiente paso; el botón principal me invita a crear OTRO restaurante |
| 5. Cargar personal | Lista + agregar | `/personal`: funciona bien (agregar, cambiar puesto, dar de baja, reactivar, duplicados). Cada fila dice *"porción 0,014"* | "¿Qué es una porción? ¿0,014 de qué?" El puesto por defecto es **Supervisor** |
| 6. Cargar la propina de la semana | Un botón "Nuevo reparto" / "Semana actual" | **No existe** | **Bloqueo total** |
| 7. Cargar horas | Tabla de personas con horas | **No existe** (Personal no tiene horas) | **Bloqueo total** |
| 8. Calcular / revisar / cerrar / sobres | — | **No existe** | — |
| 9. Buscar en Configuración | Quizás acá se reparte | 10 secciones con opciones "Próximamente", jerga (pozo, porción, política, versión, sobres, Encargado) y un aviso *"Fórmula provisional… Los importes son orientativos"* | Me asusta: ¿los números no son confiables? Y me manda a "Semana actual", que no existe |

**Resultado: el usuario abandona en el paso 6.** Es el P0 absoluto del producto.

## Flujo recomendado

La pregunta clave era: *¿cuál es la menor cantidad de pasos para pasar de "tengo $347.990 y estas horas" a "sé cuánto recibe cada uno"?*

**Respuesta: 1 pantalla, 2 datos y 1 botón.** Todo lo demás (período, política, puntos, redondeo) lo resuelve GUTIP con valores por defecto.

Validé esto en la demo con el caso Library: **1 monto de propina + 12 horas + "Calcular"** = 14 interacciones (con Tab entre horas), y el resultado fue exacto (ver *Ejemplo completo*). La demo ya prueba que el modelo de "una sola pantalla de semana" funciona; lo que hay que hacer es **llevarlo a la base y simplificar lo que se ve**.

Flujo recomendado (validado contra la estructura propuesta 1-7 del pedido):

```
INICIO ─► [Repartir propinas de esta semana]      ← CTA principal, siempre visible
            │  (si no hay personal: primero "Agregá a tu equipo", inline)
            ▼
   REPARTO DE LA SEMANA (una sola pantalla, se guarda sola)
     • Semana: 21–27/9  (sugerida; cambiable)        ← Paso 1 fusionado: "crear período" es implícito
     • Propina a repartir: [$ 347.990]  (o "cargar por día ▸")   ← Paso 2
     • Horas de cada persona: tabla rápida           ← Paso 3
     • Resultado EN VIVO debajo / al costado         ← Pasos 4 y 5 fusionados: no hace falta "Calcular"
     • [Cerrar reparto]  → confirmación con resumen  ← Paso 6
            ▼
   SOBRES (lista para preparar / entregar / imprimir)  ← Paso 7
            ▼
   HISTORIAL (repartos cerrados)
```

Cambios respecto de la estructura 1-7 propuesta:

- **"Crear/iniciar período" no debe ser un paso aparte.** Abrir la pantalla de reparto crea (o retoma) el período de la semana en curso. Cambiar la fecha es opcional. La demo lo pide como paso aparte ("Empezar semana"); se puede eliminar.
- **"Calcular" y "Revisar" se fusionan.** El cálculo es instantáneo, así que el resultado debe actualizarse mientras se escribe. El botón "Calcular" de la demo existe porque el resultado queda "viejo" (*"Cambiaste datos: volvé a calcular antes de cerrar"*): es fricción innecesaria. La vista previa en vivo elimina ese estado.
- **"Cerrar" sí debe ser un paso explícito**, con confirmación y un resumen de lo que se va a congelar (total, cantidad de personas, personas **sin horas**, adelantos).
- **"Liquidar/entregar" es una etapa posterior** que puede ocurrir otro día (sobres Pendiente → Preparado → Entregado). No bloquea "saber cuánto recibe cada uno".

## Pantallas necesarias

| Pantalla | Estado hoy | Necesidad |
|---|---|---|
| **Inicio (tablero)** con CTA "Repartir propinas de esta semana" + guía de primeros pasos | Existe, pero sin CTA ni guía | **P0** (rediseño liviano) |
| **Reparto de la semana** (`/semana`): propina, horas, resultado en vivo, cerrar | Solo demo | **P0** |
| **Confirmación de cierre** (inline, no `window.confirm`) | Solo demo (inline, bien) | **P0** |
| **Detalle de un reparto cerrado** (`/semanas/[id]`): resultado, "¿Cómo se calculó?", sobres | Solo demo | **P0** (resultado + sobres) |
| **Sobres**: preparar/entregar/imprimir planilla con firma | Solo demo | **P1** (el dueño ya "sabe cuánto recibe cada uno" sin esto; imprescindible para operar con efectivo) |
| **Historial** de repartos cerrados | Solo demo | **P1** |
| **Adelantos** dentro del reparto | Solo demo | **P1** |
| **Anular/corregir un reparto cerrado** | Solo demo | **P1** |
| **Acceso / invitaciones** | Solo demo (sin servidor) | **P2** para el primer reparto; **P1** para restaurantes con encargado |
| **Mis sobres** (vista del empleado) | Solo demo | **P2** (requiere invitaciones y rol SELF) |

## Datos que debe ingresar el usuario

Mínimos para un reparto (caso Library):

1. **Propina total de la semana**: un monto (`$ 347.990`). Opcional: por día.
2. **Horas de cada persona activa**: un número por persona (`45`, `18`, …). Vacío = no trabajó (con aviso).
3. (Opcional) **Adelantos** ya entregados: persona + monto (+ fecha/nota opcional).
4. **Confirmar el cierre.**

Nunca debería tener que ingresar: puntos, porcentajes, valor del punto, redondeo ni versión de la política.

Datos que se cargan **una sola vez** (antes del primer reparto): personal con su puesto (ya existe) y, opcionalmente, ajustar el peso de cada puesto (ya existe, con otro nombre, ver UX-006).

## Datos que calcula GUTIP

- Período (semana) según el día de inicio configurado; política vigente asociada.
- Puntos = horas × porción del puesto; total de puntos.
- Valor del punto = propina ÷ total de puntos. **Mejor presentado como "valor de la hora de cada puesto"** (ver *Explicar el cálculo*).
- Importe de cada persona, con reparto por **mayor resto** (la suma coincide exacto con el total).
- Adelantos descontados → **monto del sobre**.
- Totales: repartido, adelantos, en sobres; controles (personas sin horas, total de horas, horas promedio).
- Al cerrar: congelar política, snapshot, versión del cálculo y generar los sobres.

## Estados del reparto

Estados visibles para el usuario (mapeados al modelo `weekly_settlements` + `weekly_payments`):

| Estado visible | Estado en la base | Qué puede hacer el usuario |
|---|---|---|
| **Sin empezar** | no existe el período | Ver CTA "Repartir propinas de esta semana" |
| **En curso** (borrador, se guarda solo) | `OPEN` | Cargar/editar propina, horas y adelantos; ver el resultado en vivo |
| **Listo para cerrar** | `OPEN` (derivado: hay propina y todas las personas con horas o marcadas "no trabajó") | Cerrar |
| **Cerrado** | `CLOSED` | Ver resultado, imprimir, pasar a sobres. No se edita |
| **Sobres: pendientes / preparados / entregados** | `weekly_payments.status` | Preparar, entregar, revertir con motivo |
| **Anulado** (corregido) | `VOIDED` + nueva revisión | Ver el cierre anterior como historial |

Recomendación: mostrar siempre un **chip de estado** y una línea de "qué sigue" (*"Faltan las horas de 2 personas"*, *"Listo para cerrar"*, *"Cerrado · 3 de 12 sobres entregados"*).

## Casos especiales

| Caso | Cómo debería reaccionar la UX |
|---|---|
| Una persona trabajó 0 horas / faltó | Permitir vacío o 0. Al cerrar: *"Jean no tiene horas: no recibe propina esta semana. ¿Es correcto?"* con opción "Marcar como no trabajó". **Hoy la demo calcula en silencio**: al borrar las horas de Jean, su parte se repartió entre los demás y solo cambió un contador "11 / 12" (verificado). |
| Entró a mitad de semana | Se carga como cualquiera (horas reales). Si se agrega en Personal durante la semana, aparece en la tabla del reparto abierto. Botón "Agregar persona" **dentro** del reparto (hoy la demo manda a Personal y te saca del flujo). |
| Cambió de puesto en la semana | Caso raro: usar el puesto actual por defecto y permitir cambiar el puesto **para este reparto** en la fila (el modelo ya guarda el puesto por ítem). Documentar la limitación "un puesto por persona por período". |
| Persona inactiva (dada de baja) | No aparece en repartos nuevos; sí en los cerrados. Si se la da de baja con el reparto abierto y tenía horas, avisar. |
| Tiene un adelanto | Columna o chip "Adelanto $10.000" en la fila; el resultado muestra *Propina $76.586 − Adelanto $10.000 = Sobre $66.586*. Si el adelanto supera la propina: sobre $0 y "saldo pendiente $X pasa a la semana siguiente" (regla ya aprobada). |
| Faltan horas de una persona | Aviso no bloqueante en vivo + bloqueo suave al cerrar (confirmación explícita). |
| Faltan horas de todos | No mostrar resultado; mensaje: *"Cargá las horas para ver cuánto le toca a cada uno"*. |
| Propina $0 | Permitir cerrar con confirmación (*"No hay propina para repartir esta semana"*); todos los sobres en $0 no se generan o se marcan "sin importe" (ya existe en la demo). |
| Hay propina pero no hay empleados | Estado vacío con acción: *"Agregá a tu equipo para poder repartir"* + formulario inline. |
| Hay empleados pero no hay propina | Resultado en $0 y el campo de propina resaltado. |
| Total de horas "raro" | Validación suave por fila: > 24 × días del período lo rechaza la base (trigger); avisar antes con texto claro (*"168 h es el máximo de una semana"*). Mostrar "Total: 301 h" para que el dueño lo contraste con su registro. |
| Modifica horas después de "calcular" | Con resultado en vivo el problema desaparece. |
| Vuelve atrás / sale de la pantalla | Guardado automático por campo (la demo ya dice "Se guarda automáticamente"). Mostrar "Guardado ✓ hace 2 s" / "Guardando…" / "Sin conexión, reintentando". |
| Cierra el período | Confirmación con resumen → pantalla del reparto cerrado con los sobres y **el siguiente paso** ("Preparar sobres" / "Imprimir planilla"). |
| Necesita corregir después del cierre | "¿Hay un error?" → **Anular y rehacer** (ya diseñado en la demo y en `DATABASE.md` §6): solo si ningún sobre fue entregado, con motivo; si hay sobres entregados, primero revertir la entrega con motivo. |

## UX propuesta

Evalué la propuesta del pedido (propina arriba, lista de personas con horas, "Calcular reparto", pantalla de resultado aparte). Es buena, pero la mejoro en tres puntos:

1. **Sin pantalla de resultado aparte y sin botón "Calcular".** El resultado se ve **en la misma pantalla y en vivo**, en una columna "Le toca" al lado de las horas. Así el usuario ve el efecto de cada hora que carga y no hay estado "resultado viejo".
2. **La columna "Le toca" es el único número nuevo** que aparece en la vista principal. Nada de porción, puntos ni %.
3. **"Cerrar reparto" es la única acción destacada**, fija abajo (sticky, como ya hace la demo), con el estado a la izquierda.

Boceto (desktop):

```
REPARTO DE PROPINAS                         ● En curso · guardado hace 2 s
Semana del 21 al 27 de septiembre  [cambiar]

Propina a repartir   [ $ 347.990 ]    Cargar por día ▸

 Persona          Puesto       Horas     Le toca
 Ivan             Supervisor   [ 45 ]    $ 40.613,88
 Nardelli         Supervisor   [ 18 ]    $ 16.245,55
 Roro             Barra        [ 45 ]    $ 63.821,80
 …
 Jean             Bacha        [    ]    —  ⚠ sin horas
                               301 h     $ 347.990,00
 + Agregar persona    + Registrar adelanto

 ¿Cómo se calculó? ▸

┌──────────────────────────────────────────────────────────────┐
│ Falta cargar las horas de Jean.              [ Cerrar reparto ] │
└──────────────────────────────────────────────────────────────┘
```

Detalles:

- **Carga rápida de horas**: `inputmode="decimal"` (la demo ya lo tiene), **Enter y Tab pasan a la siguiente persona** (hoy Enter no avanza; verificado), orden por puesto como la planilla, buscador si hay más de 15 personas, "pegar desde planilla" (pegar una columna de horas desde Excel/Sheets llena la tabla en orden).
- **Adelantos**: no como formulario separado grande (como en la demo), sino como acción en la fila o una lista corta.
- **Después de cerrar**: pantalla del reparto cerrado = el mismo listado, en solo lectura, con columna "Sobre" y botones "Imprimir planilla" / "Preparar sobres".

## Cómo debería funcionar en móvil

No pude achicar la ventana del navegador de prueba (igual que en fases anteriores, `PROGRESS.md` §6.2), así que esto sale del análisis del código y de la demo, **no de una prueba visual**.

- La tabla de horas de la demo tiene `min-w-[520px]` (`src/components/week/current-week.tsx:327`): en un teléfono de 390 px obliga a **scroll horizontal**. En móvil debe ser una **lista de tarjetas de una línea**: `Ivan · Supervisor ........ [ 45 h ]  $40.614`.
- Campo de horas grande (≥ 44 px), teclado numérico, botón "Siguiente" del teclado que salte a la próxima persona.
- Propina arriba y fija; resultado total y botón "Cerrar reparto" en una barra fija abajo.
- "¿Cómo se calculó?" como hoja inferior (bottom sheet).
- El uso real en el restaurante (encargado con el celular al cierre) hace que **móvil sea la plataforma principal de carga**; desktop, la de revisión/impresión.

## Cómo debería funcionar en desktop

- Dos columnas: izquierda la tabla (horas + "Le toca"), derecha un resumen fijo (propina, total de horas, valor de la hora por puesto, personas sin horas, adelantos, botón Cerrar).
- Navegación por teclado completa (Tab/Enter/flechas).
- Imprimir planilla con firma (ya existe en la demo).

## Ejemplo completo con $347.990

Cargué el caso en la demo (misma fórmula provisional que usa la app: puntos = horas × porción; mayor resto al centavo) y verifiqué el resultado a mano.

**Importante:** los números del ejemplo del pedido (total de puntos 5,46; valor del punto $63.747,40; Ivan $41.436) **no coinciden** con lo que calcula GUTIP con esas horas y porciones. Con 45 h × 0,014 + … el total de puntos es **5,398**, no 5,46. Tomo como correctos los del motor, sin cambiar la lógica:

- Total de horas: **301 h** · Total de puntos: **5,398**
- Valor del punto: 347.990 ÷ 5,398 = **$ 64.466,47**
- **Valor de la hora por puesto** (la forma recomendada de explicarlo): Supervisor **$ 902,53/h** · Barra y Salón **$ 1.418,26/h** · Bacha **$ 451,27/h**

| Persona | Puesto | Horas | Le toca (vista simple) |
|---|---|---:|---:|
| Ivan | Supervisor | 45 | $ 40.613,88 |
| Nardelli | Supervisor | 18 | $ 16.245,55 |
| Roro | Barra | 45 | $ 63.821,80 |
| Marcos | Barra | 13 | $ 18.437,41 |
| Leo | Salón | 54 | $ 76.586,17 |
| Isaías | Salón | 36 | $ 51.057,44 |
| Agus Fulleda | Salón | 32 | $ 45.384,39 |
| Cami noche | Salón | 5 | $ 7.091,31 |
| Agus noche | Salón | 5 | $ 7.091,31 |
| Nahuel | Bacha | 24 | $ 10.830,37 |
| Jesús | Bacha | 20 | $ 9.025,31 |
| Jean | Bacha | 4 | $ 1.805,06 |
| **Total** | | **301** | **$ 347.990,00** |

Con el adelanto de la planilla (Leo, $10.000): sobre de Leo **$ 66.586,17**; total en sobres **$ 337.990,00** (idéntico a la semana cerrada que trae la demo).

**"¿Cómo se calculó?" (opcional, por persona) — propuesta de texto:**

> **Leo · Salón · 54 horas**
> Esta semana cada hora de **Salón** vale **$ 1.418,26**.
> 54 h × $ 1.418,26 = **$ 76.586,17**
> − Adelanto del sábado: $ 10.000,00
> **Sobre: $ 66.586,17**
>
> ▸ *Detalle técnico*: 54 h × porción 0,022 = 1,188 puntos · total de la semana 5,398 puntos · valor del punto $ 64.466,47 · redondeo al centavo por mayor resto (la suma da exacto $ 347.990,00).

"Valor de la hora del puesto" se entiende sin saber qué es un punto, y es exactamente equivalente (valor del punto × porción).

**Validación de la fórmula (sin cambiarla):** `PROGRESS.md` §10 (A4, P3, P4) dice que los factores 0,014/0,022/0,007 son redondeados y que "pesos enteros" reproduciría la planilla. Mientras eso siga abierto, la app muestra **"Fórmula provisional… Los importes son orientativos"** en Configuración y en cada semana. Para un usuario real ese texto **destruye la confianza** (ver UX-008). Recomiendo validar la fórmula con la planilla real antes de lanzar el reparto a usuarios, o como mínimo sacar ese aviso de la vista del dueño.

## Qué falta implementar

Para el **primer reparto** (P0), en este orden:

1. **Servicios de período (servidor)**: abrir/retomar la semana (`weekly_settlements` `OPEN` + versión vigente), guardar propina (`daily_distributions` alcance `PERIOD` + `tip_entries`), guardar horas (`period_hours`), vista previa con la **misma función** que el cierre, cerrar (snapshot + `calc_version` + ítems + `weekly_payments`), todo con `requireAccess` y los bloqueos ya documentados (`FOR UPDATE`, triggers).
2. **Acciones del servidor** para cada operación (Zod + `requireAccess`), idempotentes y por campo (guardado automático).
3. **Pantalla "Reparto de la semana"** conectada a la base (reutilizar la de la demo, simplificada como se describe arriba).
4. **Pantalla del reparto cerrado** con resultado simple + "¿Cómo se calculó?" + imprimir.
5. **Inicio con CTA y guía de primeros pasos**; quitar tarjetas en 0 que no llevan a ningún lado.
6. **Quitar/arreglar el texto que manda a "Semana actual"** mientras no exista.

Después (P1): sobres (preparar/entregar/revertir), adelantos, historial, anular y rehacer, carga por día.

---

## 1. Resumen ejecutivo

1. **El flujo principal no existe con base de datos.** Un dueño puede registrarse, crear el restaurante y cargar personal, pero **no puede repartir propinas**. El motor, el esquema y un prototipo de UI completo ya existen: falta la capa de servidor y la pantalla real. Es **el** P0.
2. **La lentitud tiene una causa principal medida: la base (Neon, São Paulo `sa-east-1`) y las funciones de Vercel (Washington `iad1`) están en continentes distintos.** Cada consulta cruza el continente y cada pantalla hace **13 a 21 consultas**, muchas duplicadas y encadenadas. Vercel Observability (P75, 12 h): **/configuracion 4,67 s · /api/auth 4,28 s · /login 3,2 s · / 1,57 s · /personal 1,47 s · /cuenta 835 ms**. La misma app contra una base local responde en **10–19 ms** por pantalla.
3. **Cada pedido resuelve sesión y acceso dos veces** (layout + página, sin `cache()`), y cada `include` de Prisma es una ida y vuelta extra. **Una sola acción "Agregar persona" ejecuta ~38 sentencias SQL**.
4. **No hay ningún `loading.tsx`**: durante 1,5–4,7 s de espera la navegación no da ninguna señal; parece que el clic no funcionó.
5. **El primer uso no guía**: no hay portada, el Inicio no dice qué hacer y su botón principal es "Crear otro restaurante"; la jerga (porción, pozo, política, versión, sobres, Encargado) aparece sin explicación y Configuración muestra un aviso de "fórmula provisional / importes orientativos".
6. Lo que sí está bien: registro/login con validaciones y mensajes claros, anti-enumeración, Personal (agregar, duplicados, bajas reversibles, mensajes de estado), aislamiento entre restaurantes, y el prototipo de semana de la demo (etiquetas accesibles, `inputmode="decimal"`, Tab entre horas, confirmación de cierre inline, anular con motivo).

## 2. Recorrido realizado

**Modo base (local, idéntico a producción), como usuario nuevo:**
1. Entré a `/` → redirección a `/login` (con el autocompletado del navegador ofreciendo credenciales reales del dueño: no las usé).
2. "Creá una" → `/registro`. Envié vacío (→ "Poné tu nombre."), email inválido (→ "Poné un email válido."), contraseña de 5 caracteres (→ "La contraseña tiene que tener entre 10 y 128 caracteres."), luego datos válidos → sesión iniciada y `/crear-restaurante`.
3. Crear restaurante vacío (→ "Poné un nombre para el restaurante.") y luego "Parrilla La Esquina" → Inicio.
4. Inicio: tarjetas en 0, botones. Busqué cómo repartir: no hay.
5. Personal: agregar vacío (→ error), "Sofía Ramos" (Supervisor por defecto), cambiar su puesto con el teclado, "Juan Pérez" en Salón, "Juan Pérez" duplicado (→ "Ya hay alguien activo llamado…"), dar de baja y ver "De baja / Reactivar", "Leo Salinas".
6. Configuración: recorrí las 10 secciones, historial de versiones y "Fórmula provisional".
7. Mi sesión; "Crear restaurante" teniendo uno; `/semana`, `/historial`, `/acceso`, `/mis-sobres` (→ "todavía no disponible"), `/locales` (→ `/cuenta`).
8. Cerrar sesión → `/login`; login con contraseña incorrecta (→ "Email o contraseña incorrectos."); login correcto → Inicio.
9. Intenté vista móvil (390 px): **no pude** achicar la ventana; lo evalué por código.

**Modo demo (mismo build), para el flujo operativo:** Inicio de la demo, semana cerrada de la planilla (Library), "Empezar semana", carga de la propina ($347.990) y de las 12 horas con Tab, "Calcular", borrar las horas de una persona y recalcular, lectura del bloque de cierre (sin cerrar ni disparar diálogos).

**Rendimiento:** registro de cada sentencia SQL en el PostgreSQL local (`log_min_duration_statement = 0`) para contar consultas por pantalla y por acción; TTFB local con `curl` (5 corridas en caliente); TTFB público de producción con `curl`; Vercel Observability (P75 por ruta), Settings → Functions (región), tamaños de bundle de `next build` y análisis de chunks.

**Producción (solo lectura):** HTTP público, panel de Vercel, y una consulta `READ ONLY` a Neon para verificar si el límite de intentos es por IP (lo es).

## 3. Problemas UX

### UX-001 — No se puede hacer un reparto
- Pantalla: todas (menú en modo base).
- Problema: no existe ninguna pantalla para cargar propina/horas, calcular, cerrar ni entregar.
- Qué hizo el usuario: buscó en Inicio, Personal, Configuración y Mi sesión.
- Qué esperaba: "Nueva semana" / "Repartir propinas".
- Qué ocurrió: nada; `/semana` muestra "todavía no disponible".
- Evidencia: `DATABASE_VENUE_NAV = ['/', '/personal', '/configuracion']` (`src/components/layout/database-nav.ts`); `src/app/semana/page.tsx:11`; no hay servicios de semanas en `src/server/`.
- Impacto: el producto no cumple su propósito; abandono garantizado.
- Solución propuesta: ver *Flujo principal de reparto*.
- Prioridad: **P0**

### UX-002 — La app manda a una pantalla que no existe
- Pantalla: Configuración de distribución.
- Problema: dice que las horas/pozos/adelantos se cargan en "Semana actual", que no está en el menú.
- Qué hizo el usuario: leyó Configuración buscando dónde cargar la propina.
- Qué esperaba: un link a esa pantalla.
- Qué ocurrió: texto sin link a una sección inexistente.
- Evidencia: `src/components/config/distribution-config-view.tsx:116`.
- Impacto: confusión, sensación de producto roto.
- Solución propuesta: mientras no exista, quitar la frase; cuando exista, convertirla en link.
- Prioridad: **P0** (arreglo de una línea)

### UX-003 — El Inicio no dice qué hacer después de crear el restaurante
- Pantalla: `/`.
- Problema: 5 tarjetas en 0 (Repartos, Semanas, Adelantos, Sobres) sin acción, y el botón principal es "Crear otro restaurante".
- Qué hizo el usuario: acaba de crear su primer restaurante.
- Qué esperaba: "Siguiente paso: agregá a tu equipo → repartí tu primera semana".
- Qué ocurrió: tablero vacío; el CTA destacado lo invita a crear otro restaurante.
- Evidencia: `src/components/home/database-home.tsx`; captura del recorrido (Inicio con "Crear otro restaurante" arriba a la derecha).
- Impacto: el usuario no sabe cómo seguir.
- Solución propuesta: checklist de primeros pasos (1. Personal ✓/✗ con contador, 2. Revisar puestos (opcional), 3. Repartir la primera semana) y CTA "Repartir propinas de esta semana". "Crear otro restaurante" como link secundario en Mi sesión. Ocultar tarjetas de funciones que no existen o reemplazarlas por "Próximamente".
- Prioridad: **P0**

### UX-004 — No hay portada: el primer contacto es un login
- Pantalla: `/` sin sesión → `/login`.
- Problema: un visitante no sabe qué es GUTIP ni por qué registrarse.
- Evidencia: `src/app/page.tsx` redirige a `/login` sin sesión; `/login` solo dice "Entrá con el email y la contraseña de tu cuenta de GUTIP."
- Impacto: baja conversión del registro público.
- Solución propuesta: portada mínima (qué hace, 3 pasos, "Crear cuenta gratis" / "Ya tengo cuenta").
- Prioridad: **P1**

### UX-005 — Jerga sin explicar (porción, pozo, política, versión, sobres, puntos, Encargado)
- Pantalla: Personal, Configuración, Crear restaurante, Inicio.
- Problema: "porción 0,014", "política de distribución versión 1", "pozo", "sobres" aparecen sin definición; "Encargado" es un rol que no coincide con "Dueño" que ve el usuario.
- Evidencia: Inicio "política de distribución versión 1"; Personal "porción 0,014" en cada fila y en el selector; Configuración "Solo el Encargado puede cambiar la configuración." (`distribution-config-view.tsx:118`) mientras el usuario es "Dueño" (`ROLE_LABEL`, `src/server/access/roles.ts:16`).
- Impacto: el dueño no entiende qué significan los números que tiene que cuidar.
- Solución propuesta: glosario mínimo en el lugar ("Porción: cuánto pesa cada hora de este puesto en el reparto"); mostrar "valor de la hora" en vez de "porción" cuando hay un reparto; sacar "versión de la política" de Inicio; unificar roles (Dueño/Encargado).
- Prioridad: **P1**

### UX-006 — "Porción 0,014" es incomprensible como número
- Pantalla: Personal y Configuración.
- Problema: nadie piensa en "0,014"; el dueño piensa "un supervisor cobra menos por hora que un mozo" o "barra vale 1, bacha vale un tercio".
- Evidencia: selector "Supervisor (porción 0,014)".
- Impacto: miedo a tocar la configuración; errores al cambiarla.
- Solución propuesta: mostrar pesos relativos ("Salón 100 % · Supervisor 64 % · Bacha 32 %") o, en el reparto, "valor de la hora"; dejar el número exacto en el detalle.
- Prioridad: **P1**

### UX-007 — Configuración abruma a un usuario nuevo
- Pantalla: `/configuracion`.
- Problema: 10 secciones; en 8 hay opciones "Próximamente"; mezcla conceptos avanzados (grupos, fuentes, horas acumuladas) con lo único editable útil (puestos y porciones).
- Evidencia: texto completo de la pantalla (recorrido, paso 6).
- Impacto: ruido; el usuario no distingue qué importa.
- Solución propuesta: "Puestos y porciones" arriba; resto colapsado bajo "Reglas avanzadas (estándar)"; ocultar opciones "Próximamente" o agruparlas en una sola nota.
- Prioridad: **P1**

### UX-008 — "Fórmula provisional · Los importes son orientativos"
- Pantalla: Configuración (y cada semana en la demo).
- Problema: le dice al dueño que los importes pueden estar mal.
- Evidencia: bloque "Fórmula provisional… Todavía estamos validando la fórmula exacta de la planilla histórica. Los importes son orientativos."
- Impacto: pérdida de confianza justo en el dato que el producto promete.
- Solución propuesta: validar la fórmula (A4/P3/P4 de `PROGRESS.md`) antes de abrir el reparto a usuarios, o mostrar ese aviso solo al equipo interno.
- Prioridad: **P0** antes de lanzar el reparto; **P1** mientras no exista.

### UX-009 — Tarjeta "Mi sesión / Cerrar sesión" arriba de Configuración
- Pantalla: `/configuracion`.
- Problema: la pantalla empieza con el nombre, el email y "Cerrar sesión" antes que el título. Es un resto de la fase anterior (`SessionBar`).
- Evidencia: `src/app/configuracion/page.tsx` importa `SessionBar`; el texto de la página empieza con "Marta Dueña (marta-audit@example.com) · Dueño en … Mi sesión Cerrar sesión".
- Impacto: ruido; el botón de salir queda al lado de configuraciones importantes.
- Solución propuesta: quitarla (ya están el encabezado y Mi sesión).
- Prioridad: **P2** (quick win)

### UX-010 — Cambiar el puesto está escondido y se guarda con la primera flecha
- Pantalla: Personal.
- Problema: el control es la etiqueta de color del puesto (sin pista visual de que es un botón); al abrirse, el `<select>` guarda en `onChange`, así que con el teclado **la primera flecha ya guarda y cierra el selector** (verificado: dos flechas → quedó en la primera opción). No hay mensaje "Guardado" y queda el mensaje anterior ("Sofía Ramos se agregó al equipo.").
- Evidencia: `src/components/staff/staff-view.tsx:146-178` (`onChange` → `setEditing(false)` + acción).
- Impacto: cambios de puesto accidentales (cambian el reparto); accesibilidad de teclado.
- Solución propuesta: ícono/lápiz visible; guardar al confirmar (Enter/blur) o usar un menú; mensaje "Puesto de Sofía: Barra ✓" con "Deshacer".
- Prioridad: **P1**

### UX-011 — Puesto por defecto "Supervisor" al agregar personal
- Pantalla: Personal → Agregar persona.
- Problema: el primer puesto de la lista queda elegido; lo más común es agregar mozos/cocina.
- Evidencia: `staff-view.tsx:209-212` (usa `view.positions[0]`).
- Impacto: personas cargadas con el puesto equivocado → reparto equivocado.
- Solución propuesta: sin selección por defecto (obligar a elegir) o recordar el último puesto usado.
- Prioridad: **P1**

### UX-012 — Registro: errores de a uno y sin marcar el campo
- Pantalla: `/registro` (y `/login`).
- Problema: se muestra un solo error, abajo, sin resaltar el campo; no hay "mostrar contraseña"; no hay "¿Olvidaste tu contraseña?".
- Evidencia: recorrido paso 2 y 8.
- Impacto: fricción; un usuario que olvida la contraseña **no tiene forma de recuperarla** (pendiente A1, sin proveedor de email).
- Solución propuesta: errores por campo (`aria-invalid` + texto debajo), ojo para ver la contraseña; recuperación de contraseña cuando haya email.
- Prioridad: **P1** (recuperación: **P1**; resto: P2)

### UX-013 — "Crear restaurante" pierde el menú y no permite volver
- Pantalla: `/crear-restaurante` con un restaurante ya creado.
- Problema: la pantalla es de "cuenta" (sin menú); solo hay un link "Elegir uno en Mi sesión". Para el primer restaurante no hay forma de cerrar sesión ahí.
- Evidencia: `ACCOUNT_SCREENS` en `src/components/layout/app-shell.tsx:8`.
- Impacto: menor; puede sentirse como "me sacó de la app".
- Solución propuesta: si ya tiene restaurantes, mostrarla dentro del shell; en el primer uso, agregar "Salir".
- Prioridad: **P2**

### UX-014 — Mi sesión no permite gestionar nada
- Pantalla: `/cuenta`.
- Problema: no se puede cambiar nombre, email ni contraseña, renombrar el restaurante, invitar gente ni borrar la cuenta. El link final "Ir a Configuración de distribución" no tiene relación con la pantalla.
- Impacto: medio; el nombre del restaurante no se puede corregir si se escribió mal.
- Solución propuesta: renombrar restaurante (P1), cambiar contraseña (P1), invitaciones (P1 para locales con encargado).
- Prioridad: **P1**

### UX-015 — Navegación lenta sin feedback
- Pantalla: todas.
- Problema: sin `loading.tsx` ni indicador, un clic en el menú no muestra nada durante 1,5–4,7 s en producción.
- Evidencia: no existe ningún `loading.tsx`/`error.tsx` en `src/app` (Glob vacío); tiempos de PERF-001.
- Impacto: parece que la app "no responde"; clics repetidos.
- Solución propuesta: `loading.tsx` con esqueleto por sección + indicador de progreso en el menú; `error.tsx` con "Reintentar".
- Prioridad: **P0** (quick win mientras se ataca la causa)

### UX-016 — Demo: el reparto calcula en silencio con personas sin horas
- Pantalla: demo `/semana` (se trasladará al flujo real).
- Problema: si una persona queda sin horas, se reparte su parte entre los demás y solo cambia el contador "11 / 12".
- Evidencia: prueba con Jean vacío: Ivan pasó de $40.613,88 a $40.825,64 sin ningún aviso; el mensaje de cierre no menciona faltantes (`src/components/week/current-week.tsx:414-427`).
- Impacto: un olvido cambia el sobre de todos.
- Solución propuesta: aviso en vivo en la fila y confirmación explícita al cerrar.
- Prioridad: **P0** (al construir el flujo real)

### UX-017 — Demo: "Calcular" obligatorio y estado "volvé a calcular"
- Pantalla: demo `/semana`.
- Problema: fricción innecesaria; el cálculo es instantáneo.
- Evidencia: `current-week.tsx:419-420` ("Cambiaste datos: volvé a calcular antes de cerrar.").
- Solución propuesta: resultado en vivo.
- Prioridad: **P1** (al construir el flujo real)

### UX-018 — Demo: la vista previa muestra la matemática por defecto
- Pantalla: demo `/semana` y `/semanas/[id]`.
- Problema: la tabla del resultado tiene PORCIÓN, PUNTOS, %, IMPORTE, ADELANTO, TOTAL FINAL.
- Solución propuesta: vista simple (Persona, Horas, Le toca/Sobre) + "¿Cómo se calculó?".
- Prioridad: **P1**

### UX-019 — Enter no avanza entre campos de horas
- Pantalla: demo `/semana`.
- Evidencia: Enter en "Horas de Nardelli" dejó el foco en el mismo campo; Tab sí avanza.
- Solución propuesta: Enter → siguiente persona (en móvil, botón "Siguiente").
- Prioridad: **P2**

## 4. Problemas de rendimiento

> Base de las mediciones. **Producción**: Vercel Observability → Functions, ventana de 12 h, P75 por ruta (incluye cold starts; las acciones del servidor cuentan en la ruta donde se ejecutan); `curl` desde Argentina a `sistema-propinas.vercel.app`. **Local**: `next start` + PostgreSQL local (latencia de red ≈ 0), conteo de sentencias por pedido con `log_min_duration_statement = 0`. **No pude medir** tiempos autenticados en producción directamente (no inicié sesión allí); los estimo multiplicando consultas encadenadas × latencia entre regiones, y coinciden con los P75 observados.

### PERF-001 — Funciones y base en continentes distintos (causa principal)
- Pantalla: todas las que consultan la base.
- Tiempo medido/aproximado: P75 **/configuracion 4,67 s, /api/auth 4,28 s, /login 3,2 s, / 1,57 s, /personal 1,47 s, /cuenta 835 ms** (Vercel). Local, mismas pantallas: **10–19 ms**.
- Qué está esperando: consultas a Neon.
- Causa probable: **Vercel ejecuta las funciones en `iad1` (Washington)** — Settings → Functions → Function Region = `iad1`; encabezado `x-vercel-id: gru1::iad1` — y **Neon está en `sa-east-1` (São Paulo)** (host de `DATABASE_URL`; `PROGRESS.md` §5 "región São Paulo"). Cada consulta hace una ida y vuelta Washington↔São Paulo (típicamente ~110–130 ms; **no medido** desde Vercel). Con 8–10 consultas encadenadas por pedido → ~1–1,5 s solo de red, que coincide con /personal y /.
- Código involucrado: configuración del proyecto en Vercel (no código).
- Evidencia: panel de Vercel (región), Observability (P75), 20–21 consultas por pantalla medidas localmente (PERF-002).
- Solución propuesta: **cambiar la región de funciones a `gru1` (São Paulo)**, la misma región que Neon (Hobby permite 1 región; requiere redeploy). Además los usuarios están en Argentina: también baja el trayecto usuario→función. No requiere código.
- Impacto: estimado **−70 a −90 %** del tiempo de servidor en cada pantalla y acción.
- Prioridad: **P0**

### PERF-002 — Sesión y acceso se resuelven dos veces por pedido
- Pantalla: todas con sesión.
- Tiempo medido/aproximado: local, sentencias por pedido: **/ 21 · /configuracion 21 · /personal 20 · /cuenta 13 · /login (con sesión) 9 · /historial (placeholder) 7**.
- Qué está esperando: el layout (`shellAccount`) y la página (`requireAccess`) hacen cada uno: sesión (`sessions`, `users`) → restaurante activo (`memberships`+`restaurants`) → membresía (`memberships`, `restaurants`, `users`). Log de `/`: `sessions` ×2, `users` ×2, `memberships`+`restaurants` ×2, verificación de membresía ×2, `restaurants` ×2, `users IN` ×2.
- Causa probable: `getSessionUser`, `activeRestaurantId` y `requireAccess` no usan `React.cache()`, y no hay middleware; cada Server Component los vuelve a ejecutar.
- Código involucrado: `src/app/layout.tsx:26-45` (`shellAccount`), `src/server/auth/session.ts:28`, `src/server/access/request.ts` (`activeRestaurantId`, `requireAccess`).
- Evidencia: listado de sentencias por pedido (dos conexiones distintas repitiendo la misma cadena).
- Solución propuesta: envolver `getSessionUser` y una nueva `getRequestAccess()` con `cache()` de React (memoización por pedido) y reutilizarla en layout y página. Sin cambios de seguridad (sigue validando en cada pedido).
- Impacto: ~−50 % de consultas por pantalla.
- Prioridad: **P0**

### PERF-003 — Cada `include`/`select` de relación es otra ida y vuelta
- Pantalla: todas.
- Qué está esperando: `membership.findUnique({ select: { restaurant, user } })` genera 3 consultas encadenadas; la política con posiciones genera 4 (`distribution_policy_versions` → `users` → `policy_version_positions` → `positions`).
- Causa probable: Prisma 6 carga relaciones con la estrategia "query" (una consulta por relación) por defecto.
- Código involucrado: `src/server/access/access.ts:62-69` (`resolveAccess`), `pickActiveRestaurant`, `src/server/policy/repository.ts`, `src/server/staff/repository.ts`.
- Evidencia: log local (`SELECT memberships` → `SELECT restaurants` → `SELECT users` en la misma conexión, en serie).
- Solución propuesta: `relationLoadStrategy: 'join'` (preview `relationJoins` de Prisma 6) o una consulta con `JOIN` para la resolución de acceso; cargar la política con sus posiciones en una sola consulta.
- Impacto: −30 a −40 % de idas y vueltas en cada pedido; con la región mal ubicada, ~0,3–0,5 s por pantalla.
- Prioridad: **P1**

### PERF-004 — Una acción cuesta ~38 sentencias (acción + re-render completo)
- Pantalla: Personal (y Configuración, que es peor).
- Tiempo medido/aproximado: "Agregar persona" = **~18 sentencias en serie en la acción** (sesión, restaurante activo, membresía, `BEGIN`, restaurante, política, usuario, posiciones, puestos, empleados, `INSERT`, `COMMIT`) **+ ~20 del re-render** = 38. Con la latencia actual: estimado **~3 s** por clic. /configuracion (P75 4,67 s) incluye las acciones de cambio de política, que son transacciones más largas.
- Causa probable: PERF-001 + PERF-002 + PERF-003; además `revalidatePath('/personal')` y `revalidatePath('/configuracion')` en cada acción (`src/app/personal/actions.ts:42-44`) fuerzan re-render del árbol completo, incluido el layout.
- Código involucrado: `src/app/personal/actions.ts`, `src/server/staff/service.ts`, `src/server/policy/*`.
- Solución propuesta: resolver acceso una vez por acción (ya se hace) pero sin volver a leer la política completa dentro de la transacción si solo hace falta validar el puesto (una consulta `EXISTS`); UI optimista en Personal (`useOptimistic`) para que la fila aparezca al instante.
- Impacto: acciones percibidas como instantáneas; menos carga en Neon.
- Prioridad: **P1**

### PERF-005 — Cada llamada a `/api/auth/*` hace 4 consultas del límite de intentos
- Pantalla: login, registro, logout, `get-session`.
- Tiempo medido: producción, `GET /api/auth/get-session` **sin sesión**: 0,87–1,15 s en caliente, **2,9–3,7 s** algunas veces; una página sin base tarda 0,28–0,30 s. P75 de `/api/auth` = 4,28 s.
- Qué está esperando: rate limit en base: `SELECT` ×2, `UPDATE`, `DELETE` de expirados (verificado localmente) **antes** de hacer el trabajo real, cada uno cruzando continentes; el login suma el hash scrypt (CPU) y las consultas de usuario/cuenta/sesión.
- Causa probable: `rateLimit.storage: 'database'` (`src/server/auth/auth.ts:84-92`) aplica también a rutas no sensibles (`/get-session`, `/ok`).
- Código involucrado: `src/server/auth/auth.ts`.
- Solución propuesta: con PERF-001 resuelto, el costo cae mucho. Además: limitar el rate limit en base a `/sign-in/email` y `/sign-up/email` (`customRules` con `false` para el resto o `storage` secundario en memoria para rutas no sensibles). La app no llama a `get-session` desde el navegador (verificado: no hay `useSession`), así que el impacto real es en login/registro/logout.
- Impacto: login y registro ~1–2 s más rápidos en producción.
- Prioridad: **P1**

### PERF-006 — Sin `loading.tsx`: la espera no se ve
- Ver UX-015. Prioridad **P0** (percepción).

### PERF-007 — El código de la demo viaja a todos los usuarios reales
- Pantalla: todas.
- Tiempo medido/aproximado: el chunk compartido `992-…js` (**30 KB** sin comprimir) contiene el demo-store (`gutip-demo-v2`, `localStorage`, "Restaurante demo") y lo cargan **todas** las rutas; el layout (19 KB) incluye `DemoShell` ("Modo demo"). First Load JS por ruta: 103–148 KB.
- Causa probable: `AppShell` (cliente) importa `DemoShell` y `DatabaseShell` estáticamente (`src/components/layout/app-shell.tsx:4-5`); la elección es en tiempo de ejecución.
- Solución propuesta: elegir el shell en el servidor (layout) y pasar solo el que corresponde, o `next/dynamic` para `DemoShell`.
- Impacto: pequeño en velocidad (~10–15 KB comprimidos), mayor en limpieza (el usuario real no debería descargar la demo).
- Prioridad: **P2**

### PERF-008 — `/login` con sesión ejecuta el layout completo
- Pantalla: `/login`, `/registro`, `/crear-restaurante`.
- Qué está esperando: `RootLayout` calcula `shellAccount()` (sesión + restaurante + membresía) aunque esas pantallas no muestran el shell; `/login` con sesión: 9 sentencias.
- Código involucrado: `src/app/layout.tsx:47-49`.
- Solución propuesta: mover el shell a un layout de grupo de rutas (`(app)/layout.tsx`) y dejar las pantallas de cuenta fuera; con PERF-002 se comparte la sesión.
- Prioridad: **P2**

### PERF-009 — Conexión directa a Neon (sin pooler) desde funciones
- Qué está esperando: en cada instancia nueva de función (6,4 % de cold starts según Observability), Prisma abre TCP + TLS directo a Neon.
- Evidencia: el `DATABASE_URL` local apunta al host **directo** (sin `-pooler`); `PROGRESS.md` §5 lo documenta. **No verifiqué** cuál usa Vercel (no leí la variable).
- Solución propuesta: usar el host `-pooler` de Neon para la app (y el directo solo para migraciones).
- Impacto: menos latencia en cold starts y protección ante picos de conexiones.
- Prioridad: **P1** (verificar primero)

## 5. Problemas técnicos detectados

Solo los que afectan al producto:

- **Falta la capa de servidor del flujo operativo** (semanas, horas, propina, cierre, sobres, adelantos). Esquema y motor listos; `src/server/` no tiene servicios para ellos. → bloquea el producto (UX-001).
- **Fórmula marcada como provisional** (`PROGRESS.md` §10, A4/P3/P4/P7): la app no debería presentar importes "orientativos" a usuarios reales (UX-008). Decidir con la planilla real antes de abrir el reparto.
- **Doble resolución de sesión/acceso por pedido** sin `cache()` (PERF-002) y relaciones en consultas separadas (PERF-003).
- **Región de funciones ≠ región de la base** (PERF-001).
- **Sin `error.tsx`**: un error de base en una pantalla muestra el error genérico de Next en vez de "Reintentar" (Configuración maneja su propio error; Personal/Inicio dependen del manejo de cada página).
- **Límite de intentos**: verificado en producción que es **por IP** (las claves de `auth_rate_limits` en Neon tienen IPs reales, no la IP vacía que aparece en local). El pendiente "IP del cliente" de `PROGRESS.md` §11 queda en la práctica resuelto para Vercel; conviene documentarlo.
- **Personal: el selector de puesto guarda en `onChange`** (UX-010), riesgo de cambios accidentales.

## 6. Funcionalidades que faltan

### Necesarias
Sin ellas el flujo principal queda incompleto.
- Reparto de la semana: propina (total) + horas + resultado + cierre, guardado en la base.
- Resultado simple por persona y detalle "¿Cómo se calculó?".
- Avisos de datos faltantes (personas sin horas, propina vacía) y confirmación de cierre.
- Inicio con guía de primeros pasos y CTA al reparto.
- Validación de la fórmula (o, como mínimo, retirar "importes orientativos" de la vista del dueño).

### Importantes
Mejorarían mucho el uso diario.
- Sobres: preparar, entregar, revertir con motivo, **imprimir planilla con firma**.
- Adelantos dentro del reparto (con saldo que pasa a la semana siguiente).
- Historial de repartos cerrados (con total por mes).
- Anular y rehacer un reparto cerrado.
- Carga de propina por día (opcional) y "pegar horas desde planilla".
- Recuperación de contraseña (requiere email, A1) y cambio de contraseña.
- Renombrar restaurante.
- Invitaciones y roles (encargado que carga, dueño que cierra).

### Futuras
- Vista del empleado ("Mis sobres") con su detalle.
- Exportar a Excel/CSV/PDF; reportes por período y por persona.
- Varias fuentes de propina (efectivo/tarjeta/recepción), pozos separados, % por grupo.
- Carga de horas por día / integración con reloj o POS.
- Notificaciones (sobre listo para retirar), recordatorio de cierre semanal.
- Búsqueda/filtros en Personal para 50+ personas.
- Multi-moneda (USD, ya contemplado en el motor).

## 7. Quick Wins

1. **Cambiar la región de funciones de Vercel a `gru1`** (sin código; redeploy). PERF-001.
2. `React.cache()` en `getSessionUser` y en una función de acceso por pedido. PERF-002.
3. `loading.tsx` (esqueletos) en `/`, `/personal`, `/configuracion`, `/cuenta` + `error.tsx` con "Reintentar". UX-015.
4. Quitar la frase "se cargan en Semana actual" de Configuración mientras no exista. UX-002.
5. Inicio: reemplazar "Crear otro restaurante" como botón principal por una guía de primeros pasos. UX-003.
6. Quitar la tarjeta de sesión de arriba de Configuración. UX-009.
7. Personal: sin puesto preseleccionado; limpiar el mensaje anterior al hacer otra acción. UX-011, UX-010.
8. Limitar el rate limit en base a login/registro. PERF-005.
9. Usar el host `-pooler` de Neon para la app (verificar la variable en Vercel). PERF-009.

## 8. Mejoras de alto impacto

1. **Flujo "Reparto de la semana" conectado a la base** (servicios + acciones + pantalla + cierre + resultado). Es el producto.
2. **Sobres e impresión** (lo que convierte el cálculo en dinero entregado, con trazabilidad).
3. **Onboarding guiado** de punta a punta (portada → registro → restaurante → personal → primer reparto), con estados vacíos accionables.
4. **Rediseño del lenguaje**: "valor de la hora por puesto" en lugar de porciones/puntos; Configuración simple + avanzada.
5. **Rendimiento estructural**: región + `cache()` + joins + UI optimista en acciones.

## 9. Problemas para un usuario que entra por primera vez

"Si yo no conozco GUTIP, ¿en qué momentos no sé qué hacer?"

1. **Al entrar**: me piden iniciar sesión sin decirme qué es esto.
2. **Al crear el restaurante**: "configuración estándar de distribución" — no sé qué es ni si tengo que tocarla.
3. **Justo después de crear el restaurante**: tablero en ceros; el botón grande me ofrece crear otro restaurante. No sé cuál es el paso 1.
4. **En Personal**: "porción 0,014" — no sé si está bien; el puesto por defecto es Supervisor y no me doy cuenta.
5. **Cuando quiero repartir**: no hay dónde. Configuración me manda a "Semana actual", que no existe.
6. **En Configuración**: 10 secciones, muchas "Próximamente", y un aviso de que los importes son orientativos: dudo del producto.
7. **Al navegar en producción**: hago clic y durante 1,5–4,7 s no pasa nada visible; vuelvo a hacer clic.
8. **Si olvido la contraseña**: no hay forma de recuperarla.

## 10. P0 — Prioridad máxima

### P0 para poder hacer el primer reparto

Validé la lista propuesta (Nuevo reparto → período → propina → horas → cálculo → revisión → cierre). La simplifico: **período, cálculo y revisión no son pasos del usuario** (son automáticos o en vivo). Lista concreta:

1. **Servidor del reparto**: abrir/retomar la semana en curso (período `OPEN` fijado a la política vigente), guardar la propina total, guardar horas por persona, vista previa con la misma función que el cierre, cerrar (snapshot, `calc_version`, ítems, sobres `PENDING`). Con `requireAccess` y los bloqueos documentados.
2. **Pantalla "Reparto de la semana"** (`/semana`) en modo base: semana sugerida, **propina total**, **tabla de horas** con Tab/Enter, **"Le toca" en vivo**, avisos de faltantes, **"Cerrar reparto"** con confirmación y resumen.
3. **Pantalla del reparto cerrado** (`/semanas/[id]`): resultado simple por persona + "¿Cómo se calculó?" + imprimir.
4. **Inicio con CTA "Repartir propinas de esta semana"** y guía de primeros pasos; menú con "Reparto" como primer ítem operativo.
5. **Decidir la fórmula** (o retirar "importes orientativos" de la vista del dueño).
6. **Agregar persona desde el reparto** (sin salir del flujo).

### P0 de rendimiento y percepción
7. Región de funciones = región de la base (PERF-001).
8. `cache()` de sesión/acceso por pedido (PERF-002).
9. `loading.tsx` / `error.tsx` (UX-015).
10. Quitar la referencia a "Semana actual" mientras no exista (UX-002).

## 11. P1 — Siguiente etapa

- Sobres: preparar/entregar/revertir con motivo, planilla imprimible con firma.
- Adelantos en el reparto (saldo a la semana siguiente).
- Historial de repartos cerrados; anular y rehacer.
- Carga de propina por día (opcional) y "pegar horas".
- Jerga: "valor de la hora" y glosario en el lugar (UX-005, UX-006); Configuración simple/avanzada (UX-007).
- Personal: cambio de puesto seguro (UX-010), sin puesto por defecto (UX-011).
- Recuperación y cambio de contraseña; renombrar restaurante; errores por campo.
- Portada pública (UX-004).
- Invitaciones y roles (encargado carga, dueño cierra).
- PERF-003 (joins), PERF-004 (acciones más livianas + UI optimista), PERF-005 (rate limit solo donde hace falta), PERF-009 (pooler).

## 12. P2 — Mejoras futuras

- "Mis sobres" para empleados; exportaciones y reportes; notificaciones.
- Varias fuentes/pozos/grupos; horas por día; integración POS/reloj.
- Búsqueda y filtros para equipos grandes.
- Quitar la demo del bundle de producción (PERF-007); layout de grupo para pantallas de cuenta (PERF-008).
- Tarjeta de sesión en Configuración (UX-009), menú en "Crear restaurante" (UX-013), Enter entre campos (UX-019).

## 13. Recorrido ideal de un usuario nuevo

Adaptado a GUTIP real. **[FALTA]** = no existe hoy con base de datos; **[DEMO]** = existe solo en la demo; **[OK]** = funciona en producción.

```
ENTRAR               Portada: qué es GUTIP en 3 pasos → "Crear cuenta"            [FALTA]
  ↓
REGISTRARSE          Nombre, email, contraseña                                     [OK]
  ↓
CREAR RESTAURANTE    Nombre → queda como Dueño, con reglas estándar                [OK]
  ↓
CONFIGURAR           (Opcional) Revisar puestos y "cuánto vale cada hora"          [OK, con jerga]
  ↓
AGREGAR PERSONAL     Nombre + puesto (sin puesto por defecto)                      [OK]
  ↓
CREAR PRIMER PERÍODO Automático al entrar a "Reparto de la semana"                 [DEMO → FALTA en base]
  ↓
CARGAR DATOS         Propina total (o por día) + horas de cada persona             [DEMO → FALTA en base]
  ↓
CALCULAR             En vivo, "Le toca" al lado de cada persona                    [DEMO con botón → FALTA en base]
  ↓
CERRAR               Confirmación con resumen y avisos                             [DEMO → FALTA en base]
  ↓
PAGAR/ENTREGAR       Sobres: preparar, entregar, imprimir planilla con firma       [DEMO → FALTA en base]
  ↓
HISTORIAL            Repartos cerrados, total por mes, anular y rehacer            [DEMO → FALTA en base]
```

---

## Arquitectura UX y roadmap (respuesta al punto 9 del pedido)

- **¿Construir primero un "Reparto" operativo?** Sí. Es la razón de ser del producto y el único bloqueo real. Todo lo demás (Historial, Sobres, Acceso) depende de que existan repartos.
- **¿"Semana" debe ser la pantalla principal?** Sí, pero renombrada para el usuario: **"Reparto"** o **"Reparto de la semana"** (el período puede ser semanal hoy y quincenal mañana; la política ya lo contempla). El Inicio debe llevar a ella con un solo clic, y cuando hay un reparto en curso, mostrar su estado ("Faltan horas de 2 personas").
- **¿Historial debe mostrar repartos cerrados?** Sí: lista de repartos cerrados (semana, total, estado de sobres) + total por mes. Es la segunda pantalla que el dueño va a usar.
- **¿Mis sobres solo cuando existe un reparto?** Mis sobres es una vista **del empleado** (rol SELF): solo tiene sentido cuando hay invitaciones. Para el dueño, los sobres viven **dentro del reparto cerrado** ("Sobres de esta semana"). No debe ser un ítem de menú del dueño.
- **¿Hace falta un dashboard?** Un Inicio liviano sí: estado del reparto en curso + CTA + último reparto cerrado + guía de primeros pasos. No un tablero de métricas (eso es P2).

Menú propuesto (dueño):
```
Inicio
Reparto           ← semana en curso (o "Empezar")
Historial         ← repartos cerrados (y sus sobres)
Personal
Configuración     ← puestos y reglas (avanzado colapsado)
───
Mi cuenta         ← sesión, restaurantes, (luego) acceso/invitaciones
```

## Cómo cargar las horas (punto 5 del pedido)

| Alternativa | Ventajas | Desventajas | Veredicto |
|---|---|---|---|
| **A) Tabla: una fila por persona con el total de horas** | Lo más rápido: N datos. Es como trabaja Library (horas totales de la semana, confirmado en `PROGRESS.md` §10 P1). Tab/Enter permite cargar 30 personas en ~1 minuto | No guarda el detalle diario | **Opción principal** |
| B) Carga por día (lun 8 h, mar 8 h…) | Detalle y control; sirve para "reparto diario" futuro | 7× más datos: 50 personas = 350 campos. Inviable en celular | Opcional, por persona ("Cargar por día ▸" que suma al total) y cuando la política lo exija (`hours_entry` por día, hoy "Próximamente") |
| C) Semanal directo | = A | = A | = A |
| D) Combinación | A por defecto; B desplegable por persona; "pegar columna" desde Excel | Algo más de diseño | **Recomendada: A + desplegable B + pegar** |

Para 20–50 empleados: A con orden por puesto, buscador, Tab/Enter y "pegar desde planilla". El esquema ya guarda horas del período (`period_hours`, con tope de 24 × días del período en la base).

## Cómo cargar la propina (punto 6 del pedido)

| Alternativa | Veredicto |
|---|---|
| **Un único total del período** | **Principal.** Es lo que usa Library (la demo trae la semana de la planilla con el pozo "como un único total"). Un campo |
| Propina diaria (lun $45.000, mar $52.000…) | **Opcional**: "Cargar por día ▸" despliega 7 campos que suman el total (la demo ya los tiene como principal, pero obliga a elegir un día para un total semanal: en la prueba tuve que poner $347.990 en "sábado"). El modelo (`tip_entries` con fecha) lo soporta |
| Efectivo / digital / varias fuentes | **Futuro** (P5 de la política: "Varias fuentes sumadas", "Pozos separados" = Próximamente). En la UI: campos extra dentro del día o del total, que suman al pozo. No mostrar hasta que la política lo active |

Recomendación de UX: el campo "Propina a repartir" acepta el total; el link "Cargar por día" cambia a modo diario y el total se vuelve de solo lectura (suma). Si ya hay datos diarios, el total no se puede editar directamente (evita inconsistencias).

## Competencia y referencias (punto 10 del pedido)

### Lo que observé en otros productos
- **Toast Tips Manager**: vista general por día con **columna de estado** ("Ready" cuando el cálculo está listo para revisar); se entra a la vista "By Day" para ver lo de cada empleado; cada pozo se **expande con un caret** para ver la matemática de lo que aporta y recibe cada uno; se **aprueba** para finalizar, y para modificar hay que **desaprobar** primero. ([Toast: reporting](https://support.toasttab.com/en/article/Tips-Receipt-and-Tip-Policy-Preview), [Get started](https://support.toasttab.com/en/article/Getting-Started-with-Toast-Tips-Manager-How-to-Pool-Share-Tips))
- **7shifts**: reglas preconfiguradas (por horas, % de ventas, puntos) aplicadas automáticamente a los datos que llegan del POS; ejemplo de "point-hours" (horas × puntos) igual al modelo de GUTIP. ([7shifts tip pooling](https://www.7shifts.com/tip-pooling/), [7shifts + Toast](https://kb.7shifts.com/hc/en-us/articles/13166056874771-Tip-Pooling-for-Toast-POS))
- **TipHaus**: sincroniza tips y horas del POS; una **"Breakdown Page"** tipo planilla con horas, parte de la propina, totales y "take-home" por empleado; el empleado ve su desglose en la app antes del pago; exportación a nómina "en 2 clics". ([TipHaus](https://www.tiphaus.com/blog/stressed-about-tip-pooling-theres-a-software-for-that/), [TipHaus home](https://www.tiphaus.com/))
- **Homebase Tip Manager**: horas del reloj + tips del POS; "configurar el pozo en minutos"; los empleados ven lo que ganaron en la app; el argumento de venta es "es mi planilla, pero sola". ([Homebase](https://www.joinhomebase.com/tip-manager), [comparativa](https://www.joinhomebase.com/blog/restaurant-tip-pooling-software))
- Patrón general: casi todos **evitan la carga manual** integrándose al POS y al reloj; el cálculo por horas es el método más usado; la matemática está disponible pero **plegada**.

(No pude abrir algunas páginas de ayuda de 7shifts y Homebase: 403 o contenido que se carga con JavaScript; no afirmo nada que no haya leído.)

### Lo que recomiendo para GUTIP
- **Estado visible por reparto** (En curso / Listo para cerrar / Cerrado / Sobres entregados), como el "Ready/Approved" de Toast.
- **Detalle plegable** ("¿Cómo se calculó?") en vez de columnas técnicas por defecto.
- **Cerrar = aprobar**; corregir = **anular y rehacer** con motivo (GUTIP ya lo tiene diseñado, más estricto que "desaprobar").
- **Vista tipo planilla** para quien la quiere (desktop), sin imponerla.
- Como GUTIP **no** tiene POS ni reloj (y sus usuarios manejan efectivo), su ventaja debe ser **la carga manual más rápida posible** (total + horas + pegar desde planilla) y **la planilla de sobres con firma**, no integraciones.

---

## Anexo — Evidencia de mediciones

**Producción (Vercel Observability, Functions, últimas 12 h, P75 de duración):**
`/configuracion 4,67 s (94 inv.) · /api/auth/[...all] 4,28 s (17) · /login 3,2 s (25) · / 1,57 s (9) · /personal 1,47 s (28) · /cuenta 835 ms (27) · /index 670 ms · /crear-restaurante 515 ms · /semanas/[id] 500 ms · /historial 300 ms`. Cold starts 6,4 %. Región de funciones: `iad1`. Neon: `sa-east-1`.

**Producción, TTFB público con `curl` (sin sesión):** `/login` 1,42 / 1,20 (frío) → 0,29–0,39 s; `/registro` ~0,29 s; `/personal` (redirección) ~0,29 s; `/icon.svg` (estático) 0,16 s; `/api/auth/get-session` 0,87–1,15 s (a veces 2,9–3,7 s).

**Local (`next start` + PostgreSQL local), TTFB en caliente y sentencias por pedido:**

| Ruta | Sentencias | TTFB (5 corridas) |
|---|---:|---|
| `/` | 21 | 14–19 ms |
| `/personal` | 20 | 13–16 ms |
| `/configuracion` | 21 | 14–16 ms |
| `/cuenta` | 13 | 10–12 ms |
| `/historial` (placeholder) | 7 | 9–12 ms |
| `/login` (con sesión) | 9 | 10–11 ms |
| `/api/auth/get-session` | 4–5 | 9–11 ms |
| Acción "Agregar persona" + re-render | ~38 | — |

**Bundles (`next build`)**: First Load JS compartido 103 kB; por ruta 104–148 kB (`/configuracion` 148 kB, `/semana` 144 kB, `/` 139 kB). Chunk con demo-store cargado por todas las rutas: 30 KB sin comprimir.

**Caso Library en la demo** (fórmula provisional actual): total 5,398 puntos; $64.466,47 por punto; resultados en la tabla del *Ejemplo completo*; con Jean sin horas, Ivan pasa a $40.825,64 (su parte se redistribuye sin aviso).

**Datos creados (solo locales, base `gutip_audit` descartable):** cuentas `marta-audit@example.com` y restaurante "Parrilla La Esquina" con 3 personas; en la demo (localStorage de `localhost:3001`) una semana abierta 28/9–4/10/2026 con el caso Library. Nada en producción.
