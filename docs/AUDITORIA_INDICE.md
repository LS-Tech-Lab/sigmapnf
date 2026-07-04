# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgos (`S1`, `V-1`, `O-3`, `A-4`, etc.) que
aparecen dispersos en comentarios de código y migraciones. Antes de este
documento, ubicar qué es un ID específico requería grep sobre todo el repo.

> **Cómo se construyó:** cada fila se verificó contra el código/migración
> real (no contra un informe externo) — mismo criterio que se aplicó al
> corregir `0046`, donde un hallazgo reportado externamente resultó ser un
> falso positivo parcial al compararlo con la base de datos real.
>
> **IDs no localizados:** `O-6`, `O-7`, `P-1`, `SEC-1`, `SEC-4` se
> referencian en la numeración pero no aparecen en el código actual —
> probablemente descartados, renombrados, o fusionados con otro fix antes
> de llegar a `main`. Si alguno reaparece en un commit viejo, agregarlo
> aquí con su estado real en vez de dejarlo suelto. (`SEC-7` estaba en
> esta lista en una versión anterior de este índice — se usó en la sesión
> que agregó `SEC-6`/`SEC-8` y ya no es un hueco; ver más abajo.)
>
> **Cobertura:** este índice cubre el esquema categorizado vigente
> (`S`/`SEC`/`V`/`D`/`O`/`A`/`ARCH`/`U`/`P`) más el esquema `FIX-CI-N`
> (CI/CD y automatización, encontrado en `logger.js` al hacer esta
> actualización — no estaba cubierto hasta ahora). `SEC-N` es una serie
> paralela a `S`/`V`/`D`/`O`/`A` enfocada específicamente en autenticación
> y sesión, encontrada al implementar `SEC-6`, y ampliada con `SEC-7`
> (`login_attempts`, `0048`) y `SEC-8` (grants de `anon` que contradecían
> su propia migración, `0049`) en la misma sesión. El proyecto usó además
> **otras dos nomenclaturas anteriores** a todo esto, encontradas al
> construir `ESQUEMA_Y_MIGRACIONES.md` — ver § Histórico más abajo.

---

## 🔐 Seguridad y RLS

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **S1** | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de cualquier programa (política heredada `FOR ALL` + RLS nunca habilitado en la tabla padre particionada) | `horarios` (padre + particiones) | `0035`, `0045` | ✅ Cerrado |
| **S2** | `docentes`/`materias`: la política de escritura (`FOR ALL`) solo exigía `auth.role() = 'authenticated'`, sin verificar el permiso granular (`puedeEditarDocentes`/`puedeEditarMaterias`/`puedeImportarExcel`/`puedeRestaurarBackup`). Mismo patrón que `S1`, alcance más angosto — un informe externo lo reportó como "RLS nunca habilitado + anon con acceso total", pero RLS ya estaba activo y anon ya estaba bloqueado; el hueco real era más específico (falso positivo parcial, verificado contra `pg_policies` real antes de escribir la migración) | `docentes`, `materias` | `0046` | ✅ Cerrado |
| **S3** | Estilos inline (`style={{...}}`) bloquean una política CSP estricta (`unsafe-inline` necesario mientras existan) | 40 archivos `.jsx` todavía con `style={{` — ver nota bajo `A3` | — | 🟡 **Abierto** — bloqueado por `A3` |
| **SEC-2** | Stack trace completo de errores visible en producción (fuga de información interna) | `src/components/ErrorBoundary.jsx` | — | ✅ Cerrado (solo se renderiza en desarrollo) |
| **SEC-3** | Sin validación centralizada de fortaleza de contraseñas | `src/utils/password.js` | — | ✅ Cerrado |
| **SEC-5** | Lockout de login normal en `localStorage` no resistía pestañas privadas (mismo patrón que `O-8`, para PIN) | `src/components/LoginScreen.jsx`, `src/utils/pinOffline.js` | — | ✅ Cerrado (migrado a IDB, cliente) |
| **SEC-6** | Sin respaldo server-side del lockout de `SEC-5` — bastaba borrar el IDB o cambiar de navegador/dispositivo para seguir intentando sin límite contra la misma cuenta | `src/components/LoginScreen.jsx`, RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado |
| **SEC-7** | `login_attempts` tenía una política de INSERT abierta a `public` con `WITH CHECK (true)` — cualquiera sin cuenta podía insertar intentos fallidos falsos con el email de otra persona y forzar su bloqueo (`SEC-6`) a voluntad, repetible sin límite | `login_attempts` (RLS + GRANT) | `0048` | ✅ Cerrado — migración aplicada en la BD real |
| **SEC-8** | 🔴 El hallazgo más serio de la sesión de `SEC-6`/`SEC-7`. 4 funciones con `REVOKE ALL FROM PUBLIC` explícito en su migración original aparecían ejecutables por `anon` en la BD real — drift, no un error de migración (nunca hubo `GRANT ... TO anon` para ninguna). Dos eran destructivas y debían ser solo `service_role`: `limpiar_audit_logs_antiguos` (cualquiera podía borrar el log de auditoría completo, anti-forense directo) y `limpiar_scan_rate_limit` (anulaba `D-3` a voluntad). Se agregó de paso el chequeo de permiso que `renovar_qr_token` nunca tuvo | `asegurar_particion_lapso`, `docentes_con_cedula`, `limpiar_audit_logs_antiguos`, `limpiar_scan_rate_limit`, `renovar_qr_token` | `0049` | ✅ Cerrado — migración aplicada en la BD real |
| **V-1** | `_aplicar_rls_horarios()`: INSERT y DELETE sin restricción de permiso granular | `horarios` | `0035` | ✅ Cerrado (ver S1 — la causa raíz completa no se cerró hasta `0045`) |
| **V-2** | RLS de `qr_sessions` y `asistencias_diarias` sin permisos granulares (`puedeGestionarQR` / `puedeVerReporteAsistencias`) | `qr_sessions`, `asistencias_diarias` | `0036` | ✅ Cerrado |
| **V-4** | `crear_qr_session()` solo validaba `rol = authenticated`, no el permiso `puedeGestionarQR` | RPC `crear_qr_session` | `0035` | ✅ Cerrado |
| **D-3** | Sin rate limiting en `registrar_asistencia()` — permitía flood de asistencias falsas con cédulas distintas desde un mismo dispositivo | `registrar_asistencia`, tabla `scan_rate_limit` | `0039`, `0040` | ✅ Cerrado |
| **SEC-9** | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` aparecen ejecutables por `anon` en la BD real y nunca tuvieron un `REVOKE` explícito en ninguna migración (mismo patrón que `SEC-8`, encontrado de paso al cerrarlo). Riesgo bajo: son de solo lectura y devuelven null/vacío para un caller anónimo, no delegan ninguna decisión de seguridad a su resultado | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` (sin migración de origen) | — | 🟡 **Pendiente** — señalado en `ESQUEMA_Y_MIGRACIONES.md` §4, sin migración de cierre todavía |

> **Nota sobre `SEC-6`:** cierra el hueco *entre* `SEC-5` (cliente) y el rate
> limiting por IP de Supabase Auth (plataforma, no versionado en este repo).
> No reemplaza a ninguno de los dos — ver el encabezado de `0047` para el
> límite explícito: no puede interceptar una llamada a `signInWithPassword()`
> hecha fuera de `LoginScreen.jsx`. Verificar que el rate limiting de Supabase
> Auth esté activo en el dashboard sigue siendo necesario para la protección
> de fondo.

## 🔎 Filtrado de datos por permiso/programa

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **V-3** | Pestañas de `AsistenciasModulo` no se filtraban según permisos individuales del usuario | `src/app/AsistenciasModulo.jsx` | ✅ Cerrado |
| **D-1** | Mismo problema que V-3, en `LogsView` | `src/components/LogsView.jsx` | ✅ Cerrado |
| **D-2** | `HistorialView` no respetaba `restringe_programa` — un usuario restringido a un programa veía el listado y detalle de todos | `src/components/HistorialView.jsx` | ✅ Cerrado |
| **D-4** | `exportarDatos()` consultaba una tabla `asistencias` que no existe (`to_regclass` → `NULL`) — todo backup exportado tenía `asistencias: []` con `asistencias_incluidas: true` (falso positivo silencioso, sin error visible) | `src/hooks/useAppData/backupActions.js` | ✅ Cerrado (corregido a `asistencias_diarias`, la tabla real del módulo QR desde `0006`) |

## 📡 Offline y estado de red

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **O-1** | Sin manejo de estado offline/online para la renovación automática del token QR | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **O-2** | Registros irrecuperables de la cola offline (IndexedDB) nunca se purgaban — crecimiento indefinido | `src/hooks/useSyncPendientes.js`, `src/utils/offlineQueue.js` | ✅ Cerrado (TTL 48h) |
| **O-3** | Sin indicador visual de red caída para los docentes en la proyección del aula | `src/components/asistencias/QRProyeccion.jsx` | ✅ Cerrado |
| **O-4** | El poll de respaldo de rotación de QR seguía intentando queries sin conexión | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **O-5** | Service Worker no se registraba explícitamente — offline/PWA no confiable | `src/main.jsx` | ✅ Cerrado |
| **O-8** | Lockout de PIN en `localStorage` no resistía pestañas privadas | `src/components/LoginScreen.jsx` | ✅ Cerrado (migrado a IndexedDB) |
| **P-2** | `DocenteScan` sin manejo offline: había que perder el registro si no había red al confirmar | `src/components/asistencias/DocenteScan/index.jsx` | ✅ Cerrado (encola en IndexedDB, confirmación optimista) |
| **P-3** | Validación de token contra la BD sin timeout — spinner infinito sin red | `src/components/asistencias/DocenteScan/index.jsx` | ✅ Cerrado (timeout de 3s) |

## ⚡ Concurrencia y datos asíncronos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **A1** | Colisión de nombres entre `pinOffline.js`, `offlineQueue.js`, `reporteCache.js` al abrir IndexedDB — crasheaba el bundle de producción (TDZ) | `src/utils/pinOffline.js`, `offlineQueue.js`, `reporteCache.js` | ✅ Cerrado (prefijos únicos) |
| **A-2** | Sin paginación por cursor en `ReporteRango` — mismo patrón de riesgo que `useDataSync` | `src/components/asistencias/ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado |
| **A-3** | Sin guardia de sanidad en `useDataSync` si el cursor de paginación no avanza | `src/hooks/useAppData/useDataSync.js` | ✅ Cerrado |
| **A-4** | Sin `AbortController` — fetches obsoletos podían sobreescribir estado más reciente (reporte por rango, recuperación de sesión QR al montar) | `ReporteRango.jsx`, `useQRSession.js` | ✅ Cerrado |
| **A-5** | Sin limpieza de datos al iniciar un fetch sin caché — banner de carga faltante al cambiar de programa | `src/components/ResumenView.jsx`, `useDataSync.js` | ✅ Cerrado |

## 🧪 Testing y arquitectura

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **A2** | `log_audit_event` sin registrar rol/programa del actor | Bloque 5, migración `0025` | ✅ Cerrado |
| **ARCH-4** | Sin cobertura de tests para lógica crítica (`useAuth`, cola offline) | `useAuth.test.js`, `offlineQueue.test.js` | ✅ Cerrado |
| **ARCH-5** | Sin tests de integración para hooks compuestos ni para flujos de usuario completos (escaneo QR, carga de horarios, gestión de usuarios) | Ver nota debajo | ✅ **Cerrado** |

> **Nota sobre `ARCH-5` (detalle por archivo, actualizado 4 de julio):** no
> todos los archivos listados prueban lo mismo — es importante no
> confundir "orquestación de hooks con mocks" con "flujo de UI real":
> - **Orquestación de hooks** (renderHook, sin `render()` de componentes):
>   `useAuth.integration.test.js`, `useConflictos.integration.test.js`,
>   `useNombresCache.integration.test.js`, `useQRSession.integration.test.js`,
>   `useAppData/useUpload.integration.test.js`.
> - **Render real de componentes** (`render()` + `screen` + `fireEvent`,
>   simulando clics y escritura como lo haría el usuario):
>   `usuarios/PestanaUsuarios.integration.test.jsx` (gestión de usuarios) y
>   `asistencias/DocenteScan/DocenteScan.flow.test.jsx` (escaneo QR completo:
>   selector de tipo → formulario → confirmación visual → RPC
>   `registrar_asistencia` → pantalla de resultado, más el caso de datos
>   guardados de una visita anterior y el de cédula con formato inválido).
>
> `DocenteScan.flow.test.jsx` ya está confirmado en el repo (commit `1f698d6`)
> y la suite completa corre **152/152** clonando el repo desde cero — no
> solo en el entorno donde se escribió. Al escribirlo se detectó además que
> `vitest.config.js` necesitaba `esbuild.jsx: "automatic"` para poder
> renderizar componentes reales — eso ya estaba en el repo (commit `7f91027`).
>
> De la carga de horarios (Excel) sigue sin haber una prueba de render real
> (solo `useUpload.integration.test.js`, a nivel de hook) — sería el
> siguiente candidato si se quiere una cobertura de render pareja en los
> tres flujos originales del hallazgo, aunque eso ya excede lo que pedía
> `ARCH-5` tal como estaba redactado.

## 🔧 CI/CD y automatización

Esquema `FIX-CI-N`, encontrado al revisar `src/utils/logger.js` (usa `FIX-CI-2`)
al actualizar este índice — no estaba cubierto en ningún documento hasta ahora.
No se localizó un comentario `FIX-CI-1` explícito en el repo (los workflows de
GitHub Actions no llevan el mismo formato de comentario `// Fix <ID>` que el
código JS/SQL); por orden cronológico y numeración, todo indica que le
correspondería al propio pipeline de CI, pero se anota como no confirmado en
vez de asumirlo.

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **FIX-CI-1** *(no confirmado)* | Sin integración continua — nadie corría los tests ni el build antes de hacer merge | `.github/workflows/ci.yml` | ✅ Cerrado (pipeline corre `npm test` + `npm run build` en cada PR/push a `main`) |
| **FIX-CI-2** | `console.log/warn/error` directos visibles en producción (mismo problema que `SEC-2`, pero para logs de diagnóstico en general, no solo el stack trace del `ErrorBoundary`) | `src/utils/logger.js` (14 archivos migrados a usarlo) | ✅ Cerrado |
| **FIX-CI-3** | Sin `npm audit` en CI (dependencias vulnerables no detectadas antes de deploy) ni verificación automatizada de que RLS rechace lecturas/escrituras no autorizadas con la clave `anon` real | `.github/workflows/ci.yml`, `scripts/rls-smoke-test.mjs` | ✅ Cerrado (`npm audit --audit-level=high` no bloqueante — `xlsx` tiene 2 CVEs high sin fix de la librería, ver comentario en `ci.yml`; smoke test bloqueante una vez configurados los secrets `SUPABASE_URL`/`SUPABASE_ANON_KEY`) |

> **Nota (corregida):** el comentario de `scripts/rls-smoke-test.mjs` decía
> *"Nace del hallazgo S1 de la auditoría de julio 2026 (docentes/materias)"*
> — ese `S1` era del esquema de la auditoría externa (`auditoria_sigmapnf.md`,
> donde S1 = docentes/materias), **no** el `S1` de este índice (que es
> `horarios`). Era una colisión de nomenclatura real entre los dos
> documentos, ya que se estaban unificando criterios entre varias
> auditorías separadas. **Corregido**: el comentario ahora referencia
> `S2` (el ID de este índice) explícitamente, y aclara la colisión para
> quien lo lea en el futuro.

## 🎨 UI y estilos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **U-1** | Estilos inline en `AdminQRPanel` — primer caso migrado a CSS externo, sentó el patrón que luego siguió A3 | `AdminQRPanel.jsx` / `.css` | ✅ Cerrado |
| **U-2** | Adaptabilidad móvil: `.qrp-col-left` con `flex: 0 0 320px` (sin encoger) desbordaba horizontalmente en viewports ≤ ~372px; grid fijo `1fr 1fr` en `ModalRol` quedaba inusable en pantallas pequeñas. Revisión real contra el HEAD (no solo conteo de `@media`) confirmó que el resto de pantallas de mayor uso móvil (`DocenteScan`, `TurnoGrid`, `ReporteRango`, `LoginScreen`, `HistorialView`) ya tenían mitigación adecuada y no necesitaron cambios | `AdminQRPanel.css`, `usuarios/ModalRol.jsx` | ✅ Cerrado |
| **U-3** | Sin trampa de foco de teclado en modales (accesibilidad) | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **U-4** | `Campo.jsx` (input del formulario de `DocenteScan`) renderiza `<label>` e `<input>` como hermanos, sin `htmlFor`/`id` que los asocie — un lector de pantalla no anuncia la etiqueta al enfocar el campo. Encontrado de forma indirecta: un test que intentaba ubicar el input por su label (`getByLabelText`, el método recomendado de Testing Library, que imita cómo un lector de pantalla encuentra el campo) no pudo hacerlo y tuvo que usar el `placeholder` como alternativa | `src/components/asistencias/DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()` genera un id estable que conecta `label`↔`input`; el mensaje de error/hint también se enlaza vía `aria-describedby`, y `aria-invalid` se activa cuando hay error. `DocenteScan.flow.test.jsx` se actualizó para usar `getByLabelText` en vez del workaround de `placeholder`, quedando como guardia contra que esto se rompa de nuevo) |
| **A3** | Migración sistemática de estilos inline a CSS externo, requisito para poder cerrar S3 (CSP) | `LoginScreen`, `ConfirmModal`, `DocentesView`, `AdminQRPanel`, `LogsView`, `MateriasView`, `UploadPreviewModal`, `PlanillaImprimibleBase`, `ReporteAsistencias/index`, `ModalRol` ya tienen `.css` propio — ver nota | 🟡 **En curso** |

> **Nota sobre `A3` (verificado contra HEAD, 4 de julio):** el conteo de
> **archivos** con `style={{` sigue en **40** — el mismo número que cuando
> se abrió el hallazgo — pero no es que no haya habido avance: el
> **volumen** de estilos inline bajó de ~894 a **487** ocurrencias, porque
> varios de esos 40 archivos (`DocentesView`, `LogsView`, `MateriasView`,
> `UploadPreviewModal`, `PlanillaImprimibleBase`, `ReporteAsistencias/index`,
> `ModalRol`) ya tienen su `.css` dedicado y solo les queda un residuo
> parcial sin migrar — no arrancaron de cero. El objeto `S` (el helper más
> viejo, previo incluso a este esquema de estilos inline puro) también bajó
> de 9 a **4 archivos** que todavía lo importan: `ReporteRango.jsx`,
> `SkeletonRow.jsx`, `VistaAusentes.jsx` y `PestanaUsuarios.jsx`. Ninguno de
> los 40 archivos llegó todavía a cero `style={{`, así que el hallazgo
> sigue abierto, pero el "40 archivos pendientes" del texto original ya no
> describe con precisión cuánto trabajo real queda — es más preciso hablar
> de 487 ocurrencias repartidas de forma desigual.

---

## 🗄️ Histórico: nomenclaturas anteriores (no vigentes)

Encontradas al construir el índice de migraciones (`ESQUEMA_Y_MIGRACIONES.md`).
No se usan más, pero los archivos con estos comentarios siguen en el repo —
vale la pena saber que existen si alguien pregunta "¿qué es el Fix #8?".

| Esquema | ID | Descripción | Archivo | Estado |
|---|---|---|---|---|
| `Fix #N` | **#2** | Políticas RLS con rol `{public}` corregidas a `{authenticated}` en `user_profiles` | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#3** | FK duplicada (`user_profiles_rol_fkey`) que bloqueaba el login (`PGRST201`) | `0017_drop_fk_duplicada_rol.sql` | ✅ Cerrado |
| `Fix #N` | **#4** | Recursión en `get_auth_role()` dentro de políticas RLS | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#8** | `borrar_horarios`/`restaurar_backup` sin verificación de permiso interno | `0018_fix_rpc_permisos_faltantes.sql` | ✅ Cerrado |
| `Fix #N` | **#10** | Sin trigger que impidiera borrar roles con `es_sistema = true` | `0019_trigger_protect_roles_sistema.sql` | ✅ Cerrado |
| `Fix #N` | **#16** | Sin índices en `horarios` para búsquedas frecuentes | `0020_indices_horarios.sql` | ✅ Cerrado |
| `Fix #N` | **#17** | RPCs de gestión de usuarios creadas directo en Supabase, sin migración de respaldo | `0021_rpcs_gestion_usuarios.sql` | ✅ Cerrado |
| `Gap #N` | **#16** | `importarDatos()` no restauraba `asistencias` desde un backup | `0041_restaurar_backup_asistencias.sql` | ✅ Cerrado |

> **Colisión de numeración:** `Fix #16` (0020, índices de horarios) y `Gap #16`
> (0041, restauración de backup) son el mismo número en esquemas distintos y no
> tienen relación entre sí. Si alguna vez se retoma cualquiera de estas dos
> nomenclaturas, evitar reusar números — usar el esquema categorizado vigente
> en su lugar, que ya evita esto al llevar letra + número por área.

---

Cuando se cierre un nuevo hallazgo:

1. Usar el mismo formato de comentario ya establecido en el repo:
   `// Fix <ID> (auditoría <fecha>): <qué y por qué>` en el código, y
   `-- Migración NNNN — Fix <ID>: <resumen>` en el SQL.
2. Agregar una fila aquí en la categoría correspondiente (crear una nueva
   sección si no encaja en las existentes).
3. Si un hallazgo reabre o profundiza uno anterior (como `S1` hizo con
   `V-1`), decirlo explícitamente en la columna de descripción — evita que
   alguien dé por cerrado algo que solo se cerró a medias.

**Abiertos ahora mismo:** `S3`/`A3` (la misma tarea, vista desde seguridad
y desde UI respectivamente) y `SEC-9` (bajo riesgo, señalado por
transparencia) — ver `AUDITORIA_FRONTEND.md` para el detalle del
reemplazo de estilos inline pendiente. Con el cierre de `SEC-6`, `SEC-7`,
`SEC-8`, `S2`, `ARCH-5`, `U-4` y todo `FIX-CI-N`, no queda ningún otro
hallazgo de seguridad, accesibilidad, testing ni de CI/automatización
abierto en este índice. Para el índice de migraciones SQL y el esquema de
base de datos, ver `ESQUEMA_Y_MIGRACIONES.md`.

---

*Última actualización: 4 de julio de 2026 — se agregaron `S2` (docentes/materias,
antes solo mencionado en el encabezado sin fila propia), la sección `FIX-CI-N`
completa (no documentada hasta ahora), `U-2` (responsividad móvil), se amplió
`ARCH-5` con los 3 tests de integración nuevos, y se corrigió el comentario de
`scripts/rls-smoke-test.mjs` que referenciaba `S1` de una auditoría externa en
vez de `S2` de este índice — varias auditorías separadas, un solo criterio de
nomenclatura de aquí en adelante.*

*Segunda pasada, mismo día (4 de julio de 2026) — verificación directa contra
HEAD `3e3be9a` en vez de solo contra el texto de este índice: se agregó
`U-4` (accesibilidad — `Campo.jsx`, encontrado al escribir el test de render
de `DocenteScan`), se detalló `ARCH-5` por archivo (distinguiendo tests de
orquestación de hooks vs. render real de componentes) y se sumó
`DocenteScan.flow.test.jsx` — escrito y verificado localmente (152/152 tests
pasan), pendiente de pegarse en el repo. Se recalcularon las cifras de `A3`
contra el código real: **40 archivos** con `style={{` (sin cambio en el
conteo de archivos, pero **487 ocurrencias** frente a las ~894 anteriores —
7 de esos 40 ya tienen `.css` propio con residuo parcial) y **4 archivos**
(antes 9) que aún importan el helper `S`.*

*Tercera pasada (4 de julio de 2026) — reconciliación entre esta rama del
índice y la sesión donde se crearon `SEC-6`/`SEC-7`/`SEC-8`: esta versión
había partido de un punto anterior a esos dos últimos y los había perdido
sin querer (no es un borrado deliberado, es que ambas ramas de trabajo
avanzaron en paralelo sobre el mismo archivo). Se reincorporaron `SEC-7` y
`SEC-8` completos, con nota confirmando que `0048` y `0049` **ya están
aplicadas en la base de datos real** (confirmado directamente, no asumido).
Se agregó `SEC-9` (pendiente, bajo riesgo) para no perder ese hallazgo
menor entre documentos. Sobre la contradicción de arriba ("ya está
confirmado en el repo" vs. "pendiente de pegarse" para
`DocenteScan.flow.test.jsx`, ambas en la nota de la segunda pasada):
verificado de nuevo, **el archivo existe en el HEAD actual del repo** —
la nota de "pendiente de pegarse" quedó desactualizada entre el momento en
que se escribió y el momento en que efectivamente se pegó, ambos el mismo
día. No se encontró el archivo `auditoria_sigmapnf.md` (la auditoría
externa mencionada en la nota de `FIX-CI-3`) en ningún lugar del repo —
si hace falta seguir unificando criterios contra ella, no está disponible
para verificar desde aquí todavía. **Actualización:** ese documento
corresponde a auditorías pasadas que no se respaldaron — no se va a poder
recuperar. No bloquea nada: este índice se construyó siempre verificando
contra código/BD real, no contra ese informe, así que cualquier hallazgo
suyo que siga sin corregir va a seguir siendo detectable con el mismo
método. Si en el futuro se recuerda un hallazgo puntual de esa auditoría
(aunque sea de memoria), se puede verificar contra el estado actual sin
necesitar el documento completo — igual que se hizo con la colisión `S1`
externo / `S2` de este índice.*
