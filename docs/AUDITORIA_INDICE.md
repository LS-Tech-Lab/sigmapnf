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
autenticación/sesión. El proyecto usó además dos nomenclaturas anteriores
(`Fix #N`, `Gap #N`) — ver § Histórico al final.

---

## 🟡 Hallazgos abiertos (detalle completo)

Todo lo necesario para retomar cada uno sin releer el historial completo.
Orden de prioridad recomendado (mayor a menor impacto/urgencia):

### 1. `FE-5` — Tokens sueltos en `.hl-*`
**Archivo:** `src/index.css` (reglas `.hl-*`, migradas desde `HorariosLayout.jsx` por `U-5`)
Al migrar el archivo de estilos inline a CSS externo, la adopción de
`var(--token)` quedó mixta: algunos `font-size`/`padding` de las reglas
`.hl-*` siguen en valores px crudos en vez de usar los tokens ya definidos
en `index.css`. Confirmado sin cambios el 9 de julio.
**Fix:** pasada de limpieza puntual, solo CSS. Bajo esfuerzo, sin riesgo.

### 2. `ARCH-10` — Archivos grandes sin dividir
**Archivos:** `src/components/HistorialView.jsx` (637 líneas), `LogsView.jsx`
(517 líneas), `LoginScreen.jsx` (508 líneas — formulario normal, flujo de
PIN offline y modal de activación mezclados en un solo archivo).
Hallazgo de la auditoría QA senior del 9 de julio. Mismo problema de fondo
que `ARCH-8` (ya cerrado), en archivos distintos.
**Fix:** extraer subcomponentes de responsabilidad única, mismo patrón ya
usado en `ARCH-8` (`HorariosSidebar.jsx`/`HorariosTopbar.jsx`) y en
`usuarios/`. Sin urgencia de seguridad, sí de mantenibilidad a futuro.

### 3. `FE-3` — Sin escala tipográfica
**Archivo:** `src/index.css`
No existe una escala de tamaños de fuente (`--font-size-*`) — cada
componente define su propio `font-size` suelto. Reverificado el 9 de julio:
sigue sin existir.
**Fix:** definir 5-6 variables basadas en los valores ya en uso hoy,
adopción gradual sin migración masiva. Mejora de largo plazo, sin prisa.
**Nota:** es la misma causa raíz que `A3`/`S3` (estilos sueltos vs. tokens),
vista desde identidad visual — no es un hallazgo independiente, pero se
sigue rastreando aquí porque `A3`/`S3` ya cerraron y este resto no.

### `ARCH-9` — Código muerto en `ResponsiveStyles.jsx`
**Archivo:** `src/components/ResponsiveStyles.jsx`
Ningún otro archivo del repo lo importa ni renderiza, y su propio import
(`responsiveCSS` desde `constants`) no existe en ningún lado — si alguna vez
se llegara a usar, rompería en tiempo de ejecución. Encontrado de forma
incidental durante el barrido de `<style>` tags que cerró `S3`.
**Fix:** eliminar el archivo directamente. Trivial, sin prioridad asignada
todavía por ser de esfuerzo mínimo.

### `SEC-9` — Funciones RPC ejecutables por `anon` sin `REVOKE` explícito
**Archivos:** RPCs `get_auth_role`, `get_my_role`, `get_auth_programa`,
`get_my_programa` (sin migración de origen registrada)
Aparecen ejecutables por `anon` en la BD real y nunca tuvieron un `REVOKE`
explícito en ninguna migración — mismo patrón que `SEC-8`, encontrado de
paso al cerrar ese hallazgo. **Riesgo bajo:** son de solo lectura y
devuelven `null`/vacío para un caller anónimo; ninguna decisión de
seguridad delega en su resultado.
**Fix:** agregar `REVOKE ALL FROM PUBLIC` explícito en una migración nueva,
mismo patrón que `0049` (`SEC-8`). Señalado por transparencia, sin
migración de cierre todavía.

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
| **SEC-9** | Ver § Hallazgos abiertos | — | — | 🟡 Abierto |

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
| **ARCH-9** | Ver § Hallazgos abiertos | `ResponsiveStyles.jsx` | 🟡 Abierto |
| **ARCH-10** | Ver § Hallazgos abiertos | `HistorialView.jsx`, `LogsView.jsx`, `LoginScreen.jsx` | 🟡 Abierto |

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

## 🎨 Identidad visual y sistema de diseño

Esquema `FE-N`. Fusionado desde `AUDITORIA_FRONTEND.md` (documento eliminado
tras la fusión — su contenido íntegro vive en esta sección).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **FE-1** | Iconografía funcional resuelta con emojis nativos del SO | `buildNavGroups.js`, `App.jsx`, `AdminMenu.jsx`, `LoginScreen.jsx`, y resto de vistas | ✅ Cerrado — cero emoji funcional confirmado por grep de rango Unicode sobre todo `src/`. Sobreviven solo `EMOJIS_PRESET` (selector deliberado de emoji de rol, es la funcionalidad en sí) y mensajes de diagnóstico en `logger.warn` |
| **FE-2** | Tipografía sin identidad — solo `system-ui` | `src/index.css` | ✅ Cerrado — fuente Inter |
| **FE-3** | Ver § Hallazgos abiertos | `src/index.css` | 🟡 Abierto |
| **FE-4** | Sin `:focus-visible` accesible consistente | `src/index.css` | ✅ Cerrado — 6 reglas confirmadas |
| **FE-5** | Ver § Hallazgos abiertos | `src/app/HorariosLayout.jsx` → `.hl-*` en `src/index.css` | 🟡 Abierto |

---

## 🗄️ Histórico: nomenclaturas anteriores (no vigentes)

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
  `ARCH-8` seguía correctamente cerrado; quedan abiertos `SEC-9`, `ARCH-9`,
  `ARCH-10`, `FE-3`, `FE-5` — ver § Hallazgos abiertos al inicio del
  documento para el detalle completo de cada uno.

---

*Última reorganización: 9 de julio de 2026 — se restructuró el documento
para separar hallazgos abiertos (con todo el contexto necesario para
retomarlos) del historial de cierre, y se condensó el registro narrativo de
pasadas previas en un resumen cronológico. Ningún hallazgo cambió de
estado en esta pasada; es solo una reorganización de lectura. Para el
índice de migraciones SQL y el esquema de base de datos, ver
`ESQUEMA_Y_MIGRACIONES.md`.*
