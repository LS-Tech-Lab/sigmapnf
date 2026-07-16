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

Todo lo demás en este documento está cerrado. Solo 2 IDs siguen pendientes:

1. **`SEC-23`** 🔴 — `SEC-20` (job de CodeQL) está desplegado pero nadie
   confirmó su primera corrida real en GitHub Actions (no verificable sin
   credenciales de GitHub). **Acción:** entrar a Security → Code scanning
   del repo, confirmar que corrió, triar los falsos positivos de la primera
   pasada (normal que existan).
2. **`UX-11`** 🟡 — Infraestructura de regresión visual (Playwright, 3
   pantallas × 3 breakpoints) funcionando: `9 passed` confirmado en CI real
   (13 de julio), sin diffs falsos. **Único pendiente:** correr el job 2-3
   veces más sin diffs falsos (descartar flakiness de fuentes/antialiasing)
   antes de sacar `continue-on-error: true` de `ci.yml`. Detalle del mock de
   sesión en `tests/visual/mockSupabase.js`.

Todo lo demás (`SEC-1`–`SEC-22`, `SEC-24`, `ARCH-*`, `PERM-*`, `OFF-*`,
`UX-1`–`UX-10`, `UX-12`–`UX-23`, `DESIGN-*`, `CI-*`, `ADMIN-*`) está ✅
cerrado y verificado contra el HEAD real (181/181 tests, `vite build`
limpio — 16 de julio). `UX-13` (modo oscuro) está ⛔ revertido a pedido
explícito de LS ("no la veo necesaria") — decisión de producto confirmada
de nuevo el 16 de julio al cerrar `UX-17`/`UX-18`, no un hallazgo
pendiente.

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
| **SEC-23** 🔴 | Ver § Hallazgos abiertos arriba | `.github/workflows/codeql.yml` | — | 🔴 **Pendiente** |
| **SEC-24** | CSP estricta sin endpoint de reporte (`report-uri`/`report-to`) — violaciones se bloqueaban en silencio | `vercel.json`, `api/csp-report.js` | — | ✅ Cerrado (15 jul) — endpoint público sin auth (insertado en `audit_logs` vía Service Role), rate limit 20 req/min por IP (best-effort en memoria, no persistente entre instancias serverless), 8 tests nuevos |

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
| **UX-11** 🟡 | Ver § Hallazgos abiertos arriba | 24 `.css`, `ci.yml`, `playwright.config.js`, `tests/visual/` | 🟡 **Pendiente** — solo faltan corridas de CI estables |
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

---

## 🗄️ Esquema retirado (`Fix #N` / `Gap #N`)

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

*Optimizado el 16 de julio de 2026: de 601 a ~400 líneas. Se condensaron los
párrafos de verificación de cada hallazgo ✅ cerrado a causa raíz + fix en
una línea (migraciones, archivos e IDs intactos); se recortó el historial
narrativo (ya duplicado en las tablas) a un resumen por fecha. En esa misma
pasada se cerraron `UX-17` y `UX-18` (ambos cosméticos, sin tocar `UX-13` —
LS confirmó de nuevo que el modo oscuro no se retoma). Último estado real:
181/181 tests, `vite build` limpio. Última reorganización de fondo: 14 de
julio de 2026 (normalización de IDs a 8 prefijos únicos). Para el índice de
migraciones SQL y el esquema de BD, ver `ESQUEMA_Y_MIGRACIONES.md`.*
