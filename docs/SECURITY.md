> **Nota:** Este documento describe el diseño original del sistema de roles y permisos.
> La migración referenciada como `0006_seguridad_roles_logs.sql` fue posteriormente
> dividida/renombrada en el historial real de migraciones (ver `0006_modulo_asistencias_qr.sql`,
> `0006b_acceso_anonimo_scan.sql` y `0007_rol_operador_qr.sql`). Se conserva como referencia
> conceptual de la matriz de roles, no como instrucción literal de instalación.
>
> **Estado del RLS:** la sección "Seguridad a nivel de base de datos" de más abajo describía
> el diseño original ("autenticados" como único criterio). Eso ya no refleja la realidad —
> ver **§ Estado actual de RLS (julio 2026)** para el estado verificado contra la base de
> datos real, con el historial de hallazgos y fixes.
>
> **Rutas de archivos:** algunas rutas de este documento (`src/components/UsuariosView.jsx`,
> `src/components/LogsView.jsx`) corresponden a la estructura original. La gestión de usuarios
> vive hoy en `src/components/usuarios/` (carpeta); `LogsView.jsx` sigue en `src/components/`.
>
> **Modelo de roles (agregado 11 ago):** la tabla "Estructura de roles y
> permisos" de abajo describe el diseño original de 4 roles fijos. Desde
> `0021` los roles son **filas editables de la tabla `roles`** (21 permisos
> reales, no una tabla fija) — la tabla de abajo sigue siendo una
> referencia útil para los 4 roles base + `operador_qr`, pero el catálogo
> completo, actualizado, y con el enforcement real de cada permiso vive en
> `MATRIZ_PERMISOS.md`. Esa tabla tampoco refleja el sistema de sedes
> (`SEDE-N`) ni el filtrado por múltiples programas (`PROG-N`) agregados
> en agosto — ver ahí y en § Estado actual de RLS más abajo.

# 🔐 Sistema de Seguridad — Guía de Implementación

## Archivos creados / modificados

### Nuevos archivos
| Archivo | Descripción |
|---|---|
| `src/hooks/useAuth.js` | Hook central de auth: roles, permisos, login, logout, logAudit |
| `src/components/UsuariosView.jsx` | Panel de gestión de usuarios (solo admin) |
| `src/components/LogsView.jsx` | Vista de logs de sesión y auditoría |
| `docs/supabase/migrations/0006_seguridad_roles_logs.sql` | Migración completa de BD |

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `src/App.jsx` | Integración de `useAuth`, menú adaptativo por rol, pantallas de error |
| `src/components/DocentesView.jsx` | Botón editar oculto si sin permiso |
| `src/components/MateriasView.jsx` | Botón editar oculto si sin permiso |
| `src/components/HistorialView.jsx` | Botones cerrar/crear ocultados si sin permiso |

---

## Estructura de roles y permisos

| Acción | Admin 👑 | Coordinador 🏛️ | Secretario 📋 | Administrativo 👤 |
|---|:---:|:---:|:---:|:---:|
| Ver horarios (su programa) | ✅ | ✅ | ✅ (solo su prog.) | ✅ |
| Importar Excel | ✅ | ✅ | ✅ (solo su prog.) | ❌ |
| Editar docentes/materias | ✅ | ✅ | ✅ (solo su prog.) | ❌ |
| Borrar horarios | ✅ | ✅ | ❌ | ❌ |
| Exportar backup | ✅ | ✅ | ❌ | ❌ |
| Restaurar backup | ✅ | ❌ | ❌ | ❌ |
| Gestionar trimestres | ✅ | ✅ | ❌ | ❌ |
| Ver logs de sesión | ✅ | ✅ | ❌ | ❌ |
| Ver auditoría | ✅ | ✅ | ✅ (solo su prog.) | ❌ |
| Gestionar usuarios | ✅ | ❌ | ❌ | ❌ |

> Existe además el rol `operador_qr` (agregado en `0007_rol_operador_qr.sql`),
> específico del módulo de asistencias: puede iniciar/cerrar sesiones QR y ver
> el reporte de asistencias, sin los permisos de esta tabla. Ver
> `FLUJO_ASISTENCIAS_QR.md` para el detalle de ese módulo.

---

## Pasos de implementación en Supabase

### 1. Ejecutar la migración SQL
En el Dashboard de Supabase → **SQL Editor**, ejecutar el archivo:
```
docs/supabase/migrations/0006_seguridad_roles_logs.sql
```

### 2. Crear el primer usuario administrador
En **Authentication → Users → Add user**:
- Email: `admin@tuinstitucion.edu.ve`
- Password: (elige una contraseña segura)
- Auto-confirm: ✅

Luego en el **SQL Editor**:
```sql
INSERT INTO user_profiles (id, email, nombre, rol)
VALUES (
  '<UUID-del-usuario-creado>',
  'admin@tuinstitucion.edu.ve',
  'Administrador del Sistema',
  'admin'
);
```

> El UUID del usuario se encuentra en la columna `id` de la tabla `auth.users`
> o en la pantalla del usuario recién creado en el Dashboard.

### 3. Crear los demás usuarios desde la app
1. Inicia sesión con la cuenta admin
2. Ve a **Sistema → Usuarios** (solo visible para admin)
3. Usa el botón **➕ Nuevo usuario**

> **Nota:** Si la creación desde la app falla (requiere Service Role Key),
> crea la cuenta en Supabase Dashboard y luego asigna el rol desde la app.

---

## Configuración de Supabase Auth recomendada

En **Authentication → Settings**:
- **Email confirmations**: desactivar (para que las cuentas funcionen inmediatamente)
- **Secure email change**: activar
- **Minimum password length**: 8
- **Rate limit**: activar (protección brute force en backend)

---

## Estado actual de RLS (julio 2026)

> Reemplaza la descripción original de esta sección, que solo exigía estar
> "autenticado" — ese fue precisamente el modelo vulnerable que las
> migraciones `0035`, `0043`, `0045` y `0046` corrigieron. Lo de abajo está
> verificado contra `pg_policies` / `pg_class` de la base real, no inferido
> de los archivos de migración únicamente (ver por qué eso importa en el
> hallazgo de `0046`, más abajo).

| Tabla | SELECT | INSERT / UPDATE | DELETE |
|---|---|---|---|
| `horarios` (tabla padre + particiones `horarios_lapso_*`) | Público (`USING (true)`) | Requiere `tiene_permiso(uid, 'puedeEditarHorarios')` | Requiere `tiene_permiso(uid, 'puedeBorrarHorarios')` |
| `docentes` / `materias` | Público (necesario: `DocenteScan` lee `docentes` sin sesión para autocompletar nombre al escanear) | Requiere `puedeEditarDocentes`/`puedeEditarMaterias` **o** `puedeImportarExcel` | Requiere el permiso de edición correspondiente |
| `user_profiles` | Cada usuario ve su perfil; admin ve todos | Columnas sensibles (`rol`, `activo`, `creado_por`) protegidas por trigger — solo modificables con `puedeGestionarUsuarios` | admin |
| `session_logs` / `audit_logs` | admin y coordinador; secretario limitado a su programa | vía RPC (`logAudit`) | — |
| `qr_sessions` / `asistencias_diarias` | Ver `FLUJO_ASISTENCIAS_QR.md` — modelo de acceso anónimo específico para `/scan`, con rate limiting por `device_fingerprint` | ídem | ídem |
| `sedes` (nueva, `0061`/`SEDE-1`) | Público (necesario: selector de sede en `/scan`, anónimo) | Requiere `puedeGestionarSedes` (`0070`) | Sin `DELETE` real — dar de baja es desactivar (`activa=false`) |
| `user_profiles_programas` (nueva, `0078`/`PROG-2`) | Ídem `user_profiles` (propio perfil o `puedeGestionarUsuarios`) | Vía RPC `admin_set_user_programas()` | ídem |
| `scan_rate_limit` / `admin_actions_rate_limit` / `csp_report_rate_limit` | **RLS habilitado, 0 políticas** — patrón más restrictivo: ni siquiera `authenticated` toca estas tablas directo vía PostgREST, solo acceso interno desde su RPC correspondiente | — | — |
| `configuracion_reportes` (nueva, `0056`/`ADMIN-6`) | Público (necesaria para renderizar el membrete en reportes imprimibles) | Requiere `puedeConfigurarReportes` | — |

### Checklist obligatorio para toda tabla nueva (agregado 9 ago, auditoría de BD)

Verificado contra `pg_default_acl` real: los privilegios por defecto de
`postgres` en el esquema `public` siguen otorgando `arwdDxtm` (lectura,
escritura, borrado completos) a **`anon` y `authenticated`** sobre toda
tabla/secuencia nueva — es el modelo estándar de Supabase (RLS es el único
gatekeeper real), corregido para funciones en `SEC-34`/`0074` pero **no
aplica a tablas**, y no se revierte a propósito (romper esto rompería el
modelo esperado de Supabase). Esta es la causa raíz estructural de `SEC-1`
(RLS nunca habilitado en `horarios`) y de `0043` (RLS nunca habilitado en
`user_profiles`): sin este paso, una tabla nueva queda con escritura
completa para `anon` desde el segundo cero.

Antes de mergear cualquier migración con `CREATE TABLE public.*`:

1. `ALTER TABLE public.<tabla> ENABLE ROW LEVEL SECURITY;` — en la misma
   migración que crea la tabla, nunca en una migración posterior.
2. Al menos una política por operación que la tabla necesite (`SELECT`,
   `INSERT`, `UPDATE`, `DELETE`) — una tabla con RLS activo pero 0
   políticas es válida y es el patrón más restrictivo (ver
   `scan_rate_limit`), pero debe ser una decisión explícita, no un olvido.
3. Confirmar contra la BD real, no solo contra el archivo de migración:
   ```sql
   SELECT relrowsecurity FROM pg_class WHERE relname = '<tabla>';
   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = '<tabla>';
   ```

### Historial de hallazgos y fixes (RLS)

| ID | Hallazgo | Causa raíz | Fix |
|---|---|---|---|
| SEC-1 | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de **cualquier** programa | Doble causa: (1) una política `FOR ALL` heredada ("Escritura autenticada") se combinaba en `OR` con las políticas granulares y las neutralizaba — las políticas RLS en PostgreSQL son permisivas por defecto; (2) la tabla padre particionada `horarios` nunca tuvo RLS habilitado sobre sí misma, solo en las particiones — y PostgREST accede siempre por el nombre del padre, así que ninguna política se evaluaba nunca en producción | `0035` (políticas granulares en las particiones) + `0045` (elimina la política heredada, habilita RLS en el padre, reaplica en todas las particiones vía `pg_inherits`) |
| — | `docentes`/`materias`: la política de escritura solo exigía `authenticated`, sin verificar el permiso específico (`puedeEditarDocentes`/`puedeEditarMaterias`) | Mismo patrón que SEC-1, alcance más angosto — RLS sí estaba activo (falso positivo parcial de un informe externo), pero sin control granular | `0046` |
| — | RLS de `user_profiles` nunca se activó a nivel de tabla, aunque las políticas existían desde `0016` | Drift entre lo aplicado directo en el dashboard de Supabase y lo versionado en el repo | `0043`, con un trigger adicional para proteger columnas sensibles antes de habilitar RLS |

> **Tabla sin actualizar desde julio — no es la lista completa.** Entre
> `SEC-8` y `SEC-39` hay ~30 hallazgos más de RLS/grants (políticas RLS
> huérfanas creadas a mano, funciones `SECURITY DEFINER` ejecutables por
> `anon` sin que ninguna migración lo otorgara, escalada de privilegios en
> gestión de usuarios, aislamiento por sede/programa, etc.) — mismo
> patrón de fondo (*drift* dashboard↔repo) que las 3 filas de arriba,
> pero no se duplican acá para no desincronizarse en dos lugares. Índice
> completo, verificado y actualizado activamente: `AUDITORIA_INDICE.md`
> § Seguridad y RLS.

**Patrón recurrente a vigilar:** varias de estas causas raíz son *drift* entre
cambios hechos directo en el dashboard de Supabase y lo que queda versionado
en `docs/supabase/migrations/`. Antes de dar por buena una política con solo leer
la migración, verificar contra la base real:

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'nombre_tabla';

SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'nombre_tabla';
```

---

## Cabeceras de seguridad y CSP (agregado 11 ago — faltaba en este documento)

Configuradas en `vercel.json`, aplican a toda ruta (`/(.*)`):

| Cabecera | Valor | Por qué |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; ...` — **sin `unsafe-inline`** | Cierre de `SEC-3`/`UX-5` (migración sistemática de estilos inline a CSS externo, ~30 componentes) |
| `X-Frame-Options` | `DENY` | Anti-clickjacking |
| `X-Content-Type-Options` | `nosniff` | — |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | HSTS |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Superficie de API del navegador que la app no usa |
| `Reporting-Endpoints` / `report-to` / `report-uri` | `/api/csp-report` | `SEC-24` — violaciones de CSP se registran en `audit_logs`, rate limit 20 req/min por IP (`api/csp-report.js`, persistente desde `OFF-9`/`0060`, antes `Map()` en memoria) |

CodeQL (SAST) corre en cada push/PR + cron semanal (`SEC-20`) — ver
Security → Code scanning del repo para el estado actual, no asumir que
0 hallazgos hoy es permanente.

## Estado del advisor de seguridad nativo de Supabase (verificado en vivo, 11 ago)

Primera vez que este documento se cruza contra `get_advisors`/security del
proyecto real (antes solo se auditaba `pg_policies`/`pg_proc` a mano). Dos
hallazgos abiertos, ninguno bloqueante — detalle completo en
`AUDITORIA_INDICE.md` (`SEC-37`, `SEC-39`):

- **`auth_leaked_password_protection` deshabilitado.** Auth no verifica
  contraseñas nuevas contra HaveIBeenPwned. Bloqueado por plan — requiere
  Supabase Pro, el proyecto está en `free`. Impacto acotado: no hay
  self-signup público, los usuarios los da de alta un admin
  (`admin_create_auth_user`).
- **Rate limiting nativo de Auth**: confirmado activo y reforzado
  (sign-ups/sign-ins 4 req/5min por IP, resto en default) — respaldo real
  del lockout de `SEC-6`/`SEC-7` (aplicación), no lo reemplaza.
- Hardening menor sin explotación conocida: ~15 funciones sin
  `search_path` fijo, extensión `pg_trgm` en el schema `public` en vez de
  uno dedicado, y una posible función `restaurar_backup()` duplicada con
  firma distinta (pendiente que LS confirme cuál usa el frontend real).

---

## Flujo de log de auditoría

Cada operación de escritura llama a `logAudit()` automáticamente:

```js
// Ejemplo en App.jsx
await logAudit({
  accion:            "IMPORTAR_EXCEL",
  entidad:           "horarios",
  lapso:             "2-2025",
  programa_afectado: "PNF Informática",
  resumen:           "Importación Excel: horarios_informatica.xlsx",
});
```

Las acciones registradas automáticamente son:
- `IMPORTAR_EXCEL` — al cargar un archivo
- `EXPORTAR_BACKUP` — al descargar backup
- `CREAR_USUARIO` / `EDITAR_USUARIO` / `ACTIVAR_USUARIO` / `DESACTIVAR_USUARIO`
- `CREAR_TRIMESTRE` / `CERRAR_TRIMESTRE` — integrado en `HistorialView.jsx`
- `EDITAR_DOCENTE` / `EDITAR_MATERIA` / `UNIFICAR_DOCENTE` / `UNIFICAR_MATERIA` — integrado en `useAppData/nameEditing.js`

---

## Política de rotación de `SUPABASE_SERVICE_ROLE_KEY`

> Fix SEC-22 (auditoría 12 de julio): esta clave no tenía política
> documentada de rotación. No es una vulnerabilidad activa — es una nota
> de proceso para el día en que haga falta rotarla (sospecha de fuga,
> salida de alguien con acceso al Dashboard, rotación preventiva
> periódica).

**Dónde vive y quién la usa:**
- Es la **única** clave de Service Role en el proyecto (bypassa RLS por
  completo). Se usa exclusivamente en `api/admin-users.js`, la Vercel
  Function que respalda la gestión de usuarios (crear/editar/desactivar
  cuentas vía Auth Admin API) — ver § "Pasos de implementación", punto 3.
- **No** se usa en el frontend (`src/`) ni se expone nunca al navegador:
  solo existe como variable de entorno del lado servidor en Vercel.
- Se distingue de `VITE_SUPABASE_ANON_KEY` (pública, sujeta a RLS, sí
  viaja al navegador) — confundirlas en un rotado sería el error más
  costoso, revisar siempre el nombre exacto de la variable antes de tocar
  algo en el Dashboard.

**Cuándo rotarla:**
1. **Sospecha o confirmación de fuga** (commit accidental, log expuesto,
   captura de pantalla, etc.) — rotar de inmediato, es el único caso
   urgente.
2. **Alguien con acceso al Dashboard de Supabase o a las variables de
   entorno de Vercel dejó el proyecto** — rotar antes de que termine su
   acceso, no después.
3. **Rotación preventiva periódica** — no hay un plazo fijo impuesto por
   Supabase; se sugiere revisarla al menos una vez al año o al hacer un
   cambio mayor de infraestructura, como criterio de higiene y no porque
   haya un incidente.

**Cómo rotarla (pasos):**
1. En el Dashboard de Supabase → **Project Settings → API**, generar una
   nueva Service Role Key (Supabase invalida la anterior al regenerarla).
2. En **Vercel → el proyecto → Settings → Environment Variables**,
   actualizar `SUPABASE_SERVICE_ROLE_KEY` con el valor nuevo en los tres
   entornos (Production, Preview, Development) si aplica.
3. Volver a desplegar (`Redeploy` en Vercel, o un push a `main`) — la
   Function no recoge la variable nueva hasta el próximo deploy.
4. Verificar con una acción real de `api/admin-users.js` (por ejemplo,
   editar un usuario de prueba) que la clave nueva funciona antes de dar
   por cerrada la rotación.
5. Si la rotación fue por sospecha de fuga, revisar además
   `admin_actions_rate_limit` (`SEC-16`) y los `audit_logs` del período
   en cuestión por actividad no reconocida.

> No hay automatización para este proceso — es manual a propósito, dado
> que ocurre con muy poca frecuencia y automatizarlo agregaría una
> superficie de riesgo (permisos amplios para rotar una clave que ya de
> por sí bypassa RLS) desproporcionada al beneficio.

---

## Pendientes opcionales (mejoras futuras)

> **Los 4 ítems que listaba esta sección originalmente ya están resueltos**
> — verificado contra el código real en julio 2026, no asumido:
>
> 1. Auditoría en edición de docentes/materias → `useAppData/nameEditing.js`
>    llama `logAudit` en cada rama (`EDITAR_DOCENTE`, `EDITAR_MATERIA`,
>    `UNIFICAR_DOCENTE`, `UNIFICAR_MATERIA`).
> 2. Auditoría en `HistorialView` → `logAudit` se recibe como prop y se
>    llama en `handleCerrar`/`handleCrear` (`CERRAR_TRIMESTRE`/`CREAR_TRIMESTRE`).
> 3. Creación de usuarios con Service Role → implementado como
>    `api/admin-users.js` (Vercel Function), no como Edge Function de
>    Supabase. La versión original de este pendiente describía la Edge
>    Function como la única forma de lograrlo — quedó obsoleta cuando se
>    migró el enfoque, no cuando se resolvió el pendiente.
> 4. Cambio de contraseña propio → `ModalCambiarPassword.jsx`.
>
> No queda ningún pendiente abierto en esta lista. El único hallazgo de
> seguridad que seguía abierto tras la auditoría de sesiones (protección
> de fuerza bruta server-side en el login) se cerró como `SEC-7` — ver
> `AUDITORIA_INDICE.md`.

---

*Última actualización: 11 de agosto de 2026 — agregadas las secciones
que faltaban por completo (cabeceras/CSP, estado del advisor nativo de
Supabase), tablas nuevas de agosto sumadas a § Estado actual de RLS, y
nota sobre el modelo de roles dinámico (`MATRIZ_PERMISOS.md` es la
fuente de verdad actualizada, no la tabla de 4 roles de este documento).
Actualización anterior: julio 2026.*
