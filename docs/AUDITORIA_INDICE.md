# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgo (`SEC-1`, `OFF-3`, `ARCH-11`, etc.)
dispersos en comentarios de código y migraciones.

**Metodología:** cada fila se verifica contra el código/BD real (`grep`,
`git log`, `pg_policies`, `vite build`), nunca contra un informe externo sin
confirmar. Al cerrar un hallazgo: usar `// Fix <ID> (auditoría <fecha>): qué
y por qué` en código / `-- Migración NNNN — Fix <ID>: resumen` en SQL,
actualizar su fila aquí, y si reabre uno anterior decirlo explícitamente.

**Nota de proceso (14 jul):** además de código duplicado, revisar *patrones
de UI/UX repetidos entre los 3 módulos raíz* (`HorariosLayout`/
`AsistenciasModulo`/`AdminModulo`) — misma acción, distinta implementación,
no lo detecta ningún grep de código duplicado.

**Esquema de IDs (normalizado 13-14 jul):** `SEC-N` (seguridad/RLS),
`PERM-N`/`PROG-N` (permiso/programa), `OFF-N` (offline/red), `ARCH-N`
(arquitectura/testing/concurrencia), `UX-N` (UI/estilos), `DESIGN-N`
(identidad visual), `CI-N` (CI/CD), `ADMIN-N` (funcionalidad nueva pedida
por LS, no hallazgo), `SEDE-N`/`ASIST-N` (features propias). IDs de
esquemas viejos (`O-N`/`P-N`/`A-N`/`FE-N`/`V-N`/`D-N`/`Fix #N`/`Gap #N`):
ver **Tabla de equivalencias** al final. Esquema de BD/migraciones SQL: ver
`ESQUEMA_Y_MIGRACIONES.md`.

---

## 🔴 Hallazgos realmente abiertos

**`SEC-37` ⛔ no aplicable.** Leaked-password protection requiere plan Pro
(org `bolysrglhpxjfydtuzkw`, plan `free`); LS confirmó (16 ago) que no lo
contratará en el corto plazo — decisión de producto, mismo criterio que
`UX-13` (modo oscuro revertido). Reevaluar solo si cambia el plan.

**`SEC-39 (1)/(2)` 🟡 abiertos**, hardening no urgente sin explotación
conocida: ~15 funciones sin `search_path` fijo; extensión `pg_trgm` en
schema `public` en vez de uno dedicado. `(3)` y `SEC-40`/`41` ya cerrados.

**`ARCH-39` 🟡 abierto:** el load test de concurrencia QR (`qr-load-test.yml`)
corre en verde pero siempre salta el paso real — falta el secret
`SUPABASE_SERVICE_ROLE_KEY` en GitHub Actions. Pendiente de LS.

`UX-13` (modo oscuro) sigue ⛔ revertido a pedido de LS, no es hallazgo
pendiente. CodeQL corre en cada push/PR y semanalmente (`SEC-20`) — revisar
Security → Code scanning periódicamente.

**Patrón recurrente a vigilar:** 3 veces un hallazgo se marcó ✅ cerrado sin
que el fix llegara al código real (`ARCH-29`→`31`, `ARCH-34`→`35`,
`ARCH-43`) — siempre detectado verificando archivo por archivo contra HEAD,
nunca dando por buena la tabla de este documento sin más. El sistema de
Sedes tuvo el mismo problema (`ARCH-37`).

**Sin hallazgos de UI/UX abiertos** tras `UX-55` (16 ago) — con la salvedad
de que esa afirmación solo vale hasta el próximo componente que reutilice
una clase compartida sin pasar por el barrido de turno vigente.

---

## 🔐 Seguridad y RLS

Esquema `SEC-N`. Fusiona 4 esquemas paralelos viejos (`S-N`/`SEC-N`/`V-N`/
`D-N`) — ver tabla de equivalencias.

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **SEC-1** | RLS nunca habilitado en `horarios` (padre particionado) | `horarios` | `0035`,`0045` | ✅ Cerrado |
| **SEC-2** | `docentes`/`materias`: política sin permiso granular | `docentes`,`materias` | `0046` | ✅ Cerrado |
| **SEC-3** | Estilos inline bloqueaban CSP estricta | Todo `src/` (ver `UX-5`) | — | ✅ Cerrado |
| **SEC-4** | Stack trace completo visible en producción | `ErrorBoundary.jsx` | — | ✅ Cerrado |
| **SEC-5** | Sin validación centralizada de fortaleza de contraseña | `utils/password.js` | — | ✅ Cerrado |
| **SEC-6** | Lockout de login en `localStorage`, no resistía privado | `LoginScreen.jsx` | — | ✅ Cerrado (IndexedDB) |
| **SEC-7** | Sin respaldo server-side del lockout de `SEC-6` | RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado |
| **SEC-8** | `login_attempts` INSERT abierto a `public` | `login_attempts` | `0048` | ✅ Cerrado |
| **SEC-9** | 4 funciones ejecutables por `anon` (drift de grants) | 4 RPCs | `0049` | ✅ Cerrado |
| **SEC-10** | INSERT/DELETE de `horarios` sin permiso granular | `horarios` | `0035` | ✅ Cerrado (misma causa que `SEC-1`) |
| **SEC-11** | RLS de `qr_sessions`/`asistencias_diarias` sin permiso granular | ambas | `0036` | ✅ Cerrado |
| **SEC-12** | `crear_qr_session()` solo validaba rol, no `puedeGestionarQR` | RPC | `0035` | ✅ Cerrado |
| **SEC-13** | Sin rate limiting en `registrar_asistencia()` | `scan_rate_limit` | `0039`,`0040` | ✅ Cerrado |
| **SEC-14** | 2 CVEs reportadas para `xlsx` | `package.json` | `0.20.3` | ✅ Cerrado — falso positivo, ambas ya corregidas antes de esa versión |
| **SEC-15** | Escalada de privilegios: `admin_caller_puede_gestionar_usuarios()` no comparaba rol actor vs. objetivo | 5 RPCs `admin_*` | `0050` | ✅ Cerrado |
| **SEC-16** | `api/admin-users.js` (Service Role) sin rate limit propio | mismo | `0051` | ✅ Cerrado (10/min por actor) |
| **SEC-17** | 4 RPCs de sesión ejecutables por `anon`, mismo patrón `SEC-9` | 4 RPCs | `0052` | ✅ Cerrado |
| **SEC-18** | 2 CVEs en `vite`/`esbuild` (solo dev server) | `package.json` | — | ✅ Cerrado |
| **SEC-19** | `api/admin-users.js` sin cabeceras CORS propias | mismo | — | ✅ Cerrado |
| **SEC-20** | Sin SAST sobre código propio en CI | `codeql.yml` | — | ✅ Cerrado (job separado, no bloqueante) |
| **SEC-21** | Sesión nunca expiraba sola | `useAuth.js` | `0053`,`0055` | ✅ Cerrado — client timeout + `pg_cron` server-side |
| **SEC-22** | Sin política documentada de rotación del Service Role Key | `SECURITY.md` | — | ✅ Cerrado |
| **SEC-23** | Primera corrida real de CodeQL sin confirmar | `codeql.yml` | — | ✅ Cerrado — 2 alertas High, resueltas en `SEC-25` |
| **SEC-24** | CSP estricta sin endpoint de reporte | `api/csp-report.js` | — | ✅ Cerrado (rate limit 20/min por IP) |
| **SEC-25** | 2 alertas High CodeQL, "DOM reinterpreted as HTML" vía `document.write()` | `exportPDF.js`, `PlanillaImprimibleBase.jsx` | — | ✅ Cerrado — `exportPDF.js` falso positivo parcial; `PlanillaImprimibleBase.jsx` XSS almacenado real (docente/materia sin escapar), `ESC()` agregado |
| **SEC-26** | `npm audit` fallaba: 3 vulns transitivas de `svgtofont` | `package.json` | — | ✅ Cerrado — paquete no usado en runtime, `npm uninstall @tabler/icons-webfont` |
| **SEC-27** 🟢 | Carga de Excel valida solo por extensión, no contenido real | `useUpload.js` | — | ✅ Cerrado — chequeo de magic bytes (ZIP/OLE2) antes del parser |
| **SEC-28** 🔴 | `admin_borrar_asistencias_rango()` sin filtro de sede — un rol con el permiso en una sede borraba de todas | RPC (`0054`) | `0068` | ✅ Cerrado (6 ago, ver `SEDE-13`) |
| **SEC-29** 🔴 | Mismo hueco que `SEC-28` en `admin_borrar_qr_sesiones()` | RPC (`0054`) | `0068` | ✅ Cerrado (6 ago, ver `SEDE-13`) |
| **SEC-30** 🔴 | 2 políticas SELECT huérfanas creadas fuera de migración anulaban el filtro de sede en `qr_sessions`/`asistencias_diarias` (OR de políticas permisivas) — cualquiera con el permiso veía todas las sedes | RLS | `0071` | ✅ Cerrado (7 ago) — `DROP POLICY` de ambas, confirmado con `pg_policies` |
| **SEC-31** 🔴 | Política INSERT zombi `sl_insert` en `session_logs` (rol viejo `get_auth_role()`) anulaba `sl_no_insert_directo` — cualquier autenticado insertaba filas de auditoría arbitrarias | RLS | `0071` | ✅ Cerrado (7 ago) |
| **SEC-32** 🟡 | `solo_hoy_insert_qr_sessions` sin `usuario_puede_ver_sede()` en el `WITH CHECK` | RLS | `0071` | ✅ Cerrado (7 ago) |
| **SEC-33** 🔴 | Auditoría completa de `EXECUTE`: ~24 funciones `SECURITY DEFINER` administrativas ejecutables por `anon`/`PUBLIC` sin que ninguna migración se lo otorgara (mismo patrón que `SEC-8`/`SEC-9`, mucho más grande) | ~24 RPCs `admin_*` | `0073` | ✅ Cerrado (7 ago) — `REVOKE`/confirmación en las 32 funciones objetivo, excluidas las 4 legítimamente anónimas |
| **SEC-34** 🟡 | Causa raíz de `SEC-8`/`9`/`33`: `pg_default_acl` de `postgres` otorgaba `EXECUTE` a `anon` en toda función nueva del schema `public` | Privilegios por defecto | `0074` | ✅ Cerrado (7 ago) — `ALTER DEFAULT PRIVILEGES` corregido; `supabase_admin` fuera de alcance (rol interno sin permiso para alterarlo) |
| **SEC-35** 🟠 | `uq_asistencia_docente_dia_tipo` sin `sede_id` — mismo docente en 2 sedes el mismo día rechazaba el segundo registro | `asistencias_diarias` | `0082` | ✅ Cerrado (9 ago) |
| **SEC-36** 🟡 | Política de `trimestres` con `roles={public}` (incluye `anon`), sin necesidad funcional | `trimestres` | `0082` | ✅ Cerrado (9 ago) |
| **SEC-37** ⛔ | `auth_leaked_password_protection` deshabilitado — requiere plan Pro | Config del proyecto | — | ⛔ No aplicable — LS no planea upgrade, ver arriba |
| **SEC-38** 🟡 | `mensajeAmigable()` era whitelist pass-through — errores de Postgres no cubiertos filtraban nombres de tabla/columna al usuario; 6 archivos más bypasseaban el filtro | `errorMessages.js` + 6 archivos | — | ✅ Cerrado (10 ago) — fallback genérico, 2 reglas nuevas, 6 call sites conectados al filtro |
| **SEC-39** 🟡 | Primera verificación vía `get_advisors` (11 ago): (1) ~15 funciones sin `search_path`, (2) `pg_trgm` en `public`, (3) firma duplicada de `restaurar_backup()` | ~15 funciones, `pg_trgm`, `restaurar_backup` | `0098` | 🟢 (3) cerrado 16 ago (firma vieja sin `DROP`, corregida). (1)/(2) abiertos, hardening no urgente |
| **SEC-40** 🟢 | RLS de `horarios` no bloqueaba escritura en trimestres cerrados — cualquiera con permiso podía editar/borrar clases de un lapso cerrado | `_aplicar_rls_horarios()` | `0099` | ✅ Cerrado (16 ago) — guard `NOT EXISTS (trimestre cerrado)` en INSERT/UPDATE/DELETE; auto-detectado y corregido en la misma sesión un bug de calificación SQL que bloqueó toda la tabla brevemente |
| **SEC-41** 🟢 | `unificar_docente()`/`_materia()` (sin `SECURITY DEFINER`, corren con RLS del invocador) quedaban bloqueadas por el guard de `SEC-40` al reasignar filas de lapsos cerrados, rompiendo la fusión de duplicados | mismas + `_aplicar_rls_horarios()` | `0100` | ✅ Cerrado (16 ago) — excepción vía GUC transaccional `app.bypass_lapso_cerrado`, solo en la política UPDATE, activada únicamente dentro de esas 2 funciones |

---

## 🔎 Filtrado de datos por permiso/programa

Esquema `PERM-N` (antes `V-3`/parte de `D-N`) + `PROG-N` (serie nueva,
8 ago, aislamiento por *programa* — no confundir con `PERM-N`, que es
control de acceso; `PROG-N` es catálogo/enforcement de qué programas
existen y quién los ve).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **PERM-1** | Pestañas de `AsistenciasModulo` no filtradas por permisos individuales | `AsistenciasModulo.jsx` | ✅ Cerrado |
| **PERM-2** | Mismo problema en `LogsView` | `LogsView.jsx` | ✅ Cerrado |
| **PERM-3** | `HistorialView` no respetaba `restringe_programa` | `HistorialView.jsx` | ✅ Cerrado |
| **PERM-4** | `exportarDatos()` consultaba tabla `asistencias` inexistente | `backupActions.js` | ✅ Cerrado (reabierto real en `PERM-7`) |
| **PERM-6** 🟡 | `puedeHacerBackup` solo se controlaba en UI, sin respaldo server-side — cualquier autenticado con lectura normal exportaba el dataset desde la consola | `backupActions.js` | ✅ Cerrado (8 ago) — RPC `exportar_backup_completo` (`0076`, SECURITY DEFINER) verifica el permiso antes de tocar cualquier tabla |
| **PERM-7** 🟢 | `PERM-4` nunca se aplicó al código real — `asistencias` (sin sufijo) no existe; sin chequeo de `.error`, backups quedaban incompletos en silencio, marcados como completos | `backupActions.js` | ✅ Cerrado (8 ago) — tabla corregida a `asistencias_diarias`, falla visible si cualquier consulta falla |
| **PROG-1** 🟡 | Mapeo inicial: filtro de programa era solo-cliente, sin RLS. Coordinadores pueden tener +1 programa (no es 1:1 como sede) | `useAuth.js` + 6 archivos de lectura | Mapeo completo, diseño en `PROG-2`, enforcement en `PROG-3` |
| **PROG-1a** 🟢 | `exportar_backup_completo` no validaba `p_programa` server-side | migración `0077` | ✅ Cerrado (8 ago) |
| **PROG-2** 🟡 | Esquema N:N `user_profiles_programas` + helper `usuario_puede_ver_programa()` (mismo patrón que sede) | migración `0078` | ✅ Cerrado (9 ago, verificado en Supabase real) |
| **PROG-3 fase 1** 🟢 | UI multi-programa en `ModalUsuario.jsx` + RPCs `admin_get/set_user_programas` | migración `0079` | ✅ Cerrado (8-9 ago) |
| **PROG-3 fase 2** 🟢 | Migración de los 6 puntos de lectura a `programasRestringidos`; hallazgo no anticipado: `ReporteAsistencias`/`ReporteRango` no revisaban el permiso en absoluto | 6 archivos | ✅ Cerrado (8 ago) |
| **PROG-3 fase 2a** 🟢 | `reporte_asistencias_rango_agregado` sin RLS por programa — `p_programa` era decorativo | migración `0080` | ✅ Cerrado (8-9 ago) |
| **PROG-3 fase 3** 🟢 | Enforcement real en RLS de `horarios`/`asistencias_diarias` (no `docentes`/`materias` — catálogos compartidos sin columna programa). Gap latente corregido: `usuario_puede_ver_programa()` no bypasseaba con `NOT restringe_programa` | migración `0081` | ✅ Cerrado (8-9 ago) — verificado en producción vía `pg_policies` |

**Serie `PROG-N` cerrada por completo** (8 ago): 6 migraciones (`0077`–`81`
+ `0075` de `OFF-10`), todas aplicadas y verificadas en Supabase real el
9 ago vía conector directo, no solo por archivo SQL.

---

## 📡 Offline y estado de red

Esquema `OFF-N` (antes `O-N`/`P-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **OFF-1** | Sin manejo offline/online para renovación de token QR | `useQRSession.js` | ✅ Cerrado |
| **OFF-2** | Registros irrecuperables de la cola offline nunca se purgaban | `offlineQueue.js` | ✅ Cerrado (TTL 48h) |
| **OFF-3** | Sin indicador visual de red caída en la proyección | `QRProyeccion.jsx` | ✅ Cerrado |
| **OFF-4** | Poll de rotación de QR seguía intentando sin conexión | `useQRSession.js` | ✅ Cerrado |
| **OFF-5** | Service Worker no se registraba explícitamente | `main.jsx` | ✅ Cerrado |
| **OFF-6** | Lockout de PIN en `localStorage`, no resistía privado | `LoginScreen.jsx` | ✅ Cerrado (IndexedDB) |
| **OFF-7** | `DocenteScan` sin manejo offline | `DocenteScan/index.jsx` | ✅ Cerrado (cola IndexedDB, confirmación optimista) |
| **OFF-8** | Validación de token sin timeout, spinner infinito | `DocenteScan/index.jsx` | ✅ Cerrado (timeout 3s) |
| **OFF-9** 🟢 | Rate limit de `csp-report.js` en `Map()` de memoria — no persiste entre instancias serverless | `api/csp-report.js`, `0060` | ✅ Cerrado (2 ago) — contador movido a tabla vía RPC |
| **OFF-10** 🟢 | `AdminQRPanel` bloqueaba `crearSesion` sin red — el offline previo no cubría arranque en frío sin sesión activa (cortes de 5+h reportados) | `useQRSession.js`, `qrOfflineCache.js`, `manualAttendanceQueue.js`, migración `0075` | ✅ Cerrado (8 ago) — pre-generación de sesiones en IndexedDB + modo manual de respaldo (RPC `registrar_asistencia_manual`). Confirmado aplicado en producción el 16 ago |
| **OFF-11** 🟢 | `TTL_MINUTES=5` acoplaba cadencia de rotación del QR con margen de expiración — casi todo lo escaneado offline sincronizaba con token vencido | `useQRSession.js` | ✅ Cerrado (8 ago) — desacoplado en `ROTATION_MINUTES=5` / `EXPIRY_TTL_MINUTES=360` |
| **OFF-12** 🟡 | Carga de horarios por Excel sin ruta de recuperación ante corte de red a mitad de proceso | `excelUploadQueue.js` (nuevo) | ✅ Cerrado (10 ago) — guarda el `File` original + contexto en IndexedDB, reintento manual (no auto-sync, requiere revisar el catálogo fresco) |

---

## 🏗️ Arquitectura, testing y concurrencia

Esquema unificado `ARCH-N` (antes 3 esquemas: `A1`/`A2`/`A3`, `A-2`..`A-5`,
`ARCH-4`..`19`) — ver tabla de equivalencias.

### Concurrencia y datos asíncronos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-1** | Colisión de nombres entre stores IndexedDB — crasheaba producción | 3 archivos | ✅ Cerrado (prefijos únicos) |
| **ARCH-2** | Sin paginación por cursor en `ReporteRango` | `ReporteRango.jsx` | ✅ Cerrado — bug real corregido después en `UX-15` |
| **ARCH-3** | Sin guardia de sanidad si el cursor no avanza | `useDataSync.js` | ✅ Cerrado (retirada al pasar a paginación por offset) |
| **ARCH-4** | Sin `AbortController` — fetches obsoletos sobreescribían estado | `ReporteRango.jsx`, `useQRSession.js` | ✅ Cerrado |
| **ARCH-5** | Sin limpieza de datos al iniciar fetch sin caché | `ResumenView.jsx` | ✅ Cerrado |

### Testing, código muerto y estructura

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **ARCH-6** | `log_audit_event` sin rol/programa del actor | migración `0025` | ✅ Cerrado |
| **ARCH-7** | Sin tests para lógica crítica (`useAuth`, cola offline) | 2 archivos de test | ✅ Cerrado |
| **ARCH-8** | Sin tests de integración de hooks/flujos completos | 7 tests nuevos | ✅ Cerrado — 152/152 |
| **ARCH-9** | CSS embebido duplicado en template literal | `QRProyeccion.jsx` | ✅ Cerrado (extraído a `.css`) |
| **ARCH-10** | Bundle sin dividir — chunk principal 514 KB | `vite.config.js` | ✅ Cerrado — `lazy()`+`Suspense`, 503→468 KB |
| **ARCH-11** | `HorariosLayout.jsx`/`App.jsx` concentraban layout+sesión | ambos | ✅ Cerrado — extraídos sidebar/topbar |
| **ARCH-12** | Código muerto sin importadores | `ResponsiveStyles.jsx` | ✅ Cerrado (eliminado) |
| **ARCH-13** | 3 archivos >500 líneas más, mismo problema que `ARCH-11` | `HistorialView`/`LogsView`/`LoginScreen` | ✅ Cerrado (9 jul) |
| **ARCH-14** | Bloque fetch/headers repetido 13 veces | `api/admin-users.js` | ✅ Cerrado — extraído `supabaseAdminFetch()` |
| **ARCH-15** | Chunk `view-qr` 320 KB por `manualChunks` mal configurado | `vite.config.js` | ✅ Cerrado — 3 chunks reales (19/6.5/37.8 KB) |
| **ARCH-16** | Tests dependían de CDN externo para `xlsx`, sin fallback | `vendor/xlsx-0.20.3.tgz` | ✅ Cerrado (vendorizado con hash) |
| **ARCH-17** | Rollup metía Supabase/logger/utils compartidos en `view-qr` | `vite.config.js` | ✅ Cerrado — `manualChunks` por función, 320→90 KB |
| **ARCH-18** | `AdminQRPanel.jsx` volvió a crecer a 685 líneas | dividido en 3 | ✅ Cerrado — 685→543 |
| **ARCH-19** | Sin ESLint/Prettier ni lint en CI | `eslint.config.mjs` | ✅ Cerrado (12 jul) — 31 errores reales, 33 warnings no bloqueantes a propósito |
| **ARCH-20** | Cero PropTypes/TypeScript | 8 componentes reutilizados | ✅ Cerrado |
| **ARCH-21** | Chunk principal 446 KB pesado incluso solo para login | `useUpload.js` | ✅ Cerrado — culpable real `xlsx` estático, `import()` dinámico, -83% |
| **ARCH-22** | Toggle "mostrar X más" no hacía nada, código muerto | `UploadPreviewModal.jsx` | ✅ Cerrado (retirado, no arreglado — LS no lo pidió) |
| **ARCH-23** | `DocenteScan/index.jsx` a 525 líneas | dividido en 3 | ✅ Cerrado (15 jul) |
| **ARCH-24** | Chunk principal creció 74→134 KB sin revisión tras `ADMIN-3/4/5` | `App.jsx` | ✅ Cerrado — módulos raíz a `lazy()`, -4.4% |
| **ARCH-25** | `ReporteRango`/`AdminModulo`/`ModuleSelector` sin tests dedicados | 18 tests nuevos | ✅ Cerrado |
| **ARCH-26** | `VistaAusentes` pedía siempre el catálogo completo como fallback (caso raro tratado como común) | `VistaAusentes.jsx` | ✅ Cerrado (1 ago) |
| **ARCH-27** | `ReporteRango` paginaba 20.000 filas crudas para agrupar en cliente | RPC `reporte_asistencias_rango_agregado`, `0055` | ✅ Cerrado (1 ago) — agregación server-side |
| **ARCH-28** | Cálculos recalculados en cada render sin memoizar | `ReporteAsistencias`, `ReporteRango` | ✅ Cerrado — `useMemo` |
| **ARCH-29→31** 🔴 | Bloqueo optimista de `saveClase()` dependía de una migración (`updated_at`+trigger) que nunca se subió al repo — marcado cerrado sin aplicar | `horarioEditing.js`, migración `0057` | ✅ Cerrado (2 ago) — migración subida y verificada contra `pg_trigger` (8 filas: padre+7 particiones) |
| **ARCH-30** 🟡 | `HorariosLayout.jsx` sin `ErrorBoundary` propio — un crash tumbaba toda la app | mismo | ✅ Cerrado (2 ago) — boundary local en `.hl-main` |
| **ARCH-32** 🟢 | `registrar_asistencia()` sin backoff exponencial — dispositivo con mala señal podía auto-bloquearse | `scan_rate_limit`, `0058` | ✅ Cerrado (2 ago) — backoff 2→4→8...60min, decae en 24h |
| **ARCH-33** 🔴 | `0058` introdujo condición de carrera real (`SELECT FOR UPDATE`+`INSERT` suelto) | RPC, `0059` | ✅ Cerrado (2 ago) — vuelto a `UPSERT` atómico, reproducido y verificado contra Postgres real |
| **ARCH-34→35** 🟢 | Guard de CI contra `dependencies` mal puestas (causa de `SEC-26`) marcado cerrado sin llegar a `ci.yml` — mismo patrón que `ARCH-29`→`31` | `ci.yml` | ✅ Cerrado (3 ago), esta vez verificado contra el archivo real |
| **ARCH-36** 🔴 | Migraciones `0066`/`67` en carpeta huérfana (`supabase/` en vez de `docs/supabase/migrations/`), sin guard de CI | ambas carpetas | ✅ Cerrado (6 ago) — movidas + guard nuevo en CI |
| **ARCH-37** 🔴 | El sistema completo de Sedes (`SEDE-1`–14) nunca se registró en este índice — causa raíz de que `SEC-28`/`29`/`ARCH-36` pasaran sin auditar | `AUDITORIA_INDICE.md` | ✅ Cerrado (6 ago) — sección `§ SEDE-N` agregada |
| **ARCH-38** 🟢 | Fix `fecha-hoy-timezone` (`UX-27`) sin suite dedicada al tramo exacto 20:00–00:00 VE | test nuevo | ✅ Cerrado (9 ago) — 22 tests, incluye caso de recurrencia documentado (turno cruzando medianoche, no explotado hoy) |
| **ARCH-39** 🟡 | Sin test de carga repetible para la condición de carrera de `ARCH-33` | `scripts/qr-load-test.mjs` | 🟡 **Abierto** — script listo, falta secret `SUPABASE_SERVICE_ROLE_KEY` para correr contra Supabase real (ver Hallazgos abiertos) |
| **ARCH-40** 🟡 | `autovacuum` nunca disparaba en 3 tablas de upsert por clave con pocas filas vivas — bloat invisible que degradará con tráfico real | 3 tablas de rate limit | ✅ Cerrado (9 ago) — `autovacuum_vacuum_scale_factor` ajustado por tabla |
| **ARCH-41** 🟡 | Selector de trimestre en Planilla calculaba lapsos por aritmética de fechas, sin consultar `trimestres` — ofrecía trimestres inexistentes | `PlanillaQR.jsx`, `lapso.js` | ✅ Cerrado (9 ago) — consulta real con fallback defensivo |
| **ARCH-42** 🟢 | 24 warnings de ESLint preexistentes (0 errores) | 11 archivos | ✅ Cerrado (9 ago) — 5 lógica real de hooks corregida, 19 cosméticos documentados con `eslint-disable` puntual — 24→0 |
| **ARCH-43** 🟡 | El job de `qr-load-test` (documentado por `ARCH-39` como "pendiente") nunca llegó a `ci.yml` — mismo patrón que `ARCH-29`/`34` | `qr-load-test.yml` (nuevo) | ✅ Cerrado (10 ago) — workflow separado, cron semanal + manual, salta con exit 0 si faltan secrets |
| **ARCH-44** 🟢 | Verificado en la auditoría del 11 ago: no existe flujo de edición de `asistencias_diarias` en todo el repo — hipótesis de bloqueo optimista descartada, `registrar_asistencia_manual` ya es `INSERT ... ON CONFLICT DO NOTHING`, atómico | — | ✅ Cerrado — no aplicaba, verificado contra código real |

---

## 🔧 CI/CD y automatización

Esquema `CI-N` (antes `FIX-CI-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **CI-1** | Sin integración continua | `ci.yml` | ✅ Cerrado (`npm test`+`build` en cada PR/push) |
| **CI-2** | `console.log/warn/error` directos en producción | `utils/logger.js` | ✅ Cerrado (14 archivos migrados) |
| **CI-3** | Sin `npm audit` ni RLS smoke test en CI | `rls-smoke-test.mjs` | ✅ Cerrado (smoke test bloqueante) |
| **CI-4** | 2 usos de `console.info` directo | `main.jsx`, `cache.js` | ✅ Cerrado (9 jul) |

---

## 🎨 UI y estilos

Esquema `UX-N` (antes `U-N`+`A3`). **Serie "auditoría UI/UX de élite"**
(desde `UX-34`, 9 ago): pasadas de verificación independiente contra HEAD
real, no contra este índice, con clon fresco cada vez.

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **UX-1** | Estilos inline en `AdminQRPanel`, primer caso migrado | `AdminQRPanel.jsx`/`.css` | ✅ Cerrado |
| **UX-2** | Desbordes de layout en viewports móviles pequeños | 2 archivos | ✅ Cerrado |
| **UX-3** | Sin trampa de foco de teclado en modales | `useFocusTrap.js` | ✅ Cerrado |
| **UX-4** | `Campo.jsx` sin `htmlFor`/`id` — lector de pantalla no anunciaba | `DocenteScan/Campo.jsx` | ✅ Cerrado (`useId()`) |
| **UX-5** | Migración sistemática inline→CSS externo (requisito `SEC-3`) | Todo `src/` | ✅ Cerrado — 54→0 |
| **UX-6** | 7 archivos del shell principal nunca auditados para responsive | `src/app/*` | ✅ Cerrado (clases con prefijo + `@media`) |
| **UX-7** | Bundle sin dividir alargaba pantalla en blanco inicial | mismo que `ARCH-10` | ✅ Cerrado |
| **UX-8** | 3 componentes de login: `<label>` sin `htmlFor`/`id`, regresión de `UX-4` | `login/*.jsx` | ✅ Cerrado (11 jul) |
| **UX-9** | Solo 4/29 CSS con media queries | `HorariosView.css` | ✅ Cerrado (12 jul) |
| **UX-10** | "Panel QR" con fondo azul oscuro y título invisible | colisión de clases `.qrp-root` | ✅ Cerrado (12 jul, renombrado a prefijo `qap-`) |
| **UX-11** | 24/30 CSS sin regresión visual automatizada | Playwright (3×3 breakpoints) | ✅ Cerrado (16 jul) — CI bloqueante |
| **UX-12** | Deuda de `UX-9`: reglas responsive en archivo equivocado | `index.css`→`QRProyeccion.css` | ✅ Cerrado (13 jul) |
| **UX-13** ⛔ | Sin modo oscuro — preferencia de producto | tokens `--color-*` | ⛔ Revertido a pedido de LS (14 jul), no es hallazgo |
| **UX-14** | Sin edición in-line de horarios pese al permiso existente | `TurnoGrid.jsx`, `ModalEditarClase.jsx` (nuevo) | ✅ Cerrado (15 jul) — modal con confirmación |
| **UX-15** | "Reporte por Rango" tiraba error de tipo UUID | `ReporteRango.jsx` | ✅ Cerrado (14 jul) — paginación por offset, no cursor entero |
| **UX-16** | Reportes PDF sin formato (CSP bloqueaba `<style>` inline) | `exportPDF.js` | ✅ Cerrado (14 jul) — CSS/JS externos |
| **UX-17** | Manifest PWA fijo en modo claro | `vite.config.js` | ✅ Cerrado — correcto, la app es 100% claro por decisión de producto |
| **UX-18** | Comentario obsoleto sobre `UX-13` revertido | `ModuleSelector.css` | ✅ Cerrado |
| **UX-19** | "Cambiar módulo" inconsistente entre los 3 módulos | topbar de los 3 | ✅ Cerrado (14 jul) — botón unificado |
| **UX-20** | Sidebar de Horarios subutilizado, código muerto (`hasBadge`) | `HorariosSidebar.jsx` | ✅ Cerrado (14 jul) |
| **UX-21** | Estado de conexión enterrado en dropdown | `HorariosSidebar.jsx` | ✅ Cerrado (14 jul) — caja siempre visible |
| **UX-22** | Dropdown de Administración no cerraba al re-tocar el botón (condición de carrera) | `AdminMenu.jsx` | ✅ Cerrado (14 jul) |
| **UX-23** | Contador de permisos mostraba "17/15" | `usuarios/shared.jsx` | ✅ Cerrado (15 jul) — checkboxes faltantes agregados |
| **UX-25** 🟢 | Sin contador visible de registros QR pendientes de sincronizar | `DocenteScan/Shell.jsx` | ✅ Cerrado (2 ago) — badge `aria-live`, evento DOM propio |
| **UX-26** 🟢 | Efecto de suscripción realtime con deps incompletas | `useDataSync.js` | ✅ Cerrado (2 ago) |
| **UX-27** 🔴 | Recurrencia de `fecha-hoy-timezone`: reporte semanal vacío 8pm-medianoche hora VE | `ReporteRango.jsx` | ✅ Cerrado (2 ago) |
| **UX-28** 🔴 | Editar una clase movía la vecina y la perdía al reasignarla | `TurnoGrid.jsx` | ✅ Cerrado (2 ago) — conflictos ahora se marcan visualmente, no desaparecen |
| **UX-29** 🔴 | Bug relacionado: horas sin sufijo AM/PM (ej. `"3:15-5:30PM"`) posicionaban la clase mal | `utils/time.js`, `turno.js` | ✅ Cerrado (3 ago) — `partesHoraNormalizadas()` centraliza el parseo en 5 funciones |
| **UX-30** 🔴 | Turno "MIXTO" (PNF Agroalimentación, sin corte de mediodía, duración variable) truncado por la grilla de bloques fijos | 10 archivos | ✅ Cerrado (4 ago) — `buildBloquesDinamicos()`, 3 causas raíz + 3 follow-ups el mismo día |
| **UX-31** 🟡 | Mensaje técnico crudo del trigger de sede en toast de error | `errorMessages.js` (nuevo) | ✅ Cerrado (6 ago) — `mensajeAmigable()` |
| **UX-32** 🟢 | `mensajeAmigable()` solo cubría un caso — generalizado a lista de reglas | mismo | ✅ Cerrado (6 ago) — duplicados/FK agregados |
| **UX-33** 🟡 | Revisión externa (Grok): borrador de docente se perdía si el token QR expiraba antes de enviar; sin resumen de sesión en `AdminQRPanel` | `DocenteScan/*`, `AdminQRPanel.jsx`, `0072` | ✅ Cerrado (7 ago) — borrador con TTL propio + RPC de conteo esperado + resumen automático al cerrar |
| **UX-34** 🟡 | En móvil "no aparecen todos los pills" — `.asm-tabs` sin `min-width:0` empujaba el resto de la topbar fuera del viewport, sin scroll posible | `index.css` (`.asm-*`) | ✅ Cerrado (9 ago) — scroll horizontal + `flex-shrink:0` |
| **UX-35** 🟡 | Cobertura a11y/cross-browser parcial: solo Chromium, sin axe-core en CI | `a11y.spec.js` (nuevo) | ✅ Cerrado (10-14 ago) — WebKit (3 breakpoints) + axe-core, graduado a bloqueante 12 ago, ampliado a 2 pantallas admin 14 ago |
| **UX-36** 🟢 | JWT vencido a mitad de carga de Excel no se reconocía como recuperable — se perdía el archivo | `useUpload.js` | ✅ Cerrado (11 ago) — `esErrorDeSesionExpirada()`, misma cola que `OFF-12` |
| **UX-37** 🔴 | `.s-btn`/`.s-select`/`.s-input` ~27-30px, bajo el mínimo táctil de 44px | `index.css` | ✅ Cerrado (14 ago) — `min-height:44px` acotado a `(pointer: coarse)` |
| **UX-38** 🟢 | Padding de controles interactivos literal en 5+ lugares sin token compartido | `index.css` | ✅ Cerrado (14 ago) — tokens `--btn-pad-*`/`--field-pad` |
| **UX-39** 🟢 | Excepción de `color-contrast` (axe-core) heredada a ciegas a pantallas nuevas | `a11y.spec.js` | ✅ Cerrado (14 ago) — corre sin excepción en las 2 pantallas nuevas (fondo sólido, sin overlays) |
| **UX-40** 🟡 | Badge "Trimestre en curso" hardcodeado a `estado="activo"` — mostraba un trimestre ya cerrado como abierto, contradiciendo la tabla de historial debajo | `HistorialView.jsx` | ✅ Cerrado (15 ago) — badge lee `trimestreActual?.estado`; bug colateral corregido: "Cerrar trimestre activo" podía re-cerrar el trimestre equivocado |
| **UX-41** 🔴 | Modales de usuario/sede/trimestre sin `overflow-y:auto` en el backdrop — campos inalcanzables con teclado virtual abierto | `ModalUsuario.css`+2 más | ✅ Cerrado (15 ago) — mismo patrón ya usado en `ModalRol.css` |
| **UX-42** 🔴 | Botones de icono (`.qrp-hist-borrar-btn` 26px, `.mr-color-swatch` 24px) fuera del barrido de `UX-37` | `AdminQRPanel.css`, `ModalRol.css` | ✅ Cerrado (15 ago) |
| **UX-43** 🟡 | `ModalUsuario` validaba campo por campo, cortando en el primer error | `ModalUsuario.jsx` | ✅ Cerrado (15 ago) — `validar()` recolecta todos los errores, `aria-invalid` por campo, foco al primero |
| **UX-44** 🟢 | Mismo hueco de `UX-42` en `DocentesView`/`MateriasView`; `ModalRol.jsx` con el mismo problema de `UX-43` | 3 archivos | ✅ Cerrado (15 ago) |
| **UX-45** 🟢 | Colisión de nombre de clase entre `GlobalSearch.css` y Gestión de Sedes (`.gs-*`) | `GlobalSearch.css` | ✅ Cerrado (14 ago) — renombrado a `gsearch-root` |
| **UX-46** 🟢 | Tercer grupo de botones de icono sin target táctil, incl. `.gs-chip` | `DocentesView`/`MateriasView`/`GestionSedes.css` | ✅ Cerrado (15 ago) |
| **UX-47** 🟡 | `UploadPreviewModal`/`ModalCambiarPassword` sin trampa de foco ni cierre por Escape | ambos | ✅ Cerrado (15 ago) — `useFocusTrap` en los dos |
| **UX-48** 🟡 | `AdminMenu`/`UserMenu` solo cerraban por clic-afuera, sin Escape ni retorno de foco | ambos + `HorariosSidebar.jsx` | ✅ Cerrado (15 ago) |
| **UX-49** 🟢 | 7 de 14 `--role-color` usados como texto directo con contraste 1.92-3.77:1, bajo el 4.5:1 exigido | `index.css` | ✅ Cerrado (15 ago) — token nuevo `--role-text` |
| **UX-50** 🟢 | Vista previa del membrete al final del formulario en móvil — había que bajar y subir para ver el efecto de cada cambio | `ConfiguracionReportes.jsx` | ✅ Cerrado (14 ago) — barra sticky compacta en móvil |
| **UX-51** 🟢 | Fallback `.role-color--default` con contraste 4.32:1, bajo el 4.5:1 exigido | `index.css` | ✅ Cerrado (15 ago) — reemplazado, 9.41:1 |
| **UX-52** 🟢 | Re-verificación completa de las 51 entradas previas contra código real — único hallazgo nuevo: `ResumenView` sin límite de ancho en monitores ultra-anchos | `ResumenView.css` | ✅ Cerrado (15 ago) — `max-width:1600px` |
| **UX-53** 🔴 | Modal "Editar" de plantillas de reportes se desbordaba en celulares angostos | `TabPlantillas.css` | ✅ Cerrado (15 ago) — `max-width:100%` faltante en `.tp-preview-wrap` |
| **UX-54** 🟡 | Vista previa del membrete "desactualizada" — reimplementación manual en JSX no sincronizada con la plantilla real (logo de coordinación nunca se mostraba) | `ConfiguracionReportes.jsx` | ✅ Cerrado (15 ago) |
| **UX-55** 🟡 | `.pu-action-btn` sin target táctil — quedó fuera del barrido de `UX-37/42/44/46` porque `TabProgramas.jsx` (12 ago, posterior) la reutiliza | `PestanaUsuarios.css` | ✅ Cerrado (16 ago) — mismo patrón `(pointer: coarse)` |

*Nota (15 ago): `UX-44`–`46` estaban implementadas pero nunca indexadas —
agregadas retroactivamente. `UX-50`/`51` estaban comentadas en el código
como `UX-41` (colisión de ID con el `UX-41` real de scroll de backdrops) —
renumeradas sin cambio funcional.*

---

## 🎨 Identidad visual y sistema de diseño

Esquema `DESIGN-N` (antes `FE-N`).

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **DESIGN-1** | Iconografía resuelta con emojis nativos del SO | `buildNavGroups.js` | ✅ Cerrado — cero emoji funcional |
| **DESIGN-2** | Tipografía sin identidad, solo `system-ui` | `index.css` | ✅ Cerrado — fuente Inter |
| **DESIGN-3** | Tokens de diseño incompletos, faltaba escala `--font-size-*` | `index.css` | ✅ Cerrado (9 jul) — 21 variables, 569 sustituciones |
| **DESIGN-4** | Sin `:focus-visible` accesible consistente | `index.css` | ✅ Cerrado |
| **DESIGN-5** | Adopción mixta de `var(--token)`, valores px crudos | `index.css` | ✅ Cerrado (9 jul) — 17 reglas tokenizadas |

---

## 🆕 Funcionalidad nueva

Esquema `ADMIN-N` — funcionalidad pedida directamente por LS, no hallazgo
de auditoría (mismo formato de comentario en código).

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **ADMIN-1** | Borrado de registros de sesión/QR/reportes, solo admin | RPCs `admin_borrar_*` | `0054` | ✅ Cerrado (10 jul) |
| **ADMIN-2** | UI de borrado para `ADMIN-1` | `TabSesiones.jsx`+2 más | `0054` | ✅ Cerrado (10 jul) |
| **ADMIN-3** | Módulo "Sistema" propio (Usuarios/Registros/Historial), solo admin | `AdminModulo.jsx` (nuevo) | — | ✅ Cerrado (10 jul) |
| **ADMIN-4** | Jerarquía admin bloqueada en servidor (`SEC-15`) sin reflejo en UI | `usuarios/*.jsx` | — | ✅ Cerrado (10 jul) |
| **ADMIN-5** | Selector de módulo: 3 tarjetas no caían en una fila en desktop | `ModuleSelector.{jsx,css}` | — | ✅ Cerrado (12-13 jul) — grid `auto-fit`, rediseño compacto |
| **ADMIN-6** | Personalizar membrete de los 3 documentos imprimibles (logo/color/textos) | `reportePlantilla.js` (nuevo), `0056` | `0056` | ✅ Cerrado (1 ago) — permiso granular, logo como data URI, 20 tests nuevos |
| **ADMIN-7** | PWA completa (primera pasada): instalabilidad dedicada para `/scan` y proyección | `useInstallPrompt.js` (nuevo), 2 manifests nuevos | — | ✅ Cerrado (9 ago) — meta iOS agregados, fix de deep-link para usuarios con 2+ módulos. Push queda para 2da pasada |
| **ADMIN-8** (`PROG-4`) | Sedes → Programas: marcar qué programas están activos por sede, propagado a todo el sistema | `gestionSedes/Tab*.jsx` (nuevos), `0090` | `0090` | ✅ Cerrado (12 ago) — tabla `programas` + relación `sedes_programas`, sin borrado real (solo desactivar). **Migración pendiente aplicar en Supabase real** (confirmar con LS) |

---

## 🗓️ Trimestre activo en Asistencias (`ASIST-N`)

Esquema agregado el 12 ago: Asistencias debe abrir por defecto en el
trimestre actual, trimestres cerrados quedan de solo consulta (igual que
Horarios).

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **ASIST-1** | Sin hook único de trimestre activo; Horarios usaba heurística por calendario en vez de la tabla real | `useTrimestreActivo.js` (nuevo) | — | ✅ Cerrado (12 ago) |
| **ASIST-2** | Sin aviso/bloqueo cuando hoy cae fuera del rango del trimestre activo | `AdminQRPanel.jsx`, `PlanillaQR.jsx` | — | ✅ Cerrado (12 ago) |
| **ASIST-4** | Sin selector-atajo de trimestre en los 3 reportes | `ReporteAsistencias/*`, `lapso.js` | — | ✅ Cerrado (12 ago) — `rangoTrimestre()` |
| **ASIST-5** | `admin_borrar_asistencias_rango()` no validaba el trimestre — podía borrar de uno cerrado hace meses | `ReporteRango.jsx` | `0089` | ✅ Cerrado (12 ago) |
| **ASIST-6** | Sin forma de corregir fechas de un trimestre ya activo sin cerrarlo | `ModalTrimestre.jsx` | — | ✅ Cerrado (12 ago) — modo "editar" nuevo |
| **ASIST-7** | Toasts/confirmaciones del módulo Sistema nunca se pintaban (bug preexistente, no de `ASIST-6`) | `App.jsx`, `AsistenciasModulo.jsx` | — | ✅ Cerrado (12 ago) |
| **ASIST-8** | `useTrimestreActivo()` saltaba siempre al `estado='activo'` de BD sin mirar si hoy cae en su rango — un trimestre futuro marcado activo dejaba la app vacía | `useTrimestreActivo.js` | — | ✅ Cerrado (16 ago) — default al último cerrado si hoy no cae en el activo |

---

## 🏢 Sistema multi-sede (`SEDE-N`)

Agregado el 6 ago para cerrar `ARCH-37`: 14 hallazgos/pasadas reales
(commits desde `1f52fe9`) nunca volcados a este índice. `SEDE-8` no
existe (hueco de numeración sin código asociado, no es pérdida de
contenido).

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **SEDE-1/2** | Catálogo de sedes + permiso `puedeVerTodasLasSedes` | `sedes`, `usuarios/*` | `0061`,`0062` | ✅ Cerrado |
| **SEDE-3/4** | RLS de aislamiento por sede en catálogos/horarios + flujo `/scan` | tablas principales | `0063`,`0064` | ✅ Cerrado |
| **SEDE-5** | Creación inline de docente/materia no mandaba `sede_id` | `ModalEditarClase.jsx` | — | ✅ Cerrado |
| **SEDE-6** | Badge de sede activa, primera versión | `ModuleSelector.jsx` | — | ✅ Cerrado |
| **SEDE-7** | `useSedes()` disparaba fetch antes de que la sesión estuviera lista | `useSedes.js` | — | ✅ Cerrado |
| **SEDE-9** | `conflictos_horario_detalle()` sin filtro de sede | `useConflictos.js` | — | ✅ Cerrado |
| **SEDE-10** | Badge de sede promovido a `UserMenu` (único común a los 3 módulos) | `UserMenu.jsx` | — | ✅ Cerrado |
| **SEDE-11** 🔴 | **Crítico:** `replace_nombre_en_clases()` sin chequeo de permiso ni filtro de sede — cualquier autenticado reescribía `horarios.clase` de cualquier sede | RPC (`0032`) | `0068` | ✅ Cerrado (6 ago) |
| **SEDE-12** | 4 RPCs `admin_*` sin filtro de sede — no explotable hoy, expuesto ante un rol futuro | 4 RPCs | `0068` | ✅ Cerrado (6 ago) |
| **SEDE-13** | `admin_borrar_qr_sesiones`/`admin_borrar_asistencias_rango` sin filtro de sede, mismo hueco que `SEC-28`/`29` | 2 RPCs | `0068` | ✅ Cerrado (6 ago) |
| **SEDE-14** | `renovar_qr_token()` sin validar sede de la sesión | RPC | `0068` | ✅ Cerrado (6 ago) |
| **SEDE-15** | `PlanillaQR.jsx` nunca leía `sedeActiva` (autoabastecida, quedó fuera de `SEDE-3`–`14`) — solo se notó al agregar una 2ª sede | `PlanillaQR.jsx` | — | ✅ Cerrado (6 ago) |
| **SEDE-16** | 8 puntos de lectura sin filtro de sede para roles con `puedeVerTodasLasSedes` (RLS ya protege por sede fija, pero un rol multi-sede podía mezclar todas) | 8 archivos (reportes/edición/import) | `0069` | ✅ Cerrado (6 ago) |
| **SEDE-17** | Catálogo de sedes solo lectura desde UI — sin forma de crear/editar sedes | `GestionSedes.jsx` (nuevo) | `0070` | ✅ Cerrado (6 ago) — permiso propio `puedeGestionarSedes`, sin `DELETE` real (FKs entrantes) |
| **SEDE-18** | `PestanaUsuarios.jsx` llamaba `useSedes()` sin `userId` — selector de sede del modal quedaba vacío en silencio | `PestanaUsuarios.jsx` | — | ✅ Cerrado (6 ago) |

**Nota (6 ago):** `SEDE-11`/`13`/`14` los encontraron en paralelo una
auditoría externa (documentada como `SEC-28`/`29`) y esta pasada de LS —
la migración real (`0068`) es de LS.

---

## 🗂️ Esquema retirado (`Fix #N` / `Gap #N`)

Encontrados al construir `ESQUEMA_Y_MIGRACIONES.md`. Ya no se usan, pero
los comentarios siguen en el repo.

| Esquema | ID | Descripción | Archivo | Estado |
|---|---|---|---|---|
| `Fix #N` | **#2** | Políticas RLS `{public}`→`{authenticated}` en `user_profiles` | `0016` | ✅ Cerrado |
| `Fix #N` | **#3** | FK duplicada bloqueaba el login | `0017` | ✅ Cerrado |
| `Fix #N` | **#4** | Recursión en `get_auth_role()` dentro de RLS | `0016` | ✅ Cerrado |
| `Fix #N` | **#8** | RPCs sin verificación de permiso interno | `0018` | ✅ Cerrado |
| `Fix #N` | **#10** | Sin trigger contra borrar roles del sistema | `0019` | ✅ Cerrado |
| `Fix #N` | **#16** | Sin índices en `horarios` | `0020` | ✅ Cerrado |
| `Fix #N` | **#17** | RPCs de usuarios sin migración de respaldo | `0021` | ✅ Cerrado |
| `Gap #N` | **#16** | `importarDatos()` no restauraba asistencias | `0041` | ✅ Cerrado |

> `Fix #16` y `Gap #16` son el mismo número en esquemas distintos, sin
> relación. Si se retoma cualquiera, evitar reusar números.

---

## 📝 Historial de auditorías (hitos, no forensia completa)

El detalle forense (causas raíz, verificaciones paso a paso, commits
exactos) vive en las filas de cada ID de arriba y en el propio `git log` —
esta sección solo ubica *cuándo* pasó cada bloque de trabajo.

- **Jun–jul 2026:** cierre inicial de `SEC-1`→`27`, `ARCH-1`→`28`,
  `UX-1`→`23`, `DESIGN-1`→`5`, `CI-1`→`4`, `ADMIN-1`→`5`. Normalización de
  IDs a 8 prefijos únicos (13-14 jul).
- **1–2 ago:** `PERM-4`/`ARCH-26`/`27`/`28` cerrados; `OFF-9`, `ARCH-29`→`31`
  (bloqueo optimista reabierto y cerrado de verdad), `ARCH-30`, `ARCH-32`/`33`
  (backoff + condición de carrera), `UX-25`→`30` (incl. turno MIXTO).
- **3 ago:** `ARCH-34`→`35` reabierto y cerrado (guard de CI que nunca
  llegó al archivo real).
- **6 ago:** Auditoría de RLS destapa `SEC-30`→`32`; se descubre que el
  sistema completo de Sedes nunca se indexó (`ARCH-37`) → sección `SEDE-N`
  agregada con 14 hallazgos retroactivos (`SEDE-1`–`18`), incluidos 2
  críticos (`SEDE-11`, `SEC-28`/`29`). `ARCH-36` (migraciones huérfanas).
- **7 ago:** Auditoría completa de `EXECUTE` en toda función `SECURITY
  DEFINER` (`SEC-33`), causa raíz en privilegios por defecto (`SEC-34`).
- **8 ago:** `OFF-10`/`11` (offline en frío + TTL desacoplado, con
  reconciliación de drift contra 9 commits paralelos de LS). `PERM-6`/`7`,
  serie `PROG-N` completa (aislamiento por programa, `PROG-1`→`3 fase 3`).
- **9 ago:** Auditoría completa de BD (esquema/RLS/funciones/particiones/
  integridad) — 3 hallazgos menores (`SEC-35`/`36`, `ARCH-40`). `ARCH-38`,
  `ARCH-41`, `ARCH-42`. `ADMIN-7` (PWA primera pasada). Primera
  verificación en vivo vía `get_advisors` (`SEC-39`).
- **10 ago:** Auditoría de estrés operacional externa — `ARCH-43`,
  `SEC-38`, `OFF-12`, `UX-35` (piloto a11y/WebKit).
- **11 ago:** Auditoría integral pre-producción — veredicto apto,
  `UX-36` cerrado, `UX-35` ampliado a mobile/tablet-webkit y graduado a
  bloqueante el 12 ago.
- **12 ago:** Serie `ASIST-N` completa (trimestre activo). `ADMIN-8`/
  `PROG-4` (Sedes→Programas).
- **14–15 ago:** Serie de auditorías UI/UX de élite — `UX-37`→`54`
  (targets táctiles, contraste, validación agregada, focus-trap, colisiones
  de ID detectadas y renumeradas). Incidente de subida (`fe733d9`) revertido
  y resubido correctamente el mismo día, verificado byte a byte.
- **16 ago:** Reconciliación completa contra el proyecto real vía conector
  Supabase directo — `OFF-10`, `SEC-39(3)` confirmados cerrados; `SEC-37`
  reclasificado a no aplicable; `SEC-40`/`41` (RLS de trimestres cerrados)
  documentados retroactivamente; `ARCH-39` sigue abierto (falta secret,
  confirmado con log real de LS); `ASIST-8`; `UX-55` (verificación
  independiente encontró y cerró el mismo día). Esta pasada de compactación
  del índice (ver nota al final).

---

<details>
<summary><strong>Tabla de equivalencias — IDs antiguos → nuevos</strong></summary>

**SEC-N:** `S1`→`SEC-1`, `S2`→`SEC-2`, `S3`→`SEC-3`, `SEC-2`(viejo)→`SEC-4`,
`SEC-3`(viejo)→`SEC-5`, `SEC-5`(viejo)→`SEC-6`, `SEC-6`(viejo)→`SEC-7`,
`SEC-7`(viejo)→`SEC-8`, `SEC-8`(viejo)→`SEC-9`, `V-1`→`SEC-10`,
`V-2`→`SEC-11`, `V-4`→`SEC-12`, `D-3`→`SEC-13`, `D-6`→`SEC-14`,
`SEC-10`(viejo)→`SEC-15`, `SEC-11`(viejo)→`SEC-16`, `SEC-9`(viejo)→`SEC-17`,
`D-7`→`SEC-18`, `SEC-13`(viejo)→`SEC-19`, `SEC-14`(viejo)→`SEC-20`,
`SEC-12`(viejo)→`SEC-21`, `SEC-15`(viejo)→`SEC-22`.

**PERM-N:** `V-3`→`PERM-1`, `D-1`→`PERM-2`, `D-2`→`PERM-3`, `D-4`→`PERM-4`.

**OFF-N:** `O-1..5`→`OFF-1..5`, `O-8`→`OFF-6`, `P-2`→`OFF-7`, `P-3`→`OFF-8`.

**ARCH-N:** `A1`→`ARCH-1`, `A-2..5`→`ARCH-2..5`, `A2`→`ARCH-6`,
`ARCH-4..19`(viejo)→`ARCH-7..22`(nuevo, +3 de offset).

**UX-N:** `U-1..15`→`UX-1..4,6..16` (con `A3`→`UX-5` intercalado).

**DESIGN-N:** `FE-1..5`→`DESIGN-1..5`.

**CI-N:** `FIX-CI-1..4`→`CI-1..4`.

IDs mencionados en código pero nunca localizados (esquema antiguo,
probablemente descartados antes de `main`): `O-6`, `O-7`, `P-1`, `S1`,
`SEC-4`(viejo).

</details>

---

*Optimizaciones de este documento: pasadas previas (16 jul, 3 ago, 6 ago,
11 ago) fueron condensando narrativa repetida a filas de tabla — ver
`git log` de este archivo para el detalle de cada una. **16 ago (674→~430
líneas):** mismo criterio llevado más lejos a pedido explícito de LS —
descripciones/estados de ítems ✅ cerrados reducidos a causa raíz + fix en
1-2 líneas (antes varios párrafos con cifras/citas textuales/commits
exactos); el historial cronológico narrativo se reemplazó por hitos por
fecha (el detalle forense ya vive en las filas de cada ID); footer de
optimizaciones anteriores condensado. Nada se eliminó sin que la
información esencial (ID, causa raíz, fix, archivos, migración, estado)
sobreviviera en su fila. Para la forensia completa de cualquier hallazgo
puntual, `git log -p` sobre este archivo conserva cada versión anterior.*
