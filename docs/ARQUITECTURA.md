# 🏛️ Decisiones de arquitectura

Decisiones ya resueltas en el código, pero explicadas en el comentario de
un solo archivo cada una — el tipo de cosa que un colaborador nuevo (o
uno mismo, meses después) redescubre a las malas si no está en un solo
lugar. No son propuestas: todo lo de aquí ya está implementado.

---

## 1. Mapa de `App.jsx`

`App.jsx` concentra deliberadamente varios hooks que podrían parecer que
deberían vivir más cerca de donde se usan. El orden real, con el motivo:

```
1. Auth
2. Perfil y permisos efectivos (online / offline-PIN)
3. Navegación interna del módulo horarios     ← antes de useAppData:
                                                 `lapso` es argumento del hook
4. Datos (useAppData)
5. Sesión QR (useQRSession)                   ← vive aquí, no en AdminQRPanel:
                                                 no debe perderse al cambiar de sub-vista
6. Shell UI (sidebar, modales globales, Supabase caído, email-change)
7. Módulo activo + auto-selección por permisos ← useModuloActivo, llamado
                                                  incondicionalmente (Regla de Hooks)
8. Sincronización offline (vaciar cola IndexedDB al recuperar red)
9. Reset de navegación al cambiar de usuario
10. Modo consulta histórica / restricción de programa para secretarios
11. Callbacks
12. Refs de inputs de archivo ocultos          ← montados en document.body,
                                                  sobreviven a cualquier pantalla
13. Guards                                     ← /scan PRIMERO (ver §2)
```

**Por qué importa:** si en algún momento se quiere "limpiar" `App.jsx`
moviendo alguno de estos hooks a un componente hijo, dos se rompen
garantizado: `useQRSession` (pierde estado al cambiar de sub-vista del
módulo de asistencias) y `useModuloActivo` (viola la Regla de Hooks si
queda detrás de un `return` condicional).

## 2. La ruta `/scan` debe evaluarse antes que cualquier guard de auth

```js
// App.jsx — Ruta pública /scan — antes de todos los guards de auth
if (window.location.pathname === "/scan") { ... }
```

`/scan` es la única ruta pública del sistema (acceso anónimo, ver `0006b`).
Si un guard de sesión/auth se evaluara primero, un docente sin cuenta en
el sistema vería una pantalla de login en vez del formulario de asistencia
— rompería el flujo completo del módulo QR para todo el que no sea admin.

## 3. Fecha y hora de Venezuela: zona horaria IANA, no aritmética de offset

Venezuela no tiene horario de verano, así que "UTC-4 fijo" es correcto en
la práctica — pero el código **no** lo calcula como offset manual
(`new Date(Date.now() - 4*60*60*1000)`), que es frágil ante cualquier
cambio futuro de huso horario. Usa el nombre de zona IANA en los tres
lugares donde importa, y los tres son consistentes entre sí:

| Dónde | Cómo |
|---|---|
| Cliente — `fechaHoyVE()` (`src/utils/time.js`) | `new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" })` |
| Cliente — `horaActualVE()` (`AdminQRPanel.jsx`) | `new Date().toLocaleString("en-US", { timeZone: "America/Caracas" })` |
| Servidor — `fecha_hoy_ve()` (`0013_seguridad_fecha_servidor.sql`) | `(now() AT TIME ZONE 'America/Caracas')::DATE` |

**Por qué importa:** hubo un bug real por calcular "hoy" con
`new Date().toISOString().slice(0,10)` (UTC puro) — entre las 8pm y
medianoche hora de Venezuela, UTC ya había cambiado de día, así que el
selector de fecha del Panel QR bloqueaba el día real y dejaba seleccionable
el día siguiente. Si se agrega una nueva función que necesite "hoy" o
"ahora" en Venezuela, replicar el patrón de la tabla — no volver a
calcularlo con aritmética manual.

## 4. `horarios` está particionada — cualquier cambio de esquema o RLS debe considerar ambos niveles

`horarios` es una tabla padre particionada por `lapso`
(`horarios_lapso_<N>_<YYYY>`, creadas dinámicamente por
`asegurar_particion_lapso()`, `0032`). PostgREST siempre accede por el
nombre del padre — así que:

- Una política RLS aplicada solo a las particiones (y no al padre) **no
  se evalúa nunca** vía la API normal de la app. Esto es exactamente lo
  que pasó con `S1` (ver `AUDITORIA_INDICE.md`): RLS granular existía en
  cada partición desde `0035`, pero el padre nunca tuvo RLS *habilitado*
  sobre sí mismo hasta `0045`.
- Un `ALTER TABLE horarios` para agregar una columna se propaga a las
  particiones automáticamente; un cambio de `DEFAULT`/`IDENTITY` en la
  columna `id` también (ver `0042`) — pero una política RLS **no**, hay
  que aplicarla explícitamente en ambos niveles.

**Regla práctica:** cualquier cambio de RLS sobre `horarios` debe
verificarse con la query de `pg_class` de `SECURITY.md` contra el padre
*y* contra al menos una partición, no solo una de las dos.

## 5. IndexedDB: prefijos únicos por módulo, obligatorio

`pinOffline.js`, `offlineQueue.js` y `reporteCache.js` abrían bases de
IndexedDB con nombres que colisionaban entre sí, lo que causó un crash de
producción por *temporal dead zone* en el bundle (`A1`, ver
`AUDITORIA_INDICE.md`). El fix fue prefijar cada nombre de base/store de
forma única por módulo. Si se agrega un cuarto módulo que necesite
IndexedDB, seguir el mismo patrón desde el inicio — no esperar a que
colisione en producción para notarlo, porque en desarrollo (sin
minificación/bundling agresivo) el problema no se manifiesta igual.

## 6. `AbortController` en cualquier fetch que pueda quedar obsoleto

Patrón establecido en `ReporteRango.jsx` y `useQRSession.js` (recuperación
de sesión al montar): cualquier fetch disparado por un cambio de filtro,
props, o parámetro que pueda repetirse antes de que el anterior responda,
necesita un `AbortController` en un `ref` para cancelar el fetch obsoleto
si llega tarde. Sin esto, una respuesta lenta puede sobreescribir estado
más reciente con datos viejos — el bug que documenta `A-4`.

## 7. El módulo de asistencias QR no comparte `AppDataContext` con Horarios

`AppDataContext` es exclusivo de `HorariosLayout`. `PlanillaQR.jsx` (y el
resto del módulo QR) se autoabastece con sus propios fetches a Supabase en
vez de depender de ese contexto — es una decisión deliberada de
aislamiento, no un descuido. Si se necesita compartir datos entre ambos
módulos en el futuro, no asumir que `AppDataContext` ya los tiene
disponibles.

## 8. El rate limiting de `/scan` cuenta intentos fallidos, no solo exitosos

`scan_rate_limit` (`0039`) incrementa el contador de un
`device_fingerprint` en **cada** llamada a `registrar_asistencia`,
incluidas las que fallan por `TOKEN_INVALIDO`/`TOKEN_EXPIRADO`. Esto es
relevante para cualquier cambio futuro al flujo de escaneo: una ráfaga de
reintentos legítimos (ver el throttle de rotación de QR, `FLUJO_ASISTENCIAS_QR.md`
§4) consume el mismo cupo que un intento de fraude. Si se toca este flujo,
verificar que no se esté acercando a docentes legítimos al límite de
10/hora por errores de sincronización, no por mal uso.

## 9. Objetos creados directo en el dashboard de Supabase, sin migración

Patrón recurrente documentado con detalle en `ESQUEMA_Y_MIGRACIONES.md` —
se resume aquí porque es una decisión de *proceso*, no solo de esquema:
cuando algo se crea directo en el dashboard de Supabase en vez de vía
migración versionada, **no existe en el repo hasta que alguien lo nota y
lo documenta a posteriori** (pasó con `horarios`/`docentes`/`materias`/
`user_profiles`, con varias RPCs en `0021`/`0031`/`0032`/`0044`, y con RLS
completo de `user_profiles` hasta `0043`). Cualquier cambio hecho desde el
dashboard en una sesión de trabajo debe migrarse a un archivo versionado
en la misma sesión — no "después", porque después es cuando se pierde.

---

## Cómo mantener este documento

Cuando una decisión de arquitectura viva solo en un comentario de código
y tenga consecuencias si alguien la ignora sin saberlo, agregarla aquí con:
qué se decidió, por qué (el bug o riesgo concreto que motivó la decisión,
no una justificación abstracta), y dónde vive en el código. Si la decisión
ya tiene un ID de auditoría asociado (`S1`, `A1`, `A-4`...), referenciarlo
en vez de repetir el detalle — este documento explica el *principio
reutilizable*, `AUDITORIA_INDICE.md` lleva el registro del *hallazgo
puntual*.

---

*Última actualización: julio 2026.*
