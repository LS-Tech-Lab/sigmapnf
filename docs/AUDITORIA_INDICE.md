# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgo (`SEC-1`, `SEC-10`, `OFF-3`, `ARCH-11`, etc.) que
aparecen dispersos en comentarios de código y migraciones. Antes de este
documento, ubicar qué era un ID específico requería `grep` sobre todo el repo.

**Metodología:** cada fila se verifica contra el código/BD real (`grep`,
`git log`, `pg_policies`, `vite build`), nunca contra un informe externo sin
confirmar. Al cerrar un hallazgo nuevo: usar el formato ya establecido en el
repo (`// Fix <ID> (auditoría <fecha>): qué y por qué` en código, `-- Migración
NNNN — Fix <ID>: resumen` en SQL), agregar/actualizar su fila aquí, y si
reabre o profundiza un hallazgo anterior decirlo explícitamente.

**Nota de proceso (agregada tras `UX-19`, 14 de julio):** las auditorías de
arquitectura ya chequean código duplicado entre componentes, pero no
*patrones de UI/UX repetidos entre los 3 módulos raíz*
(`HorariosLayout`/`AsistenciasModulo`/`AdminModulo`) — la misma acción de
usuario resuelta distinto en cada módulo no aparece en ningún grep de código
duplicado porque el comportamiento diverge, no el código. Desde la próxima
auditoría: por cada elemento de navegación común a los 3 módulos raíz
(topbar, dropdown de usuario, back-buttons, badges, atajos), confirmar que
los 3 usan el mismo componente/clase o que la diferencia está documentada
como intencional.

**Esquema de IDs (normalizado el 13-14 de julio de 2026):** 8 prefijos, uno
por área, sin colisión — `SEC-N` (seguridad y RLS), `PERM-N` (filtrado por
permiso/programa), `OFF-N` (offline y red), `ARCH-N` (arquitectura, testing y
concurrencia), `UX-N` (UI y estilos), `DESIGN-N` (identidad visual), `CI-N`
(CI/CD) y `ADMIN-N` (funcionalidad nueva pedida por el usuario, no hallazgo
de auditoría — se incluye acá porque el código usa el mismo formato de
comentario). Antes de esta fecha convivían 8-10 esquemas superpuestos (`A1`
sin guion, `A-2` con guion y `ARCH-4` eran tres cosas *distintas*) — ver
**Tabla de equivalencias** al final si un ID citado en un commit/PR viejo no
aparece arriba. IDs mencionados en código pero nunca localizados (esquema
antiguo, probablemente descartados antes de llegar a `main`): `O-6`, `O-7`,
`P-1`, `S1`, `SEC-4` (viejo). El proyecto también usó `Fix #N`/`Gap #N`,
retiradas antes de este índice — ver § Esquema retirado al final. Para el
esquema de BD y migraciones SQL, ver `ESQUEMA_Y_MIGRACIONES.md`.

---

## 🔴 Hallazgos realmente abiertos

**0 abiertos.** Última verificación cruzada código↔BD real: 6 de agosto
(auditoría externa + pasada de LS en paralelo — ver nota abajo). Antes de
esa fecha: 3 de agosto (fix `UX-29` + reapertura/cierre de `ARCH-35`,
verificados sobre el HEAD real del repo tras confirmar 14 commits en
paralelo — ver nota abajo). Antes de esa fecha: 2 de agosto (auditoría de
estrés operacional + pasada de implementación + fix reportado por LS).
Esa pasada encontró que `ARCH-29`/`UX-24` se habían marcado ✅ **sin que
la migración `0057` que citaban existiera en el repo** — reabierto y
cerrado el mismo día como `ARCH-31` (ver tabla `ARCH-N`). El resto de
hallazgos de esa fecha (`ARCH-30`, `SEC-27`, `ARCH-32`–`34`, `OFF-9`,
`UX-25`–`28`) están detallados en sus tablas por prefijo abajo, no
repetidos acá — ver también § Historial de auditorías para el resumen
cronológico. Verificación final del 6 de agosto: 280/280 tests, 0 errores
de lint, build limpio.

**Nota de proceso (6 de agosto):** auditoría externa completa contra el
HEAD real (`a84dce2`) encontró que el sistema de Sedes (`0061`–`0067`,
sin `SEDE-N` en este índice — cerrado como `ARCH-37`) nunca pasó por
auditoría, y en él, 2 funciones `SECURITY DEFINER` sin filtro de sede
(`SEC-28`/`SEC-29`) más una carpeta de migraciones huérfana (`ARCH-36`).
A mitad de esa pasada, un re-clon detectó **6 commits nuevos en
paralelo** de una sesión de LS que había encontrado y corregido el mismo
problema de forma independiente y más completa (`SEDE-11`–`14`, migración
real `0068`) más `ARCH-36` ya resuelto manualmente. Reconciliado sin
pisar nada: la migración `0068` propia (menos completa) se descartó
entera a favor de la real ya en el repo; solo `UX-31` (mensaje de error
sin traducir) seguía sin resolver y se aplicó sobre el HEAD real
(`07042f4`). Ver § Sistema multi-sede para el detalle completo de
`SEDE-1`–`14`.

**Nota de proceso (3 de agosto):** antes de aplicar `UX-29`, se detectaron
14 commits en paralelo no hechos en esta sesión — incluyendo un fix
legítimo de `useAuth.js` ("Improve session management on user sign-in",
bug de "micro refresh" al loguear, de LS) y, más importante, que `ARCH-34`
se había marcado ✅ cerrado en este índice **sin que el guard llegara al
`ci.yml` real del repo** — mismo patrón que `ARCH-29`/`ARCH-31`. Se
verificó archivo por archivo cuáles de los 5 archivos que toca `UX-29`
(`time.js`, `turno.js`, `conflictos.js` + sus tests) habían sido tocados
por los commits en paralelo (ninguno lo fue — confirmado con
`git log -- <archivo>`) antes de aplicar el fix sobre el HEAD real, y se
corrió la suite completa junto con el `useAuth.js` nuevo para confirmar
que conviven sin fricción.

`UX-13` (modo oscuro) sigue ⛔ revertido a pedido de LS — decisión de
producto, no hallazgo pendiente.

Esto no significa que no vaya a aparecer nada nuevo — CodeQL corre en cada
push/PR y semanalmente por cron (`SEC-20`), así que conviene revisar
Security → Code scanning periódicamente en vez de asumir que 0 hallazgos
abiertos es un estado permanente.

Pendiente (no verificable desde este entorno, `curl` a `supabase.com`
devuelve 403 por la política de red del sandbox): aplicar `0059`/`0060`
contra el proyecto Supabase real, y confirmar en el dashboard que
`pg_cron` (`SEC-21`) y el rate limiting nativo de Auth (`SEC-7`) siguen
activos.

---

## 🔐 Seguridad y RLS

Esquema `SEC-N`. Fusiona lo que antes eran 4 esquemas paralelos (`S-N`,
`SEC-N`, `V-N`, `D-N`) — ver tabla de equivalencias al final.

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **SEC-1** | RLS nunca habilitado en tabla padre particionada `horarios` — cualquier autenticado podía escribir cualquier programa | `horarios` (padre + particiones) | `0035`, `0045` | ✅ Cerrado |
| **SEC-2** | `docentes`/`materias`: política `FOR ALL` solo exigía rol autenticado, sin permiso granular (severidad reportada externamente mayor a la real — RLS y bloqueo `anon` ya activos) | `docentes`, `materias` | `0046` | ✅ Cerrado |
| **SEC-3** | Estilos inline bloqueaban CSP estricta | Todo `src/` — ver `UX-5` | — | ✅ Cerrado (5 jul) — `unsafe-inline` retirado de `style-src`; `ModalRol.jsx` restringido a 10 presets de color |
| **SEC-4** | Stack trace completo visible en producción | `ErrorBoundary.jsx` | — | ✅ Cerrado (solo se renderiza en dev) |
| **SEC-5** | Sin validación centralizada de fortaleza de contraseñas | `src/utils/password.js` | — | ✅ Cerrado |
| **SEC-6** | Lockout de login en `localStorage` no resistía pestañas privadas | `LoginScreen.jsx`, `pinOffline.js` | — | ✅ Cerrado (migrado a IndexedDB) |
| **SEC-7** | Sin respaldo server-side del lockout de `SEC-6` | `LoginScreen.jsx`, RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado. No reemplaza el rate limiting nativo de Supabase Auth — verificar que siga activo en el dashboard |
| **SEC-8** | `login_attempts` con INSERT abierto a `public` (`WITH CHECK (true)`) — cualquiera podía forzar bloqueo de otra cuenta | `login_attempts` | `0048` | ✅ Cerrado |
| **SEC-9** | 4 funciones con `REVOKE ALL` original pero ejecutables por `anon` en BD real (drift) | 4 RPCs (ver historial) | `0049` | ✅ Cerrado |
| **SEC-10** | INSERT/DELETE de `horarios` sin permiso granular | `horarios` | `0035` | ✅ Cerrado (misma causa raíz que `SEC-1`) |
| **SEC-11** | RLS de `qr_sessions`/`asistencias_diarias` sin permisos granulares | `qr_sessions`, `asistencias_diarias` | `0036` | ✅ Cerrado |
| **SEC-12** | `crear_qr_session()` solo validaba rol, no permiso `puedeGestionarQR` | RPC `crear_qr_session` | `0035` | ✅ Cerrado |
| **SEC-13** | Sin rate limiting en `registrar_asistencia()` | `registrar_asistencia`, `scan_rate_limit` | `0039`, `0040` | ✅ Cerrado |
| **SEC-14** | 2 CVEs "alta severidad" reportadas para `xlsx` | `package.json` | `0.20.3` | ✅ Cerrado — falso positivo (verificado contra advisories oficiales de SheetJS): ambas ya corregidas antes de `0.20.3`; `package.json` apunta al tarball oficial, no al paquete npm abandonado. No se migra a `exceljs` |
| **SEC-15** | `admin_caller_puede_gestionar_usuarios()` no comparaba rol actor vs. objetivo — escalada de privilegios (cualquier rol con el permiso podía crear/editar admins) | 5 RPCs `admin_*`, `api/admin-users.js` | `0050` | ✅ Cerrado — helper `admin_caller_es_admin()` como guard en las 5 RPCs y en `admin-users.js` |
| **SEC-16** | `api/admin-users.js` (Service Role Key) sin rate limit propio | `api/admin-users.js`, `admin_actions_rate_limit` | `0051` | ✅ Cerrado — 10 acciones/min por `actor_id` |
| **SEC-17** | 4 RPCs de sesión ejecutables por `anon` sin `REVOKE` explícito (mismo patrón `SEC-9`) | 4 RPCs de sesión | `0052` | ✅ Cerrado — resuelto vía `pg_proc` real, no asumido |
| **SEC-18** | `npm audit`: 2 CVEs en `vite`/`esbuild`, solo afectaban el dev server | `package.json` | — | ✅ Cerrado (11 jul) — `vite@^6.4.3` (dentro del rango soportado por los plugins instalados, evita el salto mayor que rompía el build) |
| **SEC-19** | `api/admin-users.js` sin cabeceras CORS propias | `api/admin-users.js` | — | ✅ Cerrado (12 jul) — validación de `Origin` vs `req.headers.host`, 403 si no coincide |
| **SEC-20** | Sin SAST sobre código propio en CI | `.github/workflows/codeql.yml` | — | ✅ Cerrado (13 jul) — job CodeQL separado y no bloqueante. **Ver `SEC-23`**: primera corrida real aún sin confirmar |
| **SEC-21** | Sesión nunca expiraba sola (persistSession + timeout solo en memoria del componente) | `useAuth.js`, `auth.sessions` | `0053`, `0055` | ✅ Cerrado (10 jul) — 2 capas: client (timeout persistido en `localStorage` + time-box 10h) y server (`pg_cron` cada 15min purga sesiones vencidas). Pendiente en dashboard Supabase (no es migración): confirmar `pg_cron` habilitado |
| **SEC-22** | Sin política documentada de rotación de `SUPABASE_SERVICE_ROLE_KEY` | `docs/SECURITY.md` | — | ✅ Cerrado (13 jul) — sección nueva con casos de rotación y pasos concretos |
| **SEC-23** | Ver detalle en `SEC-25` — la corrida real de CodeQL que faltaba confirmar ya ocurrió | `.github/workflows/codeql.yml` | — | ✅ Cerrado (16 jul) — primera corrida real de CodeQL flageó 2 alertas High ("DOM text reinterpreted as HTML" vía `document.write()`), ambas triadas y resueltas — ver `SEC-25` |
| **SEC-24** | La CSP de `vercel.json` es estricta pero no tenía endpoint de reporte (`report-uri`/`report-to`) | `vercel.json`, `api/csp-report.js` | — | ✅ Cerrado (15 jul) — endpoint público sin auth (inserta en `audit_logs` vía Service Role), rate limit 20 req/min por IP (best-effort en memoria, no persistente entre instancias serverless), 8 tests nuevos |
| **SEC-25** | Las 2 alertas High de la primera corrida real de CodeQL (`SEC-23`), ambas "DOM text reinterpreted as HTML" vía `document.write()`, investigadas por separado en vez de asumir un veredicto compartido | `exportPDF.js`, `PlanillaImprimibleBase.jsx` | — | ✅ Cerrado (16 jul) — **`exportPDF.js`: falso positivo parcial** (mismo patrón que `SEC-2`/`SEC-14`): ya escapaba casi todo con su `ESC()` local; el único hueco (`programa` en `exportarPDFDiario`) solo puede venir de un `<select>` de opciones fijas, nunca texto libre — no explotable en la práctica, pero se escapó igual por defensa en profundidad. **`PlanillaImprimibleBase.jsx`: vulnerabilidad real** — sin ningún escapado; docente/materia/sección/programa (datos reales de cargas masivas de Excel vía `useUpload.js`) se interpolaban crudos en el HTML de `document.write()` — XSS almacenado de segundo orden explotable con un nombre de docente/materia cargado con HTML/script. Mismo helper `ESC()` agregado, las 4 interpolaciones escapadas. 2 tests de regresión nuevos confirmando que un payload `<script>`/`<img onerror>` llega escapado al HTML impreso. 181/181 tests, 0 errores de lint, build limpio |
| **SEC-26** | `npm audit --omit=dev --audit-level=high` en CI fallaba con 3 vulnerabilidades (2 High: `brace-expansion` DoS, `svgo` `removeScripts` incompleto; 1 Moderate: `tar` recursión no acotada) | `package.json`, `package-lock.json` | — | ✅ Cerrado (1 ago) — ninguna de las 3 viene de una dependencia real del proyecto: las tres son transitivas de `svgtofont` (herramienta de build interna de `@tabler/icons-webfont`, declarada como `dependencies` de ese paquete, no `devDependencies`). Verificado que sigmapnf **no usa el paquete npm en absoluto** — los íconos se sirven desde `public/fonts/tabler-icons.min.css`/`.woff2`, archivos estáticos ya generados y versionados en git, enlazados directo desde `index.html` (`grep` exhaustivo fuera de `node_modules`: cero referencias en JS/CSS/scripts de build). El paquete quedó en `dependencies` desde que se usó una vez para generar esos archivos. Fix: `npm uninstall @tabler/icons-webfont`. `npm audit --omit=dev --audit-level=high` → 0 vulnerabilidades, exit 0. 185/185 tests, 0 errores de lint, build idéntico (mismo `dist/`, mismo precache de PWA) |
| **SEC-27** 🟢 | Carga de Excel (`useUpload.js`) valida el archivo solo por extensión/mimetype del navegador, sin verificar el contenido real antes de pasarlo a `XLSX.read()` — un archivo renombrado a `.xlsx` sin serlo llega hasta el parser | `useAppData/useUpload.js` | ✅ Cerrado (2 ago) — chequeo de magic bytes antes de invocar el parser: `.xlsx` valida firma ZIP (`PK\x03\x04`/`\x05\x06`/`\x07\x08`), `.xls` valida firma OLE2/CFB (`D0 CF 11 E0 A1 B1 1A E1`); lectura de los primeros 8 bytes vía `FileReader.readAsArrayBuffer()` (no `Blob.slice().arrayBuffer()` — incompatible con jsdom/algunos entornos), mensaje accionable si no coincide. 2 tests de regresión nuevos (rechaza contenido falso sin invocar al parser, acepta `.xlsx` real). 213/213 tests, 0 errores de lint, build limpio |
| **SEC-28** 🔴 | `admin_borrar_asistencias_rango()` (`SECURITY DEFINER`, se salta el RLS por sede de `0063`) validaba `puedeBorrarReportes` pero no la sede del actor — un rol con ese permiso en UNA sede podía borrar `asistencias_diarias` de TODAS las sedes por rango de fecha/turno/programa | `admin_borrar_asistencias_rango` (`0054`) | `0068` | ✅ Cerrado (6 ago) — ver `SEDE-13`: encontrado en paralelo por una auditoría externa y por LS el mismo día; la migración real que lo cierra es la de `SEDE-11`–`14` |
| **SEC-29** 🔴 | `admin_borrar_qr_sesiones()` (`SECURITY DEFINER`) borraba por array de UUIDs sin verificar que pertenecieran a la sede del actor — mismo patrón que `SEC-28`, menos explotable (requiere conocer IDs de otra sede) pero mismo hueco de diseño | `admin_borrar_qr_sesiones` (`0054`) | `0068` | ✅ Cerrado (6 ago) — ver `SEDE-13`. `admin_borrar_session_logs()` se revisó y queda fuera de alcance a propósito: `session_logs` (`0031`) no tiene columna `sede_id` |

## 🔎 Filtrado de datos por permiso/programa

Esquema `PERM-N` (antes disperso entre `V-3` y parte de `D-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **PERM-1** | Pestañas de `AsistenciasModulo` no filtradas por permisos individuales | `src/app/AsistenciasModulo.jsx` | ✅ Cerrado |
| **PERM-2** | Mismo problema que `PERM-1`, en `LogsView` | `src/components/LogsView.jsx` | ✅ Cerrado |
| **PERM-3** | `HistorialView` no respetaba `restringe_programa` | `src/components/HistorialView.jsx` | ✅ Cerrado |
| **PERM-4** | `exportarDatos()` consultaba una tabla `asistencias` inexistente | `src/hooks/useAppData/backupActions.js` | ✅ Cerrado (corregido a `asistencias_diarias`) |

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
| **OFF-9** 🟢 | Rate limit de `api/csp-report.js` (`SEC-24`) vivía en `Map()` en memoria del proceso — no persiste entre instancias serverless de Vercel, eludible repartiendo requests | `api/csp-report.js`, migración `0060` | ✅ Cerrado (2 ago) — contador movido a tabla `csp_report_rate_limit` vía RPC (mismo patrón que `SEC-16`), fail-open si la RPC falla. Verificado contra Postgres real: 20/21 llamadas → `true`, la 21ª → `false` |

## 🏗️ Arquitectura, testing y concurrencia

Esquema unificado `ARCH-N` — antes 3 esquemas distintos (`A1`/`A2`/`A3` sin
guion, `A-2`..`A-5` con guion, `ARCH-4`..`ARCH-19`). Ver tabla de
equivalencias al final.

### Concurrencia y datos asíncronos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-1** | Colisión de nombres entre stores IndexedDB — crasheaba el bundle de producción (TDZ) | `pinOffline.js`, `offlineQueue.js`, `reporteCache.js` | ✅ Cerrado (prefijos únicos) |
| **ARCH-2** | Sin paginación por cursor en `ReporteRango` | `ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado — el fix original asumía IDs enteros; bug real corregido después en `UX-15` (`asistencias_diarias.id` es UUID) |
| **ARCH-3** | Sin guardia de sanidad si el cursor de paginación no avanza | `useAppData/useDataSync.js` | ✅ Cerrado (retirada al pasar `ARCH-2`/`UX-15` a paginación por offset) |
| **ARCH-4** | Sin `AbortController` — fetches obsoletos podían sobreescribir estado más reciente | `ReporteRango.jsx`, `useQRSession.js` | ✅ Cerrado |
| **ARCH-5** | Sin limpieza de datos al iniciar un fetch sin caché | `ResumenView.jsx`, `useDataSync.js` | ✅ Cerrado |

### Testing, código muerto y estructura de componentes

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-6** | `log_audit_event` sin registrar rol/programa del actor | migración `0025` | ✅ Cerrado |
| **ARCH-7** | Sin cobertura de tests para lógica crítica (`useAuth`, cola offline) | `useAuth.test.js`, `offlineQueue.test.js` | ✅ Cerrado |
| **ARCH-8** | Sin tests de integración para hooks compuestos ni flujos completos (escaneo QR, horarios, usuarios) | `PestanaUsuarios.integration.test.jsx`, `DocenteScan.flow.test.jsx` + 5 tests de orquestación | ✅ Cerrado — 152/152 tests |
| **ARCH-9** | CSS embebido de `QRProyeccion.jsx` con el stylesheet duplicado en el mismo template literal | `asistencias/QRProyeccion.jsx` | ✅ Cerrado (5 jul, junto con `SEC-3`) — extraído a `QRProyeccion.css` |
| **ARCH-10** | Bundle sin dividir por ruta — chunk principal de 514 KB | `vite.config.js`, vistas grandes de `HorariosLayout.jsx` | ✅ Cerrado (9 jul) — `lazy()`+`Suspense` en vistas grandes; `ResumenView` estática a propósito (vista por defecto). 503→468 KB |
| **ARCH-11** | `HorariosLayout.jsx` (561 líneas) y `App.jsx` (353 líneas) concentraban layout, navegación y sesión | `src/app/HorariosLayout.jsx`, `src/App.jsx` | ✅ Cerrado — `HorariosSidebar.jsx`/`HorariosTopbar.jsx` extraídos; 561→293 y 353→338 líneas |
| **ARCH-12** | Código muerto: ningún archivo lo importaba/renderizaba | `src/components/ResponsiveStyles.jsx` | ✅ Cerrado — eliminado |
| **ARCH-13** | `HistorialView.jsx` (637), `LogsView.jsx` (517), `LoginScreen.jsx` (508) — mismo problema que `ARCH-11` | `src/components/{HistorialView,LogsView,LoginScreen}.jsx` | ✅ Cerrado (9 jul noche) — cada uno dividido en orquestador + subcomponentes presentacionales (`historial/`, `login/`, `logs/`). Extracción 1:1 verificada línea por línea |
| **ARCH-14** | `api/admin-users.js` repetía el mismo bloque fetch/headers/parseo 13 veces | `api/admin-users.js` | ✅ Cerrado (11 jul) — extraído `supabaseAdminFetch(path, options)`, 13 llamadas migradas 1:1 |
| **ARCH-15** | Chunk `view-qr` pesaba 320 KB — `vite.config.js` forzaba `AdminQRPanel`/`QRProyeccion`/`ReporteAsistencias` a un único `manualChunks`, anulando su `lazy()` individual | `vite.config.js`, `AdminQRPanel.jsx`, `QRProyeccion.jsx` | ✅ Cerrado (12 jul) — extraído código compartido a `QRDisplay.jsx` (import estático cruzado era la causa real). 3 chunks reales: admin 19 KB, proyección 6.5 KB, reporte 37.8 KB |
| **ARCH-16** | Suite de tests dependía de un tarball externo (`cdn.sheetjs.com`) para `xlsx` sin fallback — fallaba en redes restringidas | `package.json`, `vendor/xlsx-0.20.3.tgz` | ✅ Cerrado (12 jul) — tarball vendorizado con hash SHA-256 documentado en `vendor/README.md` |
| **ARCH-17** | **Más grave que `ARCH-15`**: Rollup metía el cliente de Supabase, logger y utils usados por *toda la app* dentro del chunk `view-qr` — cualquiera que abre el login ya descargaba los 320 KB de QR | `vite.config.js` (`manualChunks`) | ✅ Cerrado (12 jul) — `manualChunks` de forma objeto a función; grafo real de módulos (`getModuleInfo()`) usado para encontrar los 8 módulos a extraer. `vendor-supabase` (214 KB) y `vendor-core` (9 KB) separados. `view-qr` 320→90 KB; también corrigió el mismo problema no documentado en `view-historial` |
| **ARCH-18** | `AdminQRPanel.jsx` volvió a crecer a 685 líneas | `AdminQRPanel.jsx`, `adminQR/HistorialSesiones.jsx`, `adminQR/ConfirmBorrarSesionModal.jsx` | ✅ Cerrado — mismo patrón que `ARCH-11`/`ARCH-13`: 685→543 líneas |
| **ARCH-19** | Sin ESLint ni Prettier configurados, sin paso de lint en CI | `eslint.config.mjs`, `package.json`, `ci.yml` | ✅ Cerrado (12 jul) — flat config, 3 plugins mínimos (`@eslint/js`, `react-hooks` solo 2 reglas, `react-refresh`). 31 errores reales corregidos (código muerto/imports), 33 warnings no bloqueantes quedan a propósito. `npm run lint` bloqueante en CI. 2 inconsistencias de comportamiento encontradas en la limpieza **no se tocaron** aquí — derivaron en `ARCH-22` y `UX-14` |
| **ARCH-20** | Cero uso de PropTypes/TypeScript | 8 componentes más reutilizados (`QRDisplay`, `Avatar`, `ModalUsuario`, etc.) | ✅ Cerrado — `propTypes` agregado, cada `shape` verificado contra call sites reales, no adivinado |
| **ARCH-21** | Chunk principal (446 KB) pesado incluso solo para ver el login | `useAppData/useUpload.js`, `vite.config.js` | ✅ Cerrado (13 jul) — medido con `rollup-plugin-visualizer`: culpable real era `xlsx`/SheetJS (750 KB) importado estático, no `@tabler/icons-webfont` como se sospechaba. Cambiado a `import()` dinámico en los 2 puntos de uso real. 447→74 KB (-83%) |
| **ARCH-22** | `UploadPreviewModal.jsx`: el toggle "mostrar X más" no hacía nada — la agrupación real usaba `rows` completo, no `visible` (no es bug de linting, por eso no se tocó junto a `ARCH-19`) | `UploadPreviewModal.jsx`, `.css` | ✅ Cerrado (13 jul) — decisión de LS: retirado `expanded`/`hasMore`/`visible` y el botón muerto, en vez de arreglar un límite que nunca se pidió |
| **ARCH-23** | `DocenteScan/index.jsx` a 525 líneas — mismo problema ya corregido 3 veces antes, nunca aplicado aquí | `asistencias/DocenteScan/index.jsx` | ✅ Cerrado (15 jul) — dividido en orquestador (342 líneas) + `PasoValidacionCedula.jsx` + `PasoRegistro.jsx`, mismo patrón que `ARCH-13`/`ARCH-18` |
| **ARCH-24** | Chunk principal creció de 74.47 KB a 134.61 KB desde `ARCH-21`, sin que nadie lo revisara tras `ADMIN-3/4/5` | `vite.config.js`, `src/App.jsx` | ✅ Cerrado (15 jul) — corrección de premisa: ninguno de los 3 módulos raíz era `lazy()` (no solo `AdminModulo` como decía el hallazgo). `AsistenciasModulo`/`AdminModulo` convertidos a `lazy()`; `HorariosLayout` estático a propósito (entrada por defecto). 134.75→128.76 KB (~4.4%) |
| **ARCH-25** | `ReporteRango.jsx` (el mismo componente del bug real `UX-15`), `AdminModulo.jsx`/`ModuleSelector.jsx` (deciden qué módulos ve cada rol) sin tests dedicados | `ReporteRango.jsx`, `AdminModulo.jsx`, `ModuleSelector.jsx` | ✅ Cerrado (15 jul) — 18 tests de integración nuevos (render real con `@testing-library/react`) |
| **ARCH-26** | `VistaAusentes.jsx` pedía siempre el catálogo completo de `docentes` como fallback de resolución de nombre, aunque el 100% de las clases ya tuvieran `docente_id` vinculado (el fallback es el caso raro, no el común) | `ReporteAsistencias/VistaAusentes.jsx` | ✅ Cerrado (1 ago) — el catálogo solo se pide si `clases.some(c => !c.docente_id)`. 3 tests de integración nuevos cubriendo ambas ramas (con/sin fallback) y el filtrado de presentes |
| **ARCH-27** | `ReporteRango.jsx` paginaba hasta 20.000 filas crudas de `asistencias_diarias` (bloques de 1000) y agrupaba por docente en el cliente — mucho tráfico de red y varias idas y vueltas sin feedback de progreso para el usuario | `ReporteRango.jsx`, migración `0055` (RPC `reporte_asistencias_rango_agregado`) | ✅ Cerrado (1 ago) — agregación `GROUP BY cedula_docente` server-side (`SECURITY INVOKER`, respeta el RLS de `SEC-11` sin cambios de superficie de seguridad). Elimina también el límite de 20.000 filas y el aviso de "resultado truncado" (ya no aplica: no se transfieren filas individuales). Conteo liviano (`head: true`) agregado aparte solo para el texto del modal de borrado, que sigue operando sobre registros individuales. **Nota:** el índice de auditoría ya referenciaba una migración "0055" (pg_cron de `SEC-21`) sin archivo en el repo — verificar contra la BD real antes de aplicar, ver comentario en la migración |
| **ARCH-28** | `filtrados`/`diasHabiles` (`ReporteRango.jsx`) y `filtrados` (`ReporteAsistencias/index.jsx`) se recalculaban en cada render sin memoizar, aunque sus dependencias reales no cambiaran | `ReporteAsistencias/index.jsx`, `ReporteRango.jsx` | ✅ Cerrado (1 ago) — `useMemo` con las dependencias reales en los 3 casos |

<!-- Nota de recuperación (2 ago): ARCH-23–ARCH-28 se habían perdido en el
     commit 4d9ca67 (truncó el archivo a mitad de ARCH-21) y el intento de
     reponerlas en fa450ea también quedó cortado a mitad de frase.
     Reconstruidas aquí contra 92d1fd3, último commit con el archivo íntegro
     — texto idéntico, no reescrito. -->

| **ARCH-30** 🟡 | `HorariosLayout.jsx` (shell de los módulos resumen/horarios/secciones/docentes/materias/asistencias) no tenía `ErrorBoundary` propio — un crash de render en cualquiera de esas vistas escalaba hasta el `ErrorBoundary` global de `main.jsx`, tumbando toda la app (sidebar y topbar incluidos) en vez de quedar contenido en el área de contenido | `src/app/HorariosLayout.jsx` | ✅ Cerrado (2 ago) — mismo patrón ya usado en `AsistenciasModulo.jsx`/`AdminModulo.jsx`: `ErrorBoundary` local envolviendo el `<main className="hl-main">`, no el layout completo. Sidebar/topbar siguen operativos aunque una vista crashee. 211/211 tests preexistentes sin romper, 0 errores de lint, build limpio |
| **ARCH-31** 🔴 | Reabre `ARCH-29`/`UX-24`: el bloqueo optimista de `saveClase()` (`horarioEditing.js`) condiciona el `UPDATE` a `.eq("updated_at", expectedUpdatedAt)`, pero la migración `0057` que ese fix citaba (columna `updated_at` + trigger server-side en `horarios`) nunca se había subido al repo — `entry.updated_at` llegaba `undefined` en producción y el guard se degradaba siempre a "sin condición extra", el mismo comportamiento inseguro que `ARCH-29` describía como bloqueante | `docs/supabase/migrations/0057_arch29_bloqueo_optimista_horarios.sql` (nueva) | ✅ Cerrado (2 ago) — migración subida: `ALTER TABLE horarios ADD COLUMN updated_at` + función/trigger `set_updated_at()` `BEFORE UPDATE` sobre el padre (Postgres 11+ propaga triggers `FOR EACH ROW` de una tabla particionada declarativa a todas sus particiones automáticamente, sin loop). Verificado contra la BD real, no asumido: `SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE tgname = 'trg_horarios_set_updated_at'` devuelve 8 filas — el padre `horarios` + las 7 particiones reales (`horarios_lapso_1_2026`...`horarios_lapso_default`). Confirmado también que `useDataSync.js` usa `select("*, ...")` en el fetch que puebla `ModalEditarClase`, así que `entry.updated_at` llega poblado al cliente. 211/211 tests, 0 errores de lint, build limpio |
| **ARCH-32** 🟢 | `registrar_asistencia()` (`SEC-13`/migración `0039`) usa un límite fijo (10 intentos/hora por `device_fingerprint`) sin backoff exponencial — un dispositivo legítimo con mala señal que reintenta agresivamente en un operativo real puede auto-bloquearse antes de llegar al límite por abuso genuino | `scan_rate_limit`, RPC `registrar_asistencia`, migración `0058` | ✅ Cerrado (2 ago) — backoff progresivo: la primera vez que un dispositivo supera el límite recibe un bloqueo corto (2 min); si reincide después de que ese bloqueo expira, el bloqueo se duplica (4, 8, 16... techo de 60 min). `veces_bloqueado` decae a 0 tras 24h sin bloqueos nuevos. **No se pudo probar contra Supabase real desde este entorno** (mismo patrón que `SEC-9`/`SEC-17`) — migración incluye escenario de verificación manual |
| **ARCH-33** 🔴 | Migración `0058` (de `ARCH-32`) reemplazó el UPSERT atómico de `0039` por `SELECT FOR UPDATE`+`INSERT` suelto en `registrar_asistencia()` — condición de carrera real: 2 llamadas concurrentes del mismo `device_fingerprint` sin fila previa chocan por PK | RPC `registrar_asistencia`, migración `0059` | ✅ Cerrado (2 ago) — reproducido contra Postgres 16 real (`duplicate key value violates unique constraint "scan_rate_limit_pkey"`), corregido con `INSERT ... ON CONFLICT DO UPDATE` (vuelve al patrón de `0039`). Reverificado bajo concurrencia real: 15 llamadas → 5 bloqueadas, escalada de `veces_bloqueado` correcta |
| **ARCH-34** 🟢 | Sin guardia de CI que impidiera reintroducir herramientas de build-time (causa raíz de `SEC-26`) como `dependencies` en vez de `devDependencies` | `.github/workflows/ci.yml` | 🔴 Reabierto como `ARCH-35` (3 ago) — se había marcado ✅ cerrado sin que el guard llegara realmente al `ci.yml` del repo |
| **ARCH-35** 🟢 | Reabre `ARCH-34`: mismo patrón que `ARCH-29`→`ARCH-31` (hallazgo cerrado en el índice, nunca aplicado al código real) — verificado esta vez contra el archivo, no solo el índice | `.github/workflows/ci.yml` | ✅ Cerrado (3 ago) — guard reaplicado y confirmado presente en el archivo real; `node -e` de verificación corrido contra el `package.json` actual: pasa |
| **ARCH-36** 🔴 | Las migraciones `0066`/`0067` vivían en `supabase/migrations/`, una carpeta distinta a la secuencia real (`docs/supabase/migrations/`), sin `config.toml` de Supabase CLI ni referencia en ningún script de CI — riesgo de que se aplicaran fuera de orden o nunca (mismo patrón de fondo que `ARCH-29`/`34`) | `supabase/migrations/`, `.github/workflows/ci.yml` | — | ✅ Cerrado (6 ago) — `0066`/`0067` movidas a `docs/supabase/migrations/` y la carpeta huérfana `supabase/` eliminada (commits `72985d7`, `1ca22cd`, `07042f4`), más guard nuevo en CI que falla el build si vuelve a aparecer un `.sql` de migración fuera de `docs/supabase/migrations/`. Probado contra el estado real del repo: pasa limpio |
| **ARCH-37** 🔴 | El sistema de Sedes completo (`SEDE-1`–`14`, migraciones `0061`–`0068`, ~25 archivos de frontend con `sede_id`) nunca se registró en este índice, violando la metodología que el propio documento se auto-impone — causa raíz por la que `SEC-28`/`SEC-29`/`ARCH-36` pasaron sin auditar | `docs/AUDITORIA_INDICE.md` | — | ✅ Cerrado (6 ago) — nueva sección `§ Sistema multi-sede (SEDE-N)` documenta las 14 pasadas; auditadas también las ~50 funciones `SECURITY DEFINER` únicas definidas en el histórico de migraciones para confirmar que `SEC-28`/`SEC-29`/`SEDE-11`/`12`/`14` cubren todas las que tocaban tablas con `sede_id` sin filtro |

<!-- Nota de recuperación (2 ago, cont.): las 6 secciones siguientes (CI/CD,
     UI, Identidad visual, Funcionalidad nueva, Esquema retirado, Historial,
     Tabla de equivalencias) también se perdieron en el mismo commit
     4d9ca67; restauradas contra 92d1fd3. Su contenido narrativo (conteos de
     tests, etc.) refleja el estado al 1 de agosto, no el actual — ver
     tablas de arriba para el estado real de hoy. -->

## 🔧 CI/CD y automatización

Esquema `CI-N` (antes `FIX-CI-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **CI-1** *(no confirmado en código)* | Sin integración continua | `.github/workflows/ci.yml` | ✅ Cerrado (`npm test` + `npm run build` en cada PR/push a `main`) |
| **CI-2** | `console.log/warn/error` directos visibles en producción | `src/utils/logger.js` (14 archivos migrados) | ✅ Cerrado |
| **CI-3** | Sin `npm audit` en CI ni verificación automatizada de RLS con clave `anon` real | `.github/workflows/ci.yml`, `scripts/rls-smoke-test.mjs` | ✅ Cerrado (audit no bloqueante por `SEC-14`; smoke test bloqueante) |
| **CI-4** | 2 usos de `console.info` directo rompían la consistencia del logger | `src/main.jsx`, `src/utils/cache.js` | ✅ Cerrado (9 jul) — `logger.info()` agregado, cero `console.*` fuera de `logger.js` |

## 🎨 UI y estilos

Esquema `UX-N` (antes `U-N` + `A3` de inline styles).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **UX-1** | Estilos inline en `AdminQRPanel` — primer caso migrado, sentó el patrón de `UX-5` | `AdminQRPanel.jsx`/`.css` | ✅ Cerrado |
| **UX-2** | Desbordes de layout en viewports móviles pequeños | `AdminQRPanel.css`, `usuarios/ModalRol.jsx` | ✅ Cerrado |
| **UX-3** | Sin trampa de foco de teclado en modales | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **UX-4** | `Campo.jsx` sin `htmlFor`/`id` — lector de pantalla no anunciaba la etiqueta | `asistencias/DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()` + `aria-describedby`/`aria-invalid`) |
| **UX-5** | Migración sistemática de estilos inline a CSS externo (requisito de `SEC-3`) | Todo `src/` | ✅ Cerrado — 54→0 ocurrencias reales. `Avatar.jsx` (tono bucketizado a 24 pasos), `TurnoGrid.jsx` (`flex: 1`), `ModalRol.jsx` (10 presets) |
| **UX-6** | Los 7 archivos del shell principal (`src/app/`) nunca se auditaron para responsividad | `HorariosLayout.jsx`, `UserMenu.jsx`, `AsistenciasModulo.jsx`, `App.jsx`, `AdminMenu.jsx`, etc. | ✅ Cerrado — clases con prefijo (`hl-`, `um-`, `asm-`, `adm-`) + `@media` |
| **UX-7** | El bundle sin dividir (`ARCH-10`) alargaba la pantalla en blanco inicial | mismo que `ARCH-10` | ✅ Cerrado (mismo fix) |
| **UX-8** | `LoginFormNormal.jsx`, `LoginOfflinePinPanel.jsx`, `ModalActivarPIN.jsx` (extraídos al cerrar `ARCH-13`): `<label>` sin `htmlFor`/`id` — regresión de `UX-4` | `src/components/login/*.jsx` | ✅ Cerrado (11 jul) — mismo patrón `useId()` que `Campo.jsx` |
| **UX-9** | Solo 4/29 CSS con media queries; `HorariosView.css`/`QRProyeccion.css` sin ninguna | `HorariosView.css`, `QRProyeccion.css` | ✅ Cerrado (12 jul) — falso positivo parcial en la mitad de `QRProyeccion.css` (el responsive real ya vivía en `index.css`, luego movido en `UX-12`); `HorariosView.css` sí carecía de adaptación en la barra de filtros — `@media (max-width: 640px)` agregado |
| **UX-10** | "Panel QR" aparecía con fondo azul oscuro y título invisible — parecía regresión de un fix reciente | `AdminQRPanel.jsx`/`.css`, `QRProyeccion.jsx`/`.css` | ✅ Cerrado (12 jul) — colisión de nombres de clase preexistente (`.qrp-root` etc. duplicado entre 2 CSS con temas incompatibles, agrupados en el mismo chunk Vite). `AdminQRPanel` renombrado a prefijo `qap-` |
| **UX-11** | 24/30 archivos CSS sin `@media` — solo cobertura manual/heurística, sin regresión visual automatizada | 24 `.css`, `ci.yml`, `playwright.config.js`, `tests/visual/` | ✅ **Cerrado (16 jul)** — infraestructura Playwright (3 pantallas × 3 breakpoints) venía en `9 passed` desde el 13 jul; se confirmaron **7 corridas reales más en CI** (15–16 jul, distintos commits) todas `success`, sin ningún diff falso. Retirado `continue-on-error: true` de `ci.yml` — el job ahora bloquea el check si una imagen difiere de la base. Mock de sesión en `tests/visual/mockSupabase.js` |
| **UX-12** | Deuda cosmética de `UX-9`: reglas responsive de `.qrp-*` vivían en `index.css` en vez de `QRProyeccion.css` | `src/index.css`, `QRProyeccion.css` | ✅ Cerrado (13 jul) — ~44 líneas movidas tal cual, sin cambiar reglas |
| **UX-13** ⛔ | Sin `prefers-color-scheme` (modo oscuro) — preferencia de producto, no defecto | tokens `--color-*`/`--brand-*`, 9 `.css` de componentes | ⛔ **Revertido a pedido explícito de LS (14 jul)** — reportó menús/reportes rotos en asistencias, confirmó "no la veo necesaria". Reverso total salvo excepción quirúrgica en `ModuleSelector.css` (preservó el rediseño de `ADMIN-5`, solo revirtió el hunk del modo oscuro). Si se retoma: rehacer desde cero con verificación visual real en navegador |
| **UX-14** | `HorariosView.jsx` recibía `modoConsulta` pero no la usaba — el permiso `puedeEditarHorarios` no tenía funcionalidad real detrás (no existía edición in-line) | `HorariosView.jsx`, `TurnoGrid.jsx`, `ModalEditarClase.jsx` (nuevo), `horarioEditing.js` (nuevo) | ✅ Cerrado (15 jul) — specs de LS: edición por formulario modal (no drag-and-drop), día/bloque/aula/docente/materia + eliminar, con confirmación. Reescribe también la columna `clase` (texto crudo) para no desincronizar 6 pantallas que la leen directo sin pasar por el join. Gating de permisos separado del banner: `puedeEditar`/`puedeBorrar` independientes |
| **UX-15** | Reportado por LS: "Reporte por Rango" tiraba `invalid input syntax for type uuid: "0"` | `ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado (14 jul) — causa raíz: `asistencias_diarias.id` es UUID, no INTEGER como asumía la paginación por cursor de `ARCH-2`. Cambiado a paginación por offset (`.range()`, ordenado por `hora_registro`) |
| **UX-16** | Reportado por LS: reportes PDF se abrían sin ningún formato (texto plano) | `exportPDF.js`, `public/reporte-print.{css,js}` (nuevos) | ✅ Cerrado (14 jul) — causa raíz: la ventana de impresión (`document.write`) hereda la CSP `'self'` del documento que la abre, bloqueando en silencio el `<style>`/`<script>` inline. CSS y JS extraídos a archivos externos del mismo origen. **Sin verificar visualmente en navegador real** — recomendado que LS confirme abriendo un PDF de cada tipo |
| **UX-17** | Manifest PWA (`theme_color`/`background_color`) fijo en modo claro; en SO con modo oscuro la barra de estado/splash puede no combinar | `vite.config.js` (manifest) | ✅ **Cerrado (16 jul) — sin acción de código, misma decisión que `UX-13`**: la app es 100% de tema claro por decisión de producto, así que no hay "variante oscura" que el manifest deba reflejar. El manifest ya es correcto para el único tema que existe (`#1E3A8A`/`#ffffff`, coinciden con la marca). Reabre solo si se retoma `UX-13` |
| **UX-18** | `ModuleSelector.css` con comentario obsoleto sobre el mecanismo `prefers-color-scheme` de `UX-13` (revertido) | `ModuleSelector.css` | ✅ **Cerrado (16 jul)** — comentario reescrito: ya no cita el mecanismo concreto (removido de `index.css` con el reverso), explica en cambio por qué se usa `--navy-900` en vez de `--color-text-primary` (splash de marca fijo, no debe depender de ningún tema futuro) |
| **UX-19** | "Cambiar módulo" era botón visible en Asistencias/Admin pero enterrado en dropdown en Horarios | `HorariosTopbar.jsx`, `UserMenu.jsx`, `AsistenciasModulo.jsx`, `AdminModulo.jsx` | ✅ Cerrado (14 jul) — unificado hacia botón "← Módulos" en topbar de los 3 módulos, clase compartida `.topbar-back-btn`. Llevó a revisar el sidebar de Horarios — ver `UX-20` |
| **UX-20** | Sidebar de Horarios con solo 5 ítems tras `ADMIN-3`, se sentía subutilizado; código muerto encontrado: `hasBadge` nunca se activaba | `buildNavGroups.js`, `HorariosSidebar.jsx` | ✅ Cerrado (14 jul) — se descartaron 2 propuestas (mini-panel, conteo por ítem) por duplicar info ya visible en otro lado; único cambio real: reactivar `hasBadge: true` en "Horarios" |
| **UX-21** | Estado de conexión solo visible dentro de un dropdown, a diferencia de la caja de trimestre siempre visible | `HorariosSidebar.jsx`, `AdminMenu.jsx`, `index.css` | ✅ Cerrado (14 jul) — `.hl-status-box` nueva en sidebar (mismo trato que `hl-lapso-box`), quitado el bloque equivalente del dropdown |
| **UX-22** | Reportado por LS desde móvil: dropdown de Administración no cerraba al tocar el botón de nuevo (condición de carrera con el listener de "clic afuera") | `AdminMenu.jsx` | ✅ Cerrado (14 jul) — listener ignora clics sobre `.hl-admin-btn`, el botón es la única fuente de verdad de su toggle |
| **UX-23** | Reportado por LS: contador de permisos del admin mostraba "17/15" | `usuarios/shared.jsx` | ✅ Cerrado (15 jul) — `GRUPOS_PERMISOS` (catálogo de UI) le faltaban `puedeBorrarSesiones`/`puedeBorrarReportes`, ya funcionales en código pero sin checkbox en el editor de roles |
| **UX-25** 🟢 | `DocenteScan` encola registros en IndexedDB cuando no hay red (`OFF-7`), pero no muestra un contador visible de cuántos quedan pendientes de sincronizar — un operador de QR en un operativo real con conexión inestable y fila de docentes no tiene forma de saber si sus escaneos ya se confirmaron contra el servidor | `asistencias/DocenteScan/index.jsx`, `Shell.jsx`, `utils/offlineQueue.js` | ✅ Cerrado (2 ago) — badge `role="status" aria-live="polite"` agregado en `Shell.jsx` (el único wrapper común a las ~10 pantallas de `DocenteScan`, evita enhebrar la prop por cada call-site). Autocontenido: lee `contarPendientes()` al montar y se refresca sin polling escuchando un evento DOM nuevo (`sigma:cola-offline-cambio`) que `offlineQueue.js` dispara en `encolarAsistencia()`/`eliminarPendiente()`/`purgarExpirados()`, más `online`/`offline` como respaldo. 8 tests nuevos (5 de integración sobre `Shell`, 3 de regresión sobre el evento). 219/219 tests, 0 errores de lint, build limpio |
| **UX-26** 🟢 | `useDataSync.js`: `useEffect` de la suscripción realtime sin `userId`/`setConflictsRefreshKey` en deps — un cambio de usuario dejaba el closure de `limpiarCache(userId)`/`limpiarCacheNombres(userId)` con el id viejo | `src/hooks/useAppData/useDataSync.js` | ✅ Cerrado (2 ago) — deps agregadas (`setConflictsRefreshKey` es un setter de `useState`, estable). 0 warnings nuevos de `exhaustive-deps` en ese efecto |
| **UX-27** 🔴 | Recurrencia del bug `fecha-hoy-timezone` (ver `utils/time.js`): `ReporteRango.jsx` calculaba el "lunes de esta semana" con `new Date()` crudo (UTC en producción) mientras `fin` ya usaba `fechaHoyVE()` — entre 8pm y medianoche hora VE, el reporte quedaba vacío sin ningún error visible, todas las noches, en esa ventana de ~4h | `ReporteAsistencias/ReporteRango.jsx` | ✅ Cerrado (2 ago) — encontrado porque `ReporteRango.integration.test.jsx` empezó a fallar de forma reproducible exactamente en esa ventana; corregido derivando "lunes" de la misma fecha VE que "hoy". `grep` confirmó que era la única ocurrencia restante del patrón en `src/` |
| **UX-28** 🔴 | Reportado por LS: *"probé a editar una clase y la siguiente se movía al lugar de la que edité, y cuando probé a agregarla nuevamente a la hora original, no apareció"* — `TurnoGrid.jsx` marcaba como "ocupados" los bloques cubiertos por el `rowSpan` de una clase y descartaba en silencio cualquier OTRA clase que empezara en uno de esos bloques, aunque siguiera intacta en `horarios` | `TurnoGrid.jsx`, `TurnoGrid.css` | ✅ Cerrado (2 ago) — reproducido sintéticamente antes de tocar código. Fix: las clases tapadas se fusionan en la celda que las tapa, marcada visualmente como conflicto (⚠️ + `--color-danger-bg`, mismas variables que `ConflictosView.css`) en vez de desaparecer. 3 tests nuevos (`TurnoGrid.test.jsx`). 224/224 tests, 0 errores de lint, build limpio |
| **UX-29** 🔴 | Reportado por LS tras `UX-28` (con screenshot): el bug persistía en un caso distinto — al mover una clase de día, la clase VECINA (con `hora` en formato compartido, ej. `"3:15-5:30PM"` sin AM/PM en el inicio — atajo común en carga manual) se veía "subir" a ocupar toda la columna desde la primera fila del turno, aunque su horario real no había cambiado | `utils/time.js`, `utils/turno.js`, `utils/conflictos.js` | ✅ Cerrado (3 ago) — causa raíz real: `timeToMin("3:15")` (sin sufijo) no matchea el regex y devuelve `0` en silencio; ese `0` se usaba tal cual en `findStartBlock`/`countBlocks`, posicionando la clase en el primer bloque del turno con un `span` estirado a toda la grilla. Nueva función `partesHoraNormalizadas()` (hereda el AM/PM del final si el inicio no trae el suyo) usada en las 5 funciones que antes duplicaban el mismo parseo por separado, incluyendo `parseRango` (`conflictos.js`) — que ya se protegía de este caso descartándolo (`if inicio===0 return null`), así que estos conflictos tampoco se detectaban en la pestaña Conflictos hasta este fix. Reproducido el caso exacto del screenshot de LS (mismos nombres/horas) antes y después del fix. 9 tests nuevos (`turno.test.js`, `conflictos.test.js`). 232/232 tests, 0 errores de lint, build limpio |
| **UX-30** 🔴 | Reportado por LS: PNF Agroalimentación (Cabimas) maneja horas distintas al resto de los PNF — turno único "MIXTO" continuo 7:00am-4:00pm (sin el corte 12:00-1:00 de DIURNO/VESPERTINO), con clases de duración variable (45min a 4h30) — la grilla, basada en una tabla de bloques de 45 min fija por turno, truncaba o directamente ocultaba estas clases | `constants/index.js`, `utils/turno.js`, `utils/time.js`, `utils/excelParser.js`, `components/TurnoGrid.jsx`, `components/HorariosView.jsx`, `components/ModalEditarClase.jsx` | ✅ Cerrado (4 ago) — 3 causas raíz distintas, encontradas verificando contra el Excel real de Agroalimentación (`HORARIO_ESTANDAR_PNF_AGROALIMENTACION_II-2026.xlsx`), no solo con datos sintéticos: **(1)** `excelParser.js` priorizaba `getTurnoByCodigo(sheetName)` sobre el metadato de texto TURNO — el nombre de hoja v2 ("1-1 (11)", etiqueta legible, no código) coincidía por casualidad con el patrón y devolvía "DIURNO" siempre, pisando el "MIXTO" real; prioridad invertida (metadato explícito gana, código de hoja queda de respaldo para plantillas viejas sin celda TURNO). **(2)** `partesHoraNormalizadas()` (fix de `UX-29`) asumía que inicio y fin comparten siempre el mismo AM/PM — cierto en DIURNO/VESPERTINO (se cortan justo en 12:00/1:00), falso en MIXTO, que sí tiene bloques que cruzan el mediodía (ej. "11:30 - 12:15 PM" se leía como 11:30 PM); ahora valida que el resultado dé duración positiva, si no usa el AM/PM contrario. **(3)** La grilla (`TurnoGrid.jsx`) y el modal de edición (`ModalEditarClase.jsx`) asumían bloques fijos de 45 min por turno — nueva `buildBloquesDinamicos()` arma las filas a partir de los horarios REALES cargados (agregando límites de la data a los de la tabla base), sin necesidad de configurar nada por programa ni saber si la institución reajusta las horas cada trimestre. Turno `MIXTO` agregado a `TURNOS_CONFIG`/`BLOQUES_MIXTO` (fluye solo a QR/reportes vía `habilitado`, mecanismo ya existente de `NOCTURNO`). Bug adicional encontrado en el propio fix: `bloqueValue()`/`bloqueInicialDe()` en `ModalEditarClase.jsx` desambiguaban por hora sin considerar turno — los últimos 4 bloques de MIXTO (1:00-4:00pm) coinciden en horario con los primeros 4 de VESPERTINO, así que elegir "Mixto" en el `<select>` en realidad guardaba "Vespertino" en silencio; corregido incluyendo el turno en la clave de comparación. Verificado end-to-end contra el Excel real (16 filas, todas clasificadas MIXTO, spans 1–6 bloques, sin bloques fantasma). 18 tests nuevos (`turno.test.js`, `excelParser.test.js`, `TurnoGrid.test.jsx`). 248/248 tests, 0 errores de lint, build limpio. **Follow-up (mismo día):** el payload de `handleGuardar()` en `ModalEditarClase.jsx` no incluía `turno` — si se cambiaba el bloque de inicio a otro turno, la columna quedaba desincronizada de la `hora` guardada. Ahora `turno` se deriva del mismo bloque de inicio elegido y viaja en el payload. 3 tests nuevos (`ModalEditarClase.test.jsx`, archivo nuevo — no existía cobertura de este componente). 251/251 tests, 0 errores de lint, build limpio. **Follow-up 2 (mismo día, a pedido de LS: "ajustar la lógica en asistencias, reportes, etc."):** revisión dirigida de todo el módulo de asistencias QR y reportes buscando el mismo patrón (ternarios binarios DIURNO/VESPERTINO que no contemplan MIXTO). 5 hallazgos reales: **(1)** `ReporteRango.jsx` estimaba horas trabajadas con `turno === "NOCTURNO" ? 3 : 4` — MIXTO (9h reales) heredaba el "4" genérico, subestimando a menos de la mitad las horas de docentes de Agroalimentación; ahora se deriva de `TURNOS_CONFIG` (inicioMin/finMin). **(2)** `MateriasView.jsx` — el badge de turno por asignación mostraba cualquier turno que no fuera DIURNO como "Vespertino" (con luna); corregido con lookup a `TURNOS_CONFIG` + clase CSS `--mixto` nueva. **(3)** `PlanillaImprimibleBase.jsx` — el selector de turno para la planilla imprimible de firmas era un array fijo `["DIURNO","VESPERTINO"]`: MIXTO no era ni siquiera seleccionable, la planilla era imposible de generar para Agroalimentación; ahora sale de `TURNOS_CONFIG.filter(habilitado)`. **(4)** `ReporteAsistencias/index.jsx` — el filtro de turno del reporte diario mostraba MIXTO como **"Todos los turnos"** (mismo texto que la opción real de sin-filtro, por un ternario que solo contemplaba dos turnos); corregido con `TURNOS_CONFIG`. **(5)** `AdminQRPanel.jsx` — el turno preseleccionado al abrir el panel recorría los turnos en orden fijo (DIURNO→VESPERTINO→MIXTO), así que un coordinador de Agroalimentación en la tarde veía "Vespertino" preseleccionado en vez de su turno real; ahora, si `profile.programa` es Agroalimentación, se prioriza MIXTO cuando sigue disponible. Revisados también `exportPDF.js`/`exportCSV.js`/`VistaAusentes.jsx` — ya eran genéricos (derivan el label capitalizando el id crudo), sin cambios necesarios. 9 tests nuevos (2 en `ReporteRango.integration.test.jsx`, archivo nuevo `PlanillaImprimibleBase.mixto.test.jsx` con 3). **Pendiente:** no se agregó cobertura de test para `MateriasView.jsx`, `ReporteAsistencias/index.jsx` ni el default de turno de `AdminQRPanel.jsx` (sin archivo de test previo, revisión manual únicamente). 255/255 tests, 0 errores de lint, build limpio. **Follow-up 3 (mismo día):** se cierra el pendiente — 3 archivos de test nuevos (ninguno tenía cobertura previa): `MateriasView.test.jsx` (3 tests, badge MIXTO/DIURNO/VESPERTINO), `ReporteAsistencias/index.test.jsx` (2 tests, confirma que la opción MIXTO del filtro ya no comparte texto con "TODOS"), `AdminQRPanel.test.jsx` (4 tests, con `vi.useFakeTimers()`/`vi.setSystemTime()` para fijar la hora de Caracas de forma determinista — cubre perfil Agroalimentación en la tarde/mañana, perfil de otro programa sin regresión, y perfil nulo). 264/264 tests, 0 errores de lint, build limpio |
| **UX-31** 🟡 | El trigger `autocompletar_sede_id` (`0063`) devuelve un mensaje técnico ("...tu perfil no tiene una sede fija asignada. Si tu rol ve todas las sedes, manda sede_id explícito.") y varios puntos del cliente lo concatenan crudo en el toast/mensaje de error al crear un docente/materia inline sin sede asignada | `ModalEditarClase.jsx`, `useAppData/nameEditing.js` | — | ✅ Cerrado (6 ago) — helper nuevo `utils/errorMessages.js` (`mensajeAmigable()`) intercepta puntualmente ESE mensaje y lo traduce a algo accionable para un usuario final; cualquier otro mensaje de error pasa sin cambios, sin inventar traducciones sobre casos no verificados. 3 tests nuevos. 280/280 tests, 0 errores de lint |

## 🎨 Identidad visual y sistema de diseño

Esquema `DESIGN-N` (antes `FE-N`). Fusionado desde `AUDITORIA_FRONTEND.md`
(documento eliminado tras la fusión).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **DESIGN-1** | Iconografía funcional resuelta con emojis nativos del SO | `buildNavGroups.js`, `App.jsx`, etc. | ✅ Cerrado — cero emoji funcional (confirmado por grep de rango Unicode); sobrevive solo `EMOJIS_PRESET` (selector deliberado) |
| **DESIGN-2** | Tipografía sin identidad — solo `system-ui` | `src/index.css` | ✅ Cerrado — fuente Inter |
| **DESIGN-3** | Tokens de diseño incompletos — faltaba escala `--font-size-*` | `src/index.css`, objeto `S` | ✅ Cerrado (9 jul) — 21 variables definidas 1:1 de valores ya en uso, 569 sustituciones en 27 `.css`. `clamp()` responsivos y tamaños de una sola ocurrencia se dejan literales a propósito |
| **DESIGN-4** | Sin `:focus-visible` accesible consistente | `src/index.css` | ✅ Cerrado — 6 reglas |
| **DESIGN-5** | Adopción mixta de `var(--token)` en reglas `.hl-*` — algunos valores en px crudos | `src/index.css` (reglas `.hl-*`) | ✅ Cerrado (9 jul) — 17 reglas tokenizadas; 4 valores no múltiplo de 4 recibieron tokens exactos nuevos (`--space-6px` etc.) en vez de forzar la escala estándar |

---

## 🆕 Funcionalidad nueva

Esquema `ADMIN-N`. A diferencia del resto de este índice, documenta
funcionalidad nueva pedida directamente por LS (no hallazgos de auditoría) —
se incluye aquí porque el código ya usa el mismo formato de comentario.

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **ADMIN-1** | Borrado de registros de sesión/QR/reportes de asistencia, solo para admin | RPCs `admin_borrar_*` | `0054` | ✅ Cerrado (10 jul) — permiso dinámico en JSONB de roles, cada RPC revalida en servidor y registra en `audit_logs` |
| **ADMIN-2** | UI de borrado para `ADMIN-1`: selección múltiple, borrado por fila/rango | `TabSesiones.jsx`, `AdminQRPanel.jsx`, `ReporteRango.jsx` | `0054` | ✅ Cerrado (10 jul) — borrar sesión QR no borra asistencias ya registradas (`qr_session_id` → NULL) |
| **ADMIN-3** | Sacar "Usuarios y Roles"/"Registros"/"Historial" a un módulo propio, visible solo con permiso admin | `AdminModulo.jsx` (nuevo), `buildNavGroups.js`, `HorariosLayout.jsx` | — | ✅ Cerrado (10 jul) — nombre visible: "Sistema" (no "Administración", ya usado en el dropdown del sidebar). Historial pasa a exigir permiso admin (antes lo veía cualquiera con acceso a Horarios) |
| **ADMIN-4** | La jerarquía admin (`SEC-15`) ya bloqueaba en servidor crear/editar admins sin serlo, pero la UI no lo reflejaba | `usuarios/{index,PestanaUsuarios,ModalUsuario}.jsx` | — | ✅ Cerrado (10 jul) — `esActorAdmin` propagado; oculta "admin" del selector y bloquea edición sobre filas admin si el actor no lo es |
| **ADMIN-5** | Las 3 tarjetas del selector de módulo no caían en una fila en desktop; pedido general de optimización visual | `ModuleSelector.{jsx,css}` | — | ✅ Cerrado (12-13 jul, 3 pasadas) — Grid `auto-fit`/`minmax` en vez de `flexbox` de ancho fijo; rediseño compacto a layout horizontal tipo fila (180px→72px de alto); fix de `var(--color-text-primary)` que UX-13 (modo oscuro, en paralelo) habría roto en el fondo del splash |
| **ADMIN-6** | Pedido explícito de LS: personalizar el membrete de los 3 documentos imprimibles (logo, color, textos institucionales) — antes "UNERMB"/una "U" hardcodeados por separado en `exportPDF.js`, y `PlanillaImprimibleBase.jsx` sin membrete en absoluto | `configuracion_reportes` (migración `0056`), `reportePlantilla.js` (nuevo, compartido), `useReporteConfig.js` (nuevo), `ConfiguracionReportes.{jsx,css}` (nuevo, pestaña "Reportes" en Sistema), `exportPDF.js`, `PlanillaImprimibleBase.jsx`, `reporte-print.css` | `0056` | ✅ Cerrado (1 ago) — permiso granular nuevo `puedeConfigurarReportes`. Logo guardado como data URI en la fila (no Storage: el CSP `img-src 'self' data: blob:` ya lo permite sin abrir dominio nuevo; `CHECK` limita tipo a png/jpeg/webp — SVG excluido a propósito — y tamaño ~1.5MB). Color NO es hex libre: 6 clases CSS preset (`rp-color--*`), mismo criterio que `COLORES_PRESET`/`SEC-3` — el CSP `style-src 'self'` sin `unsafe-inline` bloquea tanto `style=""` en la ventana de impresión como en la app React normal (confirmado con los swatches del formulario, que también son clases, no `style={{background}}`). Unificar `exportPDF.js` y `PlanillaImprimibleBase.jsx` sobre la misma plantilla (`reportePlantilla.js`) corrigió de paso un bug latente nunca reportado: el `<style>` inline de `PlanillaImprimibleBase` casi con certeza estaba bloqueado en silencio por el mismo CSP que forzó externalizar `reporte-print.css` el 14 de julio. `ESC()` de la plantilla compartida ahora también escapa comillas (el logo va dentro de un atributo `src="..."`, no solo texto). 20 tests nuevos (`reportePlantilla.test.js`, `ConfiguracionReportes.integration.test.jsx`, casos nuevos en `AdminModulo.integration.test.jsx`) |

---

## 🏢 Sistema multi-sede (`SEDE-N`)

Esquema `SEDE-N`, agregado el 6 de agosto para cerrar `ARCH-37`: el sistema
de Sedes (independencia entre sedes de UNERMB — Cabimas, y las que se
agreguen) se construyó en 14 hallazgos/pasadas reales (commits `1f52fe9`
en adelante) que nunca se habían volcado a este índice. `SEDE-8` no existe
(hueco de numeración, sin código ni migración asociada — no se detectó
ninguna pérdida de contenido, a diferencia de los huecos de `ARCH-29`/`31`
o `ARCH-34`/`35`, que sí escondían trabajo no aplicado).

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **SEDE-1/2** | Catálogo de sedes + permiso `puedeVerTodasLasSedes` (en vez de fijo a una sola) | `sedes`, `user_profiles.sede_id`, `usuarios/{shared,ModalUsuario}.jsx` | `0061`, `0062` | ✅ Cerrado |
| **SEDE-3/4** | RLS de aislamiento por sede en `docentes`/`materias`/`horarios` (incl. particiones) y flujo anónimo `/scan` | `0063` | `0063`, `0064` | ✅ Cerrado |
| **SEDE-5** | Creación inline de docente/materia (`ModalEditarClase.jsx`, `+ Nuevo`) no mandaba `sede_id` — quedaban en la sede del trigger por defecto, no la sede activa elegida por un rol que ve todas las sedes | `ModalEditarClase.jsx` | — | ✅ Cerrado |
| **SEDE-6** | Badge de sede activa, primera versión (roles con `puedeVerTodasLasSedes`) | `ModuleSelector.jsx` | — | ✅ Cerrado |
| **SEDE-7** | `useSedes()` disparaba su fetch antes de que la sesión estuviera lista, carrera con el login | `useSedes.js` | — | ✅ Cerrado |
| **SEDE-9** | `conflictos_horario_detalle()` (`SECURITY DEFINER`) no filtraba por sede | `useConflictos.js`, migración de la época | — | ✅ Cerrado |
| **SEDE-10** | Badge de sede activa promovido a `UserMenu.jsx` (único elemento común a los 3 módulos, no solo `ModuleSelector`) | `UserMenu.jsx` | — | ✅ Cerrado |
| **SEDE-11** 🔴 | **Crítico:** `replace_nombre_en_clases()` (`0032`, junio 2026, nunca tocada desde entonces) era `SECURITY DEFINER` **sin ningún chequeo de permiso y sin filtro de sede** — cualquier autenticado podía reescribir `horarios.clase` de cualquier sede con solo conocer el nombre de la función. Encontrada en la pasada de auditoría de `SEC-28`/`29` (ver más abajo), ampliada al resto de funciones `SECURITY DEFINER` reales | `replace_nombre_en_clases` (`0032`), `nameEditing.js` | `0068` | ✅ Cerrado (6 ago) — exige `puedeEditarDocentes`/`puedeEditarMaterias` (nunca lo tuvo) y filtra el `UPDATE` por sede resuelta igual que `conflictos_horario` (`0067`) |
| **SEDE-12** | `admin_get_users`/`admin_toggle_user_activo`/`admin_delete_user`/`admin_reset_user_password` sin filtro de sede — hoy no explotable (solo admin/coordinador tienen `puedeGestionarUsuarios`, ambos con `puedeVerTodasLasSedes`), pero el RBAC es dinámico y un rol futuro "coordinador de sede" quedaría expuesto | 4 RPCs `admin_*` | `0068` | ✅ Cerrado (6 ago) — las 4 filtran ahora por `usuario_puede_ver_sede()` sobre la sede del usuario objetivo |
| **SEDE-13** | Mismo problema que `borrar_horarios`/`restaurar_backup` (`0065`) pero en dos RPCs que quedaron fuera de esa migración: `admin_borrar_qr_sesiones`/`admin_borrar_asistencias_rango` (`SECURITY DEFINER`) sin filtro de sede — un rol con `puedeBorrarSesiones`/`puedeBorrarReportes` en una sede podía borrar datos de todas | `admin_borrar_qr_sesiones`, `admin_borrar_asistencias_rango` (`0054`), `ReporteRango.jsx` | `0068` | ✅ Cerrado (6 ago) — mismo patrón de resolución de sede que `borrar_horarios` (`0065`); `admin_borrar_qr_sesiones` rechaza el lote completo si algún id no es visible para el actor, en vez de borrar parcial en silencio |
| **SEDE-14** | `renovar_qr_token()` solo validaba `puedeGestionarQR`, no que la sesión fuera de la sede del actor — defensa en profundidad, mismo principio que `SEC-8` | `renovar_qr_token` | `0068` | ✅ Cerrado (6 ago) — agrega `usuario_puede_ver_sede()` sobre la sede de la sesión |

**Nota de reconciliación (6 ago):** `SEDE-11`/`13`/`14` fueron encontrados
de forma independiente en dos pasadas en paralelo — una auditoría externa
(cerrada acá como `SEC-28`/`SEC-29`, ver tabla de Seguridad) y esta pasada
de LS, más completa (suma `SEDE-11`/`12`/`14`, que la auditoría externa no
había cubierto, y usa mejor validación en `SEDE-13`: rechaza el lote
completo de `admin_borrar_qr_sesiones` en vez de borrar solo lo visible en
silencio). La migración `0068` real es la de esta pasada; `SEC-28`/`29`
quedan documentados como el hallazgo que originó el fix, no como una
migración aparte.



Encontradas al construir `ESQUEMA_Y_MIGRACIONES.md`. Ya no se usan, pero los
archivos con estos comentarios siguen en el repo.

| Esquema | ID | Descripción | Archivo | Estado |
|---|---|---|---|---|
| `Fix #N` | **#2** | Políticas RLS `{public}` → `{authenticated}` en `user_profiles` | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#3** | FK duplicada bloqueaba el login (`PGRST201`) | `0017_drop_fk_duplicada_rol.sql` | ✅ Cerrado |
| `Fix #N` | **#4** | Recursión en `get_auth_role()` dentro de políticas RLS | `0016_fix_rls_user_profiles.sql` | ✅ Cerrado |
| `Fix #N` | **#8** | `borrar_horarios`/`restaurar_backup` sin verificación de permiso interno | `0018_fix_rpc_permisos_faltantes.sql` | ✅ Cerrado |
| `Fix #N` | **#10** | Sin trigger que impidiera borrar roles con `es_sistema = true` | `0019_trigger_protect_roles_sistema.sql` | ✅ Cerrado |
| `Fix #N` | **#16** | Sin índices en `horarios` para búsquedas frecuentes | `0020_indices_horarios.sql` | ✅ Cerrado |
| `Fix #N` | **#17** | RPCs de gestión de usuarios sin migración de respaldo | `0021_rpcs_gestion_usuarios.sql` | ✅ Cerrado |
| `Gap #N` | **#16** | `importarDatos()` no restauraba `asistencias` desde un backup | `0041_restaurar_backup_asistencias.sql` | ✅ Cerrado |

> **Colisión de numeración:** `Fix #16` y `Gap #16` son el mismo número en
> esquemas distintos, sin relación entre sí. Si se retoma cualquiera de
> estas nomenclaturas, evitar reusar números.

---

## 📝 Historial de auditorías (resumen por fecha)

Solo hitos — el "cómo" completo vive en las tablas de arriba.

- **jun 2026:** RLS inicial, QR/offline, migración a Tabler Icons + paleta slate.
- **4–8 jul:** auditoría QA externa + auditoría de arquitectura (87/100) aportan la mayoría de `SEC-1`–`SEC-9`, `ARCH-1`–`ARCH-9`, `UX-1`–`UX-6`, `DESIGN-*`, `CI-*`.
- **9 jul:** reorganización del documento (separar abiertos de historial). Cierre de `ARCH-12`/`ARCH-13`, `DESIGN-3`/`DESIGN-5`.
- **10 jul:** `ADMIN-1`–`ADMIN-4` (funcionalidad nueva). `SEC-15`/`SEC-21` cerrados en sesión paralela.
- **11 jul, auditoría QA senior (Arq. 91, Seg. 93, UX 88):** `ARCH-14`, `SEC-18`, `UX-8` — cerrados el mismo/día siguiente.
- **12 jul, dos auditorías QA senior el mismo día:** 1ª pasada (Arq. 92, Seg. 94, UX 87) aporta `ARCH-15`–`ARCH-17`, `SEC-19`, `UX-9`. 2ª pasada (Arq. 90, Seg. 96, UX 88) aporta `ARCH-18`–`ARCH-21`, `SEC-20`/`SEC-22`, `UX-11`–`UX-13`. Todos cerrados el mismo día salvo `UX-11`/`UX-13`.
- **13 jul:** cierre de `ARCH-18`, `ARCH-20`, `ARCH-21`, `ARCH-22`, `SEC-20`, `SEC-22`, `UX-12`. Primera normalización de IDs (8-10 esquemas colisionantes → 8 prefijos únicos, aplicado a 110 archivos).
- **14 jul:** reverso completo de `UX-13` (modo oscuro) a pedido de LS. Cierre de `UX-15`/`UX-16` (bugs reportados por LS) y `UX-19`–`UX-22`. Segunda normalización de IDs (repo avanzó 3 commits entre pasadas).
- **15 jul, auditoría QA senior (Arq. 90, Seg. 96, UX 87):** clonado fresco contra `23628f9`, sin reabrir nada. Aporta 7 hallazgos nuevos (`ARCH-23`–`ARCH-25`, `SEC-23`/`SEC-24`, `UX-17`/`UX-18`). Informe completo: `docs/AUDITORIA_QA_2026-07-14.md`.
- **15 jul, sesión de implementación:** clonado fresco contra `8637053` (14 commits por delante). Cierra `ARCH-23`, `ARCH-24`, `ARCH-25`, `SEC-24`, `UX-23`. No toca `SEC-23` (requiere verificación manual de LS en GitHub) ni `UX-11`/`UX-17`/`UX-18` (esperando corridas de CI / diferidos sin acción dedicada). 179/179 tests reales.
- **16 jul, primera corrida real de CodeQL (cierra `SEC-23`):** 2 alertas High, "DOM text reinterpreted as HTML" vía `document.write()`. `exportPDF.js` — falso positivo parcial (mismo patrón que `SEC-2`/`SEC-14`), escapado igual por defensa en profundidad. `PlanillaImprimibleBase.jsx` — vulnerabilidad real (XSS almacenado de segundo orden vía nombres de docente/materia cargados por Excel), corregida y con 2 tests de regresión nuevos (`SEC-25`). 181/181 tests.
- **16 jul, cierre de `UX-17`/`UX-18` y `UX-11`:** `UX-17` sin acción de código (misma decisión de producto que `UX-13`, LS confirmó no retomar modo oscuro); `UX-18` comentario obsoleto reescrito en `ModuleSelector.css`. `UX-11` cerrado tras confirmar 7 corridas reales de CI sin diffs desde el 13 de julio; `continue-on-error` retirado de `ci.yml`. Con esto, 0 hallazgos abiertos en el índice.
- **1 ago, rendimiento/UX en módulo de reportes:** clonado fresco contra `2b36c46` (sin hallazgos abiertos previos). Pedido explícito de LS: 3 hallazgos nuevos de rendimiento (`ARCH-26`–`ARCH-28`), cerrados en la misma sesión. `ARCH-26` (fetch condicional en `VistaAusentes`) y `ARCH-28` (memoización) sin migración. `ARCH-27` (agregación server-side para Reporte por Rango) sí — migración `0055`, RPC `SECURITY INVOKER` sobre `asistencias_diarias`, sin cambios de superficie de seguridad respecto al SELECT directo que reemplaza. Como efecto colateral de `ARCH-27`, desaparece el problema de "sin feedback de progreso durante paginación larga" — ya no hay paginación cliente que mostrar progreso de. 185/185 tests (4 nuevos), `vite build` limpio.
- **1 ago, `npm audit` fallando en CI (`SEC-26`):** LS reportó la salida de `npm audit --omit=dev --audit-level=high` (3 vulnerabilidades, exit 1). Rastreadas hasta `svgtofont`, dependencia de build interna de `@tabler/icons-webfont` — paquete confirmado sin ningún uso real en el proyecto (los íconos se sirven desde `public/fonts/`, estáticos y versionados). `npm uninstall @tabler/icons-webfont` → 0 vulnerabilidades. Sin impacto en build/tests (185/185, build idéntico).
- **1 ago, personalización de reportes (`ADMIN-6`):** pedido explícito de LS ("mejorar visualmente los reportes, agregarle formato, encabezados, logos"), resuelto en el nivel más completo de 3 opciones consultadas (módulo completo con logo subido, colores, textos y vista previa; aplicado a los 3 documentos imprimibles; admin-only). Detectado durante el diseño: `ADMIN-5` ya estaba tomado (grid del selector de módulos, 12-13 jul) — la búsqueda inicial de IDs no lo incluyó, se corrigió a `ADMIN-6` antes de entregar. Unificar `exportPDF.js`/`PlanillaImprimibleBase.jsx` sobre `reportePlantilla.js` corrigió de paso un bug de CSS inline en `PlanillaImprimibleBase` nunca reportado (ver detalle en la fila `ADMIN-6`). 205/205 tests (20 nuevos), 0 errores de lint, build limpio (chunk `ConfiguracionReportes` separado por code-splitting, 6.54 KB).
- **2 ago, auditoría de estrés operacional + pasada de implementación:** aporta `ARCH-29`/`UX-24` (reabiertos como `ARCH-31` al detectar que la migración `0057` citada no existía), `ARCH-30`, `SEC-27`, `ARCH-32`–`34`, `OFF-9`, `UX-25`, `UX-26`. Deuda técnica cerrada en la misma pasada, sin ID propio: 6 warnings de `react-hooks/exhaustive-deps` corregidos uno por uno (`useDataSync.js`, `useNombresCache.js`, `PestanaRoles/PestanaUsuarios.jsx`, `VistaAusentes.jsx`, `PlanillaImprimibleBase.jsx`, `App.jsx`, `ComparadorPanel.jsx`), y `vite` `6.4.3`→`7.3.6` (bloqueado antes por `vite-plugin-pwa`, ya soporta `^7`). Investigando un test que empezó a fallar en esta misma pasada se encontró `UX-27` (bug de timezone en `ReporteRango.jsx`). Mismo día, LS reportó por separado un bug de edición de horarios (clases que "desaparecían"/"aparecían de golpe" en `TurnoGrid.jsx`), cerrado como `UX-28`. Verificación final: 224/224 tests, 0 errores de lint, build limpio.
- **3 ago, fix reportado por LS con screenshot (`UX-29`):** recurrencia del bug de `UX-28` en un caso distinto — clase vecina con hora sin AM/PM en el inicio se movía visualmente sin que su horario real cambiara. Causa raíz en `timeToMin()`/`parseRango()` (ver detalle en la fila `UX-29`). Antes de aplicar el fix se detectaron 14 commits en paralelo no hechos en esta sesión (fix legítimo de `useAuth.js` de LS, y `ARCH-34` marcado ✅ sin que el guard llegara al `ci.yml` real) — reabierto y cerrado el mismo día como `ARCH-35` (ver nota de proceso arriba). Verificación final: 232/232 tests, 0 errores de lint, build limpio.
- **4 ago, fix reportado por LS (`UX-30`):** PNF Agroalimentación usa un turno "MIXTO" continuo de duración variable, incompatible con la grilla de bloques fijos de 45 min — 3 causas raíz distintas (parseo de metadato TURNO, AM/PM que cruza el mediodía, bloques fijos por turno) más 2 rondas de follow-up el mismo día (5 hallazgos más en asistencias/reportes que heredaban el mismo patrón binario DIURNO/VESPERTINO, y su cobertura de tests pendiente). Detalle completo en la fila `UX-30`. Verificación final: 264/264 tests, 0 errores de lint, build limpio.
- **6 ago, auditoría integral externa + reconciliación con pasada paralela de LS:** auditoría completa contra HEAD real (`a84dce2`) — mono-sede: Arq. 90, Seg. 94 (74 sobre el feature nuevo de Sedes), UX 88. Encuentra que el sistema de Sedes (`0061`–`0067`) nunca pasó por este índice (`ARCH-37`, nueva § Sistema multi-sede), 2 `SECURITY DEFINER` sin filtro de sede (`SEC-28`/`29`) y una carpeta de migraciones huérfana (`ARCH-36`). A mitad de la implementación, un re-clon detectó 6 commits en paralelo de una sesión de LS que había encontrado y corregido el mismo problema de forma independiente y más completa (`SEDE-11`–`14`, migración real `0068`, más `replace_nombre_en_clases()` sin ningún chequeo de permiso — hallazgo que la auditoría externa no había visto). Reconciliado sin pisar nada: la migración `0068` propia se descartó entera a favor de la real ya en el repo; solo `UX-31` (mensaje de error del trigger de sede sin traducir) seguía sin resolver y se aplicó sobre el HEAD real (`07042f4`). Verificación final: 280/280 tests, 0 errores de lint, build limpio.

## 🔁 Tabla de equivalencias (IDs antiguos → nuevos)

Reorganización del 13-14 de julio de 2026. Si un commit viejo, un PR
cerrado, o una conversación pasada menciona un ID que no aparece en ninguna
tabla de arriba, buscarlo acá. `ADMIN-N` no está porque nunca colisionó.

**Nota:** las 12 migraciones SQL ya aplicadas a producción conservan a
propósito sus IDs *originales* en los comentarios (historial real de lo que
corrió contra la BD, no se tocaron en la reorganización). Si un comentario
dice `Fix S1`, es el mismo hallazgo que esta tabla mapea a `SEC-1`.

<details>
<summary><strong>SEC-N — Seguridad y RLS</strong></summary>

| Antiguo | Nuevo | | Antiguo | Nuevo |
|---|---|---|---|---|
| `S1` | `SEC-1` | | `V-4` | `SEC-12` |
| `S2` | `SEC-2` | | `D-3` | `SEC-13` |
| `S3` | `SEC-3` | | `D-6` | `SEC-14` |
| `SEC-2` | `SEC-4` | | `SEC-10` | `SEC-15` |
| `SEC-3` | `SEC-5` | | `SEC-11` | `SEC-16` |
| `SEC-5` | `SEC-6` | | `SEC-9` | `SEC-17` |
| `SEC-6` | `SEC-7` | | `D-7` | `SEC-18` |
| `SEC-7` | `SEC-8` | | `SEC-13` | `SEC-19` |
| `SEC-8` | `SEC-9` | | `SEC-14` | `SEC-20` |
| `V-1` | `SEC-10` | | `SEC-12` | `SEC-21` |
| `V-2` | `SEC-11` | | `SEC-15` | `SEC-22` |

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

| Antiguo | Nuevo | | Antiguo | Nuevo |
|---|---|---|---|---|
| `A1` | `ARCH-1` | | `ARCH-9` | `ARCH-12` |
| `A-2` | `ARCH-2` | | `ARCH-10` | `ARCH-13` |
| `A-3` | `ARCH-3` | | `ARCH-11` | `ARCH-14` |
| `A-4` | `ARCH-4` | | `ARCH-12` | `ARCH-15` |
| `A-5` | `ARCH-5` | | `ARCH-13` | `ARCH-16` |
| `A2` | `ARCH-6` | | `ARCH-14` | `ARCH-17` |
| `ARCH-4` | `ARCH-7` | | `ARCH-15` | `ARCH-18` |
| `ARCH-5` | `ARCH-8` | | `ARCH-16` | `ARCH-19` |
| `ARCH-6` | `ARCH-9` | | `ARCH-17` | `ARCH-20` |
| `ARCH-7` | `ARCH-10` | | `ARCH-18` | `ARCH-21` |
| `ARCH-8` | `ARCH-11` | | `ARCH-19` | `ARCH-22` |

</details>

<details>
<summary><strong>UX-N — UI y estilos</strong></summary>

| Antiguo | Nuevo | | Antiguo | Nuevo |
|---|---|---|---|---|
| `U-1` | `UX-1` | | `U-8` | `UX-9` |
| `U-2` | `UX-2` | | `U-9` | `UX-10` |
| `U-3` | `UX-3` | | `U-10` | `UX-11` |
| `U-4` | `UX-4` | | `U-11` | `UX-12` |
| `A3` | `UX-5` | | `U-12` | `UX-13` |
| `U-5` | `UX-6` | | `U-13` | `UX-14` |
| `U-6` | `UX-7` | | `U-14` | `UX-15` |
| `U-7` | `UX-8` | | `U-15` | `UX-16` |

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

*Optimizaciones de este documento — **16 jul** (601→~400 líneas): párrafos
de verificación de cada hallazgo ✅ cerrado condensados a causa raíz + fix
en una línea (migraciones/archivos/IDs intactos); historial narrativo
recortado a resumen por fecha. Incluyó una recuperación de contenido
(commit `44b25f6` con `SEC-25`/cierre de `SEC-23`, sobrescrito sin querer
por un push con la versión optimizada — reconstruido del diff real, sin
pérdida de información). **3 ago** (530→~450 líneas): mismo criterio
aplicado a las 4 secciones narrativas del "2 de agosto" que habían vuelto
a crecer arriba del archivo — replegadas a sus filas en las tablas por
prefijo (`ARCH-32`–`34`, `OFF-9`, `UX-25`–`28`) y a una línea en §
Historial; las 2 notas de recuperación de contenido perdido (commit
`4d9ca67`) se condensaron sin perder la referencia a los commits
involucrados. Nada se eliminó sin migrarlo antes a su tabla permanente.
Última reorganización de fondo (normalización de IDs a 8 prefijos únicos):
14 de julio de 2026. Para el índice de migraciones SQL y el esquema de BD,
ver `ESQUEMA_Y_MIGRACIONES.md`.*
