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

**2 abiertos**, de los 4 encontrados el 2 de agosto en una auditoría de
estrés operacional pre-producción (simulación deliberada de concurrencia
masiva, entradas maliciosas, fallos de red y fatiga de usuario — no solo
revisión estática). Los 2 bloqueantes de producción (`ARCH-29`, `UX-24`)
se cerraron el mismo día en un solo commit — ver sus filas para el
detalle real del fix (columna `updated_at` + trigger server-side +
bloqueo optimista en `saveClase()`, migración `0057`, 209/209 tests).
Quedan `ARCH-30` y `SEC-27`, ninguno bloqueante.

| Prioridad | ID | Descripción corta | Estado |
|---|---|---|---|
| ~~1~~ | ~~🔴 **ARCH-29**~~ | ~~Edición de horarios sin bloqueo optimista~~ | ✅ Cerrado (2 ago) |
| ~~2~~ | ~~🔴 **UX-24**~~ | ~~Sin aviso de conflicto de edición al usuario~~ | ✅ Cerrado (2 ago) |
| 1 | 🟡 **ARCH-30** | `HorariosLayout` sin `ErrorBoundary` propio | ⬜ Abierto |
| 2 | 🟢 **SEC-27** | Validación de Excel solo por extensión, sin magic bytes | ⬜ Abierto |

`UX-13` (modo oscuro) sigue ⛔ revertido a pedido de LS — decisión de
producto, no hallazgo pendiente.

Esto no significa que no vaya a aparecer nada nuevo — CodeQL corre en cada
push/PR y semanalmente por cron (`SEC-20`), así que conviene revisar
Security → Code scanning periódicamente en vez de asumir que 0 hallazgos
abiertos es un estado permanente.

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
| **SEC-27** 🟢 | Carga de Excel (`useUpload.js`) valida el archivo solo por extensión/mimetype del navegador, sin verificar el contenido real antes de pasarlo a `XLSX.read()` — un archivo renombrado a `.xlsx` sin serlo llega hasta el parser | `useAppData/useUpload.js` | ⬜ **Abierto (2 ago) — optimización, no bloqueante.** Sin RCE ni explotabilidad real (SheetJS falla de forma controlada), pero el error que ve el usuario es técnico bajo presión de tiempo. Fix: chequeo de magic bytes (firma ZIP `PK\x03\x04`, primeros 4 bytes) antes de invocar el parser, con mensaje claro si no coincide |

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
| **ARCH-23** | `DocenteScan/index.jsx` a 525 líneas — mis
