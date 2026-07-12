# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgo (`S1`, `V-1`, `O-3`, `ARCH-8`, etc.) que
aparecen dispersos en comentarios de código y migraciones. Antes de este
documento, ubicar qué era un ID específico requería `grep` sobre todo el repo.

**Metodología:** cada fila se verifica contra el código/BD real (`grep`,
`git log`, `pg_policies`, `vite build`), nunca contra un informe externo sin
confirmar. Varios hallazgos reportados como vigentes resultaron falsos
positivos parciales al compararlos con el HEAD real — ver `S2` y `D-6` como
ejemplos. Al cerrar un hallazgo nuevo: usar el formato ya establecido en el
repo (`// Fix <ID> (auditoría <fecha>): qué y por qué` en código, `-- Migración
NNNN — Fix <ID>: resumen` en SQL), agregar/actualizar su fila aquí, y si
reabre o profundiza un hallazgo anterior decirlo explícitamente en la
descripción.

**IDs mencionados en código pero no localizados:** `O-6`, `O-7`, `P-1`,
`SEC-1`, `SEC-4` — probablemente descartados o fusionados con otro fix antes
de llegar a `main`. Si alguno reaparece, agregarlo aquí con su estado real.

**Esquemas cubiertos:** `S`/`SEC`/`V`/`D`/`O`/`A`/`ARCH`/`U`/`P`/`FE` (por
área) y `FIX-CI-N` (CI/CD). `SEC-N` es una serie paralela enfocada en
autenticación/sesión. `ADMIN-N` (§ Funcionalidad nueva) documenta trabajo
de producto pedido directamente por el usuario, no hallazgos de auditoría
— se incluye aquí porque el código ya usa ese formato de comentario. El
proyecto usó además dos nomenclaturas anteriores (`Fix #N`, `Gap #N`) —
ver § Histórico al final.

---

## 🟡 Hallazgos abiertos

De la auditoría QA senior externa del 12 de julio (ver § Historial de
auditorías al final para el detalle completo). Ninguno crítico ni
bloqueante — orden de prioridad sugerido:

1. ~~**`U-8`**~~ — ✅ Cerrado el 12 de julio (ver tabla "UI y estilos")
2. **`ARCH-12`** 🟡 — chunk `view-qr` (320 KB) sin sub-lazy-loading interno
3. **`SEC-13`** 🟡 — `api/admin-users.js` sin allowlist de origen (CORS,
   defensa en profundidad, sin explotación conocida hoy)
4. **`ARCH-13`** 🟢 — `xlsx` sin fallback local para CI en red restringida

Ver las tablas de categoría abajo para el detalle de cada uno.

---

## 🔐 Seguridad y RLS

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **S1** | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de cualquier programa (RLS nunca habilitado en la tabla padre particionada) | `horarios` (padre + particiones) | `0035`, `0045` | ✅ Cerrado |
| **S2** | `docentes`/`materias`: la política `FOR ALL` solo exigía `auth.role() = 'authenticated'`, sin permiso granular. (Reportado externamente como más grave de lo que era — RLS y bloqueo a `anon` ya estaban activos; verificado contra `pg_policies` real antes de escribir la migración) | `docentes`, `materias` | `0046` | ✅ Cerrado |
| **S3** | Estilos inline (`style={{...}}`) bloqueaban una política CSP estricta (`unsafe-inline` necesario mientras existieran) | Todo `src/` — ver `A3` | — | ✅ Cerrado (5 de julio) — `vercel.json` sin `unsafe-inline` en `style-src`. `ModalRol.jsx` restringido a 10 presets de color en vez de `<input type="color">` libre |
| **SEC-2** | Stack trace completo visible en producción | `src/components/ErrorBoundary.jsx` | — | ✅ Cerrado (solo se renderiza en desarrollo) |
| **SEC-3** | Sin validación centralizada de fortaleza de contraseñas | `src/utils/password.js` | — | ✅ Cerrado |
| **SEC-5** | Lockout de login en `localStorage` no resistía pestañas privadas (mismo patrón que `O-8`, para PIN) | `LoginScreen.jsx`, `pinOffline.js` | — | ✅ Cerrado (migrado a IndexedDB, cliente) |
| **SEC-6** | Sin respaldo server-side del lockout de `SEC-5` | `LoginScreen.jsx`, RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado. No reemplaza el rate limiting de Supabase Auth (plataforma) — verificar que siga activo en el dashboard |
| **SEC-7** | `login_attempts` tenía INSERT abierto a `public` con `WITH CHECK (true)` — cualquiera podía forzar el bloqueo de otra cuenta | `login_attempts` (RLS + GRANT) | `0048` | ✅ Cerrado |
| **SEC-8** 🔴 | 4 funciones con `REVOKE ALL FROM PUBLIC` en su migración original aparecían ejecutables por `anon` en la BD real (drift, no error de migración). Dos destructivas y solo debían ser `service_role`: `limpiar_audit_logs_antiguos`, `limpiar_scan_rate_limit` | `asegurar_particion_lapso`, `docentes_con_cedula`, `limpiar_audit_logs_antiguos`, `limpiar_scan_rate_limit`, `renovar_qr_token` | `0049` | ✅ Cerrado |
| **V-1** | INSERT/DELETE de `horarios` sin restricción de permiso granular | `horarios` | `0035` | ✅ Cerrado (causa raíz completa cerrada con `S1`/`0045`) |
| **V-2** | RLS de `qr_sessions`/`asistencias_diarias` sin permisos granulares | `qr_sessions`, `asistencias_diarias` | `0036` | ✅ Cerrado |
| **V-4** | `crear_qr_session()` solo validaba rol, no el permiso `puedeGestionarQR` | RPC `crear_qr_session` | `0035` | ✅ Cerrado |
| **D-3** | Sin rate limiting en `registrar_asistencia()` | `registrar_asistencia`, `scan_rate_limit` | `0039`, `0040` | ✅ Cerrado |
| **D-6** | 2 CVEs "alta severidad" reportadas para `xlsx` (prototype pollution, ReDoS) | `package.json` | `0.20.3` | ✅ **Cerrado — falso positivo** (verificado 9 de julio contra `cdn.sheetjs.com/advisories`, no `npm audit`): ambas CVEs ya corregidas antes de `0.20.3`; `package.json` apunta al tarball oficial de SheetJS, no al paquete de npm abandonado en `0.18.5` (de ahí que `npm audit`/Snyk sigan marcándolo). No se migra a `exceljs` — sin vulnerabilidad real que mitigar |
| **SEC-10** 🔴 | `admin_caller_puede_gestionar_usuarios()` solo verificaba un permiso booleano, sin comparar rol actor vs. rol objetivo — cualquier rol con ese permiso podía crear/editar/eliminar cuentas `admin` sin serlo (escalada de privilegios) | 5 RPCs `admin_*`, `api/admin-users.js` | `0050` | ✅ Cerrado — helper `admin_caller_es_admin()` como guard en las 5 RPCs y replicado en `admin-users.js` (que no llama a las RPCs, usa la Auth Admin API directo) |
| **SEC-11** | `api/admin-users.js` (Service Role Key) sin límite de frecuencia propio | `api/admin-users.js`, `admin_actions_rate_limit` | `0051` | ✅ Cerrado — 10 acciones/minuto por `actor_id` (no IP, por NAT compartido en Vercel) |
| **SEC-9** | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` aparecían ejecutables por `anon` sin ningún `REVOKE` explícito en ninguna migración — mismo patrón que `SEC-8`. Riesgo bajo (solo lectura, devuelven `null`/vacío para `anon`) | 4 RPCs de sesión (sin migración de origen) | `0052` | ✅ Cerrado — ninguna de las 4 fue creada por una migración de este repo, así que `0052` resuelve la firma real vía `pg_proc` en vez de asumirla, y aplica `REVOKE`/`GRANT` a la función que efectivamente exista. Verificado contra la BD real tras aplicar: `anon` ya no aparece en `EXECUTE` de ninguna |
| **D-7** 🟡 | `npm audit` marcaba 2 vulnerabilidades en `vite`/`esbuild` (una "alta", una "moderada"). Ambas vivían en el servidor de desarrollo (`npm run dev`) — permitían que una web maliciosa le pidiera datos a ese servidor mientras corría localmente. No afectaban el build de producción que sirve Vercel | `package.json` (`devDependencies.vite`) | — | ✅ **Cerrado (11 de julio)** — la sugerencia automática de `npm audit fix --force` saltaba a `vite@8.1.4`, pero `vite-plugin-pwa@0.21.1` (instalado) y `@vitejs/plugin-react@4.7.0` (instalado) solo declaran soporte hasta `vite ^6.0.0`/`^7.0.0` en sus `peerDependencies` — ese salto habría roto el build. Se aplicó en cambio `vite@^6.4.3` (dentro del mismo rango mayor que ya soportan ambos plugins), que trae `esbuild@^0.25.0` — ambas CVEs afectan únicamente versiones `<=6.4.2`/`<=0.24.2`, así que `6.4.3` ya las resuelve sin saltar de mayor. `npm audit --package-lock-only`: 0 vulnerabilidades. `vite-plugin-pwa` resolvió a `0.21.2` sin cambiar de rango en `package.json`. `npx vitest run`: 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `D-6`). `vite build` verificado completo con un stub temporal de `xlsx` (necesario solo por el firewall del sandbox de verificación, no se toca el repo): 253 módulos, chunking lazy idéntico (`view-historial`/`view-logs`/`view-qr`/`view-usuarios`), PWA generado correctamente (52 entradas de precache) |
| **SEC-13** 🟡 | `api/admin-users.js` no define cabeceras CORS propias (`Access-Control-Allow-Origin`, etc.). Hoy no es explotable porque Vercel sirve frontend y función del mismo origen, pero si en el futuro se llama desde otro dominio quedaría abierto a cualquier origen por defecto en vez de a una allowlist explícita | `api/admin-users.js` | — | 🟡 Abierto (detectado 12 de julio, auditoría QA senior externa) — solución: allowlist explícito del dominio de producción al inicio de `handler()`, rechazando con 403 cualquier origen fuera de la lista |
| **SEC-12** 🔴 | Reportado por LS: una sesión iniciada nunca se cerraba sola aunque pasaran días. Causa: `persistSession`/`autoRefreshToken` por defecto (sin límite de sesión) + el timeout de inactividad de `useAuth.js` (30/60 min) vivía solo en memoria del componente — cerrar la pestaña y reabrirla reiniciaba el conteo a cero sin importar el tiempo real transcurrido. Riesgo: acceso físico no autorizado al equipo con la cuenta ya logueada | `src/hooks/useAuth.js`, `auth.sessions` | `0053_limpieza_sesiones_expiradas`, `0055_fix_email_session_logs_cron` | ✅ Cerrado (10 de julio) — dos capas. Client: última actividad e inicio de sesión persistidos en `localStorage`; al montar, si ya venció el plazo se cierra sesión de inmediato, si no, el timer arranca con el tiempo *restante*. Se agrega además un time-box absoluto de 10h (jornada laboral) que no existía. Server (capa real, no evadible editando `localStorage`): `pg_cron` cada 15 min borra de `auth.sessions` lo que exceda el time-box (10h) o 2h sin renovar token — replica el "Time-boxed sessions" de Supabase Pro sin tener ese plan, usando acceso directo a `auth.sessions` (mismo patrón ya establecido en `0014`/`0015`/`0021`/`0050` con `auth.users`). Cada cierre forzado queda registrado en `session_logs` (`evento='logout'`, `detalles->>'forzado'='true'` — ver nota `0055`). `0055` corrige dos constraints de `session_logs` en producción no documentados en ningún esquema versionado (mismo tipo de drift que ya detectó `0033`): `NOT NULL` en `email` (resuelto poblando `email`/`nombre`/`rol`/`programa` vía el mismo JOIN que ya usa `get_session_logs()`) y un `CHECK` en `evento` que solo permite `'login'`/`'logout'` — verificado contra la BD real (302/49 filas) — por lo que el cierre forzado por servidor reusa `evento='logout'` y marca la distinción en `detalles` (`forzado`, `origen`, `motivo`) en vez de ampliar el constraint. Pendiente en el dashboard de Supabase (no se puede hacer por migración): confirmar `pg_cron` habilitado y considerar bajar el JWT expiry limit para acotar la ventana entre el borrado del server y el vencimiento natural del access token ya emitido |

## 🔎 Filtrado de datos por permiso/programa

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **V-3** | Pestañas de `AsistenciasModulo` no filtradas por permisos individuales | `src/app/AsistenciasModulo.jsx` | ✅ Cerrado |
| **D-1** | Mismo problema que `V-3`, en `LogsView` | `src/components/LogsView.jsx` | ✅ Cerrado |
| **D-2** | `HistorialView` no respetaba `restringe_programa` | `src/components/HistorialView.jsx` | ✅ Cerrado |
| **D-4** | `exportarDatos()` consultaba una tabla `asistencias` inexistente — backups exportaban `asistencias: []` silenciosamente | `src/hooks/useAppData/backupActions.js` | ✅ Cerrado (corregido a `asistencias_diarias`) |

## 📡 Offline y estado de red

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **O-1** | Sin manejo de estado offline/online para renovación del token QR | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **O-2** | Registros irrecuperables de la cola offline nunca se purgaban | `useSyncPendientes.js`, `offlineQueue.js` | ✅ Cerrado (TTL 48h) |
| **O-3** | Sin indicador visual de red caída en la proyección del aula | `QRProyeccion.jsx` | ✅ Cerrado |
| **O-4** | El poll de rotación de QR seguía intentando queries sin conexión | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **O-5** | Service Worker no se registraba explícitamente | `src/main.jsx` | ✅ Cerrado |
| **O-8** | Lockout de PIN en `localStorage` no resistía pestañas privadas | `LoginScreen.jsx` | ✅ Cerrado (migrado a IndexedDB) |
| **P-2** | `DocenteScan` sin manejo offline | `DocenteScan/index.jsx` | ✅ Cerrado (encola en IndexedDB, confirmación optimista) |
| **P-3** | Validación de token sin timeout — spinner infinito sin red | `DocenteScan/index.jsx` | ✅ Cerrado (timeout 3s) |

## ⚡ Concurrencia y datos asíncronos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **A1** | Colisión de nombres entre stores IndexedDB — crasheaba el bundle de producción (TDZ) | `pinOffline.js`, `offlineQueue.js`, `reporteCache.js` | ✅ Cerrado (prefijos únicos) |
| **A-2** | Sin paginación por cursor en `ReporteRango` | `ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado |
| **A-3** | Sin guardia de sanidad si el cursor de paginación no avanza | `useAppData/useDataSync.js` | ✅ Cerrado |
| **A-4** | Sin `AbortController` — fetches obsoletos podían sobreescribir estado más reciente | `ReporteRango.jsx`, `useQRSession.js` | ✅ Cerrado |
| **A-5** | Sin limpieza de datos al iniciar un fetch sin caché | `ResumenView.jsx`, `useDataSync.js` | ✅ Cerrado |

## 🧪 Testing y arquitectura

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **A2** | `log_audit_event` sin registrar rol/programa del actor | migración `0025` | ✅ Cerrado |
| **ARCH-4** | Sin cobertura de tests para lógica crítica (`useAuth`, cola offline) | `useAuth.test.js`, `offlineQueue.test.js` | ✅ Cerrado |
| **ARCH-5** | Sin tests de integración para hooks compuestos ni flujos de usuario completos (escaneo QR, carga de horarios, gestión de usuarios) | 5 tests de orquestación de hooks + `PestanaUsuarios.integration.test.jsx` + `DocenteScan.flow.test.jsx` (render real) | ✅ Cerrado — 152/152 tests, confirmado clonando el repo desde cero |
| **ARCH-6** | CSS embebido de `QRProyeccion.jsx` tenía el stylesheet completo duplicado dentro del mismo template literal | `asistencias/QRProyeccion.jsx` | ✅ Cerrado (5 de julio, junto con `S3`) — extraído a `QRProyeccion.css`, eliminada la copia vieja |
| **ARCH-7** | Bundle de producción sin dividir por ruta — chunk principal de 514 KB, por encima del umbral de Vite | `vite.config.js`, vistas grandes de `HorariosLayout.jsx` | ✅ Cerrado (9 de julio) — `lazy()` + `Suspense` en `HorariosView`, `SeccionesView`, `DocentesView`, `MateriasView`, `AsistenciasView`, `UploadPreviewModal`. `ResumenView` se dejó estática a propósito (vista por defecto). Chunk principal: 503 KB → 468.49 KB |
| **ARCH-8** | `HorariosLayout.jsx` (561 líneas) y `App.jsx` (353 líneas) concentraban layout, navegación y estado de sesión en un solo archivo | `src/app/HorariosLayout.jsx`, `src/App.jsx` | ✅ Cerrado — `HorariosSidebar.jsx`/`HorariosTopbar.jsx` extraídos; `HorariosLayout.jsx` 561→293 líneas, `App.jsx` 353→338 |
| **ARCH-9** | Código muerto: ningún archivo del repo lo importaba ni renderizaba, y su propio import (`responsiveCSS`) no existía en ningún lado. Encontrado de forma incidental durante el barrido que cerró `S3` | `src/components/ResponsiveStyles.jsx` | ✅ Cerrado — archivo eliminado |
| **ARCH-10** | `HistorialView.jsx` (637 líneas), `LogsView.jsx` (517), `LoginScreen.jsx` (508) concentraban layout, estado y lógica de responsabilidades distintas en un solo archivo cada uno. Mismo problema de fondo que `ARCH-8`, en archivos distintos | `src/components/{HistorialView,LogsView,LoginScreen}.jsx` | ✅ **Cerrado (9 de julio, noche)** — mismo patrón que `ARCH-8`: cada archivo se dividió en un orquestador (estado/efectos/handlers) + subcomponentes presentacionales puros que reciben todo por props. `HistorialView.jsx` 637→286 líneas (`historial/`: `ModalTrimestre.jsx`, `ComparadorPanel.jsx`, `HistorialLista.jsx`, `historialUtils.jsx`). `LoginScreen.jsx` 508→336 líneas (`login/`: `ModalActivarPIN.jsx`, `LoginOfflinePinPanel.jsx`, `LoginFormNormal.jsx`). `LogsView.jsx` 517→76 líneas (`logs/`: `TabSesiones.jsx`, `TabAuditoria.jsx`, `logsUtils.jsx` — ya eran subcomponentes autocontenidos, solo se movieron). Extracción 1:1 verificada línea por línea contra el original antes de reemplazar, sin cambios de lógica. `vite build` limpio (mismo tamaño de bundle `view-logs`/`view-historial`, confirma que no se duplicó código), 153/153 tests |
| **ARCH-11** | `api/admin-users.js` repetía el mismo bloque (armar headers, llamar `fetch`, parsear JSON, revisar `.ok`) 13 veces para hablar con Supabase (Auth Admin API + REST) | `api/admin-users.js` | ✅ **Cerrado (11 de julio)** — extraído `supabaseAdminFetch(path, options)`: centraliza `Authorization`/`apikey`/`Content-Type` condicional (solo si hay body) y el prefijo `${SUPABASE_URL}`; `options.headers` se aplica después de los defaults, así que puede sobreescribirlos — lo usa la verificación de sesión inicial, que necesita `Authorization: Bearer <token del usuario>` en vez del service role. Las 13 llamadas (verificación de sesión/permiso/rate-limit + `create`/`reset_password`/`delete`/`delete_orphan`) migradas 1:1 al helper, sin tocar lógica de permisos. Verificado contra el HEAD real antes de reemplazar: diff de todos los mensajes de error idéntico byte a byte, cero `fetch(` directo fuera del helper, 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox de verificación, mismo caso ya documentado en `D-6`) |
| **ARCH-12** 🟡 | El chunk `view-qr` pesa 320 KB (88 KB comprimido) — casi el triple que el segundo chunk más grande (`vendor-react`, 134 KB) — porque carga de una sola vez todo lo que puede aparecer en la pantalla de proyección QR (countdown, cola offline, historial de sesión, panel admin), se use o no en ese momento | `src/components/asistencias/QRProyeccion.jsx` y componentes relacionados | 🟡 Abierto (detectado 12 de julio, auditoría QA senior externa) — solución: dividir con `React.lazy` los subcomponentes que solo se muestran bajo demanda (`ColaOfflinePanel`, `HistorialSesiones`), mismo patrón ya usado en `ARCH-7` |
| **ARCH-13** 🟢 | La suite de tests depende de un tarball externo (`cdn.sheetjs.com`) para `xlsx`, sin fallback local — en una red restringida (ej. CI con firewall estricto) el `npm install` completo falla y bloquea 2 suites de tests sin que sea un error del código (mismo síntoma ya visto en `D-6`) | `package.json` (`dependencies.xlsx`) | 🟢 Abierto (detectado 12 de julio, auditoría QA senior externa) — solución: vendorizar el `.tgz` de `xlsx` (commitearlo en el repo o cachearlo como artifact de CI) y apuntar `package.json` a esa ruta local en vez de a la URL del CDN |

## 🔧 CI/CD y automatización

Esquema `FIX-CI-N`. No se localizó un comentario `FIX-CI-1` explícito en el
repo (los workflows de GitHub Actions no llevan el mismo formato de
comentario que el código JS/SQL); se anota como no confirmado en vez de
asumirlo.

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **FIX-CI-1** *(no confirmado)* | Sin integración continua | `.github/workflows/ci.yml` | ✅ Cerrado (corre `npm test` + `npm run build` en cada PR/push a `main`) |
| **FIX-CI-2** | `console.log/warn/error` directos visibles en producción | `src/utils/logger.js` (14 archivos migrados) | ✅ Cerrado |
| **FIX-CI-3** | Sin `npm audit` en CI ni verificación automatizada de RLS con la clave `anon` real | `.github/workflows/ci.yml`, `scripts/rls-smoke-test.mjs` | ✅ Cerrado (`npm audit --audit-level=high` no bloqueante por `D-6`, ver nota ahí; smoke test bloqueante) |
| **FIX-CI-4** | 2 usos de `console.info` directo rompían la consistencia del logger centralizado | `src/main.jsx`, `src/utils/cache.js` | ✅ Cerrado (9 de julio) — se agregó `logger.info()` siguiendo el patrón de `log`/`warn`/`error`; cero `console.*` fuera de `logger.js` en todo `src/` |

## 🎨 UI y estilos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **U-1** | Estilos inline en `AdminQRPanel` — primer caso migrado, sentó el patrón de `A3` | `AdminQRPanel.jsx`/`.css` | ✅ Cerrado |
| **U-2** | Desbordes de layout en viewports móviles pequeños (`AdminQRPanel`, `ModalRol`) | `AdminQRPanel.css`, `usuarios/ModalRol.jsx` | ✅ Cerrado |
| **U-3** | Sin trampa de foco de teclado en modales | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **U-4** | `Campo.jsx` renderizaba `<label>`/`<input>` sin `htmlFor`/`id` — lector de pantalla no anunciaba la etiqueta | `asistencias/DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()` + `aria-describedby`/`aria-invalid`) |
| **A3** | Migración sistemática de estilos inline a CSS externo (requisito de `S3`) | Todo `src/` — bajó de 54 a 0 ocurrencias reales | ✅ Cerrado — `Avatar.jsx` (tono bucketizado a 24 pasos de 15°), `TurnoGrid.jsx` (resuelto con `flex: 1` en vez de cálculo en JS), `ModalRol.jsx` (restringido a 10 presets) |
| **U-5** | Los 7 archivos del shell principal (`src/app/`) nunca se auditaron para responsividad — solo se había cubierto funcionalidad (QR, horarios, login) | `HorariosLayout.jsx`, `UserMenu.jsx`, `AsistenciasModulo.jsx`, `App.jsx`, `AdminMenu.jsx`, `SinPerfilAsignado.jsx`, `CuentaDesactivada.jsx` | ✅ Cerrado — migrados a clases con prefijo (`hl-`, `um-`, `asm-`, `adm-`, `spa-`, `cd-`) con reglas `@media` incluidas |
| **U-6** | El bundle sin dividir (`ARCH-7`) alargaba la pantalla en blanco en la primera carga | mismo que `ARCH-7` | ✅ Cerrado (9 de julio, mismo fix que `ARCH-7`) |
| **U-7** | `LoginFormNormal.jsx`, `LoginOfflinePinPanel.jsx`, `ModalActivarPIN.jsx` (extraídos de `LoginScreen.jsx` al cerrar `ARCH-10`, la noche del 9 de julio): el `<label>` de cada campo quedó como hermano del `<input>`, sin `htmlFor`/`id` — misma regresión que `U-4` ya había resuelto en `Campo.jsx`, reintroducida en archivos nuevos que no pasaron por ese fix | `src/components/login/{LoginFormNormal,LoginOfflinePinPanel,ModalActivarPIN}.jsx` | ✅ **Cerrado (11 de julio)** — mismo patrón que `Campo.jsx`/`U-4`: `useId()` por instancia de componente, enlazando cada `<label htmlFor>` con su `<input id>`/`<select id>` (2 campos en cada uno de los 3 componentes). Cambio puramente estructural, sin tocar `.form-label`/`.form-input` ni los handlers. Verificado contra el HEAD real (`9477be2`, ya con `ARCH-11` y `SEC-12` incluidos) antes de reemplazar: 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `D-6`) |
| **U-8** 🟡 | Solo 4 de los 29 archivos CSS del proyecto tienen media queries; `HorariosView.css` (la grilla de horarios) y `QRProyeccion.css` (pantalla de proyección en el aula) no tienen ninguna — en una tablet o un proyector con resolución distinta a un monitor de escritorio, la grilla o el QR proyectado pueden verse cortados o requerir scroll horizontal incómodo | `src/components/HorariosView.css`, `src/components/asistencias/QRProyeccion.css` | ✅ **Cerrado (12 de julio)** — verificado contra el HEAD real antes de tocar nada, con dos hallazgos distintos: (1) **falso positivo parcial en la mitad de `QRProyeccion.css`** — el archivo en sí no tiene `@media`, pero las clases `.qrp-*` que usa `QRProyeccion.jsx` (confirmado 1:1 contra el JSX) sí tienen tratamiento responsive real, ya implementado en `src/index.css` líneas ~424-439 (reflow a 1 columna en <900px, achique de fuente en <640px) — quedó ahí porque cuando `ARCH-6` extrajo el CSS del template literal, esas reglas ya vivían en `index.css` desde antes y no se movieron. No requiere fix de comportamiento, mismo tipo de corrección que `S2`/`D-6`; queda pendiente como mejora cosmética de organización (mover esas reglas a `QRProyeccion.css` por cohesión), no como bug. (2) **`HorariosView.css` sí carecía de adaptación real** — pero el archivo es solo la barra de filtros/pestañas (`.hv-filters`, `.hv-tabs`, `.hv-days`), no la grilla en sí (esa es `TurnoGrid.css`, fuera del alcance original de este hallazgo, ya se degrada con `overflow-x: auto` — patrón válido, no roto). `.hv-filters-row`/`.hv-days` ya tenían `flex-wrap: wrap`, así que no se rompían, pero en <640px el título y el padding quedaban sobredimensionados. Se agregó un único `@media (max-width: 640px)` que reduce `.hv-filters` padding y `.hv-title` font-size — mismo breakpoint que `AdminQRPanel.css`. Cambio de 9 líneas, solo aditivo, sin tocar ninguna regla existente. Verificado: `vite build` limpio (mismo tamaño de bundle, es solo CSS), 130/130 tests reales (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `D-6`) |

## 🎨 Identidad visual y sistema de diseño

Esquema `FE-N`. Fusionado desde `AUDITORIA_FRONTEND.md` (documento eliminado
tras la fusión — su contenido íntegro vive en esta sección).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **FE-1** | Iconografía funcional resuelta con emojis nativos del SO | `buildNavGroups.js`, `App.jsx`, `AdminMenu.jsx`, `LoginScreen.jsx`, y resto de vistas | ✅ Cerrado — cero emoji funcional confirmado por grep de rango Unicode sobre todo `src/`. Sobreviven solo `EMOJIS_PRESET` (selector deliberado de emoji de rol, es la funcionalidad en sí) y mensajes de diagnóstico en `logger.warn` |
| **FE-2** | Tipografía sin identidad — solo `system-ui` | `src/index.css` | ✅ Cerrado — fuente Inter |
| **FE-3** | Tokens de diseño incompletos: faltaban escalas de espaciado/sombras/radios; gran parte de los componentes usaba estilos inline con hex repetidos en vez de tokens | `src/index.css`, objeto `S` en `src/constants/index.js` | ✅ **Cerrado (9 de julio, tarde)** — la escala de tokens sí se completó antes (espaciado, sombras, `:focus-visible`); lo que quedaba de este hallazgo era la falta de una escala `--font-size-*`. Se definieron 21 variables (`--font-size-9`…`-48`) tomando cada valor 1:1 de los que ya estaban en uso en todo el proyecto — sin redondear ni consolidar ningún tamaño — y se adoptaron en `index.css` y en los 27 `.css` de componentes restantes (569 sustituciones en total). Quedan como literal, a propósito, los `clamp()` responsivos, los tamaños dinámicos de `Avatar` (excepción ya documentada en `A3`) y los valores que aparecen una sola vez en todo el proyecto (72px, 52px). Verificado: `vite build` limpio, 153/153 tests, ningún tamaño visual cambió |
| **FE-4** | Sin `:focus-visible` accesible consistente | `src/index.css` | ✅ Cerrado — 6 reglas confirmadas |
| **FE-5** | Adopción mixta de `var(--token)` en las reglas `.hl-*` (migradas desde `HorariosLayout.jsx` por `U-5`): algunos `font-size`/`padding`/`margin`/`gap` seguían en valores px crudos | `src/index.css` (reglas `.hl-*`) | ✅ **Cerrado (9 de julio, tarde)** — cerrado en dos pasadas. La primera (en otro chat) tokenizó 5 líneas con la escala `--space-N` existente (múltiplos de 4: `4/8/12/16/20/24/32px`). La segunda completó las 12 reglas restantes; como 4 valores en uso (`6px`, `7px`, `10px`, `14px`) no son múltiplo de 4 y forzarlos al `--space-N` más cercano habría alterado el tamaño real, se agregaron 4 tokens de valor exacto (`--space-6px`, `--space-7px`, `--space-10px`, `--space-14px`, mismo criterio que `--font-size-N`). Quedan como literal, a propósito, 2 valores de una sola ocurrencia (`.hl-lapso-label margin-bottom: 3px`, `.hl-syncing gap: 5px`) y el `width: 20px` de dos íconos (es sizing, no espaciado — fuera de alcance). Verificado: `vite build` limpio, 153/153 tests, ningún tamaño ni espaciado visual cambió |

---

## 🆕 Funcionalidad nueva

Esquema `ADMIN-N`. A diferencia del resto de este índice (hallazgos
encontrados en auditoría externa o interna), esta serie documenta
funcionalidad nueva pedida directamente por el usuario — se incluye aquí
porque el código ya usa el mismo formato de comentario (`// ADMIN-N:...`)
y porque toca los mismos archivos que varios hallazgos de arriba
(`buildNavGroups.js`, `HorariosLayout.jsx`, `ModuleSelector.jsx`).

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **ADMIN-1** | El borrado de registros de sesión (login y QR) y de reportes de asistencia no existía como funcionalidad — se pidió que solo el rol admin pudiera hacerlo | `roles` (permisos `puedeBorrarSesiones`/`puedeBorrarReportes`), RPCs `admin_borrar_session_logs`/`admin_borrar_qr_sesiones`/`admin_borrar_asistencias_rango` | `0054` | ✅ Cerrado (10 de julio) — permiso dinámico en el JSONB de roles (no hardcodeado por nombre de rol), asignado solo a admin; cada RPC revalida el permiso en el servidor y registra en `audit_logs` |
| **ADMIN-2** | UI de borrado para lo habilitado en `ADMIN-1`: selección múltiple en registros de sesión, borrado por fila en sesiones QR cerradas, borrado por rango de fechas en el reporte de asistencia | `src/components/logs/TabSesiones.jsx`, `src/components/asistencias/AdminQRPanel.jsx` (`HistorialSesiones`), `src/components/asistencias/ReporteAsistencias/ReporteRango.jsx` | `0054` | ✅ Cerrado (10 de julio) — todos los botones gateados por los permisos de `ADMIN-1`; borrar una sesión QR no borra las asistencias ya registradas (`qr_session_id` queda en `NULL`, sin pérdida de datos) |
| **ADMIN-3** | "Usuarios y Roles" y "Registros" vivían dentro del módulo de Horarios filtrados por permiso; "Historial" vivía ahí sin ningún filtro de permiso — se pidió sacar los tres a un módulo propio, visible solo a quien tenga algún permiso admin | `src/app/AdminModulo.jsx` (nuevo), `src/hooks/useModuloActivo.js`, `src/components/ModuleSelector.jsx`, `src/app/buildNavGroups.js`, `src/app/HorariosLayout.jsx` | — | ✅ Cerrado (10 de julio) — decisión de producto confirmada con el usuario: Historial pasa a ser exclusivo de este módulo (antes lo veía cualquiera con acceso a Horarios, ahora requiere permiso admin). El nombre visible para el usuario quedó como **"Sistema"**, no "Administración", para no chocar con el dropdown que ya existía en el pie del sidebar de Horarios (`AdminMenu.jsx`: Importar Excel, Backup, Restaurar, Borrar Horarios) — el id interno (`moduloActivo === "admin"`, `tieneAdmin`) no cambió, solo la etiqueta |
| **ADMIN-4** | La jerarquía fija del rol admin (`SEC-10`, migración `0050`) ya bloqueaba en el servidor que un rol no-admin creara/editara/eliminara una cuenta admin, pero la UI no reflejaba esa regla: el selector de rol mostraba "admin" como opción a cualquiera con `puedeGestionarUsuarios`, y las filas admin de la tabla no bloqueaban editar/desactivar/eliminar — el error solo aparecía al guardar | `src/components/usuarios/{index,PestanaUsuarios,ModalUsuario}.jsx` | — | ✅ Cerrado (10 de julio) — no es un hallazgo de seguridad nuevo (`SEC-10` ya cerraba el hueco real, en el servidor); es la UI reflejando la misma regla para evitar que alguien llegue a un error que ya sabíamos que iba a pasar. Se propaga `profile.rol === "admin"` (`esActorAdmin`) desde `AdminModulo.jsx` hasta `ModalUsuario.jsx`: oculta "admin" del selector de rol si el actor no lo es, y bloquea (con tooltip) editar/desactivar/eliminar sobre una fila admin en la tabla |

---



Encontradas al construir `ESQUEMA_Y_MIGRACIONES.md`. Ya no se usan, pero los
archivos con estos comentarios siguen en el repo — útil si alguien pregunta
"¿qué es el Fix #8?".

| Esquema | ID | Descripción | Archivo | Estado |
|---|---|---|---|---|
| `Fix #N` | **#2** | Políticas RLS con rol `{public}` corregidas a `{authenticated}` en `user_profiles` | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#3** | FK duplicada bloqueaba el login (`PGRST201`) | `0017_drop_fk_duplicada_rol.sql` | ✅ Cerrado |
| `Fix #N` | **#4** | Recursión en `get_auth_role()` dentro de políticas RLS | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#8** | `borrar_horarios`/`restaurar_backup` sin verificación de permiso interno | `0018_fix_rpc_permisos_faltantes.sql` | ✅ Cerrado |
| `Fix #N` | **#10** | Sin trigger que impidiera borrar roles con `es_sistema = true` | `0019_trigger_protect_roles_sistema.sql` | ✅ Cerrado |
| `Fix #N` | **#16** | Sin índices en `horarios` para búsquedas frecuentes | `0020_indices_horarios.sql` | ✅ Cerrado |
| `Fix #N` | **#17** | RPCs de gestión de usuarios sin migración de respaldo | `0021_rpcs_gestion_usuarios.sql` | ✅ Cerrado |
| `Gap #N` | **#16** | `importarDatos()` no restauraba `asistencias` desde un backup | `0041_restaurar_backup_asistencias.sql` | ✅ Cerrado |

> **Colisión de numeración:** `Fix #16` y `Gap #16` son el mismo número en
> esquemas distintos, sin relación entre sí. Si se retoma cualquiera de
> estas nomenclaturas, evitar reusar números — usar el esquema categorizado
> vigente (letra + número por área).

---

## 📝 Historial de auditorías (condensado)

Registro breve de cuándo se descubrió/cerró cada cosa, para trazabilidad sin
repetir el detalle ya cubierto en las tablas de arriba.

- **Primeras rondas (jun 2026):** RLS inicial (`0016`–`0021`), QR/offline
  (`O-*`, `P-*`, `A-*`, `V-*`, `D-1`–`D-4`), migración de diseño a Tabler
  Icons + paleta slate, `parsing.js` con cascada de 3 niveles para nombres
  de docentes.
- **4 de julio:** se agregó `S2`, la sección `FIX-CI-N` completa, `U-2`.
  Reconciliación de una rama de trabajo que había perdido `SEC-6`–`SEC-8`
  al partir de un punto anterior — reincorporados. Fusión de
  `AUDITORIA_FRONTEND.md` como sección `FE-N`.
- **5 de julio, auditoría QA externa:** aportó `SEC-10`, `SEC-11`, `D-6`
  (original, luego revertido a falso positivo), `ARCH-7`/`U-6`, `ARCH-8`,
  `U-5`. Se descubrió que todas las sesiones previas de `A3` habían
  grepeado solo `src/components/`, nunca `src/app/` (157 ocurrencias reales
  en 29 archivos vs. lo reportado) — reconciliado el mismo día.
- **5 de julio, cierre de `A3`/`S3` (4 fases + 2 pasadas de retoque):**
  el repo bajó de 54 ocurrencias reales en 22 archivos a 0. Casos
  "genuinamente difíciles" resueltos con bucketización (`Avatar.jsx`,
  hue → 24 clases) o solución de raíz (`TurnoGrid.jsx`, `flex: 1` en vez de
  cálculo en JS). `ModalRol.jsx` cerró restringiendo el color de rol a 10
  presets (decisión de producto). De paso se encontró y cerró `ARCH-6`
  (CSS duplicado en `QRProyeccion.jsx`) y se documentó `ARCH-9` (código
  muerto, sin cerrar). `vercel.json` quedó con `style-src 'self'`, sin
  `unsafe-inline`.
- **9 de julio, auditoría QA senior (Arquitectura 84/100, Seguridad
  91/100, UX 89/100):** confirmó `ARCH-8` cerrado (dado por abierto en el
  índice), reverificó con evidencia nueva `ARCH-7`/`U-6`, `D-6`, `FE-3`,
  `FE-5` como abiertos, y agregó `ARCH-10` y `FIX-CI-4`.
- **9 de julio, tarde — 3 pasadas de implementación:** `ARCH-7`/`U-6`
  cerrado (`lazy()` en 6 vistas). `D-6` cerrado como falso positivo
  (verificado contra `cdn.sheetjs.com/advisories`). `FIX-CI-4` cerrado
  (`logger.info()` agregado).
- **9 de julio, re-verificación completa de este índice:** confirmado que
  `ARCH-8` seguía correctamente cerrado; quedaban abiertos `SEC-9`,
  `ARCH-9`, `ARCH-10`, `FE-3`, `FE-5`.
- **9 de julio, reorganización de este documento:** se separaron los
  hallazgos abiertos del historial de cierre (sin cambiar ningún estado).
- **9 de julio, cierre de `ARCH-9` y `SEC-9`:** `ResponsiveStyles.jsx`
  eliminado del repo. Migración `0052` revoca `EXECUTE` de `anon` en las 4
  RPCs de sesión, resolviendo su firma real vía `pg_proc` (ninguna tenía
  migración de origen versionada) — verificado contra la BD real tras
  aplicar. Quedan abiertos `ARCH-10`, `FE-3`, `FE-5` — ver § Hallazgos
  abiertos al inicio del documento.
- **9 de julio, tarde — avance de `FE-3`:** escala `--font-size-9`…`-48`
  definida en `:root` (valores 1:1 de los ya usados, sin redondear) y
  adoptada por completo en `index.css`. `vite build` limpio, 153/153
  tests, ningún tamaño visual cambió. Queda `🟡` porque los 27 `.css` de
  componentes fuera de `index.css` todavía no adoptan la escala.
- **9 de julio, tarde — cierre de `FE-3`:** escala ampliada con
  10 valores más (17/19/22/24/26/28/32/36/40/44px, repetidos en varios
  componentes aunque no dentro de `index.css`) y adoptada en los 27 `.css`
  restantes — 479 sustituciones adicionales. `vite build` limpio, 153/153
  tests. Quedan abiertos solo `ARCH-10` y `FE-5` — ver § Hallazgos
  abiertos al inicio del documento.
- **9 de julio, tarde — cierre de `FE-5` (2 pasadas, sesiones distintas):**
  la primera pasada tokenizó 5 líneas de `.hl-*` con `--space-N`
  existente. Al verificar contra HEAD real antes de continuar con `FE-3`,
  se detectó que esa pasada tocaba las mismas líneas que la extensión de
  `FE-3` pendiente de aplicar — se reconstruyó `FE-3` sobre el `index.css`
  ya actualizado con `FE-5`, en vez de sobreescribirlo. La segunda pasada
  completó las 12 reglas `.hl-*` restantes, agregando 4 tokens de valor
  exacto (`--space-6px/7px/10px/14px`) para los valores que no encajan en
  la escala múltiplo-de-4. `vite build` limpio, 153/153 tests con ambos
  fixes juntos. Queda abierto solo `ARCH-10` — ver § Hallazgos abiertos al
  inicio del documento.
- **9 de julio, noche — cierre de `ARCH-10` (último hallazgo abierto):**
  `HistorialView.jsx`, `LogsView.jsx` y `LoginScreen.jsx` divididos en
  orquestador + subcomponentes, mismo patrón que `ARCH-8`. Cada extracción
  se verificó línea por línea contra el original antes de reemplazar.
  `vite build` limpio (tamaño de bundle idéntico en los chunks lazy
  `view-historial`/`view-logs`, confirma que no se duplicó código),
  153/153 tests. **No queda ningún hallazgo abierto en este índice.**
- **10 de julio — `ADMIN-1`/`ADMIN-2`/`ADMIN-3` (funcionalidad nueva, no
  hallazgo de auditoría):** a pedido del usuario, (1) se restringió el
  borrado de sesiones (login y QR) y reportes de asistencia al rol admin
  vía permiso dinámico + RPCs que revalidan en el servidor (`0054`); (2)
  se agregó la UI de borrado correspondiente en `TabSesiones.jsx`,
  `AdminQRPanel.jsx` y `ReporteRango.jsx`; (3) se sacaron "Usuarios y
  Roles", "Registros" e "Historial" del módulo de Horarios a un módulo
  propio (`AdminModulo.jsx`, mostrado como **"Sistema"** en la UI para no
  chocar con el dropdown "Administración" ya existente en
  `AdminMenu.jsx`), con `useModuloActivo`/`ModuleSelector` generalizados
  de 2 a 3 módulos. Decisión de producto explícita: Historial pasa a ser
  exclusivo de este módulo (antes visible a cualquiera con acceso a
  Horarios). Ver § Funcionalidad nueva para el detalle. `vite build`
  limpio (bloqueado solo por `xlsx` en el sandbox de verificación, ajeno
  al cambio), 121/121 tests ejecutables.
- **10 de julio — `ADMIN-4` (funcionalidad nueva, refuerzo de UI sobre
  `SEC-10`):** a pedido del usuario, se verificó que la jerarquía fija de
  rol admin (`SEC-10`) ya bloqueaba en el servidor (RPCs + `api/admin-
  users.js`) que un no-admin creara/editara una cuenta admin — no hacía
  falta ningún cambio de seguridad. Lo que faltaba era reflejar esa regla
  en la UI: se propagó `profile.rol === "admin"` desde `AdminModulo.jsx`
  hasta `ModalUsuario.jsx` (`esActorAdmin`) para ocultar "admin" del
  selector de rol y bloquear las acciones de fila sobre cuentas admin
  cuando el actor no lo es. 121/121 tests (incluye
  `PestanaUsuarios.integration.test.jsx`, que sigue pasando sin cambios
  porque su fixture no usa rol admin), `vite build` limpio.
- **10 de julio — apertura y cierre de `SEC-12` (sesión paralela a la de
  `ADMIN-1`–`4`):** LS reportó que las sesiones nunca se cerraban solas
  así pasaran días. Plan free de Supabase, sin acceso a "Time-boxed
  sessions" (Pro). Se replicó esa feature con `pg_cron` sobre
  `auth.sessions` directamente (`0053_limpieza_sesiones_expiradas.sql`)
  más persistencia en `localStorage` del lado cliente para que el
  timeout de inactividad ya existente sobreviva a cerrar la pestaña, y
  un time-box absoluto de 10h nuevo. Al reconciliar contra el HEAD real
  se detectó que esta migración compartía el prefijo `0053` con la de
  `ADMIN-1` (trabajada en paralelo); LS la renumeró a
  `0054_permisos_borrado_sesiones_reportes.sql`, sin colisión. `vite
  build` limpio,
  16/16 tests de `useAuth` reaplicados sobre el `useAuth.js` real (que
  para entonces ya incluía los permisos `puedeBorrarSesiones`/
  `puedeBorrarReportes` de `ADMIN-1` — se editó sobre esa versión, no
  sobre la desactualizada del primer intento). Pendiente en el
  dashboard de Supabase (fuera del alcance de una migración): confirmar
  `pg_cron` habilitado y evaluar bajar el JWT expiry limit. **No queda
  ningún hallazgo abierto en este índice.**
- **11 de julio, auditoría QA senior externa (Arquitectura 91/100,
  Seguridad 93/100, UX 88/100):** clonado fresco de `main`, sin asumir el
  estado reportado en este índice. Confirmó que el índice previo era
  preciso — ningún hallazgo cerrado resultó estar en realidad abierto.
  Agregó 3 hallazgos nuevos, ninguno crítico: `ARCH-11` (código
  duplicado en `api/admin-users.js`), `D-7` (2 CVEs de `npm audit` en
  `vite`/`esbuild`, solo dev-server) y `U-7` (regresión de accesibilidad
  en los formularios de login extraídos por `ARCH-10`).
- **11 de julio, cierre de `ARCH-11`:** extraído `supabaseAdminFetch()`
  en `api/admin-users.js`, centralizando las 13 llamadas a Supabase que
  antes repetían headers/parseo a mano. Verificado contra el HEAD real
  clonado desde GitHub antes de escribir el reemplazo: mensajes de error
  idénticos, cero `fetch(` directo fuera del helper, 121/121 tests (2
  suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo
  caso de `D-6`). Quedan abiertos `D-7` (diferido, sin urgencia) y `U-7`
  (en progreso en otra sesión) — ver § Hallazgos abiertos al inicio del
  documento.
- **11 de julio, cierre de `U-7`:** mismo patrón que `Campo.jsx`/`U-4`
  — `useId()` en `LoginFormNormal.jsx`, `LoginOfflinePinPanel.jsx` y
  `ModalActivarPIN.jsx`, enlazando cada `<label htmlFor>` con su
  `<input id>`/`<select id>`. Cambio estructural puro, sin tocar CSS ni
  handlers. Antes de reemplazar se hizo `git fetch` y se confirmó que
  `origin/main` había avanzado 7 commits desde el clonado inicial de esta
  sesión (cierre de `ARCH-11`, `SEC-12`/gestión de sesiones, migración
  `0055`) — se rebaseó sobre ese HEAD real (`9477be2`) antes de aplicar el
  fix, para no pisar ese trabajo. `vite build` bloqueado solo por `xlsx`
  en el sandbox (mismo caso de `D-6`), 121/121 tests. **No queda ningún
  hallazgo abierto de la auditoría del 11 de julio salvo `D-7`
  (diferido).**
- **11 de julio, cierre de `D-7`:** la sugerencia automática de `npm
  audit fix --force` saltaba a `vite@8.1.4`, pero eso rompía los
  `peerDependencies` de `vite-plugin-pwa@0.21.1` y
  `@vitejs/plugin-react@4.7.0` (ambos instalados), que solo declaran
  soporte hasta `vite ^6.0.0`/`^7.0.0`. Investigado el rango real de las
  3 CVEs (todas `<=6.4.2`/`<=0.24.2`): `vite@^6.4.3` ya las resuelve sin
  el salto de mayor que rompía los plugins. `npm audit
  --package-lock-only`: 0 vulnerabilidades. 121/121 tests, `vite build`
  completo verificado con un stub temporal de `xlsx` (solo por el
  firewall del sandbox de verificación) — mismo chunking lazy y PWA que
  antes del bump. Verificado antes de aplicar contra el `main` real
  (`276b0b4`, ya con `ARCH-11` y `U-7` fusionados por otras sesiones):
  `package.json`/`package-lock.json` seguían byte-idénticos a los usados
  para preparar este fix, sin choque posible. **No queda ningún hallazgo
  abierto en este índice.**
- **11 de julio — `0055`, fix sobre `SEC-12` (drift de esquema, no
  hallazgo nuevo, 2 rondas):** al ejecutar `limpiar_sesiones_expiradas()`
  por primera vez contra la BD real, falló con `23502: null value in
  column "email"` — `session_logs.email` tiene un `NOT NULL` en
  producción no documentado en ningún esquema versionado (mismo tipo
  de drift que ya había detectado y corregido `0033` para las mismas
  columnas legado). El `INSERT` directo de `0053` seguía el patrón de
  `log_session_event()` tal como está en `0031` (que tampoco puebla
  email), pero evidentemente insuficiente contra la BD real. Primera
  ronda de `0055`: pobló `email`/`nombre`/`rol`/`programa` vía el mismo
  JOIN contra `auth.users`/`user_profiles` que ya usa
  `get_session_logs()`. Segunda ronda, mismo día: nuevo fallo real,
  `23514` — `session_logs_evento_check` (CHECK, tampoco documentado en
  ningún esquema versionado) solo permite una lista cerrada de
  valores; verificado contra la BD real antes de corregir (302 filas
  `'login'`, 49 `'logout'`, nada más) en vez de adivinar. En vez de
  ampliar el constraint con `ALTER TABLE`, se reusa `evento='logout'`
  (ya permitido) y la distinción "cerrado por el cron, no por el
  usuario" queda en `detalles` (`forzado`, `origen`, `motivo`) —
  filtrable en LogsView sin tocar el esquema de la tabla. `0055` nunca
  llegó a commitearse en su primera versión (se corrigió el mismo
  archivo antes de subirlo), así que no queda una migración rota en el
  historial de git.

- **12 de julio, auditoría QA senior externa (Arquitectura 92/100, Seguridad
  94/100, UX 87/100):** clonado fresco de `main` (`2f01ce9`), sin asumir el
  estado reportado en este índice. `npm install`, `npx vitest run` (130/130
  tests ejecutables, el resto bloqueado solo por el firewall del sandbox
  contra el CDN de `xlsx`, mismo caso ya documentado en `D-6`), `npx vite
  build` (limpio, 254 módulos, PWA con 53 entradas de precache), `npm audit
  --package-lock-only` (0 vulnerabilidades). Confirmó que ningún hallazgo
  cerrado había reabierto. Agregó 4 hallazgos nuevos, ninguno crítico ni
  bloqueante: `ARCH-12` (chunk `view-qr` de 320 KB sin sub-lazy-loading
  interno), `ARCH-13` (`xlsx` sin fallback local para CI en red
  restringida), `SEC-13` (`api/admin-users.js` sin allowlist de origen/CORS,
  defensa en profundidad, sin explotación conocida hoy) y `U-8`
  (`HorariosView.css`/`QRProyeccion.css` sin media queries — falta
  adaptabilidad en proyector de aula/tablet, la baja de 1 punto en UX
  respecto al 88/100 del 11 de julio refleja este ángulo nuevo evaluado, no
  una regresión). Orden de prioridad sugerido para implementar: `U-8` →
  `ARCH-12` → `SEC-13` → `ARCH-13`.

- **12 de julio, cierre de `U-8`:** verificado contra el HEAD real
  (`f715090`) antes de tocar nada. El hallazgo resultó mixto: la mitad de
  `QRProyeccion.css` era **falso positivo parcial** (mismo tipo de
  corrección que `S2`/`D-6`) — el archivo no tiene `@media`, pero las
  clases `.qrp-*` que usa `QRProyeccion.jsx` ya tienen tratamiento
  responsive real en `src/index.css` (reflow a 1 columna en <900px,
  achique de fuente en <640px), reglas que quedaron ahí desde antes de
  `ARCH-6` y nunca se movieron al archivo del componente. La otra mitad
  (`HorariosView.css`) sí carecía de adaptación — es la barra de
  filtros/pestañas (no la grilla, que es `TurnoGrid.css` y ya se degrada
  con `overflow-x: auto`, patrón válido) y en <640px el título/padding
  quedaban sobredimensionados pese a que `.hv-filters-row`/`.hv-days` ya
  usaban `flex-wrap`. Fix de 9 líneas, puramente aditivo (un solo
  `@media (max-width: 640px)`, mismo breakpoint que `AdminQRPanel.css`),
  sin tocar ninguna regla existente. Verificado: `vite build` limpio
  (mismo tamaño de bundle), 130/130 tests reales (2 suites de `xlsx`
  bloqueadas solo por el firewall del sandbox, mismo caso de `D-6`).

---

*Última reorganización: 9 de julio de 2026 — se restructuró el documento
para separar hallazgos abiertos (con todo el contexto necesario para
retomarlos) del historial de cierre, y se condensó el registro narrativo de
pasadas previas en un resumen cronológico. Ningún hallazgo cambió de
estado en esta pasada; es solo una reorganización de lectura. Para el
índice de migraciones SQL y el esquema de base de datos, ver
`ESQUEMA_Y_MIGRACIONES.md`.*
