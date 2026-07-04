# 📋 Índice de hallazgos de auditoría

Índice único de los IDs de hallazgos (`S1`, `V-1`, `O-3`, `A-4`, etc.) que
aparecen dispersos en comentarios de código y migraciones. Antes de este
documento, ubicar qué es un ID específico requería grep sobre todo el repo.

> **Cómo se construyó:** cada fila se verificó contra el código/migración
> real (no contra un informe externo) — mismo criterio que se aplicó al
> corregir `0046`, donde un hallazgo reportado externamente resultó ser un
> falso positivo parcial al compararlo con la base de datos real.
>
> **IDs no localizados:** `O-6`, `O-7`, `P-1`, `SEC-1`, `SEC-4`, `SEC-7` se
> referencian en la numeración pero no aparecen en el código actual —
> probablemente descartados, renombrados, o fusionados con otro fix antes
> de llegar a `main`. Si alguno reaparece en un commit viejo, agregarlo
> aquí con su estado real en vez de dejarlo suelto.
>
> **Cobertura:** este índice cubre el esquema categorizado vigente
> (`S`/`SEC`/`V`/`D`/`O`/`A`/`ARCH`/`U`/`P`) — `SEC-N` es una serie
> paralela a `S`/`V`/`D`/`O`/`A` enfocada específicamente en autenticación
> y sesión, encontrada al implementar `SEC-6`. El proyecto usó además
> **otras dos nomenclaturas anteriores** a todo esto, encontradas al
> construir `ESQUEMA_Y_MIGRACIONES.md` — ver § Histórico más abajo.

---

## 🔐 Seguridad y RLS

| ID | Descripción | Archivo(s) clave | Migración | Estado |
|---|---|---|---|---|
| **S1** | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de cualquier programa (política heredada `FOR ALL` + RLS nunca habilitado en la tabla padre particionada) | `horarios` (padre + particiones) | `0035`, `0045` | ✅ Cerrado |
| **S3** | Estilos inline (`style={{...}}`) bloquean una política CSP estricta (`unsafe-inline` necesario mientras existan) | `HistorialView`, `ResumenView`, `LogsView` y otras — **40 archivos** con `style={{` todavía presentes | — | 🟡 **Abierto** — bloqueado por `A3` |
| **SEC-2** | Stack trace completo de errores visible en producción (fuga de información interna) | `src/components/ErrorBoundary.jsx` | — | ✅ Cerrado (solo se renderiza en desarrollo) |
| **SEC-3** | Sin validación centralizada de fortaleza de contraseñas | `src/utils/password.js` | — | ✅ Cerrado |
| **SEC-5** | Lockout de login normal en `localStorage` no resistía pestañas privadas (mismo patrón que `O-8`, para PIN) | `src/components/LoginScreen.jsx`, `src/utils/pinOffline.js` | — | ✅ Cerrado (migrado a IDB, cliente) |
| **SEC-6** | Sin respaldo server-side del lockout de `SEC-5` — bastaba borrar el IDB o cambiar de navegador/dispositivo para seguir intentando sin límite contra la misma cuenta | `src/components/LoginScreen.jsx`, RPC `verificar_bloqueo_login` | `0047` | ✅ Cerrado |
| **V-1** | `_aplicar_rls_horarios()`: INSERT y DELETE sin restricción de permiso granular | `horarios` | `0035` | ✅ Cerrado (ver S1 — la causa raíz completa no se cerró hasta `0045`) |
| **V-2** | RLS de `qr_sessions` y `asistencias_diarias` sin permisos granulares (`puedeGestionarQR` / `puedeVerReporteAsistencias`) | `qr_sessions`, `asistencias_diarias` | `0036` | ✅ Cerrado |
| **V-4** | `crear_qr_session()` solo validaba `rol = authenticated`, no el permiso `puedeGestionarQR` | RPC `crear_qr_session` | `0035` | ✅ Cerrado |
| **D-3** | Sin rate limiting en `registrar_asistencia()` — permitía flood de asistencias falsas con cédulas distintas desde un mismo dispositivo | `registrar_asistencia`, tabla `scan_rate_limit` | `0039`, `0040` | ✅ Cerrado |

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
| **ARCH-5** | Sin tests de integración para hooks compuestos | `useConflictos.integration.test.js`, `useAuth.integration.test.js`, `useNombresCache.integration.test.js` | ✅ Cerrado |

## 🎨 UI y estilos

| ID | Descripción | Archivo(s) clave | Estado |
|---|---|---|---|
| **U-1** | Estilos inline en `AdminQRPanel` — primer caso migrado a CSS externo, sentó el patrón que luego siguió A3 | `AdminQRPanel.jsx` / `.css` | ✅ Cerrado |
| **U-3** | Sin trampa de foco de teclado en modales (accesibilidad) | `src/hooks/useFocusTrap.js` | ✅ Cerrado |
| **A3** | Migración sistemática de estilos inline a CSS externo, requisito para poder cerrar S3 (CSP) | `LoginScreen`, `ConfirmModal`, `DocentesView`, `AdminQRPanel` ya migrados — **40 archivos pendientes** | 🟡 **En curso** |

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

**Abiertos ahora mismo:** solo `S3`/`A3` (la misma tarea, vista desde
seguridad y desde UI respectivamente) — ver `AUDITORIA_FRONTEND.md` para el
detalle del reemplazo de estilos inline pendiente. Con el cierre de `SEC-6`,
no queda ningún otro hallazgo de seguridad abierto en este índice. Para el
índice de migraciones SQL y el esquema de base de datos, ver
`ESQUEMA_Y_MIGRACIONES.md`.

---

*Última actualización: julio 2026.*
