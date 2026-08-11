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
3. Sede activa (useSedeActiva) — resuelta ANTES del módulo activo:
                                                 needsSedeSelection frena la
                                                 auto-selección de módulo
                                                 hasta que haya sede (SEDE-18)
4. Navegación interna del módulo horarios     ← antes de useAppData:
                                                 `lapso` es argumento del hook
5. Datos (useAppData)
6. Sesión QR (useQRSession)                   ← vive aquí, no en AdminQRPanel:
                                                 no debe perderse al cambiar de sub-vista
7. Shell UI (sidebar, modales globales, Supabase caído, email-change)
8. Módulo activo + auto-selección por permisos ← useModuloActivo, llamado
                                                  incondicionalmente (Regla de Hooks)
9. Sincronización offline (vaciar cola IndexedDB al recuperar red)
10. Reset de navegación al cambiar de usuario
11. Modo consulta histórica / restricción de programa para secretarios
12. Callbacks
13. Refs de inputs de archivo ocultos          ← montados en document.body,
                                                  sobreviven a cualquier pantalla
14. Guards                                     ← /scan PRIMERO (ver §2)
```

**Actualizado 11 ago (`SEDE-18`):** el orden real tiene la sede activa
antes del módulo activo — la razón es exactamente la misma que ya
explicaba el punto 3 original (ahora 4): `useModuloActivo` necesita saber
si todavía falta elegir sede (`needsSedeSelection`) para no auto-seleccionar
un módulo antes de que `ModuleSelector` haya tenido la oportunidad de
mostrar su dropdown de sede al menos una vez.

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

## 2.5. Selección de sede: un único punto en toda la app (`SEDE-18`, 11 ago)

Hasta el 10 de agosto, un usuario con `puedeVerTodasLasSedes` pasaba por
una pantalla propia (`<SedeSelector/>`) forzada antes de llegar a
`ModuleSelector`. Se eliminó: la elección de sede ahora vive **solo**
como dropdown dentro de `ModuleSelector.jsx` (`UX-31`). El problema real
que esto introdujo, y cómo se resolvió: si el usuario solo tenía acceso
a **un** módulo, la auto-selección de `useModuloActivo` saltaba directo
a él y `ModuleSelector` nunca llegaba a mostrarse — ese usuario quedaba
sin ninguna forma de elegir sede en toda la sesión. `needsSedeSelection`
(`useModuloActivo.js`) frena esa auto-selección mientras
`puedeElegirSede` sea `true` y `sedeActiva` siga sin resolver, forzando
que `ModuleSelector` se muestre al menos una vez.

**Regla práctica:** cualquier auto-navegación nueva que dependa de
`efectivePermisos`/`efectiveProfile` (siguiendo el patrón de
`useModuloActivo`) debe considerar si el usuario todavía necesita elegir
sede antes de saltarse pantallas — de lo contrario se reintroduce
exactamente este bug.

> ⚠️ **Código muerto detectado durante esta actualización (11 ago):**
> `src/components/SedeSelector.jsx` sigue en el repo pero ya no lo
> importa nada (`ModuleSelector.jsx` reemplazó su función por completo).
> No se borró como parte de este documento — LS: confirmar que no hay
> un motivo para conservarlo antes de eliminarlo.

## 2.6. Errores recuperables durante cargas largas: red y sesión expirada son el mismo camino (`UX-36`, 11 ago)

`useUpload.js` ya tenía `esErrorDeRed()` para preservar un archivo Excel
en `excelUploadQueue` si se cortaba la conexión a mitad de carga
(`OFF-12`). Un JWT vencido durante el `insert` final **no** se comporta
igual: Supabase lo devuelve como `{ error }` normal de la respuesta
(código `PGRST301`), no como excepción lanzada — así que nunca pasaba
por ningún camino de encolado, y el usuario perdía el archivo y tenía
que rehacer parseo + resolución de catálogo + vista previa tras volver
a loguearse. `esErrorDeSesionExpirada()` + `esErrorRecuperable()` (red
**o** sesión) generalizan el patrón. **Regla práctica:** cualquier
operación larga contra Supabase que ya maneje cortes de red debe
preguntarse también por sesión expirada — son fallos con la misma
consecuencia para el usuario (perder trabajo) pero disparados de forma
distinta (excepción vs. `{ error }` en la respuesta).

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

**Relacionado — `getCurrentLapso()` es orientativo, no autoritativo (fix
11 ago):** el botón "Volver al trimestre activo" (`HorariosSidebar.jsx`)
usaba `getCurrentLapso()` — un cálculo por *fecha de calendario*
(`ARCH-41`, `utils/lapso.js`), no el trimestre realmente `activo` en la
tabla `trimestres`. Cerrar un trimestre solo le pone `estado='cerrado'`,
**no** activa el siguiente automáticamente (eso es "Nuevo trimestre" en
`HistorialView`, una acción separada) — si el trimestre recién cerrado
era justo el que la fecha de hoy calcularía como "actual", el botón
reenviaba al usuario exactamente al mismo trimestre cerrado, atrapado en
modo lectura. `handleVolverActivo()` (`App.jsx`) ahora consulta
`trimestres WHERE estado='activo'` en el momento del clic (siempre
fresco) y solo cae al heurístico de `getCurrentLapso()` como *fallback*
si no hay ninguno activo. **Regla práctica:** para "¿cuál es el
trimestre vigente ahora mismo?", preferir siempre una consulta real a
`trimestres.estado` sobre el heurístico de fecha — el heurístico es para
cuando no hay datos que consultar (instalación nueva), no la fuente de
verdad.

## 4. `horarios` está particionada — cualquier cambio de esquema o RLS debe considerar ambos niveles

`horarios` es una tabla padre particionada por `lapso`
(`horarios_lapso_<N>_<YYYY>`, creadas dinámicamente por
`asegurar_particion_lapso()`, `0032`). PostgREST siempre accede por el
nombre del padre — así que:

- Una política RLS aplicada solo a las particiones (y no al padre) **no
  se evalúa nunca** vía la API normal de la app. Esto es exactamente lo
  que pasó con `SEC-1` (ver `AUDITORIA_INDICE.md`): RLS granular existía en
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
producción por *temporal dead zone* en el bundle (`ARCH-1`, ver
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
más reciente con datos viejos — el bug que documenta `ARCH-4`.

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
ya tiene un ID de auditoría asociado (`SEC-1`, `ARCH-1`, `ARCH-4`...), referenciarlo
en vez de repetir el detalle — este documento explica el *principio
reutilizable*, `AUDITORIA_INDICE.md` lleva el registro del *hallazgo
puntual*.

---

*Última actualización: 11 de agosto de 2026 — agregadas §2.5 (`SEDE-18`,
selección de sede unificada en `ModuleSelector`) y §2.6 (`UX-36`, sesión
expirada como error recuperable en cargas largas), más la nota sobre
`getCurrentLapso()` en §3. Verificado contra `git diff` real del drift
paralelo detectado el mismo día (17 commits), no inferido. Actualización
anterior: julio 2026.*
