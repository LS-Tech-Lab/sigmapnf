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
| **S3** | Estilos inline (`style={{...}}`) bloquean una política CSP estricta (`unsafe-inline` necesario mientras existan) | Ver nota bajo `A3` | — | ✅ Cerrado (5 de julio) — `vercel.json` ya no tiene `unsafe-inline` en `style-src`. Se decidió restringir `ModalRol.jsx` a los 10 presets (quitando el `<input type="color">` libre) en vez de mantener `unsafe-inline` permanente. Verificación adicional antes de cerrar: barrido completo por manipulación de `style` fuera de JSX (`.style.X =`, `setAttribute('style'...)`, `<style>` tags, `dangerouslySetInnerHTML`) — encontró y cerró 2 casos más que ningún grep de `style={{` detecta (ver pasada). No verificable con `vite build`/tests locales, solo en el navegador tras desplegar |
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
| **SEC-10** 🔴 | `admin_caller_puede_gestionar_usuarios()` solo verificaba un permiso booleano (`puedeGestionarUsuarios`), sin comparar el rol de quien actúa contra el rol objetivo. Como los roles son dinámicos (`admin_upsert_role`), cualquier rol con ese único permiso activado podía crear, editar, activar/desactivar, resetear la contraseña o eliminar una cuenta con rol `admin` sin serlo — escalada de privilegios. Hallazgo de la auditoría QA externa del 5 de julio | RPCs `admin_create_auth_user`, `admin_upsert_user_profile`, `admin_toggle_user_activo`, `admin_delete_user`, `admin_reset_user_password`; `api/admin-users.js` | `0050` | ✅ Cerrado — verificado contra HEAD real el 5 de julio: helper `admin_caller_es_admin()` agregado y aplicado como guard en las 5 RPCs (regla fija: solo un `admin` puede tocar el rol `admin`, sin depender de la tabla `roles` dinámica). `api/admin-users.js` **no** llama a estas RPCs — reimplementa la operación directo contra la Auth Admin API con la Service Role Key — así que se confirmó el mismo guard replicado ahí por separado (líneas 90–124, 207–208, 257–258) |
| **SEC-11** | `api/admin-users.js` (función serverless con la Service Role Key) no tenía límite de frecuencia propio — dependía solo de que el token del caller fuera válido y tuviera permiso; una cuenta comprometida podía ejecutar una ráfaga de creación de usuarios o reseteos de contraseña sin freno. Hallazgo de la auditoría QA externa del 5 de julio | `api/admin-users.js`, tabla `admin_actions_rate_limit`, RPC `registrar_admin_action_rate_limit` | `0051` | ✅ Cerrado — verificado contra HEAD real el 5 de julio: límite de 10 acciones/minuto por `actor_id` (`auth.uid()` del caller, no IP — Vercel no expone IP de cliente confiable y varias cuentas tras la misma IP/NAT se bloquearían entre sí). Mismo patrón que `scan_rate_limit`/`D-3` pero sin necesitar `pg_cron`, porque la tabla está acotada al número de cuentas con permiso de gestión de usuarios. Confirmado que `api/admin-users.js` invoca la RPC (línea 67) antes de ejecutar cualquier acción |
| **D-6** | La librería `xlsx` (parseo de los Excel que suben los usuarios) tiene 2 vulnerabilidades de severidad **alta** sin parche disponible del mantenedor (contaminación de prototipo y ReDoS). Única vía de entrada de datos externos no controlados por RLS. Hallazgo de la auditoría QA externa del 5 de julio | `package.json`, parser de Excel | — | 🟡 **Abierto** — reverificado contra HEAD real el 9 de julio: `package.json` sigue apuntando al tarball de SheetJS (`xlsx-0.20.3.tgz`), sin parche disponible del mantenedor. Confirmado que el límite de tamaño de archivo (10 MB, `useUpload.js`) ya existe; sigue sin confirmarse un límite explícito de filas/hojas. **Prioridad #2** de la sesión del 9 de julio: evaluar migración a `exceljs` cuando el roadmap lo permita. No bloqueante: el parseo ocurre en el navegador de quien sube el archivo, no en un servidor compartido |

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
| **ARCH-6** | El CSS embebido de `QRProyeccion.jsx` (`const CSS = \`...\`` inyectado vía `<style>`) contiene el stylesheet completo duplicado dentro del mismo template literal — dos copias consecutivas de ~300 líneas. La primera es una versión vieja e incompleta que queda pisada por la segunda (correcta) solo por cascada CSS, mismo selector/especificidad. No afecta el render (la copia buena va después), pero duplica ~300 líneas muertas en el bundle. Encontrado de forma incidental al migrar `A3` en este archivo (5 de julio) | `src/components/asistencias/QRProyeccion.jsx` | ✅ Cerrado (5 de julio, cierre de `S3`) — el `<style>{CSS}</style>` en sí bloqueaba `S3` igual que un `style` inline, así que se extrajo a `QRProyeccion.css` real; de paso se eliminó la copia duplicada/vieja, dejando solo la correcta |
| **ARCH-7** | Bundle de producción sin dividir por ruta — el chunk principal pesa 514 KB minificado (165 KB comprimido), por encima del umbral que Vite recomienda y advierte en cada build. Hallazgo de la auditoría QA externa del 5 de julio | `vite.config.js`; vistas grandes sin `React.lazy` (`HistorialView`, `LogsView`, `AsistenciasModulo`) | 🟡 **Abierto, con progreso real** — reverificado con `vite build` contra HEAD real el 9 de julio: ya hay `React.lazy` aplicado en 7 vistas (`HistorialView`, `UsuariosView`, `LogsView`, `AdminQRPanel`, `QRProyeccion`, `ReporteAsistencias`, `PlanillaQR`), pero el chunk principal (`index-*.js`) sigue midiendo **503 KB** minificado — todavía por encima del umbral de Vite — porque otras 7 vistas se importan directo en `HorariosLayout.jsx` sin `lazy()`: `ResumenView`, `UploadPreviewModal`, `HorariosView`, `SeccionesView`, `DocentesView`, `MateriasView`, `AsistenciasView`. **Prioridad #1** de la sesión del 9 de julio: aplicar el mismo patrón `lazy(() => import(...))` ya probado en el mismo archivo a esas 7 vistas restantes — es mecánico y de bajo riesgo |
| **ARCH-8** | `HorariosLayout.jsx` (561 líneas) y `App.jsx` (353 líneas) concentran layout, navegación, estado de sesión (y hasta hace poco, estilos) en un solo archivo cada uno — cualquier cambio pequeño obliga a leer el archivo completo. Hallazgo de la auditoría QA externa del 5 de julio | `src/app/HorariosLayout.jsx`, `src/App.jsx` | ✅ **Cerrado** — verificado contra HEAD real el 9 de julio: `HorariosSidebar.jsx` y `HorariosTopbar.jsx` ya existen como componentes propios, extraídos de `HorariosLayout.jsx` (comentario `// Extraído de HorariosLayout.jsx (ARCH-8)` confirmado en ambos archivos). `HorariosLayout.jsx` bajó de 561 a **293** líneas; `App.jsx` bajó de 353 a **338** |
| **ARCH-9** | `ResponsiveStyles.jsx` es código muerto: no lo importa ni renderiza ningún otro archivo del repo, y encima su propio import (`responsiveCSS` desde `constants`) no existe en ningún lado — si alguna vez se llegara a usar, rompería en tiempo de ejecución. Encontrado de forma incidental durante el barrido de `<style>` tags para cerrar `S3` (5 de julio) | `src/components/ResponsiveStyles.jsx` | 🟡 **Abierto** — señalado, sin corregir; opción más simple es eliminar el archivo directamente |
| **ARCH-10** | Con `ARCH-8` ya cerrado, los tres archivos más grandes del repo pasaron a ser otros: `HistorialView.jsx` (637 líneas), `LogsView.jsx` (517) y `LoginScreen.jsx` (508, con formulario normal, flujo de PIN offline y modal de activación mezclados en un solo archivo). Mismo problema de fondo que `ARCH-8`, en archivos distintos. Hallazgo de la auditoría QA senior del 9 de julio | `src/components/HistorialView.jsx`, `LogsView.jsx`, `LoginScreen.jsx` | 🟡 **Abierto** — **Prioridad #5**: extraer subcomponentes de responsabilidad única, mismo patrón ya usado en `ARCH-8` y en `usuarios/`. Sin urgencia de seguridad, sí de mantenibilidad a futuro |

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
| **FIX-CI-4** | 2 usos de `console.info` directo (`src/main.jsx`, `src/utils/cache.js`) rompen la consistencia del logger centralizado que motivó `FIX-CI-2` — no exponen información sensible (mensajes informativos de PWA/caché), pero son la única excepción a un patrón que el resto del repo (38 usos) sí sigue. Hallazgo de la auditoría QA senior del 9 de julio | `src/main.jsx`, `src/utils/cache.js` | 🟡 **Abierto** — **Prioridad #3**: reemplazar por `logger.info`, cambio de una línea cada uno, cero riesgo |

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
| **U-1** | Estilos inline en `AdminQRPanel` — primer caso migrado a CSS externo, sentó el patrón que luego siguió A3 | `AdminQRPanel.jsx` / `.css` | ✅ Cerrado (ver nota de precisión bajo `A3`) |
| **U-2** | Adaptabilidad móvil: `.qrp-col-left` con `flex: 0 0 320px` (sin encoger) desbordaba horizontalmente en viewports ≤ ~372px; grid fijo `1fr 1fr` en `ModalRol` quedaba inusable en pantallas pequeñas. Revisión real contra el HEAD (no solo conteo de `@media`) confirmó que el resto de pantallas de mayor uso móvil (`DocenteScan`, `TurnoGrid`, `ReporteRango`, `LoginScreen`, `HistorialView`) ya tenían mitigación adecuada y no necesitaron cambios | `AdminQRPanel.css`, `usuarios/ModalRol.jsx` | ✅ Cerrado |
| **U-3** | Sin trampa de foco de teclado en modales (accesibilidad) | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **U-4** | `Campo.jsx` (input del formulario de `DocenteScan`) renderiza `<label>` e `<input>` como hermanos, sin `htmlFor`/`id` que los asocie — un lector de pantalla no anuncia la etiqueta al enfocar el campo. Encontrado de forma indirecta: un test que intentaba ubicar el input por su label (`getByLabelText`, el método recomendado de Testing Library, que imita cómo un lector de pantalla encuentra el campo) no pudo hacerlo y tuvo que usar el `placeholder` como alternativa | `src/components/asistencias/DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()` genera un id estable que conecta `label`↔`input`; el mensaje de error/hint también se enlaza vía `aria-describedby`, y `aria-invalid` se activa cuando hay error. `DocenteScan.flow.test.jsx` se actualizó para usar `getByLabelText` en vez del workaround de `placeholder`, quedando como guardia contra que esto se rompa de nuevo) |
| **A3** | Migración sistemática de estilos inline a CSS externo, requisito para poder cerrar S3 (CSP) | Ver nota — el repo bajó de 54 a **0 ocurrencias reales** | ✅ **Cerrado** — `Avatar.jsx` se cerró bucketizando el tono a 24 pasos de 15° (tamaño ya era fijo: solo 30/44/52 se usan); `TurnoGrid.jsx` se cerró de raíz reemplazando el cálculo de altura en JS por `flex: 1` (el `rowSpan` ya era 1-6, dominio fijo); `ModalRol.jsx` se cerró quitando el `<input type="color">` libre — decisión de producto revisada, ahora restringido a los 10 presets |
| **U-5** | Los 7 archivos del shell principal (`src/app/`) — `HorariosLayout.jsx`, `UserMenu.jsx`, `AsistenciasModulo.jsx`, `App.jsx`, `AdminMenu.jsx`, `SinPerfilAsignado.jsx`, `CuentaDesactivada.jsx` — tenían cero reglas `@media` propias por ser estilos inline; `U-2` solo había verificado pantallas de *funcionalidad* (QR, horarios, login), nunca el *shell* que las contiene (sidebar, menú de usuario, layout de asistencias). Hallazgo de la auditoría QA externa del 5 de julio | mismos 7 archivos + `src/index.css` | ✅ Cerrado — verificado contra HEAD real el 5 de julio: los 7 archivos migrados a clases con prefijo (`hl-`, `um-`, `asm-`, `adm-`, `spa-`, `cd-`) consolidadas en `src/index.css`, con reglas `@media` incluidas (ej. bloque `@media (max-width: 640px)` con `.hl-brand-row`, `.hl-consulta-banner`, `.hl-consulta-btn`). `UserMenu.jsx` conserva 1 estilo inline legítimo (`style={{ "--um-role-color": rolColor }}`, una CSS custom property con color dinámico por dato — no es deuda pendiente) |
| **U-6** | El bundle sin dividir (`ARCH-7`) también es un problema de experiencia: pantalla en blanco más larga de lo necesario en la primera carga, especialmente en redes móviles. Hallazgo de la auditoría QA externa del 5 de julio | mismo que `ARCH-7` | 🟡 **Abierto, mismo progreso que `ARCH-7`** — reverificado el 9 de julio: 7 de 14 vistas ya usan `React.lazy`, pero el chunk principal sigue en 503 KB. Mismo remedio, misma prioridad (**#1**) |

> **Nota de precisión sobre `U-1` (histórico, verificado contra HEAD el
> 4 de julio):** el propio comentario de cabecera de `AdminQRPanel.jsx`
> afirmaba *"Eliminados los 142 bloques `style={{}}` inline que existían
> en la versión anterior"*, pero funcionalidad añadida después
> (`CountdownBar`, `FeedActividad`, `ContadorSesion`, `ColaOfflinePanel`,
> `HistorialSesiones`) había vuelto a introducir 34 bloques inline sin
> seguir el patrón `.css` que `U-1` estableció. **Actualización (HEAD
> `abc4118`, 5 de julio):** ese backlog ya se migró — el archivo bajó de
> 34 a **5** bloques, todos estilo dinámico legítimo. `U-1`/`AdminQRPanel`
> se considera cerrado en ambos sentidos (el hallazgo puntual y el archivo
> completo).
>
> **⚠️ Discrepancia real encontrada y reconciliada (5 de julio, auditoría
> QA externa vs. este índice):** la pasada anterior (ver más abajo, "verificado
> contra HEAD `4380e23`") daba `A3` por prácticamente cerrado con solo 2
> residuos, porque **todas** las sesiones de migración de `A3` hasta esa
> fecha habían grepeado únicamente `src/components/` — nunca `src/app/`
> (el shell principal: sidebar, header, menú de usuario, layout de
> asistencias). Una auditoría QA independiente corrió el mismo grep sobre
> **todo** `src/` el mismo día y encontró **157 ocurrencias en 29
> archivos**, incluyendo **7 archivos de `src/app/` nunca antes
> contados**: `HorariosLayout.jsx` (40), `UserMenu.jsx` (21),
> `AsistenciasModulo.jsx` (12), `App.jsx` (12), `AdminMenu.jsx` (7),
> `SinPerfilAsignado.jsx` (6), `CuentaDesactivada.jsx` (6). No es que se
> hubiera reabierto nada — es que nunca se había auditado esa parte del
> árbol.
>
> **Verificado contra HEAD real el 5 de julio, después del hallazgo:**
> los 7 archivos de `src/app/` ya están migrados — 6 en 0 estilos inline,
> `UserMenu.jsx` con 1 residuo dinámico legítimo (ver `U-5` arriba). El
> conteo global real de `style={{` en todo `src/` en este momento es
> **54 ocurrencias en 22 archivos**. De esos 22, la gran mayoría son
> estilo dinámico legítimo ya aceptado en pasadas anteriores (color por
> dato, tamaño de avatar, config de evento/acción — 1 ocurrencia cada uno
> en `GlobalSearch.jsx`, `Avatar.jsx`, `usuarios/shared.jsx`,
> `usuarios/PestanaRoles.jsx`, `usuarios/PestanaUsuarios.jsx`,
> `StatCard.jsx`, `ConflictosView.jsx`, `MateriasView.jsx`,
> `PlanillaImprimibleBase.jsx`, `SkeletonRow.jsx`; 2 en
> `ModalCambiarPassword.jsx`, `ProgramaLogo.jsx`, `TurnoGrid.jsx`,
> `ReporteAsistencias/index.jsx`). **Pero 6 archivos siguen con deuda
> real pendiente de migrar** (no dinámico legítimo, migración simplemente
> no hecha todavía): `LogsView.jsx` (5), `ReporteRango.jsx` (5),
> `DocentesView.jsx` (3), `SeccionesView.jsx` (3), `UploadPreviewModal.jsx`
> (3), `ModalRol.jsx` (3) — este es el mismo grupo de "6 archivos
> restantes" que ya señalaba el trabajo en curso al 4 de julio, ahora
> confirmado con números reales en vez de dado por hecho. `ResumenView.jsx`
> y `AdminQRPanel.jsx`, que aparecían con 8 y 5 respectivamente en la
> pasada anterior, ya están en 0.
>
> **Conclusión de esta reconciliación:** `A3` no puede darse por cerrado
> todavía — el hallazgo de la auditoría QA sí era correcto en que el
> alcance real era mayor al reportado, pero el shell (`src/app/`), que
> era la parte nueva y más grande en volumen, ya se cerró al momento de
> esta verificación. Lo que queda pendiente es el mismo grupo de 6
> archivos en `src/components/` ya identificado antes — no hay trabajo
> nuevo que agregar más allá de terminarlos. Recomendación de la propia
> auditoría QA, adoptada aquí: automatizar el conteo con un script de CI
> (`grep -r "style={{" src | wc -l`) que falle si sube, para que esta
> clase de discrepancia entre "lo reportado" y "lo real" no vuelva a
> pasar desapercibida.
>
> **Cerrados en la sesión del 5 de julio (16 archivos trabajados):**
> `ConflictosView.jsx` (20→1), `ModuleSelector.jsx` (17→0, eliminó el
> `useState` de hover simulado), `usuarios/ModalUsuario.jsx` (14→0),
> `HorariosView.jsx` (10→0 en local — **ver discrepancia abajo**),
> `GlobalSearch.jsx` (10→1), `usuarios/shared.jsx` (9→1, `Badge`/
> `ModalConfirm`/`Spinner`), `usuarios/index.jsx` (8→0),
> `asistencias/PlanillaQR.jsx` (7→0), `ReporteAsistencias/
> AlertaSinVincular.jsx` (6→0), `ErrorBoundary.jsx` (6→0),
> `asistencias/QRProyeccion.jsx` (4→0 — ver hallazgo nuevo abajo),
> `Toast.jsx` (4→0, eliminó el objeto `palette` de JS),
> `StatCard.jsx` (4→1), `ProgramaLogo.jsx` (3→2),
> `ReporteAsistencias/EstadoChip.jsx` (2→0, eliminó el objeto `map` de JS),
> `Avatar.jsx` (1→1).
>
> **⚠️ Discrepancia encontrada al reverificar contra HEAD real
> (`4380e23`):** `HorariosView.jsx` se migró y se entregó completo
> (10→0) en esta sesión, y su `.css` (`HorariosView.css`) sí llegó a
> pegarse en el repo — pero el `.jsx` no. El HEAD real todavía tiene el
> archivo viejo con los 10 `style={{` originales, sin el `import
> './HorariosView.css'`. Es el mismo patrón de "archivo entregado pero no
> aplicado" que ya había ocurrido antes con otros archivos en sesiones
> previas (ver la advertencia general al inicio de este documento sobre
> verificar contra HEAD real). **Sigue siendo el único bloqueo real de
> `A3`/`S3`** — el archivo migrado ya existe, solo falta pegarlo.
>
> **Hallazgo nuevo, fuera del alcance de `A3` (`asistencias/
> QRProyeccion.jsx`):** el CSS embebido del componente (`const CSS =
> \`...\``, inyectado vía `<style>{CSS}</style>` en vez de un archivo
> `.css` importado) contiene el stylesheet **completo duplicado dentro
> del mismo template literal** — dos copias consecutivas de ~300 líneas
> cada una. La primera copia es además una versión **vieja e incompleta**
> (sin los modificadores `--sm`/`--col`/`--row` de la segunda), que queda
> pisada por la segunda solo gracias a la cascada CSS (mismo selector,
> misma especificidad, la última declarada gana). No es un bug funcional
> visible — el render es correcto porque la copia buena va después — pero
> duplica ~300 líneas muertas en el bundle. No se corrigió en esta sesión
> por estar fuera del alcance de `A3`; queda pendiente de asignarle un ID
> y decidir si se aborda (ver `ARCH-6` más abajo).
>
> **Pendiente real, por tamaño:** solo `HorariosView.jsx` (10, migración
> ya lista, solo falta pegarse) y `SkeletonRow.jsx` (1 — estático: ancho
> fijo por columna del esqueleto de carga vía `[120, 90, 160, 90, 80,
> 100][i]`, no depende de datos en runtime; candidato a resolverse con
> `:nth-child()` en CSS puro, mismo patrón ya aplicado en `TurnoGrid` y
> `GlobalSearch` — no confundir con dinámico legítimo).
>
> El helper `S` de `src/constants/index.js` ya no lo importa **ningún**
> archivo (bajó de 2) — `usuarios/shared.jsx` y `ReporteAsistencias/
> VistaAusentes.jsx` fueron los últimos en dejar de usarlo, en esta y la
> sesión anterior respectivamente. Ese sub-objetivo de la migración está
> **100% cerrado**, independientemente de que `HorariosView.jsx` siga
> pendiente de pegarse.

---

## 🎨 Identidad visual y sistema de diseño

Esquema `FE-N` (Frontend). Fusionado desde `AUDITORIA_FRONTEND.md`, un
documento aparte que auditaba específicamente identidad visual e
iconografía — se integra aquí para tener un solo índice de auditoría en
vez de dos con superposición parcial (ambos tocan estilos inline y el
objeto `S`). Cada fila se reverificó contra el HEAD actual antes de
fusionarse, no se copió tal cual del documento original. `AUDITORIA_FRONTEND.md`
se elimina del repo tras esta fusión — su contenido vive ahora aquí.

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **FE-1** | Iconografía funcional resuelta con emojis nativos del SO (📅👥⚙️🎓✅⚠️…) en sidebar, topbar, modales y tarjetas — varía de apariencia según SO/navegador y no transmite seriedad institucional | `src/app/buildNavGroups.js`, `App.jsx`, `AdminMenu.jsx`, `LoginScreen.jsx`, `ModuleSelector.jsx`, `ConfirmModal.jsx` (primera pasada); resto de vistas (segunda pasada) | ✅ Cerrado — verificado con un grep de rango Unicode de emoji sobre **todo** `src/`: cero coincidencias como icono funcional. Los únicos emoji que sobreviven en el código son `EMOJIS_PRESET` en `usuarios/shared.jsx` (selector deliberado de emoji para personalizar un rol, es la funcionalidad en sí, no un ícono de UI) y un puñado dentro de `logger.warn(...)` / un comentario — mensajes de diagnóstico de desarrollo, no interfaz |
| **FE-2** | Tipografía sin identidad — solo `system-ui`, sin fuente propia ni jerarquía tipográfica definida | `src/index.css` | ✅ Cerrado — fuente **Inter** confirmada en `index.css` |
| **FE-3** | Tokens de diseño incompletos: faltaban escalas de espaciado/sombras/radios; gran parte de los componentes usaba estilos inline con hex repetidos en vez de tokens | `src/index.css`, objeto `S` en `src/constants/index.js` | 🟡 **Parcialmente cerrado** — la escala de tokens sí se completó (espaciado, sombras, `:focus-visible`), pero la segunda mitad de este mismo hallazgo (estilos inline con hex repetido en vez de tokens) es exactamente la causa raíz de `S3`/`A3` — no son hallazgos distintos, `S3`/`A3` es la continuación de `FE-3` con más profundidad y alcance (33 archivos en vez de los "algunos" que mencionaba `FE-3` originalmente). Seguir el estado real en `A3`, no aquí Reverificado el 9 de julio: sigue sin existir una escala de tamaños de fuente (`--font-size-*`) — cada componente define su propio `font-size` suelto. **Prioridad #6**: definir 5-6 variables basadas en los valores ya en uso hoy, adopción gradual sin migración masiva |
| **FE-4** | Sin estado `:focus-visible` accesible consistente para navegación por teclado | `src/index.css` | ✅ Cerrado — 6 reglas `:focus-visible` confirmadas en `index.css` |
| **FE-5** | `HorariosLayout.jsx` mezclaba `fontSize`, colores y espaciados como números sueltos (`fontSize: 13`, `padding: "10px 10px 10px"`) en vez de los tokens ya definidos en `index.css`. Hallazgo de la auditoría QA externa del 5 de julio | `src/app/HorariosLayout.jsx` → clases `.hl-*` en `src/index.css` | 🟡 **Parcialmente cerrado** — al migrar el archivo a CSS externo (ver `U-5`) desapareció el problema de fondo (valores JS sueltos), pero la adopción de `var(--token)` en las reglas `.hl-*` nuevas quedó mixta: algunos `font-size`/`padding` siguen en px crudo en vez de tokens. Confirmado sin cambios el 9 de julio. **Prioridad #4**: pasada de limpieza puntual, solo CSS, bajo riesgo |

> **Nota sobre la lista "pendiente fase 2" del documento original:** listaba
> conteos de emoji por archivo (`UsuariosView.jsx` 25, `LogsView.jsx` 24,
> `HistorialView.jsx` 22, `AdminQRPanel.jsx` 14, `ResumenView.jsx` 13,
> `DocentesView.jsx` 12, etc.) como trabajo pendiente. Verificado contra
> HEAD: esa lista ya no aplica. `UsuariosView.jsx` ya ni existe — se
> refactorizó en la carpeta `usuarios/` (varios archivos) en un trabajo
> aparte de arquitectura, no de iconografía. Los demás archivos de la
> lista se revisaron uno por uno con el mismo grep de rango Unicode: cero
> emoji funcional en ninguno. Este hallazgo se puede dar por **completado
> en su totalidad**, no solo en la primera pasada que documentaba el
> archivo original.
>
> **Sugerencias del documento original que siguen sin implementarse**
> (no eran hallazgos de auditoría propiamente, sino mejoras sugeridas a
> futuro — se preservan aquí para no perderlas al fusionar):
> dividir `App.jsx` (1500+ líneas) y vistas grandes en subcomponentes;
> evaluar `code-splitting` con `import()` dinámico por vista para reducir
> el bundle inicial (~917 KB en la medición original). Ninguna de las dos
> es bloqueante para `S3`/`A3`.

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

**Abiertos ahora mismo:** `A3` y `S3` quedaron **cerrados** — el repo llegó
a 0 estilos inline reales (incluyendo formas que ningún grep de
`style={{` detecta: `.style.X =` en JS puro, `<style>` tags con contenido
estático, `innerHTML` con `style=""`) y `vercel.json` ya no tiene
`unsafe-inline` en `style-src`. De paso se cerró `ARCH-6` (CSS duplicado
en `QRProyeccion.jsx`, resuelto al extraerlo a un archivo `.css` real). Se
agregó `ARCH-9` (código muerto en `ResponsiveStyles.jsx`, encontrado en el
mismo barrido). `SEC-9` (bajo riesgo, señalado por transparencia) sigue
abierto. `D-6` (vulnerabilidades de `xlsx`, sin parche disponible),
`ARCH-7`/`U-6` (bundle sin dividir por ruta), `ARCH-8`
(`HorariosLayout.jsx` y `App.jsx` concentran demasiada responsabilidad) y
`ARCH-9` (código muerto) son hallazgos nuevos de la auditoría QA externa
del 5 de julio (y su continuación), todos abiertos. `FE-3` y `FE-5`
quedan parcialmente abiertos pero son la misma tarea que `A3`/`S3` vista
desde identidad visual, no hallazgos independientes. `SEC-10` y `SEC-11`
(escalada de privilegios y rate limiting en gestión de usuarios,
reportados por la misma auditoría QA) se verificaron contra HEAD real y
están **cerrados** — migraciones `0050`/`0051` aplicadas y confirmadas en
código. `U-5` (responsividad del shell) también se verificó cerrado.
Con el cierre de `SEC-6`, `SEC-7`, `SEC-8`, `SEC-10`, `SEC-11`, `S2`,
`ARCH-5`, `U-4`, `U-5`, `FE-1`, `FE-2`, `FE-4` y todo `FIX-CI-N`, el resto
de hallazgos de seguridad, accesibilidad, testing, iconografía/tipografía
y CI/automatización de este índice quedan cerrados. Para el índice de
migraciones SQL y el esquema de base de datos, ver `ESQUEMA_Y_MIGRACIONES.md`.

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

*Cuarta pasada (4 de julio de 2026) — esta rama de trabajo (migración A3
archivo por archivo + fusión de `AUDITORIA_FRONTEND.md`) había divergido en
paralelo de la rama que agregó `SEC-7`/`SEC-8`/`SEC-9` (la de la "Tercera
pasada" de arriba): ambas partieron del mismo punto y avanzaron sin verse.
Se reconcilió tomando el HEAD real del repo como base (que ya tenía
`SEC-7`/`SEC-8`/`SEC-9` correctos) y aplicando encima, ya reverificado
contra código: (1) cifras de `A3` recalculadas — **33 archivos, 341
ocurrencias** (bajó de 40/487), con **9 archivos ya efectivamente
cerrados** listados por nombre; (2) nota de precisión en `U-1`:
`AdminQRPanel.jsx` afirma en su propio comentario de cabecera que ya no
tiene `style={{`, pero el HEAD real muestra 34 — funcionalidad añadida
después de aquel fix no siguió su patrón; (3) fusión completa de
`AUDITORIA_FRONTEND.md` como sección `FE-N` (`FE-1` a `FE-4`), con
`FE-3` marcado explícitamente como el mismo hallazgo que `S3`/`A3` visto
desde otro ángulo, para no mantener dos contadores que se desincronicen;
(4) corregido un dato propio: el helper `S` lo importan **3** archivos,
no 4 como se había escrito en un borrador intermedio de esta misma
pasada — se verificó de nuevo con grep antes de cerrar. `AUDITORIA_FRONTEND.md`
se elimina del repo con este cambio; su contenido íntegro vive ahora en la
sección `FE-N` de este documento.*

*Quinta pasada (5 de julio de 2026) — sesión de migración `A3` archivo por
archivo, verificada al final contra el HEAD real del repo (`4380e23`,
tras `git fetch && git reset --hard origin/main`) en vez de solo contra
lo entregado en el chat. Se trabajaron 16 archivos: `ConflictosView.jsx`
(20→1), `ModuleSelector.jsx` (17→0), `usuarios/ModalUsuario.jsx` (14→0),
`HorariosView.jsx` (10→0 en local), `GlobalSearch.jsx` (10→1),
`usuarios/shared.jsx` (9→1), `usuarios/index.jsx` (8→0),
`asistencias/PlanillaQR.jsx` (7→0), `ReporteAsistencias/
AlertaSinVincular.jsx` (6→0), `ErrorBoundary.jsx` (6→0),
`asistencias/QRProyeccion.jsx` (4→0), `Toast.jsx` (4→0), `StatCard.jsx`
(4→1), `ProgramaLogo.jsx` (3→2), `ReporteAsistencias/EstadoChip.jsx`
(2→0), `Avatar.jsx` (1→1). El helper `S` quedó en **0 archivos** que lo
importen (bajó de 2). Al reverificar contra HEAD real se encontró que
**`HorariosView.jsx` se entregó y su `.css` se pegó, pero el `.jsx`
migrado no llegó a aplicarse** — el HEAD real seguía con los 10
`style={{` originales; se volvió a entregar en el mismo chat. Es el
mismo patrón de "archivo entregado pero no aplicado" documentado en
sesiones anteriores de esta migración. Se estableció además una
convención nueva durante la sesión: componentes con menos de ~5 reglas
CSS se consolidan directamente en `src/index.css` con prefijo de
componente (`qr-`, `eb-`, `asv-`, `pl-`, `ec-`, `av-`, `sc-`) en vez de
crear un archivo `.css` individual — evita fragmentar el bundle CSS sin
necesidad para casos pequeños. Se encontró de forma incidental y se
documentó como `ARCH-6` (nuevo) un CSS embebido completo duplicado
dentro del mismo template literal en `QRProyeccion.jsx`, fuera del
alcance de esta migración — sin corregir, señalado para una sesión
futura. Con `HorariosView.jsx` pendiente solo de pegarse y
`SkeletonRow.jsx` como único residuo estático real (1 estilo, ya
señalado en pasadas anteriores), `A3`/`S3` quedan a un paso de cerrarse
por completo.*

*Sexta pasada (5 de julio de 2026) — integración de una auditoría QA
independiente (`AUDITORIA_QA_5JUL2026.md`), verificada contra HEAD real
antes de incorporar nada. Se confirmaron cerrados `SEC-10` (migración
`0050` — jerarquía fija de rol admin en 5 RPCs, guard replicado en
`api/admin-users.js`) y `SEC-11` (migración `0051` — rate limit de 10
acciones/minuto por `actor_id` en `api/admin-users.js`, RPC confirmada
invocada en el endpoint). Se reconcilió una discrepancia real en `A3`:
todas las sesiones anteriores habían grepeado solo `src/components/`,
sin tocar nunca `src/app/` (el shell principal) — la auditoría QA corrió
el grep sobre todo `src/` y encontró 157 ocurrencias en 29 archivos en
vez de los ~5 que este índice daba por pendientes. Verificado después
del hallazgo: los 7 archivos de `src/app/` señalados ya estaban migrados
(6 en 0 estilos, 1 con un residuo dinámico legítimo vía CSS custom
property) — se agregó `U-5` como cerrado por esto. `A3`/`S3` permanecen
**abiertos**, no por el shell (ya resuelto) sino por el mismo grupo de 6
archivos de `src/components/` ya conocido de sesiones previas
(`LogsView.jsx`, `ReporteRango.jsx`, `DocentesView.jsx`,
`SeccionesView.jsx`, `UploadPreviewModal.jsx`, `ModalRol.jsx`). Se
agregaron como nuevos hallazgos abiertos, sin corregir en esta pasada:
`D-6` (vulnerabilidades sin parche en `xlsx`), `ARCH-7`/`U-6` (bundle sin
dividir por ruta, 514 KB minificado) y `ARCH-8` (`HorariosLayout.jsx` y
`App.jsx` concentran demasiada responsabilidad). `FE-5` (valores sueltos
en vez de tokens en `HorariosLayout.jsx`) se marcó parcialmente cerrado —
el problema de fondo desapareció al migrar a CSS externo, pero la
adopción de `var(--token)` en las reglas nuevas quedó mixta. Nota: la
mención de `HorariosView.jsx` pendiente de pegarse en la pasada anterior
no se reverificó en esta sesión — quedó fuera del alcance de la
auditoría QA, que no lo señaló como hallazgo.*

*Octava pasada (5 de julio de 2026) — ejecución de las Fases 1 y 2 del plan
acordado para cerrar `A3`/`S3` de verdad (no solo el shell). Diagnóstico
previo: un CSP `style-src` sin `unsafe-inline` bloquea cualquier atributo
`style`, sea un color literal o una CSS custom property — así que "usar
`--var` en vez de color directo" nunca iba a cerrar `S3` por sí solo; solo
mover el dato a un dominio **enumerable** (clases fijas) lo hace. Se
revisó el origen real de cada residuo restante en todo `src/` (no solo los
4 archivos mencionados originalmente) y se encontraron bastantes más de
los esperados, todos hardcodeados en el propio código, no datos de
usuario:
- **Fase 1** (13 clases `.trayecto-<n>` en `index.css`, TRAYECTO_BG/COLORS
  es un dominio fijo): cerró `DocentesView.jsx`, `SeccionesView.jsx`,
  `MateriasView.jsx`, `ConflictosView.jsx`, `GlobalSearch.jsx`,
  `PlanillaImprimibleBase.jsx` a 0 estilos inline; `ResumenView.jsx` y
  `TurnoGrid.jsx` bajaron parcialmente (les queda algo de Fase 4/5, ver
  abajo).
- **Fase 2** (datos igual de fijos pero sin relación con trayecto): cerró
  a 0 `LogsView.jsx` (`EVENTO_CONFIG`/`ACCION_CONFIG`), `StatCard.jsx`
  (refactor de prop `color` arbitraria a `variant` fijo, 8 call sites en
  `ResumenView`/`DocentesView`), `ProgramaLogo.jsx` (tamaño siempre 32,
  gradiente por programa fijo), `PestanaUsuarios.jsx` (stats), `SkeletonRow.jsx`
  y ambos archivos de `ReporteAsistencias/` (stats + skeleton por
  `nth-child`), `ModalCambiarPassword.jsx` (4 niveles de fortaleza, no un %
  continuo) y `UploadPreviewModal.jsx` (subcomponentes `Tag`/`StatChip`/
  `EmptyState` refactorizados de `color/bg/border` a `variant`, con la
  paleta interna `C` eliminada por quedar sin uso). En `ReporteRango.jsx`
  y `AdminQRPanel.jsx` se cerró el color (umbral fijo de 3 estados),
  dejando solo el ancho (% continuo real) inline para Fase 4.
- **Efecto colateral — 2 bugs latentes corregidos**: `PestanaUsuarios.jsx`
  llamaba `hex2rgba()` con strings `"var(--brand-500)"` en vez de un hex
  real, generando `rgba(NaN,NaN,NaN,0.2)` silenciosamente (el borde de las
  3 tarjetas de stats nunca se veía como debía); `StatCard.jsx` tenía el
  mismo problema con `${color}18` para las 4 tarjetas de `DocentesView`
  que pasaban `color="var(--brand-500)"` etc. Ambos se corrigieron de paso
  al definir las clases fijas con el hex real ya resuelto.
- **Resultado verificado contra HEAD real**: 152/152 tests, `vite build`
  limpio. El repo bajó de 54 ocurrencias reales en 22 archivos a 18 en 9
  archivos, todas ya diagnosticadas y clasificadas: Fase 3 (color de rol
  personalizado — `UserMenu.jsx`, `PestanaRoles.jsx`, `usuarios/shared.jsx`
  `Badge`, `ModalRol.jsx` — pendiente de un `CHECK` en `roles.color`
  antes de poder cerrarse), Fase 4 (% continuo — `ResumenView.jsx`,
  `ReporteRango.jsx`, `AdminQRPanel.jsx` — decidido bucketizar a
  incrementos de 5%, sin ejecutar todavía) y Fase 5 (casos genuinamente
  difíciles — `Avatar.jsx` por hash de nombre, `TurnoGrid.jsx` por altura
  de celda calculada — sin decisión tomada aún). `A3`/`S3` siguen
  **abiertos** hasta que se ejecuten esas 3 fases.*

*Novena pasada (5 de julio de 2026) — ejecución de la Fase 3 (color de rol).
Se creó `roleColorClass()` en `constants/index.js`, combinando los 5
colores de `ROL_SIDEBAR` y los 10 de `COLORES_PRESET` (14 valores únicos)
en clases fijas `.role-color--<slug>` (`src/index.css`), con un fallback
`.role-color--default` para cualquier color no reconocido (degrada a gris
neutro, sin romper visualmente). Cerró a 0 estilos inline: `UserMenu.jsx`
(`.um-role`), `usuarios/shared.jsx` (`Badge`) y `PestanaRoles.jsx`
(`.pr-avatar`).
**Hallazgo que cambió el plan**: al revisar `ModalRol.jsx` para cerrar sus
3 residuos, se encontró un `<input type="color">` nativo junto a los 10
swatches del preset — el admin puede elegir **cualquier** color para un
rol personalizado, no solo los 10 conocidos. La premisa original de la
Fase 3 (agregar un `CHECK` en `roles.color` restringido al preset) era
incorrecta: `roles.color` nunca estuvo realmente acotado, y aplicar ese
`CHECK` habría roto la función de elegir color libre. Se preguntó y se
decidió **mantener el selector libre** en vez de restringirlo a 10
colores fijos. Como consecuencia: el swatch picker de `ModalRol.jsx` (los
10 botones, siempre uno de los valores conocidos) sí se migró a clases
fijas; los otros 2 residuos (tinte de fondo de la fila seleccionada,
`accentColor` del checkbox — ambos dependen de `form.color`, que puede
ser arbitrario) quedan **permanentes**, documentados en el propio código
como la misma clase de excepción que `Avatar.jsx` (Fase 5), no como deuda
pendiente. La migración `0052` con el `CHECK` en `roles.color` **no se
aplica** — queda descartada por esta razón.
Verificado contra HEAD real: 152/152 tests, `vite build` limpio. El repo
bajó de 18 a 16 ocurrencias reales en 6 archivos: Fase 4 (% continuo —
`ResumenView.jsx`, `ReporteRango.jsx`, `AdminQRPanel.jsx`, sin ejecutar)
y Fase 5 (permanentes por decisión de producto — `Avatar.jsx`,
`TurnoGrid.jsx`, y ahora también `ModalRol.jsx`). `A3` puede darse por
cerrado en el sentido de "todo lo enumerable ya se migró"; lo que queda
es, por diseño, no enumerable. `S3` (quitar `unsafe-inline` del todo)
solo podría cerrarse si además se resuelve Fase 4 y se acepta que el
color de rol libre seguirá necesitando `unsafe-inline` de forma
permanente — o se revierte la decisión de mantener el selector libre.*

*Décima pasada (5 de julio de 2026) — ejecución de la Fase 4 (bucketización
de % continuo). Se creó `pctClass()` en `constants/index.js`: redondea
cualquier % al múltiplo de 5 más cercano y devuelve una de 21 clases fijas
`.w-pct-0` … `.w-pct-100` (`src/index.css`), en vez de `width` inline.
Precisión perdida: hasta ±2.5 puntos porcentuales — aceptable para barras
de progreso visuales, no para valores que se lean como cifra exacta (esos
ya se muestran aparte, como texto, sin redondear). Cerró a 0 estilos
inline: `ResumenView.jsx` (6 barras), `ReporteRango.jsx` (1) y
`AdminQRPanel.jsx` (1). Verificado contra HEAD real: 152/152 tests, `vite
build` limpio.
**Estado final de `A3`/`S3` tras las 4 fases**: el repo bajó de 54
ocurrencias reales en 22 archivos a **5 en 3 archivos** — `Avatar.jsx` (1),
`TurnoGrid.jsx` (2) y `ModalRol.jsx` (2) — las 3 excepciones permanentes ya
decididas (dominio arbitrario, geometría calculada, y libertad de color
por decisión de producto, respectivamente). `A3` se da por **cerrado en la
práctica**: no queda ningún dato enumerable sin migrar. `S3` sigue
**abierto** porque esas 3 excepciones, al ser atributos `style` reales,
siguen requiriendo `unsafe-inline` en `style-src` — cerrarlo del todo ya
no es un problema técnico sino una decisión de producto (aceptar
`unsafe-inline` permanente y acotado a 3 casos conocidos, o sacrificar esa
funcionalidad). Pendiente de decidir.*

*Undécima pasada (5 de julio de 2026) — al retomar `S3`, se revisaron a
fondo los 2 casos que la pasada anterior había dado por "genuinamente
difíciles" y resultaron cerrables, no permanentes:
- **`Avatar.jsx`**: el tamaño (`size`) resultó ser fijo en la práctica —
  los 4 usos reales en todo el repo solo pasan 30, 44 o 52 — así que se
  volvió clase fija (`.av-size-30/44/52`) igual que cualquier otro dominio
  enumerable. El tono de color por nombre (`hue`, hash de caracteres,
  0-359°) sí es genuinamente continuo — se bucketizó a pasos de 15° (24
  clases `.av-hue-<n>` en vez de 360 valores posibles), mismo criterio que
  Fase 4 con los `%`.
- **`TurnoGrid.jsx`**: en vez de bucketizar, se encontró una solución de
  raíz. `BLOQUES_DIURNO`/`BLOQUES_VESPERTINO` (`constants/index.js`)
  siempre tienen exactamente 6 bloques — así que el `rowSpan` de una celda
  combinada solo puede ser 1-6, un dominio fijo perfecto para 6 clases
  (`.tg-cell-data--span-1` … `--span-6`). Y la altura de cada tarjeta
  dentro de una celda con varias clases superpuestas — que antes se
  calculaba en JS dividiendo por `entries.length` — se resolvió con
  `flex: 1` puro en un `<div className="tg-cell-inner">` dentro del `<td>`
  (se evitó poner `display:flex` directo en el `<td>`, que tiene
  `rowSpan`, para no arriesgar el layout de la tabla): el navegador
  reparte el espacio automáticamente sin que el componente necesite saber
  cuántas entradas hay. `ROW_H` quedó sin uso y se eliminó.
Verificado contra HEAD real: 152/152 tests, `vite build` limpio.
**Estado final**: el repo bajó de 54 ocurrencias reales en 22 archivos a
**2, en 1 solo archivo** — `ModalRol.jsx` (color de rol libre). `A3` se da
por **cerrado**. `S3` queda con una única decisión de producto pendiente,
acotada a ese archivo: restringir el color de rol a los 10 presets
(cerraría `S3` al 100%) o mantener `unsafe-inline` de forma permanente y
acotada a ese único caso conocido.*

*Duodécima pasada (5 de julio de 2026) — cierre real de `S3`. Se confirmó
que la opción de restringir `ModalRol.jsx` a los 10 presets era mejor
(el `<input type="color">` libre era una función de bajo valor real frente
al costo de mantener `unsafe-inline` permanente). Se quitó ese input, se
migraron los 2 residuos restantes (tinte de fondo de fila seleccionada,
`accentColor` del checkbox) a `roleColorClass()` con una nueva variable
`--role-tint-5`, y se eliminó `hex2rgba()` de `usuarios/shared.jsx` por
quedar sin ningún llamador en todo el repo (era además la fuente del bug
latente ya documentado). Con eso, `A3` llegó a **0 ocurrencias reales**.
Antes de tocar `vercel.json`, se hizo un barrido más allá de `style={{`
(que solo cubre JSX) buscando cualquier otra forma de generar un atributo
`style` o un `<style>` con contenido dinámico:
- **`ResponsiveStyles.jsx`**: código muerto — nunca se importa/renderiza
  en ningún lado, y su propio import (`responsiveCSS`) ni siquiera existe.
  No afecta a `S3` (nunca se ejecuta), documentado aparte como `ARCH-9`.
- **`QRProyeccion.jsx`**: `<style>{CSS}</style>` (dos veces) con contenido
  100% estático — un `<style>` con contenido, aunque no venga de datos,
  bloquea `S3` igual que un atributo `style`. Se extrajo a
  `QRProyeccion.css` real, lo que de paso cerró `ARCH-6` (el CSS embebido
  tenía el stylesheet completo duplicado dos veces; se conservó solo la
  copia correcta).
- **`App.jsx`**: `xlsxInput.style.display = "none"` / `jsonInput.style.display
  = "none"` (inputs de archivo ocultos, creados vía `document.createElement`)
  — manipulación directa de `.style` en JS, invisible para cualquier grep
  de `style={{`. Se reemplazó por una clase `.hidden-file-input`.
- **`main.jsx`**: el banner de actualización del Service Worker (DOM plano
  a propósito, no React) usaba `banner.style.cssText` y `style="..."`
  dentro de su propio `innerHTML`, contenido 100% estático. Se convirtió a
  clases (`.sw-update-banner`, `.sw-update-banner-btn`,
  `.sw-update-banner-dismiss`).
- **`exportPDF.js`** y **`PlanillaImprimibleBase.jsx`** (ventana de
  impresión): ambos generan un documento HTML aparte vía
  `window.open()` + `document.write()` — ese documento no recibe los
  headers HTTP de Vercel, así que la CSP del `vercel.json` no le aplica.
  No requerían ningún cambio.
- Se revisaron también las dependencias de producción
  (`@supabase/supabase-js`, `@tabler/icons-webfont`, `qrcode`, `xlsx`,
  `react`/`react-dom`) — ninguna inyecta estilos en runtime (`qrcode`
  dibuja en un `<canvas>`, Tabler es una fuente de íconos vía CSS externo).
Verificado contra HEAD real: 152/152 tests, `vite build` limpio en cada
paso. **`vercel.json` quedó con `style-src 'self'`, sin `unsafe-inline`.**
Nota de transparencia: este cambio de header HTTP no lo puede verificar
`vite build`/`vitest` — solo se confirma de verdad revisando la consola
del navegador (violaciones de CSP) después de desplegar.*

---

*Décima tercera pasada (9 de julio de 2026) — auditoría QA senior completa,
tres ejes (Funcionamiento/Arquitectura, Seguridad, Visualización/UX),
verificada contra HEAD real (`9443f85`) con suite de tests corrida de cero
(153/153 ✅, subió de 152 por `DocenteScan.flow.test.jsx` ya contabilizado
en el total) y un `vite build` de producción real, no contra lo que este
índice daba por hecho. Puntuación otorgada: **Arquitectura 84/100,
Seguridad 91/100, UX 89/100**.

Se confirmó cerrado algo que el índice daba por abierto: **`ARCH-8`** —
`HorariosSidebar.jsx` y `HorariosTopbar.jsx` ya existen como componentes
extraídos, con el comentario de origen (`// Extraído de HorariosLayout.jsx
(ARCH-8)`) confirmado en ambos; `HorariosLayout.jsx` bajó a 293 líneas y
`App.jsx` a 338.

Se reverificaron con evidencia nueva (medición real, no solo lectura de
código) los hallazgos que seguían abiertos: **`ARCH-7`/`U-6`** — ya hay
`React.lazy` en 7 de 14 vistas, pero el chunk principal sigue en 503 KB
minificado (`vite build` real); **`D-6`** — `xlsx` sigue en `0.20.3` vía
CDN, sin parche; **`FE-5`** y **`FE-3`** — la adopción mixta de tokens en
`.hl-*` sigue igual, y se confirmó que no existe ninguna escala de
`font-size` en todo el proyecto.

Se agregaron dos hallazgos nuevos: **`ARCH-10`** (`HistorialView.jsx`,
`LogsView.jsx` y `LoginScreen.jsx` son ahora los archivos más grandes del
repo, mismo problema que ya resolvió `ARCH-8` en otro lugar) y
**`FIX-CI-4`** (2 usos de `console.info` fuera del logger centralizado,
hallazgo trivial y de cero riesgo).

**Orden de prioridad recomendado para los próximos fixes** (de mayor a
menor impacto/urgencia):

1. **`ARCH-7`/`U-6`** — aplicar `React.lazy` a las 7 vistas restantes de
   `HorariosLayout.jsx`. Alto impacto en UX percibida, bajo riesgo, patrón
   ya probado en el mismo archivo.
2. **`D-6`** — evaluar migración de `xlsx` a `exceljs`. Única
   vulnerabilidad de seguridad real que sigue abierta; sin fix de código
   posible hoy, planificar antes de que crezca más código dependiente de
   la API actual.
3. **`FIX-CI-4`** — reemplazar los 2 `console.info` por `logger.info`.
   Trivial, cosmético, cero riesgo.
4. **`FE-5`** — limpieza puntual de tokens en las reglas `.hl-*`. Bajo
   esfuerzo, sin riesgo, solo CSS.
5. **`ARCH-10`** — dividir `LoginScreen.jsx`, `HistorialView.jsx` y
   `LogsView.jsx` en subcomponentes de responsabilidad única. Mayor
   esfuerzo, sin urgencia — trabajo de fondo.
6. **`FE-3`** — definir una escala tipográfica (`--font-size-*`) y
   adoptarla gradualmente. Mejora de largo plazo, sin prisa.

Todo lo demás señalado en pasadas anteriores (`SEC-9`, `S3`/`A3`, `U-5`,
`FE-1`/`FE-2`/`FE-4`, todo `FIX-CI-1`–`FIX-CI-3`) se reconfirmó cerrado
durante esta pasada sin encontrar regresiones.*
