# 🕒 Flujo de Asistencias QR — Guía técnica

Documentación del módulo de asistencias por código QR: cómo funciona hoy,
componentes involucrados, ciclo de vida del token, y el fix de rendimiento/UX
aplicado en la auditoría de 2026 (throttle de rotación).

> **Alcance:** este documento cubre el flujo de *entrada/salida de docentes*
> vía `/scan`, no el resto del sistema de horarios. Para roles y permisos
> generales ver `SECURITY.md`.

---

## 1. Componentes involucrados

| Archivo | Rol |
|---|---|
| `src/hooks/useQRSession.js` | Hook que vive en `App.jsx`. Gestiona el ciclo de vida completo de la sesión QR: creación, countdown, rotación del token, recuperación tras recarga. |
| `src/components/asistencias/AdminQRPanel.jsx` | Panel del admin/`operador_qr`: configura turno/programa/fecha, inicia/cierra la sesión, muestra el QR, el feed de actividad y el contador de entradas/salidas. |
| `src/components/asistencias/QRProyeccion.jsx` | Vista de solo-proyección (pantalla/proyector del aula) — el QR y las instrucciones, nada de controles administrativos. |
| `src/components/asistencias/DocenteScan/index.jsx` | Página pública que abre el docente al escanear (`/scan?token=...`). Sin sesión Supabase, acceso anónimo. |
| `docs/supabase/migrations/0006_modulo_asistencias_qr.sql` | Esquema (`qr_sessions`, `asistencias_diarias`) y RPCs base (`crear_qr_session`, `renovar_qr_token`, `registrar_asistencia`). |
| `docs/supabase/migrations/0039_rate_limit_scan.sql` | Rate limiting por `device_fingerprint` sobre `registrar_asistencia`. |
| `docs/supabase/migrations/0058_arch32_backoff_progresivo_scan.sql` | Backoff progresivo (**ARCH-32**) sobre el mismo rate limit. |
| `docs/supabase/migrations/0059_arch33_fix_race_condition_rate_limit.sql` | Fix de condición de carrera real (**ARCH-33**) en `registrar_asistencia`. |

---

## 2. Flujo end-to-end

```mermaid
sequenceDiagram
    participant Admin as Operador (AdminQRPanel)
    participant DB as Supabase (qr_sessions)
    participant Screen as Proyección (QRProyeccion)
    participant Docente as Docente (DocenteScan)

    Admin->>DB: crear_qr_session(turno, programa, fecha)
    DB-->>Admin: session_id, token, expires_at
    Admin->>Screen: QR con /scan?token=X

    Docente->>Docente: escanea QR (token X)
    Docente->>DB: registrar_asistencia(token=X, cedula, nombre, tipo)
    DB-->>Docente: ok / error

    DB->>DB: INSERT en asistencias_diarias
    DB-->>Admin: evento Realtime (INSERT)
    Admin->>DB: renovar_qr_token() [acotado por throttle, ver §4]
    DB-->>Screen: nuevo token Y (el QR proyectado cambia)
```

### 2.1 Docente recurrente (ya escaneó antes en este dispositivo)

1. Escanea → la app valida que el token corresponde a una sesión **de hoy**
   (evita mostrar datos de un docente anterior en el mismo dispositivo).
2. Ve sus datos guardados (`localStorage`) y solo confirma Entrada/Salida.
3. Un solo tap → `registrar_asistencia` → resultado.

### 2.2 Docente primerizo (o cambió de dispositivo)

1. Escanea → formulario de cédula + nombre.
2. Autocompletado: busca primero en `docentes` (catálogo de horarios) y si
   no está vinculado, en el último registro que ese mismo docente haya hecho
   en `asistencias_diarias` (debounce de 450 ms).
3. Pantalla de verificación de datos ("un número equivocado te registra como
   otra persona") antes de confirmar.
4. Al confirmar con éxito, los datos quedan guardados localmente para la
   próxima vez.

**Persistencia de borrador (UX-33, 8 ago):** mientras el primerizo escribe,
lo tecleado se guarda con debounce en una clave de `localStorage` separada
(`pnf_docente_borrador`, TTL de 20 minutos) — **nunca** se mezcla con la
clave de identidad ya confirmada (`pnf_docente_datos`). Si el token rota
antes de que termine de escribir (ver §3/§4) y tiene que reescanear, el
formulario se precarga con lo que ya había tecleado, con aviso de que es un
borrador recuperado. Se borra automáticamente al confirmar el registro con
éxito. El TTL corto (frente a las 12h de `LS_TIMEOUT_HORAS` para datos
confirmados) acota la ventana en la que un dispositivo compartido podría
precargar el nombre/cédula de alguien que nunca completó su registro.

---

## 3. Ciclo de vida del token

El TTL configurado es de **5 minutos**, pero en la práctica el token rota por
tres vías independientes — el TTL es el techo, no la cadencia real:

| Disparador | Mecanismo | Immediatez |
|---|---|---|
| **Escaneo exitoso** (uno o varios) | Suscripción Realtime a `INSERT` en `asistencias_diarias` | Pasa por el **throttle** (§4) |
| **Respaldo por si Realtime falla** | Poll cada 7s que compara el conteo de registros de la sesión | Pasa por el mismo throttle |
| **Vencimiento de TTL** | `setInterval` que renueva 15s antes de `expires_at` | Inmediato, sin throttle |
| **Manual** | Botón "Regenerar QR ahora" en `AdminQRPanel` | Inmediato, sin throttle |

La rotación no es "agregar un token válido más": `renovar_qr_token` hace
`UPDATE qr_sessions SET token = nuevo`, sobre una columna `UNIQUE`. El token
anterior deja de existir — no hay ventana de gracia a nivel de base de datos.
`registrar_asistencia` busca `WHERE token = p_token`; si ya rotó, no hay
match y devuelve `TOKEN_INVALIDO`.

---

## 4. Fix: throttle de rotación por escaneo (auditoría 2026)

### 4.1 El problema

Antes de este fix, **cada** escaneo exitoso rotaba el token al instante. En
hora pico (varios docentes escaneando el mismo QR casi a la vez), el primer
registro exitoso invalidaba el token para todos los que seguían a mitad del
formulario. Consecuencias:

- Docentes recurrentes: mensaje de "vuelve a escanear" — molesto pero
  rápido de resolver (sus datos ya estaban guardados localmente).
- Docentes primerizos: si perdían la carrera, no había pantalla de
  recuperación equivalente — reescribían cédula y nombre desde cero,
  compitiendo otra vez contra el siguiente escaneo.
- Cada intento fallido por token viejo también consume una unidad del
  rate limit por `device_fingerprint` (10 intentos/hora) — una ráfaga de
  colisiones podía acercar a un docente al bloqueo sin que hubiera hecho
  nada indebido.

### 4.2 La solución

`useQRSession.js` — throttle con **trailing edge** sobre las dos fuentes de
"rotar porque hubo un escaneo" (Realtime y el poll de respaldo). La rotación
por TTL y la manual **no** pasan por el throttle; siguen siendo inmediatas.

```js
const ROTACION_ESCANEO_MIN_INTERVALO_MS = 12000; // 12s
```

Comportamiento:

1. Si ya pasaron 12s desde la última rotación por escaneo → rota de
   inmediato (caso normal, un solo docente escaneando).
2. Si no, y no hay ya una rotación pendiente agendada → agenda **una sola**
   rotación para el tiempo que falte hasta completar los 12s. Si llegan más
   escaneos mientras tanto, no se agenda un timer nuevo por cada uno — se
   reutiliza el mismo trailing.

Esto da dos garantías:

- **Cota superior:** ningún token dura más de ~12s de actividad sin rotar,
  aunque haya una ráfaga continua — el conteo nunca se reinicia con cada
  evento nuevo (evita el problema típico de un debounce puro, que puede
  posponerse indefinidamente si el tráfico no para).
- **Cota inferior:** sin actividad, no hay timers de fondo corriendo.

### 4.3 Trade-off de seguridad (explícito, no accidental)

La rotación por escaneo existe para invalidar rápido una foto del QR
reenviada por chat. Antes: inútil en milisegundos tras el primer escaneo
legítimo. Ahora: puede seguir siendo válida hasta 12s más en el peor caso.
Frente a un TTL base de 5 minutos, esos 12s adicionales no cambian el
modelo de amenaza real (fotos reenviadas minutos u horas después) — solo
angosta ligeramente la ventana de reutilización inmediata, que ya era
estrecha.

### 4.4 Lo que este fix *no* resuelve

- La primera colisión de cada sesión (t=0, cuando `ultimaRotacionEscaneoRef`
  arranca en 0) sigue rotando al instante — caso poco común en la práctica
  (rara vez hay ya una fila de docentes en el primer segundo de una sesión
  recién creada).
- Un docente que escanea justo antes de que se cumpla la ventana de 12s y
  confirma después de que ya rotó, todavía puede perder la carrera. La
  pantalla de "solo reescanea" (docentes recurrentes) sigue siendo la red
  de seguridad para ese caso.
- El caso de **primerizos** que pierden la carrera ya tiene red de
  seguridad propia desde `UX-33` (§2.2, §5): el throttle reduce la
  frecuencia de la colisión, y si igual ocurre, el borrador guardado evita
  que pierdan lo ya tecleado al reescanear.

---

## 5. Pendientes evaluados

| Propuesta | Estado | Motivo |
|---|---|---|
| Persistir datos de un primerizo mientras espera el reescaneo, para no perder cédula/nombre tecleados | **Cerrado (`UX-33`, 8 ago)** | Implementado con clave de `localStorage` separada (`pnf_docente_borrador`, TTL 20 min) de la de "registro confirmado" (`pnf_docente_datos`) — no contamina `avisoStale` ni la detección de docente recurrente. Ver §2.2 para el detalle. |
| Resumen automático al cerrar sesión (`AdminQRPanel`) | **Cerrado (`UX-33`, 8 ago)** | Ver §7 — no estaba entre las propuestas evaluadas originalmente en este documento, se agrega ahora que está implementado. |
| Ventana de gracia real en el token (aceptar el penúltimo token unos segundos) | **Evaluada y descartada por ahora** | Toca `registrar_asistencia` y `renovar_qr_token` (RPCs `SECURITY DEFINER` con acceso anónimo) — zona de mayor riesgo del sistema. No cubre bien ráfagas de 3+ rotaciones seguidas (cada rotación nueva pisa la gracia de la anterior). Se reconsiderará solo si el throttle actual resulta insuficiente en uso real. |

---

## 6. Códigos de resultado de `registrar_asistencia`

| Código | Significado | Requiere reescaneo* |
|---|---|:---:|
| `ok` | Registro exitoso | — |
| `OFFLINE` | Guardado localmente, pendiente de sincronizar | — |
| `YA_REGISTRADO` / `YA_REGISTRADO_SALIDA` | El docente ya marcó ese tipo hoy | No |
| `SIN_ENTRADA_PREVIA` | Intenta marcar salida sin entrada previa el mismo día | No |
| `TOKEN_INVALIDO` | El token no existe (ya rotó, o QR ajeno) | **Sí** |
| `TOKEN_EXPIRADO` | Token vencido por TTL | **Sí** |
| `SESION_FECHA_INVALIDA` | Token de una sesión de otro día | **Sí** |
| `SESION_INACTIVA` | El operador cerró la sesión | No |
| `DEVICE_DUPLICADO` | El mismo dispositivo ya se usó para otra cédula en esta sesión | No |
| `RATE_LIMIT` | Más de 10 intentos/hora desde ese `device_fingerprint` | No |

\* "Requiere reescaneo" = la app muestra la pantalla amable de "vuelve a
escanear, tus datos ya están confirmados" en vez del error genérico —
solo disponible hoy para docentes con datos guardados localmente (ver §5).

---

## 7. Panel del operador: contador "de N esperados" y resumen de cierre (UX-33)

Dos mejoras al `AdminQRPanel.jsx`, agregadas junto con la persistencia de
borrador (§2.2):

### 7.1 Contador "de N esperados"

El contador en vivo de entradas/salidas (`ContadorSesion`) ya existía; se le
agregó un denominador: "3 de 5 esperados". El "esperados" viene de una RPC
aparte, `contar_docentes_esperados` (migración `0072`, `SECURITY DEFINER`,
scoped por sede), que cruza `horarios` por turno/día/programa/sede — a
diferencia del conteo de entradas/salidas, no está suscrita a Realtime ni al
polling: el número esperado no cambia mientras la sesión está activa (depende
del horario planificado, no de quién ya marcó), solo se recalcula si cambian
turno/programa/día/sede, que de todos modos están bloqueados en la UI
mientras hay una sesión abierta. Si la RPC falla (ej. no aplicada todavía en
el Supabase real), el contador de entradas/salidas sigue funcionando igual —
es un complemento, no crítico.

### 7.2 Resumen automático al cerrar sesión

Al cerrar una sesión QR, `AdminQRPanel.jsx` arma un resumen (entradas,
salidas, y la lista de docentes que marcaron entrada pero no salida) y lo
muestra en un modal. El resumen se calcula **antes** de ejecutar el cierre
real de la sesión, para evitar una condición de carrera con `sessionId` una
vez cerrada. Si la consulta del resumen falla por cualquier motivo, la
sesión se cierra igual — el resumen es informativo, nunca bloquea el cierre.

---

*Última actualización: 8 de agosto de 2026 — persistencia de borrador y
resumen de cierre de sesión (`UX-33`).*
