# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgo (`SEC-1`, `SEC-10`, `OFF-3`, `ARCH-11`, etc.) que
aparecen dispersos en comentarios de código y migraciones. Antes de este
documento, ubicar qué era un ID específico requería `grep` sobre todo el repo.

**Metodología:** cada fila se verifica contra el código/BD real (`grep`,
`git log`, `pg_policies`, `vite build`), nunca contra un informe externo sin
confirmar. Varios hallazgos reportados como vigentes resultaron falsos
positivos parciales al compararlos con el HEAD real — ver `SEC-2` y `SEC-14` como
ejemplos. Al cerrar un hallazgo nuevo: usar el formato ya establecido en el
repo (`// Fix <ID> (auditoría <fecha>): qué y por qué` en código, `-- Migración
NNNN — Fix <ID>: resumen` en SQL), agregar/actualizar su fila aquí, y si
reabre o profundiza un hallazgo anterior decirlo explícitamente en la
descripción.

**IDs mencionados en código pero nunca localizados (esquema antiguo,
antes de la reorganización del 13-14 de julio):** `O-6`, `O-7`, `P-1`,
`S1`, `SEC-4` — probablemente descartados o fusionados con otro fix
antes de llegar a `main`. Nunca tuvieron una fila real en este índice,
así que no entran en la tabla de equivalencias de más abajo. Si alguno
reaparece, agregarlo con su estado real y su ID nuevo correspondiente.

**Esquema de IDs (normalizado el 13-14 de julio de 2026):** 8 prefijos,
uno por área, sin colisión entre sí — `SEC-N` (seguridad y RLS),
`PERM-N` (filtrado de datos por permiso/programa), `OFF-N` (offline y
red), `ARCH-N` (arquitectura, testing y concurrencia), `UX-N` (UI y
estilos), `DESIGN-N` (identidad visual y sistema de diseño), `CI-N`
(CI/CD) y `ADMIN-N` (§ Funcionalidad nueva — trabajo de producto pedido
directamente por el usuario, no hallazgos de auditoría; se incluye acá
porque el código ya usa ese formato de comentario). Antes de esta fecha
convivían 8-10 esquemas con superposición real entre sí (`A1` sin guion,
`A-2` con guion y `ARCH-4` eran tres cosas *distintas* que solo se
diferenciaban por el guion) — ver **Tabla de equivalencias** al final
del documento si un ID citado en un commit o PR viejo no aparece en
ninguna tabla de arriba. El proyecto usó además dos nomenclaturas mucho
más antiguas (`Fix #N`, `Gap #N`), retiradas antes de que existiera este
índice — ver § Esquema retirado al final.

---

## 🔴 Hallazgos abiertos

De la auditoría QA senior externa del 12 de julio (segunda pasada del día,
clonado fresco contra `870242e`, sin reabrir ningún hallazgo previamente
cerrado — 153/153 tests reales, build limpio, `npm audit`: 0
vulnerabilidades). Orden de prioridad sugerido por la auditoría:

1. **`UX-11`** 🟡 — 24/30 archivos CSS sin `@media`; `9 passed` confirmado
   en un run real de CI (las 3 pantallas × 3 breakpoints); falta solo
   2-3 corridas más estables antes de sacar `continue-on-error`
2. **`UX-13`** ⛔ — Modo oscuro, revertido a pedido de LS (14 de julio) — ver detalle abajo
3. **`UX-14`** 🟡 — Ya no es una pregunta abierta: convertido en mejora de
   producto planeada (edición in-line de horarios en `TurnoGrid.jsx`),
   sin código tocado todavía — ver detalle abajo

`ARCH-18`, `ARCH-19`, `ARCH-20`, `ARCH-21`, `ARCH-22`, `SEC-20`, `SEC-22`
y `UX-12` ✅ cerrados — ver tablas de Arquitectura y Seguridad abajo.

Ver las tablas de categoría abajo para el detalle de cada uno.

---

## 🔐 Seguridad y RLS

Esquema `SEC-N`. Fusiona lo que antes eran 4 esquemas paralelos (`S-N`,
`SEC-N`, `V-N`, y los hallazgos de seguridad archivados bajo `D-N`) —
ver tabla de equivalencias al final del documento.

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **SEC-1** | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de cualquier programa (RLS nunca habilitado en la tabla padre particionada) | `horarios` (padre + particiones) | `0035`, `0045` | ✅ Cerrado |
| **SEC-2** | `docentes`/`materias`: la política `FOR ALL` solo exigía `auth.role() = 'authenticated'`, sin permiso granular. (Reportado externamente como más grave de lo que era — RLS y bloqueo a `anon` ya estaban activos; verificado contra `pg_policies` real antes de escribir la migración) | `docentes`, `materias` | `0046` | ✅ Cerrado |
| **SEC-3** | Estilos inline (`style={{...}}`) bloqueaban una política CSP estricta (`unsafe-inline` necesario mientras existieran) | Todo `src/` — ver `UX-5` | — | ✅ Cerrado (5 de julio) — `vercel.json` sin `unsafe-inline` en `style-src`. `ModalRol.jsx` restringido a 10 presets de color en vez de `<input type="color">` libre |
| **SEC-4** | Stack trace completo visible en producción | `src/components/ErrorBoundary.jsx` | — | ✅ Cerrado (solo se renderiza en desarrollo) |
| **SEC-5** | Sin validación centralizada de fortaleza de contraseñas | `src/utils/password.js` | — | ✅ Cerrado |
| **SEC-6** | Lockout de login en `localStorage` no resistía pestañas privadas (mismo patrón que `OFF-6`, para PIN) | `LoginScreen.jsx`, `pinOffline.js` | — | ✅ Cerrado (migrado a IndexedDB, cliente) |
| **SEC-7** | Sin respaldo server-side del lockout de `SEC-6` | `LoginScreen.jsx`, RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado. No reemplaza el rate limiting de Supabase Auth (plataforma) — verificar que siga activo en el dashboard |
| **SEC-8** | `login_attempts` tenía INSERT abierto a `public` con `WITH CHECK (true)` — cualquiera podía forzar el bloqueo de otra cuenta | `login_attempts` (RLS + GRANT) | `0048` | ✅ Cerrado |
| **SEC-9** 🔴 | 4 funciones con `REVOKE ALL FROM PUBLIC` en su migración original aparecían ejecutables por `anon` en la BD real (drift, no error de migración). Dos destructivas y solo debían ser `service_role`: `limpiar_audit_logs_antiguos`, `limpiar_scan_rate_limit` | `asegurar_particion_lapso`, `docentes_con_cedula`, `limpiar_audit_logs_antiguos`, `limpiar_scan_rate_limit`, `renovar_qr_token` | `0049` | ✅ Cerrado |
| **SEC-10** | INSERT/DELETE de `horarios` sin restricción de permiso granular | `horarios` | `0035` | ✅ Cerrado (causa raíz completa cerrada con `SEC-1`/`0045`) |
| **SEC-11** | RLS de `qr_sessions`/`asistencias_diarias` sin permisos granulares | `qr_sessions`, `asistencias_diarias` | `0036` | ✅ Cerrado |
| **SEC-12** | `crear_qr_session()` solo validaba rol, no el permiso `puedeGestionarQR` | RPC `crear_qr_session` | `0035` | ✅ Cerrado |
| **SEC-13** | Sin rate limiting en `registrar_asistencia()` | `registrar_asistencia`, `scan_rate_limit` | `0039`, `0040` | ✅ Cerrado |
| **SEC-14** | 2 CVEs "alta severidad" reportadas para `xlsx` (prototype pollution, ReDoS) | `package.json` | `0.20.3` | ✅ **Cerrado — falso positivo** (verificado 9 de julio contra `cdn.sheetjs.com/advisories`, no `npm audit`): ambas CVEs ya corregidas antes de `0.20.3`; `package.json` apunta al tarball oficial de SheetJS, no al paquete de npm abandonado en `0.18.5` (de ahí que `npm audit`/Snyk sigan marcándolo). No se migra a `exceljs` — sin vulnerabilidad real que mitigar |
| **SEC-15** 🔴 | `admin_caller_puede_gestionar_usuarios()` solo verificaba un permiso booleano, sin comparar rol actor vs. rol objetivo — cualquier rol con ese permiso podía crear/editar/eliminar cuentas `admin` sin serlo (escalada de privilegios) | 5 RPCs `admin_*`, `api/admin-users.js` | `0050` | ✅ Cerrado — helper `admin_caller_es_admin()` como guard en las 5 RPCs y replicado en `admin-users.js` (que no llama a las RPCs, usa la Auth Admin API directo) |
| **SEC-16** | `api/admin-users.js` (Service Role Key) sin límite de frecuencia propio | `api/admin-users.js`, `admin_actions_rate_limit` | `0051` | ✅ Cerrado — 10 acciones/minuto por `actor_id` (no IP, por NAT compartido en Vercel) |
| **SEC-17** | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` aparecían ejecutables por `anon` sin ningún `REVOKE` explícito en ninguna migración — mismo patrón que `SEC-9`. Riesgo bajo (solo lectura, devuelven `null`/vacío para `anon`) | 4 RPCs de sesión (sin migración de origen) | `0052` | ✅ Cerrado — ninguna de las 4 fue creada por una migración de este repo, así que `0052` resuelve la firma real vía `pg_proc` en vez de asumirla, y aplica `REVOKE`/`GRANT` a la función que efectivamente exista. Verificado contra la BD real tras aplicar: `anon` ya no aparece en `EXECUTE` de ninguna |
| **SEC-18** 🟡 | `npm audit` marcaba 2 vulnerabilidades en `vite`/`esbuild` (una "alta", una "moderada"). Ambas vivían en el servidor de desarrollo (`npm run dev`) — permitían que una web maliciosa le pidiera datos a ese servidor mientras corría localmente. No afectaban el build de producción que sirve Vercel | `package.json` (`devDependencies.vite`) | — | ✅ **Cerrado (11 de julio)** — la sugerencia automática de `npm audit fix --force` saltaba a `vite@8.1.4`, pero `vite-plugin-pwa@0.21.1` (instalado) y `@vitejs/plugin-react@4.7.0` (instalado) solo declaran soporte hasta `vite ^6.0.0`/`^7.0.0` en sus `peerDependencies` — ese salto habría roto el build. Se aplicó en cambio `vite@^6.4.3` (dentro del mismo rango mayor que ya soportan ambos plugins), que trae `esbuild@^0.25.0` — ambas CVEs afectan únicamente versiones `<=6.4.2`/`<=0.24.2`, así que `6.4.3` ya las resuelve sin saltar de mayor. `npm audit --package-lock-only`: 0 vulnerabilidades. `vite-plugin-pwa` resolvió a `0.21.2` sin cambiar de rango en `package.json`. `npx vitest run`: 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `SEC-14`). `vite build` verificado completo con un stub temporal de `xlsx` (necesario solo por el firewall del sandbox de verificación, no se toca el repo): 253 módulos, chunking lazy idéntico (`view-historial`/`view-logs`/`view-qr`/`view-usuarios`), PWA generado correctamente (52 entradas de precache) |
| **SEC-19** 🟡 | `api/admin-users.js` no define cabeceras CORS propias (`Access-Control-Allow-Origin`, etc.). Hoy no es explotable porque Vercel sirve frontend y función del mismo origen, pero si en el futuro se llama desde otro dominio quedaría abierto a cualquier origen por defecto en vez de a una allowlist explícita | `api/admin-users.js` | — | ✅ **Cerrado (12 de julio)** — se agregó una validación de origen al inicio de `handleRequest()`: si llega la cabecera `Origin` y su host no coincide con `req.headers.host` (el dominio real que Vercel resolvió para esa request), se rechaza con 403 antes de cualquier otro procesamiento. Se compara solo el host, ignorando protocolo http/https a propósito, para que funcione igual en producción, previews de Vercel y desarrollo local (`vercel dev` sirve por `http://`) sin necesitar una lista de dominios hardcodeada ni variables de entorno nuevas. Si `Origin` no viene (llamada sin ese header) no se rechaza, para no romper clientes legítimos — los navegadores modernos siempre lo envían en `POST`, así que su ausencia no es indicio de ataque. Verificado con 5 casos manuales (mismo origen prod, dev local http, sin header, origen malicioso, preview de Vercel) antes de integrar. Cambio de 20 líneas, aditivo, no toca ninguna lógica de auth/permisos existente. `vite build` limpio, 130/130 tests reales (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `SEC-14`) |
| **SEC-20** 🟢 | Sin SAST/análisis estático de seguridad sobre el código propio en CI — solo había `npm audit` (dependencias de terceros) y ESLint (estilo, no vulnerabilidades) | `.github/workflows/codeql.yml` (nuevo) | — | ✅ **Cerrado (13 de julio)** — job nuevo y separado de `test-and-build` (mismo criterio que `visual-regression` de `UX-11`): corre `github/codeql-action` sobre `javascript-typescript` en cada PR/push a `main` y semanalmente por cron. Sube resultados a la pestaña Security > Code scanning del repo en vez de fallar el check de PR — un hallazgo de CodeQL no debe bloquear un build que está bien, y sin baseline previo un check bloqueante entrenaría a ignorarlo (mismo problema que documentó `UX-11`). Permisos acotados a `contents: read` + `security-events: write`, sin tocar `ci.yml` ni `main.yml` existentes. YAML validado (`yaml.safe_load`) antes de commitear; no se pudo correr el job en sí porque requiere GitHub Actions real (el análisis de CodeQL no es replicable en este sandbox) — **pendiente que LS confirme la primera corrida en Actions** y revise los hallazgos iniciales que reporte (pueden incluir falsos positivos a triar, normal en una primera pasada) |
| **SEC-21** 🔴 | Reportado por LS: una sesión iniciada nunca se cerraba sola aunque pasaran días. Causa: `persistSession`/`autoRefreshToken` por defecto (sin límite de sesión) + el timeout de inactividad de `useAuth.js` (30/60 min) vivía solo en memoria del componente — cerrar la pestaña y reabrirla reiniciaba el conteo a cero sin importar el tiempo real transcurrido. Riesgo: acceso físico no autorizado al equipo con la cuenta ya logueada | `src/hooks/useAuth.js`, `auth.sessions` | `0053_limpieza_sesiones_expiradas`, `0055_fix_email_session_logs_cron` | ✅ Cerrado (10 de julio) — dos capas. Client: última actividad e inicio de sesión persistidos en `localStorage`; al montar, si ya venció el plazo se cierra sesión de inmediato, si no, el timer arranca con el tiempo *restante*. Se agrega además un time-box absoluto de 10h (jornada laboral) que no existía. Server (capa real, no evadible editando `localStorage`): `pg_cron` cada 15 min borra de `auth.sessions` lo que exceda el time-box (10h) o 2h sin renovar token — replica el "Time-boxed sessions" de Supabase Pro sin tener ese plan, usando acceso directo a `auth.sessions` (mismo patrón ya establecido en `0014`/`0015`/`0021`/`0050` con `auth.users`). Cada cierre forzado queda registrado en `session_logs` (`evento='logout'`, `detalles->>'forzado'='true'` — ver nota `0055`). `0055` corrige dos constraints de `session_logs` en producción no documentados en ningún esquema versionado (mismo tipo de drift que ya detectó `0033`): `NOT NULL` en `email` (resuelto poblando `email`/`nombre`/`rol`/`programa` vía el mismo JOIN que ya usa `get_session_logs()`) y un `CHECK` en `evento` que solo permite `'login'`/`'logout'` — verificado contra la BD real (302/49 filas) — por lo que el cierre forzado por servidor reusa `evento='logout'` y marca la distinción en `detalles` (`forzado`, `origen`, `motivo`) en vez de ampliar el constraint. Pendiente en el dashboard de Supabase (no se puede hacer por migración): confirmar `pg_cron` habilitado y considerar bajar el JWT expiry limit para acotar la ventana entre el borrado del server y el vencimiento natural del access token ya emitido |
| **SEC-22** | Sin política documentada de rotación de `SUPABASE_SERVICE_ROLE_KEY` — no es una vulnerabilidad activa, es una nota de proceso ante una fuga eventual (auditoría QA del 12 de julio, segunda pasada) | `api/admin-users.js` (uso real), `docs/SECURITY.md` | — | ✅ **Cerrado (13 de julio)** — sección nueva "Política de rotación de `SUPABASE_SERVICE_ROLE_KEY`" en `SECURITY.md`: confirma dónde vive la clave (solo `api/admin-users.js`, nunca el frontend), 3 casos que ameritan rotación (fuga, salida de alguien con acceso, preventiva anual), pasos concretos (Dashboard → regenerar, Vercel → actualizar en los 3 entornos, redeploy, verificar con una acción real antes de dar por cerrada). Cambio de documentación pura, no toca código ni migraciones — sin riesgo de romper nada existente |

## 🔎 Filtrado de datos por permiso/programa

Esquema `PERM-N` (antes disperso entre `V-3` y parte de `D-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **PERM-1** | Pestañas de `AsistenciasModulo` no filtradas por permisos individuales | `src/app/AsistenciasModulo.jsx` | ✅ Cerrado |
| **PERM-2** | Mismo problema que `PERM-1`, en `LogsView` | `src/components/LogsView.jsx` | ✅ Cerrado |
| **PERM-3** | `HistorialView` no respetaba `restringe_programa` | `src/components/HistorialView.jsx` | ✅ Cerrado |
| **PERM-4** | `exportarDatos()` consultaba una tabla `asistencias` inexistente — backups exportaban `asistencias: []` silenciosamente | `src/hooks/useAppData/backupActions.js` | ✅ Cerrado (corregido a `asistencias_diarias`) |

## 📡 Offline y estado de red

Esquema `OFF-N` (antes `O-N`/`P-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **OFF-1** | Sin manejo de estado offline/online para renovación del token QR | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **OFF-2** | Registros irrecuperables de la cola offline nunca se purgaban | `useSyncPendientes.js`, `offlineQueue.js` | ✅ Cerrado (TTL 48h) |
| **OFF-3** | Sin indicador visual de red caída en la proyección del aula | `QRProyeccion.jsx` | ✅ Cerrado |
| **OFF-4** | El poll de rotación de QR seguía intentando queries sin conexión | `src/hooks/useQRSession.js` | ✅ Cerrado |
| **OFF-5** | Service Worker no se registraba explícitamente | `src/main.jsx` | ✅ Cerrado |
| **OFF-6** | Lockout de PIN en `localStorage` no resistía pestañas privadas | `LoginScreen.jsx` | ✅ Cerrado (migrado a IndexedDB) |
| **OFF-7** | `DocenteScan` sin manejo offline | `DocenteScan/index.jsx` | ✅ Cerrado (encola en IndexedDB, confirmación optimista) |
| **OFF-8** | Validación de token sin timeout — spinner infinito sin red | `DocenteScan/index.jsx` | ✅ Cerrado (timeout 3s) |

## 🏗️ Arquitectura, testing y concurrencia

Esquema unificado `ARCH-N` — antes 3 esquemas distintos que colisionaban
visualmente entre sí (`A1`/`A2`/`A3` sin guion, `A-2`..`A-5` con guion, y
`ARCH-4`..`ARCH-19`; `A2` y `A-2` eran hallazgos *distintos* que solo se
diferenciaban por la presencia del guion). Ver tabla de equivalencias al
final del documento.

### Concurrencia y datos asíncronos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-1** | Colisión de nombres entre stores IndexedDB — crasheaba el bundle de producción (TDZ) | `pinOffline.js`, `offlineQueue.js`, `reporteCache.js` | ✅ Cerrado (prefijos únicos) |
| **ARCH-2** | Sin paginación por cursor en `ReporteRango` | `ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado — **ver `UX-15`**: la implementación original de este cierre tenía un bug real (cursor `id` sobre una columna UUID), corregido el 14 de julio |
| **ARCH-3** | Sin guardia de sanidad si el cursor de paginación no avanza | `useAppData/useDataSync.js` | ✅ Cerrado |
| **ARCH-4** | Sin `AbortController` — fetches obsoletos podían sobreescribir estado más reciente | `ReporteRango.jsx`, `useQRSession.js` | ✅ Cerrado |
| **ARCH-5** | Sin limpieza de datos al iniciar un fetch sin caché | `ResumenView.jsx`, `useDataSync.js` | ✅ Cerrado |

### Testing, código muerto y estructura de componentes

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-6** | `log_audit_event` sin registrar rol/programa del actor | migración `0025` | ✅ Cerrado |
| **ARCH-7** | Sin cobertura de tests para lógica crítica (`useAuth`, cola offline) | `useAuth.test.js`, `offlineQueue.test.js` | ✅ Cerrado |
| **ARCH-8** | Sin tests de integración para hooks compuestos ni flujos de usuario completos (escaneo QR, carga de horarios, gestión de usuarios) | 5 tests de orquestación de hooks + `PestanaUsuarios.integration.test.jsx` + `DocenteScan.flow.test.jsx` (render real) | ✅ Cerrado — 152/152 tests, confirmado clonando el repo desde cero |
| **ARCH-9** | CSS embebido de `QRProyeccion.jsx` tenía el stylesheet completo duplicado dentro del mismo template literal | `asistencias/QRProyeccion.jsx` | ✅ Cerrado (5 de julio, junto con `SEC-3`) — extraído a `QRProyeccion.css`, eliminada la copia vieja |
| **ARCH-10** | Bundle de producción sin dividir por ruta — chunk principal de 514 KB, por encima del umbral de Vite | `vite.config.js`, vistas grandes de `HorariosLayout.jsx` | ✅ Cerrado (9 de julio) — `lazy()` + `Suspense` en `HorariosView`, `SeccionesView`, `DocentesView`, `MateriasView`, `AsistenciasView`, `UploadPreviewModal`. `ResumenView` se dejó estática a propósito (vista por defecto). Chunk principal: 503 KB → 468.49 KB |
| **ARCH-11** | `HorariosLayout.jsx` (561 líneas) y `App.jsx` (353 líneas) concentraban layout, navegación y estado de sesión en un solo archivo | `src/app/HorariosLayout.jsx`, `src/App.jsx` | ✅ Cerrado — `HorariosSidebar.jsx`/`HorariosTopbar.jsx` extraídos; `HorariosLayout.jsx` 561→293 líneas, `App.jsx` 353→338 |
| **ARCH-12** | Código muerto: ningún archivo del repo lo importaba ni renderizaba, y su propio import (`responsiveCSS`) no existía en ningún lado. Encontrado de forma incidental durante el barrido que cerró `SEC-3` | `src/components/ResponsiveStyles.jsx` | ✅ Cerrado — archivo eliminado |
| **ARCH-13** | `HistorialView.jsx` (637 líneas), `LogsView.jsx` (517), `LoginScreen.jsx` (508) concentraban layout, estado y lógica de responsabilidades distintas en un solo archivo cada uno. Mismo problema de fondo que `ARCH-11`, en archivos distintos | `src/components/{HistorialView,LogsView,LoginScreen}.jsx` | ✅ **Cerrado (9 de julio, noche)** — mismo patrón que `ARCH-11`: cada archivo se dividió en un orquestador (estado/efectos/handlers) + subcomponentes presentacionales puros que reciben todo por props. `HistorialView.jsx` 637→286 líneas (`historial/`: `ModalTrimestre.jsx`, `ComparadorPanel.jsx`, `HistorialLista.jsx`, `historialUtils.jsx`). `LoginScreen.jsx` 508→336 líneas (`login/`: `ModalActivarPIN.jsx`, `LoginOfflinePinPanel.jsx`, `LoginFormNormal.jsx`). `LogsView.jsx` 517→76 líneas (`logs/`: `TabSesiones.jsx`, `TabAuditoria.jsx`, `logsUtils.jsx` — ya eran subcomponentes autocontenidos, solo se movieron). Extracción 1:1 verificada línea por línea contra el original antes de reemplazar, sin cambios de lógica. `vite build` limpio (mismo tamaño de bundle `view-logs`/`view-historial`, confirma que no se duplicó código), 153/153 tests |
| **ARCH-14** | `api/admin-users.js` repetía el mismo bloque (armar headers, llamar `fetch`, parsear JSON, revisar `.ok`) 13 veces para hablar con Supabase (Auth Admin API + REST) | `api/admin-users.js` | ✅ **Cerrado (11 de julio)** — extraído `supabaseAdminFetch(path, options)`: centraliza `Authorization`/`apikey`/`Content-Type` condicional (solo si hay body) y el prefijo `${SUPABASE_URL}`; `options.headers` se aplica después de los defaults, así que puede sobreescribirlos — lo usa la verificación de sesión inicial, que necesita `Authorization: Bearer <token del usuario>` en vez del service role. Las 13 llamadas (verificación de sesión/permiso/rate-limit + `create`/`reset_password`/`delete`/`delete_orphan`) migradas 1:1 al helper, sin tocar lógica de permisos. Verificado contra el HEAD real antes de reemplazar: diff de todos los mensajes de error idéntico byte a byte, cero `fetch(` directo fuera del helper, 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox de verificación, mismo caso ya documentado en `SEC-14`) |
| **ARCH-15** 🟡 | El chunk `view-qr` pesa 320 KB (88 KB comprimido) — casi el triple que el segundo chunk más grande (`vendor-react`, 134 KB). Diagnóstico original (12 de julio) decía que era por falta de sub-lazy-loading interno en `QRProyeccion.jsx`; investigación más profunda (intento de fix, 12 de julio, sesión posterior) corrigió esto: `AdminQRPanel`, `QRProyeccion` y `ReporteAsistencias` YA tienen cada uno su propio `React.lazy()` en `AsistenciasModulo.jsx` — el problema real es que `vite.config.js` los fuerza a los tres dentro de un único `manualChunks: { 'view-qr': [...] }`, anulando esa separación | `vite.config.js`, `src/components/asistencias/{AdminQRPanel,QRProyeccion}.jsx` | ✅ **Cerrado (12 de julio, sesión posterior al cierre de `ARCH-17`)** — `view-qr` (90 KB tras `ARCH-17`) separado en 3 chunks reales: `view-qr-admin` (19 KB), `view-qr-proyeccion` (6.5 KB, la vista de proyección en pantalla/TV es ahora la más liviana de las 3, como debía ser) y `view-qr-reporte` (37.8 KB). No fue solo cambiar `manualChunks`: `QRProyeccion.jsx` importaba `QRDisplay`/`formatFechaVE`/`TURNOS_VISIBLES` **directamente de `AdminQRPanel.jsx`** — un import estático real que habría arrastrado el panel admin completo al chunk de proyección sin importar cómo se configurara el chunking. Se extrajo `QRDisplay`/`formatFechaVE`/`TURNOS_VISIBLES`/`CountdownBar` a un archivo nuevo y autocontenido (`QRDisplay.jsx` + `QRDisplay.css`, con su CSS movido 1:1 sin cambiar valores), y `AdminQRPanel.jsx`/`QRProyeccion.jsx` ahora importan ambos desde ahí. Mismo análisis de grafo de módulos usado en `ARCH-17` (intersección de lo alcanzable desde cada una de las 3 entradas QR) para encontrar el resto de lo compartido: `useRegistroSound.js` (mismos 2 consumidores que `QRDisplay`) necesitó el mismo tratamiento — un chunk propio explícito (`view-qr-display`, 27.3 KB), no dejarlo en `undefined`, porque se probó así primero y Rollup lo terminó metiendo físicamente dentro de `view-qr-admin` de todos modos (mismo patrón de fondo que `ARCH-17`, esta vez entre dos chunks lazy en vez de lazy-vs-eager). Verificado: `view-qr-admin` y `view-qr-proyeccion` ahora comparten *solo* `view-qr-display` (código legítimamente común, ambos ya lazy); `view-qr-reporte` no cruza con ninguno de los otros dos; `index.html` sigue sin precargar ningún chunk `view-*`; grep exhaustivo de imports estáticos del chunk principal hacia los 7 chunks lazy (incluyendo los 4 nuevos) da vacío; 153/153 tests reales; `npm audit --package-lock-only`: 0 vulnerabilidades |
| **ARCH-17** 🔴 | **Hallazgo nuevo, más grave que `ARCH-15`** (descubierto intentando arreglarlo, 12 de julio): al separar `view-qr` en chunks individuales para medir el impacto real, se confirmó — comparando contra el `vite.config.js` original sin tocar nada — que este problema **ya existe hoy en producción**, no lo causó el intento de fix. Rollup, al decidir automáticamente dónde poner los módulos que no están en `manualChunks`, metió el cliente de Supabase (`lib/supabase.js`, `createClient`), el logger centralizado, `parseClase` y otras utilidades usadas por **toda la app desde el arranque** físicamente dentro del chunk `view-qr` — confirmado con `grep` del bundle real: el chunk principal (`index-*.js`, el que se descarga en cada visita, antes del login) importa `supabase`/`logger`/etc. directamente desde `view-qr-*.js`. Esto significa que **cualquier persona que abre la app, incluso solo para ver la pantalla de login, ya está descargando los 320 KB completos del módulo QR** | `vite.config.js` (`manualChunks`, forma objeto) | ✅ **Cerrado (12 de julio)** — `manualChunks` convertido de forma objeto a forma función, que decide chunk por módulo individual en vez de por grafo de dependencias de un grupo completo. Confirmado con `<link rel="modulepreload">` real en `index.html`: el build original precargaba `view-qr-*.js` (320 KB) **y también** `view-historial-*.js` en cada visita, ambos sin que el hallazgo original mencionara el segundo caso — se corrigieron los dos, mismo patrón de fondo. Metodología: en vez de listar módulos compartidos "a ojo", se usó el grafo real de módulos de Rollup (`this.getModuleInfo()`/`importedIds` vía un plugin de análisis, no manualChunks en sí) para calcular la intersección exacta entre lo alcanzable desde `main.jsx` y desde cada grupo de vistas lazy (`view-historial`/`usuarios`/`logs`/`qr`) — encontrando así los 8 módulos que de verdad hacía falta extraer (`src/lib/supabase.js`, `logger.js`, `parsing.js`, `time.js`, `idb.js`, `offlineQueue.js`, `lapso.js`, `password.js`, `useFocusTrap.js`, `constants/index.js`, más el SDK completo de `@supabase/*` e `iceberg-js` en `node_modules`) en vez de confiar en que "devolver `undefined`" bastara — se probó primero solo con la forma función sin extraer nada más y el problema persistió idéntico, lo cual confirmó que hacía falta el paso adicional. Resultado: `vendor-supabase` (214 KB, el SDK de Supabase — se carga igual de inmediato porque ya se necesitaba desde `App.jsx` para sesión/login, pero ahora en su propio chunk en vez de mezclado con código específico de QR) y `vendor-core` (9 KB, utilidades transversales). `view-qr` bajó de 320.15 KB a 90.36 KB (código real y exclusivo de las 3 vistas QR + `qrcode`/`dijkstrajs`); `view-historial` de tener un import cruzado no documentado a 16.84 KB limpio. Verificado exhaustivamente: `index.html` generado ya no tiene ningún `<link rel="modulepreload">` a `view-*` (antes tenía `view-qr` y `view-historial`); búsqueda de `import{...}from"./view-*-*.js"` dentro del chunk principal da vacío para los 4 grupos lazy; tamaño del chunk principal (`index-*.js`) sin cambios (445.96→445.89 KB, la diferencia es solo redondeo de hashes); `vite build` limpio, 153/153 tests reales, `npm audit --package-lock-only`: 0 vulnerabilidades. Cambio de un solo archivo (`vite.config.js`), sin tocar ningún componente ni lógica de negocio |
| **ARCH-16** 🟢 | La suite de tests depende de un tarball externo (`cdn.sheetjs.com`) para `xlsx`, sin fallback local — en una red restringida (ej. CI con firewall estricto) el `npm install` completo falla y bloquea 2 suites de tests sin que sea un error del código (mismo síntoma ya visto en `SEC-14`) | `package.json` (`dependencies.xlsx`), `vendor/xlsx-0.20.3.tgz` | ✅ **Cerrado (12 de julio)** — se vendorizó el tarball oficial de `xlsx@0.20.3` (misma versión exacta que ya usaba producción, descargado del propio CDN de SheetJS y commiteado en `vendor/xlsx-0.20.3.tgz`, con hash SHA-256 documentado en `vendor/README.md` junto con el procedimiento para actualizarlo a futuro). `package.json` pasa de apuntar a la URL del CDN a `file:./vendor/xlsx-0.20.3.tgz`. Verificado con instalación limpia (`rm -rf node_modules && npm install`) sin acceso al CDN: instala sin salir a internet para esta dependencia, `vite build` limpio (mismo tamaño de bundle, `view-qr` sigue en 320 KB — `xlsx` no vive ahí), 153/153 tests reales, incluidas las 2 suites de `xlsx` que antes quedaban bloqueadas en redes restringidas (`excelParser.test.js`, 29 tests) |
| **ARCH-18** | `AdminQRPanel.jsx` volvió a crecer a 685 líneas (auditoría QA del 12 de julio, segunda pasada) — el archivo más grande del proyecto, por encima de los ya divididos en `ARCH-11`/`ARCH-13`. Mezclaba panel admin, historial de sesiones y borrado en un solo archivo | `src/components/asistencias/AdminQRPanel.jsx`, `adminQR/HistorialSesiones.jsx`, `adminQR/ConfirmBorrarSesionModal.jsx` | ✅ **Cerrado** — mismo patrón ya probado en `ARCH-11`/`ARCH-13`: `HistorialSesiones` (fetch de historial + su estado) extraído a `asistencias/adminQR/HistorialSesiones.jsx`, y su modal de confirmación de borrado a un componente presentacional propio (`adminQR/ConfirmBorrarSesionModal.jsx`, recibe `sesion`/`borrando`/`onConfirm`/`onCancel` por props). `AdminQRPanel.jsx` queda como orquestador: 685→543 líneas. `FeedActividad`/`ContadorSesion`/`ColaOfflinePanel` se dejaron en el archivo principal a propósito — son pequeños y no formaban parte del hallazgo, evitando scope creep. Confirmado ya integrado en `main` (HEAD `3a6b565`): `AdminQRPanel.jsx` en 543 líneas, ambos componentes nuevos presentes con el comentario `// Fix ARCH-18`. Re-verificado en clon fresco: `vite build` limpio, 153/153 tests reales, `npm audit --package-lock-only`: 0 vulnerabilidades |
| **ARCH-19** 🟡 | El proyecto no tiene ESLint ni Prettier configurados — no hay ningún archivo de lint en la raíz, ni paso de lint en `ci.yml` (auditoría QA del 12 de julio, segunda pasada) | `eslint.config.mjs` (nuevo), `package.json`, `.github/workflows/ci.yml` | ✅ **Cerrado (12 de julio)** — `eslint.config.mjs` (flat config, ESLint 10; extensión `.mjs` en vez de `.js` para que Node no tenga que adivinar el tipo de módulo, sin tocar `"type"` en `package.json`) con solo 3 plugins deliberadamente mínimos: `@eslint/js` recommended, `eslint-plugin-react-hooks` (**solo** `rules-of-hooks` + `exhaustive-deps` en `warn`, no el preset `recommended` completo del plugin — en la v7 instalada ese preset trae ~15 reglas nuevas orientadas al React Compiler que marcaban como error patrones idiomáticos ya auditados del proyecto; adoptarlo entero habría significado reescribir ~15 archivos, fuera de alcance) y `eslint-plugin-react-refresh` (`only-export-components` en `warn`). `no-unused-vars` con `ignoreRestSiblings: true` (patrón real: `const { salt, hash, ...perfil } = entry` en `pinOffline.js`) y `varsIgnorePattern: '^React$'` (import de React sin usar en varios archivos por el runtime automático de JSX). `no-empty` con `allowEmptyCatch: true`. Adaptado al HEAD post-`ARCH-18`/`ARCH-20`/`UX-11`: excluye `playwright-report/`, `test-results/`, `blob-report/` (artefactos de Playwright) y da su propio bloque de globals de Node a `tests/visual/**`/`playwright.config.js` (runner y globals distintos de Vitest). 31 errores reales (mismo diagnóstico ya hecho contra un HEAD anterior, re-confirmado 1:1 contra este), todos código muerto o imports sobrantes, corregidos uno por uno sin tocar lógica de negocio: variables/imports sin usar en `LoginScreen.jsx`, `HorariosLayout.jsx`, `buildNavGroups.js`, `DocentesView.jsx`, `TurnoGrid.jsx`, `AdminQRPanel.jsx` (imports ya no usados tras el split de `ARCH-18`), `realtime.js` (3 variables muertas de un refactor previo que dejó `*TimerRef` sin borrar las originales); 3 funciones de ícono SVG huérfanas y un `SectionHeader` huérfano eliminados en `ProgramaLogo.jsx`/`UploadPreviewModal.jsx` (mismo patrón que `ARCH-12`); `no-useless-escape` en `exportPDF.js` resuelto con `eslint-disable`/`enable` alrededor del template literal completo (el escape es defensivo y real, no se tocó su contenido); `no-useless-assignment` en `api/admin-users.js` y `LoginScreen.jsx` resuelto quitando el valor inicial redundante de `callerEsAdmin`/`loginUser`/`loginProfile`, verificado que ningún camino de control los lee antes de la reasignación real. 2 inconsistencias de comportamiento encontradas durante la limpieza **no se tocaron** por ser cambio de comportamiento y no de linting — documentadas como `ARCH-22` y `UX-14` abajo. Quedan 33 warnings (`exhaustive-deps`/`only-export-components`), visibles pero no bloqueantes a propósito. `npm run lint` agregado a `package.json` e integrado en `ci.yml` como paso bloqueante del job `test-and-build` (entre instalación y tests) — el job separado `visual-regression` de `UX-11` no se tocó. Verificado con `rm -rf node_modules && npm ci` (misma instalación que usa CI): lint 0 errores/33 warnings, 153/153 tests, `vite build` limpio (chunk principal 447.61 KB, idéntico al HEAD sin este fix — la limpieza de código muerto no afectó el tamaño), `npm audit --omit=dev --audit-level=high`: 0 vulnerabilidades |
| **ARCH-20** | Cero uso de `PropTypes` o TypeScript — los "contratos" entre componentes no están declarados en ningún lado (auditoría QA del 12 de julio, segunda pasada) | componentes más reutilizados (`QRDisplay`, `Avatar`, `ModalUsuario`, etc.) | ✅ **Cerrado** — se agregó `prop-types` como dependencia y `propTypes` a los 8 componentes más reutilizados/compartidos del repo (confirmado por conteo real de importadores, no a ojo): `Avatar.jsx`, `QRDisplay.jsx` (+`CountdownBar` interno), `usuarios/ModalUsuario.jsx`, `app/UserMenu.jsx`, `ModalCambiarPassword.jsx`, `ErrorBoundary.jsx`, `StatCard.jsx`, `ConfirmModal.jsx`. Los `shape`/`oneOf` de cada uno se verificaron contra los call sites reales antes de escribirlos (ej. `StatCard.variant` se corrigió de una primera lista adivinada a los 7 valores reales confirmados por grep de `sc-root--*` en `index.css` + los dos componentes que lo usan). Cambio puramente aditivo, sin tocar lógica ni JSX existente. Confirmado ya integrado en `main` (HEAD `3a6b565`): `prop-types` en `package.json`, `propTypes` presentes en los 8 componentes con el comentario `// Fix ARCH-20`. Re-verificado en clon fresco: `vite build` limpio (chunk principal 447.61 KB, coincide con lo esperado), 153/153 tests reales, `npm audit --package-lock-only`: 0 vulnerabilidades |
| **ARCH-21** 🟢 | El chunk principal (`index-*.js`) era el más pesado del bundle (446 KB / 149 KB gzip) incluso después de `ARCH-10`/`ARCH-15`/`ARCH-17` — descargado en toda visita a la app, aunque fuera solo para ver el login (auditoría QA del 12 de julio, segunda pasada) | `src/hooks/useAppData/useUpload.js`, `vite.config.js` | ✅ **Cerrado (13 de julio)** — se instaló temporalmente `rollup-plugin-visualizer` (nunca commiteado, solo para diagnóstico) para medir qué había *de verdad* dentro del chunk principal en vez de adivinar. Resultado: no era `@tabler/icons-webfont` como se sospechaba en la fila anterior — era **`xlsx` (SheetJS), 750 KB sin comprimir / ~195 KB gzip, más pesado que todo el resto del chunk principal junto**. La cadena era `useAppData/index.js` → `useUpload.js` (`import * as XLSX from "xlsx"` estático) → cualquiera que abre la app ya descarga la librería completa de Excel, la use o no. Fix: tanto `xlsx` como `../../utils/excelParser` (que también importa `xlsx` de forma estática) pasan a importarse con `import()` dinámico, exactamente en los 2 puntos donde ya se usaban de verdad (`leerWorkbookRaw`, ahora `async`, y el inicio de `handleFileUpload`) — ambos solo se ejecutan cuando el usuario elige un archivo para subir, nunca al montar el componente. No hizo falta tocar `manualChunks`: Rollup separa automáticamente el módulo dinámico (y sus dependencias) en su propio chunk async. `parseHojaDocentes`/`parseHojaMalla`/`parseExcelFile` no cambiaron de firma — siguen síncronas donde ya lo eran, así que `excelParser.test.js` (29 tests, importa el módulo de forma estática desde el archivo de test, un grafo aparte) no se vio afectado. Se agregó `chunkSizeWarningLimit: 520` a `vite.config.js` (con nota explicando por qué) para no silenciar advertencias futuras del chunk *principal* mientras se deja pasar el chunk de `xlsx`, ahora deliberadamente pesado pero lazy. Resultado medido: chunk principal **447.61 KB → 74.47 KB** (149.86 KB → 23.56 KB gzip, -83%), `xlsx` en su propio chunk de 500 KB cargado solo on-demand. Verificado con `rm -rf node_modules && npm ci`: lint 0 errores/33 warnings, 153/153 tests (incluidos los 32 de `useUpload.integration.test.js`/`excelParser.test.js`, que ejercitan tanto el `XLSX.read()` real dentro de `leerWorkbookRaw` como el mock de `vi.mock("../../utils/excelParser")` interceptando correctamente el `import()` dinámico), build limpio sin warnings, `npm audit --package-lock-only`: 0 vulnerabilidades |
| **ARCH-22** 🟢 | Descubierto cerrando `ARCH-19` (12 de julio): `UploadPreviewModal.jsx` calcula `visible = expanded ? rows : rows.slice(0, limit)` pero la agrupación real (`bySec`) usa `rows` completo, no `visible` — la tabla del preview de carga masiva siempre muestra todas las filas sin importar `expanded`, y el botón "mostrar X más" (basado en `hasMore`) no cambia nada visible al hacer clic. No es un hallazgo de linting — es un cambio de comportamiento, por eso no se corrigió junto con `ARCH-19` | `src/components/UploadPreviewModal.jsx`, `.css` | ✅ **Cerrado (13 de julio)** — decisión de LS entre las 2 opciones presentadas: mantener el comportamiento real actual (mostrar siempre todas las filas), en vez de arreglar un límite de 200 que nunca se había pedido ni notado en producción. Se retiró el estado `expanded`/`hasMore`/`visible` y el botón "mostrar más" (que no hacía nada), junto con la clase `.upm-mostrar-mas` en el CSS, ahora huérfana. `TablaRegistros` queda con una sola responsabilidad: agrupar y mostrar `rows` completo, sin lógica muerta alrededor. Ningún caller pasaba la prop `limit`, así que quitarla del todo no afecta a nadie. Verificado: `vite build` limpio (mismo tamaño de bundle, solo se quitó JS/CSS muerto), 153/153 tests reales, sin tests dedicados a este componente que pudieran romperse |

## 🔧 CI/CD y automatización

Esquema `CI-N` (antes `FIX-CI-N` — se sacó el "FIX-" redundante del
prefijo mismo). No se localizó un comentario `CI-1` explícito en el
repo (los workflows de GitHub Actions no llevan el mismo formato de
comentario que el código JS/SQL); se anota como no confirmado en vez de
asumirlo.

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **CI-1** *(no confirmado)* | Sin integración continua | `.github/workflows/ci.yml` | ✅ Cerrado (corre `npm test` + `npm run build` en cada PR/push a `main`) |
| **CI-2** | `console.log/warn/error` directos visibles en producción | `src/utils/logger.js` (14 archivos migrados) | ✅ Cerrado |
| **CI-3** | Sin `npm audit` en CI ni verificación automatizada de RLS con la clave `anon` real | `.github/workflows/ci.yml`, `scripts/rls-smoke-test.mjs` | ✅ Cerrado (`npm audit --audit-level=high` no bloqueante por `SEC-14`, ver nota ahí; smoke test bloqueante) |
| **CI-4** | 2 usos de `console.info` directo rompían la consistencia del logger centralizado | `src/main.jsx`, `src/utils/cache.js` | ✅ Cerrado (9 de julio) — se agregó `logger.info()` siguiendo el patrón de `log`/`warn`/`error`; cero `console.*` fuera de `logger.js` en todo `src/` |

## 🎨 UI y estilos

Esquema `UX-N` (antes `U-N` + el hallazgo `A3` de inline styles, que
vivía sueltó en el esquema de "Concurrencia" pese a ser un tema de UI).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **UX-1** | Estilos inline en `AdminQRPanel` — primer caso migrado, sentó el patrón de `UX-5` | `AdminQRPanel.jsx`/`.css` | ✅ Cerrado |
| **UX-2** | Desbordes de layout en viewports móviles pequeños (`AdminQRPanel`, `ModalRol`) | `AdminQRPanel.css`, `usuarios/ModalRol.jsx` | ✅ Cerrado |
| **UX-3** | Sin trampa de foco de teclado en modales | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **UX-4** | `Campo.jsx` renderizaba `<label>`/`<input>` sin `htmlFor`/`id` — lector de pantalla no anunciaba la etiqueta | `asistencias/DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()` + `aria-describedby`/`aria-invalid`) |
| **UX-5** | Migración sistemática de estilos inline a CSS externo (requisito de `SEC-3`) | Todo `src/` — bajó de 54 a 0 ocurrencias reales | ✅ Cerrado — `Avatar.jsx` (tono bucketizado a 24 pasos de 15°), `TurnoGrid.jsx` (resuelto con `flex: 1` en vez de cálculo en JS), `ModalRol.jsx` (restringido a 10 presets) |
| **UX-6** | Los 7 archivos del shell principal (`src/app/`) nunca se auditaron para responsividad — solo se había cubierto funcionalidad (QR, horarios, login) | `HorariosLayout.jsx`, `UserMenu.jsx`, `AsistenciasModulo.jsx`, `App.jsx`, `AdminMenu.jsx`, `SinPerfilAsignado.jsx`, `CuentaDesactivada.jsx` | ✅ Cerrado — migrados a clases con prefijo (`hl-`, `um-`, `asm-`, `adm-`, `spa-`, `cd-`) con reglas `@media` incluidas |
| **UX-7** | El bundle sin dividir (`ARCH-10`) alargaba la pantalla en blanco en la primera carga | mismo que `ARCH-10` | ✅ Cerrado (9 de julio, mismo fix que `ARCH-10`) |
| **UX-8** | `LoginFormNormal.jsx`, `LoginOfflinePinPanel.jsx`, `ModalActivarPIN.jsx` (extraídos de `LoginScreen.jsx` al cerrar `ARCH-13`, la noche del 9 de julio): el `<label>` de cada campo quedó como hermano del `<input>`, sin `htmlFor`/`id` — misma regresión que `UX-4` ya había resuelto en `Campo.jsx`, reintroducida en archivos nuevos que no pasaron por ese fix | `src/components/login/{LoginFormNormal,LoginOfflinePinPanel,ModalActivarPIN}.jsx` | ✅ **Cerrado (11 de julio)** — mismo patrón que `Campo.jsx`/`UX-4`: `useId()` por instancia de componente, enlazando cada `<label htmlFor>` con su `<input id>`/`<select id>` (2 campos en cada uno de los 3 componentes). Cambio puramente estructural, sin tocar `.form-label`/`.form-input` ni los handlers. Verificado contra el HEAD real (`9477be2`, ya con `ARCH-14` y `SEC-21` incluidos) antes de reemplazar: 121/121 tests (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `SEC-14`) |
| **UX-9** 🟡 | Solo 4 de los 29 archivos CSS del proyecto tienen media queries; `HorariosView.css` (la grilla de horarios) y `QRProyeccion.css` (pantalla de proyección en el aula) no tienen ninguna — en una tablet o un proyector con resolución distinta a un monitor de escritorio, la grilla o el QR proyectado pueden verse cortados o requerir scroll horizontal incómodo | `src/components/HorariosView.css`, `src/components/asistencias/QRProyeccion.css` | ✅ **Cerrado (12 de julio)** — verificado contra el HEAD real antes de tocar nada, con dos hallazgos distintos: (1) **falso positivo parcial en la mitad de `QRProyeccion.css`** — el archivo en sí no tiene `@media`, pero las clases `.qrp-*` que usa `QRProyeccion.jsx` (confirmado 1:1 contra el JSX) sí tienen tratamiento responsive real, ya implementado en `src/index.css` líneas ~424-439 (reflow a 1 columna en <900px, achique de fuente en <640px) — quedó ahí porque cuando `ARCH-9` extrajo el CSS del template literal, esas reglas ya vivían en `index.css` desde antes y no se movieron. No requiere fix de comportamiento, mismo tipo de corrección que `SEC-2`/`SEC-14`; queda pendiente como mejora cosmética de organización (mover esas reglas a `QRProyeccion.css` por cohesión), no como bug. (2) **`HorariosView.css` sí carecía de adaptación real** — pero el archivo es solo la barra de filtros/pestañas (`.hv-filters`, `.hv-tabs`, `.hv-days`), no la grilla en sí (esa es `TurnoGrid.css`, fuera del alcance original de este hallazgo, ya se degrada con `overflow-x: auto` — patrón válido, no roto). `.hv-filters-row`/`.hv-days` ya tenían `flex-wrap: wrap`, así que no se rompían, pero en <640px el título y el padding quedaban sobredimensionados. Se agregó un único `@media (max-width: 640px)` que reduce `.hv-filters` padding y `.hv-title` font-size — mismo breakpoint que `AdminQRPanel.css`. Cambio de 9 líneas, solo aditivo, sin tocar ninguna regla existente. Verificado: `vite build` limpio (mismo tamaño de bundle, es solo CSS), 130/130 tests reales (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `SEC-14`) |
| **UX-10** 🔴 | Reportado por el usuario con capturas de pantalla: "Panel QR" (sin sesión activa) aparecía con fondo azul oscuro (#0F172A) en vez del fondo claro esperado, y el título "Control de Asistencias QR" se volvía invisible (texto oscuro sobre fondo oscuro) — visualmente parecía una regresión de un fix reciente | `AdminQRPanel.jsx`/`.css`, `QRProyeccion.jsx`/`.css` | ✅ **Cerrado (12 de julio)** — no era una regresión de ningún fix de auditoría anterior, sino una colisión de nombres de clase preexistente entre dos archivos CSS distintos que comparten el prefijo `qrp-`: `AdminQRPanel.css` y `QRProyeccion.css` definen por separado `.qrp-root`, `.qrp-qr-wrap` y `.qrp-offline-banner`, cada uno con estilos incompatibles (panel admin = tema claro; proyección = tema oscuro para el aula, por diseño). Confirmado con `comm` sobre los selectores reales de ambos archivos que son las únicas 3 clases duplicadas (de +140 clases `qrp-*` en total). Como Vite agrupa el CSS de ambos componentes en un chunk compartido (`view-qr-*.css`, confirmado en el output de `vite build`) que se carga en cualquier visita al módulo de Asistencias — no solo tras visitar "Proyección" — ambas reglas quedan activas simultáneamente y gana la de mayor especificidad/orden de carga (mismo selector, misma especificidad → última en cascada). Fix: se renombraron las 3 clases del lado de `AdminQRPanel` a prefijo `qap-` ("QR Admin Panel"), sin tocar `QRProyeccion.css` (donde el tema oscuro es intencional) ni ninguna de las +140 clases `qrp-*` restantes que no colisionan. Cambio de 2 archivos, 3 clases renombradas (2 ocurrencias JSX + 3 selectores CSS). Verificado: `vite build` limpio, `view-qr-*.css` ya no comparte selectores entre ambos componentes (`comm -12` vacío tras el fix), 153/153 tests reales (2 suites de `xlsx` bloqueadas solo por el firewall del sandbox, mismo caso de `SEC-14`) |
| **UX-11** 🟡 | 24 de los 30 archivos CSS del proyecto no tienen ningún `@media` — la mayoría se apoya en `flex-wrap`/`overflow-x: auto`, lo cual hoy funciona (verificado en `UX-9`), pero no hay forma automática de detectar si un cambio futuro rompe eso en pantallas chicas (auditoría QA del 12 de julio, segunda pasada) | 24 archivos `.css` de `src/`, `.github/workflows/ci.yml`, `playwright.config.js`, `tests/visual/` | 🟡 **`9 passed` confirmado en CI real (13 de julio)** — las 3 pantallas × 3 breakpoints comparan limpio contra las imágenes base, sin ningún diff (`Running 9 tests using 2 workers... 9 passed (8.7s)`, log crudo revisado línea por línea: descarga de Chromium, build, corrida completa). QR scan muestra el selector "Marcar Entrada/Marcar Salida" correcto; selector de módulos muestra "Bienvenido, Prof. Vista Previa" con exactamente 2 tarjetas (Horarios + Asistencias) — confirma que el mock de sesión de la opción C (`tests/visual/mockSupabase.js`) funciona de punta a punta en CI, no solo localmente. **Único pendiente real:** correr el job 2-3 veces más en corridas futuras sin diffs falsos (para descartar flakiness de fuentes/antialiasing entre corridas de CI) antes de sacar el `continue-on-error: true` de `ci.yml` — recién ahí `UX-11` queda cerrado del todo. Detalle completo de la decisión de la opción C y cómo está armado el mock en `tests/visual/mockSupabase.js` y en las notas narrativas al final de este documento |
| **UX-12** | Deuda cosmética ya documentada en `UX-9`: las reglas responsive de `.qrp-*` (pantalla de proyección QR) vivían en `index.css` en vez de `QRProyeccion.css`, por herencia de cuando `ARCH-9` extrajo el CSS del componente. No es un bug, es organización (auditoría QA del 12 de julio, segunda pasada) | `src/index.css`, `src/components/asistencias/QRProyeccion.css` | ✅ **Cerrado (13 de julio)** — las ~44 líneas (reglas base + los 2 bloques `@media`) se movieron tal cual a `QRProyeccion.css`, sin cambiar ninguna regla ni su orden relativo, solo el archivo. `vite build` limpio, 153/153 tests |
| **UX-13** ⛔ | Sin soporte de `prefers-color-scheme` (modo oscuro) — preferencia de producto, no defecto (auditoría QA del 12 de julio, segunda pasada) | tokens `--color-*`/`--brand-*` en `src/index.css`, 9 archivos `.css` de componentes migrados antes del reverso | ⛔ **Revertido a pedido explícito de LS (14 de julio)** — motivo: LS reportó menús y reportes rotos en el módulo de asistencias tras los últimos fixes de esta migración, y confirmó que la mejora no es necesaria para el producto ("no la veo necesaria"). Alcance del reverso (total, no parcial): `src/index.css` vuelto al estado previo a `7632f42` (sin bloque `:root[data-theme="dark"]`, sin los 11 tokens de Fase 1 — verificado por `grep` que ningún archivo restante usa esos tokens, solo quedaban mencionados en comentarios de `Toast.css`); los 9 archivos migrados en Fase 2 (`DocenteScan.css`, `LoginScreen.css`, `ModalCambiarPassword.css`, `LogsView.css`, `ResumenView.css`, `HistorialView.css`, `AdminQRPanel.css`, `ReporteAsistencias/index.css`, `PestanaUsuarios.css`, `PestanaRoles.css`) restaurados a colores literales, commit por commit (`git show <parent>:<archivo>`), confirmando primero que ningún cambio legítimo posterior tocara el mismo archivo. **Excepción quirúrgica:** `ModuleSelector.css` recibió tanto esta migración (`7c341a5`) como el rediseño de `ADMIN-5` (pedido explícito de LS, cierre de las 3 tarjetas en una fila) — se revirtió *solo* el hunk de `7c341a5` con `git apply -R` sobre el diff exacto de ese commit, preservando intacto el trabajo de `ADMIN-5`. El bug real que esta migración había encontrado y corregido en `AdminQRPanel.css` (tokens `--color-surface`/`--color-border` inexistentes → fondo transparente/sin borde) queda revertido junto con el resto — el archivo vuelve a su estado anterior a esa migración, que es el estado en producción antes de que UX-13 empezara. **Verificado tras el reverso:** 153/153 tests, `vite build` limpio, `eslint .` sin errores nuevos (0 errores, mismos 33 warnings preexistentes). Si en el futuro se retoma modo oscuro, conviene rehacerlo desde cero con verificación visual real en navegador (limitación ya documentada: este entorno de auditoría no tiene navegador) antes de tocar archivos en producción |
| **UX-14** 🟡 | Descubierto cerrando `ARCH-19` (12 de julio): `HorariosView.jsx` recibe la prop `modoConsulta` (calculada en `HorariosLayout.jsx` como `modoConsulta || !permisos.puedeEditarHorarios`) pero no la usa en ningún lado del cuerpo — a diferencia de `DocentesView`/`MateriasView`, que sí la leen para mostrar su banner de solo-lectura. Confirmado (13 de julio): hoy **no existe ninguna edición in-line de horarios en todo el código** — `TurnoGrid.jsx` solo expande celda para ver detalle, no hay drag-and-drop en ningún lado, ni rastro de que haya existido (sin comentarios, sin TODOs). El permiso `puedeEditarHorarios` (`"Arrastrar y colocar bloques, editar in-line"`, definido en `usuarios/shared.jsx`) no tiene ninguna funcionalidad real detrás | `src/components/HorariosView.jsx`, `src/components/TurnoGrid.jsx` | 🟡 **Convertido en mejora planeada (13 de julio)** — decisión de LS: no era una pregunta para cerrar con un "sí"/"no", es una funcionalidad real pendiente de construir. Queda anotado como **roadmap: implementar edición in-line de horarios (drag-and-drop de bloques) en `TurnoGrid.jsx`**, activando entonces sí el banner de solo-lectura en `HorariosView.jsx` cuando `modoConsulta` sea `true` (mismo patrón que `DocentesView`/`MateriasView`). No se toca código en esta pasada — es trabajo de feature nueva, no un fix; cuando se aborde, conviene tratarlo con el mismo criterio que la serie `ADMIN-N` de la sección "🆕 Funcionalidad nueva" (specs claras de LS antes de tocar `TurnoGrid.jsx`, que hoy es de solo lectura y ya pasa por varias vistas) |
| **UX-15** 🔴 | Reportado por LS (14 de julio) con el mensaje de error textual: al abrir "Reporte por Rango de Fechas", Supabase devolvía `invalid input syntax for type uuid: "0"` y la tabla no cargaba ningún dato | `src/components/asistencias/ReporteAsistencias/ReporteRango.jsx` | ✅ **Cerrado (14 de julio)** — causa raíz: `asistencias_diarias.id` es `UUID` (migración `0006_modulo_asistencias_qr.sql`), no un entero autoincremental como `horarios.id` (que sí es `INTEGER`, ver `0042_fix_default_id_horarios.sql`). La paginación por cursor de `ARCH-2` asumía lo segundo: partía de `cursor = 0` y hacía `.gt("id", cursor)`, y Postgres rechaza comparar una columna `uuid` contra el entero `0` — fallaba en la primera página, antes de traer ningún dato real. Se confirmó por `grep` que el mismo patrón `let cursor = 0` / `.gt("id", cursor)` existe también en `PlanillaQR.jsx` y `useDataSync.js`, pero ambos consultan `horarios` (`id` sí es `INTEGER` ahí) — no están afectados, no se tocaron. Fix: los UUID no tienen un orden secuencial útil para un cursor, así que se cambió a paginación por offset (`.range()`), ordenando por `hora_registro` (con `id` como desempate estable) en vez de por `id`. Se quitó también la guardia de "cursor no avanza" (`ARCH-3`, ya no aplica con offset) y el import de `logger` que quedó sin uso. Verificado: 153/153 tests, `vite build` limpio, `eslint .` 0 errores |
| **UX-16** 🔴 | Reportado por LS (14 de julio): los reportes en PDF (diario y por rango, botón "PDF" en `ReporteAsistencias`) se abrían en la ventana nueva sin ningún formato — tabla, colores y membrete aparecían como texto plano sin estilo | `src/components/asistencias/ReporteAsistencias/exportPDF.js`, `public/reporte-print.css` (nuevo), `public/reporte-print.js` (nuevo) | ✅ **Cerrado (14 de julio)** — causa raíz: el CSP del proyecto usa `script-src 'self'` y `style-src 'self'` sin `'unsafe-inline'` (endurecido en `SEC-3`/`UX-5`, ver sección de Seguridad). `exportPDF.js` abre la vista de impresión con `window.open("", "_blank")` + `document.write(html)` — un documento `about:blank` del mismo origen que **hereda el CSP del documento que lo abrió** (comportamiento estándar del navegador, no específico de este proyecto) en vez de partir sin política propia. El `<style>` inline del `<head>`, el `<script>` inline de auto-impresión, y **todos** los atributos `style="..."` sueltos en las celdas/tarjetas de la plantilla (colores de estado, alineaciones) quedaban bloqueados en silencio — de ahí el HTML sin ningún estilo aplicado. Fix: el CSS se extrajo a `public/reporte-print.css` y el script de auto-impresión a `public/reporte-print.js`, referenciados como recursos externos del mismo origen (`<link rel="stylesheet" href="/reporte-print.css">`, `<script src="/reporte-print.js">`) — `'self'` sí los permite. Los ~20 atributos `style=""` restantes de la plantilla (colores de stat-box, celdas de tabla, badges) se reemplazaron por clases utilitarias nuevas en ese mismo CSS (`.stat-num--azul/verde/ambar/rojo`, `.td-cedula`, `.td-pct--alta/media/baja`, etc.), sin cambiar ningún color ni tamaño visual respecto al original. Verificado: `vite build` limpio (los 2 archivos nuevos de `public/` quedan precacheados por el service worker), 153/153 tests, `eslint .` 0 errores. **Sin verificar visualmente en navegador real** (mismo límite ya documentado en `UX-11`/`UX-13`: este entorno de auditoría no tiene navegador) — recomendado que LS confirme abriendo un PDF de cada tipo (diario y por rango) antes de dar por cerrado |

## 🎨 Identidad visual y sistema de diseño

Esquema `DESIGN-N` (antes `FE-N`). Fusionado desde `AUDITORIA_FRONTEND.md`
(documento eliminado tras la fusión — su contenido íntegro vive en esta
sección).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **DESIGN-1** | Iconografía funcional resuelta con emojis nativos del SO | `buildNavGroups.js`, `App.jsx`, `AdminMenu.jsx`, `LoginScreen.jsx`, y resto de vistas | ✅ Cerrado — cero emoji funcional confirmado por grep de rango Unicode sobre todo `src/`. Sobreviven solo `EMOJIS_PRESET` (selector deliberado de emoji de rol, es la funcionalidad en sí) y mensajes de diagnóstico en `logger.warn` |
| **DESIGN-2** | Tipografía sin identidad — solo `system-ui` | `src/index.css` | ✅ Cerrado — fuente Inter |
| **DESIGN-3** | Tokens de diseño incompletos: faltaban escalas de espaciado/sombras/radios; gran parte de los componentes usaba estilos inline con hex repetidos en vez de tokens | `src/index.css`, objeto `S` en `src/constants/index.js` | ✅ **Cerrado (9 de julio, tarde)** — la escala de tokens sí se completó antes (espaciado, sombras, `:focus-visible`); lo que quedaba de este hallazgo era la falta de una escala `--font-size-*`. Se definieron 21 variables (`--font-size-9`…`-48`) tomando cada valor 1:1 de los que ya estaban en uso en todo el proyecto — sin redondear ni consolidar ningún tamaño — y se adoptaron en `index.css` y en los 27 `.css` de componentes restantes (569 sustituciones en total). Quedan como literal, a propósito, los `clamp()` responsivos, los tamaños dinámicos de `Avatar` (excepción ya documentada en `UX-5`) y los valores que aparecen una sola vez en todo el proyecto (72px, 52px). Verificado: `vite build` limpio, 153/153 tests, ningún tamaño visual cambió |
| **DESIGN-4** | Sin `:focus-visible` accesible consistente | `src/index.css` | ✅ Cerrado — 6 reglas confirmadas |
| **DESIGN-5** | Adopción mixta de `var(--token)` en las reglas `.hl-*` (migradas desde `HorariosLayout.jsx` por `UX-6`): algunos `font-size`/`padding`/`margin`/`gap` seguían en valores px crudos | `src/index.css` (reglas `.hl-*`) | ✅ **Cerrado (9 de julio, tarde)** — cerrado en dos pasadas. La primera (en otro chat) tokenizó 5 líneas con la escala `--space-N` existente (múltiplos de 4: `4/8/12/16/20/24/32px`). La segunda completó las 12 reglas restantes; como 4 valores en uso (`6px`, `7px`, `10px`, `14px`) no son múltiplo de 4 y forzarlos al `--space-N` más cercano habría alterado el tamaño real, se agregaron 4 tokens de valor exacto (`--space-6px`, `--space-7px`, `--space-10px`, `--space-14px`, mismo criterio que `--font-size-N`). Quedan como literal, a propósito, 2 valores de una sola ocurrencia (`.hl-lapso-label margin-bottom: 3px`, `.hl-syncing gap: 5px`) y el `width: 20px` de dos íconos (es sizing, no espaciado — fuera de alcance). Verificado: `vite build` limpio, 153/153 tests, ningún tamaño ni espaciado visual cambió |

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
| **ADMIN-4** | La jerarquía fija del rol admin (`SEC-15`, migración `0050`) ya bloqueaba en el servidor que un rol no-admin creara/editara/eliminara una cuenta admin, pero la UI no reflejaba esa regla: el selector de rol mostraba "admin" como opción a cualquiera con `puedeGestionarUsuarios`, y las filas admin de la tabla no bloqueaban editar/desactivar/eliminar — el error solo aparecía al guardar | `src/components/usuarios/{index,PestanaUsuarios,ModalUsuario}.jsx` | — | ✅ Cerrado (10 de julio) — no es un hallazgo de seguridad nuevo (`SEC-15` ya cerraba el hueco real, en el servidor); es la UI reflejando la misma regla para evitar que alguien llegue a un error que ya sabíamos que iba a pasar. Se propaga `profile.rol === "admin"` (`esActorAdmin`) desde `AdminModulo.jsx` hasta `ModalUsuario.jsx`: oculta "admin" del selector de rol si el actor no lo es, y bloquea (con tooltip) editar/desactivar/eliminar sobre una fila admin en la tabla |
| **ADMIN-5** | Pedido directo del usuario (12 de julio, con captura desde laptop): las 3 tarjetas del selector de módulo (pantalla post-login) no caían en una sola fila en desktop — la 3ra ("Sistema") bajaba sola a una segunda fila aunque sobraba espacio horizontal. De paso, se pidió una pasada de optimización visual general de esa pantalla, cuidando que siguiera respondiendo bien en móvil y previendo que se agreguen más módulos a futuro | `src/components/ModuleSelector.{jsx,css}` | — | ✅ Cerrado (12–13 de julio), en tres pasadas. **Pasada 1** (grid + consistencia, 12 de julio): `flexbox` con `max-width: 680px` fijo cambiado a CSS Grid con `auto-fit`/`minmax` (resuelve el problema reportado y es a prueba de más módulos a futuro); tokens de spacing/radio/color adoptados donde calzaban exacto; fix de hover "pegado" en touch; breakpoint mobile; `prefers-reduced-motion`. Ninguno de estos cambios era visualmente perceptible en desktop con mouse — el usuario lo notó y con razón ("no veo nada diferente"), esa pasada fue de consistencia/robustez, no de rediseño. **Pasada 2** (rediseño compacto, 12 de julio, a pedido explícito tras esa observación): cambio estructural real — la tarjeta pasa de layout vertical (ícono arriba → título → descripción → "Entrar" al final, ~180px de alto) a un layout horizontal tipo fila de lista (ícono | texto | chevron, ~72px de alto): nuevo `<div className="module-card-body">` envolviendo título+descripción, `<i className="ti ti-chevron-right">` reemplazando el texto "Entrar". En CSS: bordes 1px (antes 2px), radio reducido a `--border-radius-lg`, ícono de 52px a 40px, sombra por defecto eliminada (flat design), descripción con `-webkit-line-clamp: 2` para que las 3 tarjetas midan lo mismo. **Pasada 3** (13 de julio, verificación de que no chocara con lo que había cambiado en `main` mientras tanto — UX-13 modo oscuro se agregó en paralelo): se encontró que `.module-page` usaba `var(--color-text-primary)` como stop de gradiente, heredado del archivo original de antes de que existiera modo oscuro — UX-13 redefine ese token a casi blanco bajo `prefers-color-scheme:dark`, lo que habría roto el fondo (pensado para verse siempre oscuro, es un splash de marca) para cualquier usuario con el SO en modo oscuro. Cambiado a `var(--navy-900)` (mismo `#0f172a` exacto, pero confirmado invariante entre temas — la paleta de superficies oscuras no se redefine en el bloque `prefers-color-scheme`). No es un bug introducido por esta feature: ya estaba latente desde la migración original (5 de julio), solo se volvió un bug real una vez que UX-13 se mergeó. Verificado con `vite build`, `eslint .` (0 errores) y 153/153 tests reales sobre el HEAD real de `main` en cada pasada, no sobre una copia desactualizada |

---

## 🗄️ Esquema retirado (`Fix #N` / `Gap #N`)

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
repetir el detalle ya cubierto en las tablas de arriba (que es donde vive
el "cómo" completo — verificación, comandos corridos, resultados).

- **Primeras rondas (jun 2026):** RLS inicial (`0016`–`0021`), QR/offline
  (`OFF-*`, `ARCH-1`–`ARCH-5`, `SEC-10`–`SEC-12`, `PERM-2`–`PERM-4`),
  migración de diseño a Tabler Icons + paleta slate, `parsing.js` con
  cascada de 3 niveles para nombres de docentes.
- **4–5 de julio:** `SEC-4`, sección `CI-N` completa, `UX-2`, fusión de
  `AUDITORIA_FRONTEND.md` como sección `DESIGN-N`. Auditoría QA externa
  aporta `SEC-21`/`SEC-22`/`SEC-20`/`ARCH-6`/`UX-3`–`UX-6`; cierre de
  todos salvo `SEC-17` (fuerza bruta server-side, requería `pg_cron`).
- **5–8 de julio:** cierre de `SEC-17` (migración `0047`, bloqueo por
  cuenta además del bloqueo de IDB del cliente). Auditoría de una
  segunda IA (Arquitectura 87/100) aporta `ARCH-7`–`ARCH-9`, `UX-1`,
  cerrados el mismo día. `ARCH-11` (`AppDataContext`) cierra el prop
  drilling de `appData` a través de 6+ niveles de componentes.
- **9 de julio:** reorganización del documento (separar hallazgos
  abiertos del historial, sin cambiar ningún estado). Cierre de
  `ARCH-12`/`SEC-9` (`ResponsiveStyles.jsx` muerto eliminado; RPCs de
  sesión sin `REVOKE` de `anon` corregidas). Cierre de `DESIGN-3`/
  `DESIGN-5` (escala tipográfica y de espaciado tokenizada en los 27
  `.css` del proyecto, ~750 sustituciones). Cierre de `ARCH-13`
  (`HistorialView`/`LogsView`/`LoginScreen`, los 3 archivos más grandes
  del repo, divididos en orquestador + subcomponentes).
- **10 de julio:** `ADMIN-1`–`ADMIN-4` (funcionalidad nueva, no hallazgo
  de auditoría). `SEC-15` abierto y cerrado en sesión paralela: limpieza
  automática de sesiones expiradas vía `pg_cron`.
- **11 de julio, auditoría QA senior externa (Arq. 91/100, Seg. 93/100,
  UX 88/100):** confirma que nada cerrado se reabrió. Aporta `ARCH-14`
  (código duplicado en `api/admin-users.js`), `SEC-18` (2 CVEs de
  `npm audit`, solo dev-server) y `UX-8` (regresión de accesibilidad en
  los formularios de login). Los 3 cerrados el mismo/día siguiente.
- **12 de julio, dos auditorías QA senior externas (misma fecha,
  sesiones distintas):** primera pasada (Arq. 92/100, Seg. 94/100,
  UX 87/100) aporta `ARCH-15`–`ARCH-17` (chunk `view-qr`, `xlsx` sin
  fallback, chunk principal cargando todo de entrada), `SEC-19` (CORS
  en `api/admin-users.js`) y `UX-9` (CSS sin media queries) — todos
  cerrados el mismo día. Segunda pasada, horas después (Arq. 90/100,
  Seg. 96/100, UX 88/100) — 9 hallazgos nuevos: `ARCH-18`–`ARCH-21`
  (tamaño de archivo, sin lint, sin PropTypes, chunk principal como
  techo actual), `SEC-20`/`SEC-22` (sin CodeQL, sin política de
  rotación de la service role key), `UX-11`–`UX-13` (regresión visual
  automatizada, deuda cosmética de `UX-9`, sin modo oscuro).
- **12–13 de julio, cierre de `ARCH-18`/`ARCH-20`:** `AdminQRPanel.jsx`
  dividido en orquestador + 2 subcomponentes; `prop-types` agregado a
  los 8 componentes más reutilizados, verificando cada `shape` contra
  call sites reales en vez de adivinar.
- **12–13 de julio, `UX-11` (regresión visual):** infraestructura de
  Playwright con 3 breakpoints, job de CI separado y no-bloqueante
  hasta tener imágenes base. Login, QR scan y selector de módulos
  cubiertos — este último con sesión mockeada a nivel de red del
  navegador (opción elegida por LS entre 3 presentadas; ver
  `tests/visual/mockSupabase.js`). Confirmado `9 passed` en CI real.
  Pendiente: 2-3 corridas más sin diffs falsos antes de sacar
  `continue-on-error`.
- **13 de julio, cierre de `ARCH-21` (chunk principal):** medido con
  `rollup-plugin-visualizer` en vez de adivinar — el culpable real era
  `xlsx`/SheetJS (~750 KB) importado de forma estática. Fix: `import()`
  dinámico. Chunk principal 447.61 KB → 74.47 KB (-83%).
- **13 de julio, cierre de `ARCH-22` y reclasificación de `UX-14`:**
  código muerto de `UploadPreviewModal.jsx` retirado. Permiso
  `puedeEditarHorarios` sin funcionalidad real detrás — no es un bug,
  reclasificado como roadmap (edición in-line en `TurnoGrid.jsx`).
- **13 de julio, primera normalización de IDs:** 8-10 esquemas
  colisionantes (`A1`/`A-2`/`ARCH-4` eran 3 cosas distintas que solo se
  diferenciaban por el guion) → 8 prefijos únicos. Aplicado a 110
  archivos de código. Bug propio encontrado y corregido antes de
  aplicar nada: un primer intento de script reemplazaba los IDs en
  secuencia, lo cual encadenaba mal 29 de los 79 mapeos por
  solapamiento numérico entre rangos viejo/nuevo — corregido con
  sustitución simultánea de una sola pasada.
- **14 de julio, reverso completo de `UX-13` (modo oscuro):** a pedido
  explícito de LS — reportó menús y reportes rotos en asistencias tras
  los últimos fixes de la migración, y confirmó que la mejora "no la
  veo necesaria". Reverso total: tokens de Fase 1 quitados de
  `index.css`, los 9 archivos de Fase 2 restaurados a colores literales
  commit por commit, con una excepción quirúrgica en `ModuleSelector.css`
  (recibió también el rediseño de `ADMIN-5` — se revirtió *solo* el
  hunk del modo oscuro con `git apply -R`, preservando `ADMIN-5` intacto).
- **14 de julio, `UX-15`/`UX-16` (bugs reportados directamente por LS,
  cerrados el mismo día):** `UX-15` — paginación por cursor de `ARCH-2`
  asumía IDs enteros autoincrementales, pero `asistencias_diarias.id` es
  `UUID`; cambiado a paginación por offset. `UX-16` — CSP (`script-src`/
  `style-src 'self'`, endurecido en `SEC-3`/`UX-5`) bloqueaba en
  silencio todo el HTML inline de los PDFs de reporte; CSS y JS
  extraídos a `public/reporte-print.{css,js}` como recursos del mismo
  origen. Ninguno de los dos se verificó visualmente en navegador real
  (límite de entorno ya documentado en `UX-11`/`UX-13`) — pendiente que
  LS confirme abriendo un PDF de cada tipo.
- **14 de julio, segunda normalización de IDs (esta pasada):** el repo
  avanzó 3 commits más entre la primera normalización y la entrega —
  el reverso de `UX-13` y el cierre de `UX-15`/`UX-16` llegaron
  *después* de la primera pasada, con 2 IDs nuevos (`U-14`/`U-15`,
  esquema viejo) que no existían en el mapeo original. Se extendió el
  mapeo (`UX-15`, `UX-16`) y se rehízo todo el proceso contra el HEAD
  real en vez de entregar la versión vieja — segunda vez que esto pasa
  en el mismo día; confirmado con LS que no hay una tercera sesión en
  paralelo antes de dar esta pasada por final.

## 🔁 Tabla de equivalencias (IDs antiguos → nuevos)

Reorganización del 13-14 de julio de 2026. Si un commit viejo, un PR cerrado, o una conversación pasada menciona un ID que no aparece en ninguna tabla de arriba, buscarlo acá. `ADMIN-N` no está en esta tabla porque no cambió — nunca colisionaba con nada.

**Nota:** las 12 migraciones SQL ya aplicadas a producción (`docs/supabase/migrations/00{25,35,39,45,47,48,49,50,51,52}*.sql`) conservan a propósito sus IDs *originales* en los comentarios — son historial de lo que de verdad corrió contra la base de datos, y no se tocaron en esta reorganización. Si un comentario ahí dice `Fix S1`, es el mismo hallazgo que esta tabla mapea a `SEC-1`.

<details>
<summary><strong>SEC-N — Seguridad y RLS</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `S1` | `SEC-1` |
| `S2` | `SEC-2` |
| `S3` | `SEC-3` |
| `SEC-2` | `SEC-4` |
| `SEC-3` | `SEC-5` |
| `SEC-5` | `SEC-6` |
| `SEC-6` | `SEC-7` |
| `SEC-7` | `SEC-8` |
| `SEC-8` | `SEC-9` |
| `V-1` | `SEC-10` |
| `V-2` | `SEC-11` |
| `V-4` | `SEC-12` |
| `D-3` | `SEC-13` |
| `D-6` | `SEC-14` |
| `SEC-10` | `SEC-15` |
| `SEC-11` | `SEC-16` |
| `SEC-9` | `SEC-17` |
| `D-7` | `SEC-18` |
| `SEC-13` | `SEC-19` |
| `SEC-14` | `SEC-20` |
| `SEC-12` | `SEC-21` |
| `SEC-15` | `SEC-22` |

</details>

<details>
<summary><strong>PERM-N — Filtrado de datos por permiso/programa</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `V-3` | `PERM-1` |
| `D-1` | `PERM-2` |
| `D-2` | `PERM-3` |
| `D-4` | `PERM-4` |

</details>

<details>
<summary><strong>OFF-N — Offline y estado de red</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `O-1` | `OFF-1` |
| `O-2` | `OFF-2` |
| `O-3` | `OFF-3` |
| `O-4` | `OFF-4` |
| `O-5` | `OFF-5` |
| `O-8` | `OFF-6` |
| `P-2` | `OFF-7` |
| `P-3` | `OFF-8` |

</details>

<details>
<summary><strong>ARCH-N — Arquitectura, testing y concurrencia</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `A1` | `ARCH-1` |
| `A-2` | `ARCH-2` |
| `A-3` | `ARCH-3` |
| `A-4` | `ARCH-4` |
| `A-5` | `ARCH-5` |
| `A2` | `ARCH-6` |
| `ARCH-4` | `ARCH-7` |
| `ARCH-5` | `ARCH-8` |
| `ARCH-6` | `ARCH-9` |
| `ARCH-7` | `ARCH-10` |
| `ARCH-8` | `ARCH-11` |
| `ARCH-9` | `ARCH-12` |
| `ARCH-10` | `ARCH-13` |
| `ARCH-11` | `ARCH-14` |
| `ARCH-12` | `ARCH-15` |
| `ARCH-13` | `ARCH-16` |
| `ARCH-14` | `ARCH-17` |
| `ARCH-15` | `ARCH-18` |
| `ARCH-16` | `ARCH-19` |
| `ARCH-17` | `ARCH-20` |
| `ARCH-18` | `ARCH-21` |
| `ARCH-19` | `ARCH-22` |

</details>

<details>
<summary><strong>UX-N — UI y estilos</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `U-1` | `UX-1` |
| `U-2` | `UX-2` |
| `U-3` | `UX-3` |
| `U-4` | `UX-4` |
| `A3` | `UX-5` |
| `U-5` | `UX-6` |
| `U-6` | `UX-7` |
| `U-7` | `UX-8` |
| `U-8` | `UX-9` |
| `U-9` | `UX-10` |
| `U-10` | `UX-11` |
| `U-11` | `UX-12` |
| `U-12` | `UX-13` |
| `U-13` | `UX-14` |
| `U-14` | `UX-15` |
| `U-15` | `UX-16` |

</details>

<details>
<summary><strong>DESIGN-N — Identidad visual y sistema de diseño</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `FE-1` | `DESIGN-1` |
| `FE-2` | `DESIGN-2` |
| `FE-3` | `DESIGN-3` |
| `FE-4` | `DESIGN-4` |
| `FE-5` | `DESIGN-5` |

</details>

<details>
<summary><strong>CI-N — CI/CD y automatización</strong></summary>

| Antiguo | Nuevo |
|---|---|
| `FIX-CI-1` | `CI-1` |
| `FIX-CI-2` | `CI-2` |
| `FIX-CI-3` | `CI-3` |
| `FIX-CI-4` | `CI-4` |

</details>

---

*Última reorganización: 14 de julio de 2026 — se normalizaron los IDs de
hallazgo a 8 prefijos únicos y sin colisión (`SEC`/`PERM`/`OFF`/`ARCH`/
`UX`/`DESIGN`/`CI`/`ADMIN`, antes 8-10 esquemas parcialmente
superpuestos — ver tabla de equivalencias arriba), se aplicó la misma
renumeración a los 112 archivos de código que citan estos IDs en
comentarios, y se condensó el historial narrativo de ~650 a ~120 líneas.
Ningún hallazgo cambió de estado real en esta pasada — algunos cambiaron
de número. Hecho en dos tandas el mismo día porque el repo avanzó 3
commits (reverso de `UX-13`, cierre de `UX-15`/`UX-16`) entre la primera
pasada y la entrega — la segunda tanda extendió el mapeo con los 2 IDs
nuevos y se rehizo contra el HEAD real. Reorganización anterior: 9 de
julio de 2026, se separaron hallazgos abiertos del historial de cierre.
Para el índice de migraciones SQL y el esquema de base de datos, ver
`ESQUEMA_Y_MIGRACIONES.md`.*
