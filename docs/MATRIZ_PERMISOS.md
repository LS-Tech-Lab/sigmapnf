# 🔑 Matriz de permisos (RBAC)

Catálogo completo de permisos del sistema, dónde se define cada uno, y —lo
más importante para auditoría— **dónde se hace cumplir realmente** (RLS,
RPC, o solo la interfaz). Construido a partir de `src/components/usuarios/shared.jsx`
(fuente de verdad del catálogo oficial) y verificado contra cada punto de
uso en `src/` y `docs/supabase/migrations/`.

> **El modelo no es de roles fijos.** `SECURITY.md` describe una tabla de 4
> roles como si fueran las únicas opciones — eso era cierto en el diseño
> original, pero desde `0021_rpcs_gestion_usuarios.sql` los roles son
> **filas de la tabla `roles`**, creables y editables desde la UI (`PestanaRoles`).
> Cada rol tiene: `nombre`, `label`, `emoji`, `color`, `restringe_programa`
> (boolean), `permisos` (JSONB de `{clave: true/false}`), `es_sistema`
> (boolean — protege de borrado a los roles base, ver `0019`). Los 4 roles
> originales + `operador_qr` siguen existiendo, pero como datos, no como
> código — un administrador puede crear un rol nuevo con cualquier
> combinación de los permisos de abajo sin tocar una línea de SQL.

---

## 1. Catálogo oficial (`GRUPOS_PERMISOS`, `shared.jsx`)

### Horarios
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeVerTodo` | Cambiar libremente entre todos los PNF | RLS (`horarios`/`asistencias_diarias` vía `usuario_puede_ver_programa()`, `0081`) — ver §3 |
| `puedeEditarHorarios` | Arrastrar/colocar bloques, edición in-line | RLS (`horarios`, `0035`/`0045`) |
| `puedeBorrarHorarios` | Eliminar bloques, vaciar trimestres | RLS (`horarios`, `0035`/`0045`) + RPC `borrar_horarios` (`0018`) |
| `puedeGestionarTrimestres` | Cambiar lapso activo, crear/eliminar trimestres | RPC (`0025`) |

### Catálogos académicos
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeEditarDocentes` | Crear, renombrar, vincular cédula a docentes | RLS (`docentes`, `0046`) |
| `puedeEditarMaterias` | Crear/renombrar unidades curriculares | RLS (`materias`, `0046`) |
| `puedeImportarExcel` | Cargar horarios desde `.xlsx` | RLS (`horarios`/`docentes`/`materias`, `0046`) |

### Respaldo de datos
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeHacerBackup` | Descargar JSON con todos los datos | RPC `exportar_backup_completo` (`0076`, `SECURITY DEFINER`) — ver §3 |
| `puedeRestaurarBackup` | Sobrescribir datos desde un archivo | RPC (`0018`, `0041`) |

### Módulo QR
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeGestionarQR` | Abrir/cerrar sesiones QR, ver proyección | RLS + RPC `crear_qr_session` (`0035`, `0036`) |
| `puedeVerReporteAsistencias` | Consultar/exportar historial de asistencias; también gatea la pestaña "Estadísticas" (dashboard de analítica académica, `ESTAD-1`) | RLS (`asistencias_diarias`, `0036`) |
| `puedeBorrarSesiones` | Eliminar sesiones QR ya cerradas del historial | RLS/RPC (`0054`) |
| `puedeBorrarReportes` | Eliminar registros de asistencia en el reporte por rango | RLS/RPC (`0054`) |

### Administración
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeGestionarUsuarios` | Crear/editar/activar cuentas | RLS (`user_profiles`, `0016`/`0043`) + guard en cada RPC `admin_*` (`0021`) |
| `puedeGestionarRoles` | Crear/editar roles y sus permisos | RPC (`0021`) |
| `puedeVerLogs` | Historial de acciones del sistema | RPC (`0024`, `0031`–`0033`) |
| `puedeVerAuditoria` | Ver quién hizo qué y cuándo | RPC `get_audit_logs` (`0024`) |
| `puedeConfigurarReportes` | Personalizar logo, colores y textos del membrete de los 3 documentos imprimibles | Tabla `configuracion_reportes` (`0056`, **ADMIN-6**) |

---

## 2. El que no está en el catálogo: `puedeVerSoloSuPrograma`

Aparece en varios componentes (`PlanillaQR.jsx`, `App.jsx`, `HorariosLayout.jsx`,
`AppStyles.js`) pero **no es una clave de `roles.permisos`** — no la vas a
encontrar si inspeccionas el JSONB de un rol. Es **derivada en el cliente**,
calculada en `useAuth.js`/`usePerfilEfectivo.js` a partir de la columna
`roles.restringe_programa`:

```js
puedeVerSoloSuPrograma: !!rolInfo.restringe_programa
```

No es un bug — es el diseño correcto para ese caso (no tiene sentido que sea
editable independientemente en la UI de permisos, ya vive junto al rol). Lo
documento aquí explícitamente porque, a diferencia de los otros 19, grepear
`roles.permisos` por esta clave no la va a encontrar — y sin esta nota, la
próxima persona que audite el sistema de permisos puede asumir que falta.

**Actualizado por `PROG-N` (serie cerrada 8 ago):** un coordinador puede
tener **más de un** programa a cargo — a diferencia de sede, que es 1:1 por
usuario. `useAuth.js` ahora deriva `programasRestringidos` (array) desde la
tabla nueva `user_profiles_programas` (N:N, `0078`), con `programaRestringido`
(escalar) conservado como `programasRestringidos[0]` solo por compatibilidad
hacia atrás con código que aún no migró. `puedeVerSoloSuPrograma` en sí no
cambió de definición, pero dejó de ser una restricción solo-en-cliente: desde
`0081` tiene respaldo real en RLS (ver §3).

---

## 3. Historial: dos permisos que fueron solo-UI, ya cerrados

`puedeVerTodo` y `puedeHacerBackup` fueron en su momento un hallazgo real:
**no aparecían en ningún archivo SQL** — solo controlaban si un
botón/selector se mostraba en la interfaz, sin respaldo server-side. Ambos
quedaron cerrados desde entonces; se conserva el historial de cada uno
porque el razonamiento (qué se investigó, qué se descartó) sigue siendo
útil para auditorías futuras.

- **`puedeHacerBackup`** — cerrado como **`PERM-6`** (8 ago). `exportarDatos()`
  (`src/hooks/useAppData/backupActions.js`) hacía `SELECT *` directo contra
  `horarios`/`docentes`/`materias`/`asistencias_diarias` sin ningún RPC de
  por medio — el único freno real era el RLS por sede (`SEDE-14`), que
  nunca comprobaba este permiso en sí. Reemplazado por el RPC
  `exportar_backup_completo` (`0076`, `SECURITY DEFINER`): verifica
  `tiene_permiso(auth.uid(), 'puedeHacerBackup')` antes de tocar cualquier
  tabla, y repite el filtro por sede a mano en las 4 sub-consultas (al ser
  `SECURITY DEFINER` bypasea RLS). Sin fallback al camino inseguro si el
  RPC no existe todavía. Ver también **`PERM-4`** (hallazgo previo,
  separado): la consulta de respaldo apuntaba a una tabla inexistente
  llamada `asistencias` en vez de `asistencias_diarias` — corregido antes
  de `PERM-6`.

- **`puedeVerTodo`** — cerrado como cierre de la serie **`PROG-N`**
  (`PROG-1` → `PROG-3 fase 3`, 8 ago). Antes: la tabla `horarios` tenía
  `SELECT` público a nivel RLS, así que restringir este permiso solo
  simplificaba la UI, sin efecto real en los datos — un usuario
  restringido a un programa podía en teoría consultar la API directo y
  ver datos de otros programas. Cerrado con una serie de migraciones:
  `user_profiles_programas` como tabla N:N (`PROG-2`, `0078`, ya que un
  coordinador puede tener más de un programa, a diferencia de sede);
  RPCs de gestión multi-programa (`PROG-3` fase 1, `0079`); migración de
  los puntos de lectura del cliente a la lista completa en vez del
  escalar legado (`PROG-3` fase 2); y el cierre real, RLS en `horarios` y
  `asistencias_diarias` vía el helper `usuario_puede_ver_programa()`
  (`PROG-3` fase 3, `0081`). **Nota de alcance:** `docentes` y `materias`
  quedan fuera a propósito — son catálogos compartidos dentro de una sede
  (un mismo docente dicta en varios programas), no le pertenecen a un
  programa concreto. Detalle completo en `AUDITORIA_INDICE.md` (`PROG-1`
  a `PROG-3 fase 3`).
  > **Pendiente operativo:** las migraciones `0075`, `0077`–`0081` están
  > escritas y verificadas contra los tests, pero **aún no aplicadas en
  > el Supabase de producción** — aplicar en ese orden (`0081` depende de
  > `usuario_puede_ver_programa()`, creada en `0078`).

---

## 4. Cómo se administra (RPCs de `0021`)

| RPC | Qué hace |
|---|---|
| `admin_get_roles()` / `admin_upsert_role()` / `admin_delete_role()` | CRUD de roles — `admin_delete_role` respeta el trigger de `0019` (no borra `es_sistema = true`) |
| `admin_get_users()` / `admin_upsert_user_profile()` / `admin_toggle_user_activo()` / `admin_delete_user()` | CRUD de usuarios |
| `admin_create_auth_user()` / `admin_delete_orphan_auth_user()` / `admin_get_orphan_auth_users()` | Gestión del usuario en `auth.users` en paralelo a `user_profiles` (detecta/limpia huérfanos entre ambas tablas) |
| `admin_quedaria_sin_gestion()` | Guardia: evita que un admin se quite a sí mismo el único acceso de gestión, dejando el sistema sin nadie que pueda administrar usuarios |
| `admin_caller_puede_gestionar_usuarios()` | Helper interno — centraliza el `tiene_permiso(uid, 'puedeGestionarUsuarios')` que usan las demás RPCs `admin_*` |

Todas verifican el permiso del llamante internamente (vía
`admin_caller_puede_gestionar_usuarios` o `tiene_permiso` directo) — no
dependen de que el cliente ya haya filtrado la UI, que es la diferencia
clave frente a `puedeVerTodo`/`puedeHacerBackup` del §3.

---

## 5. Verificar contra la base de datos real

```sql
-- Catálogo de permisos realmente en uso por cada rol
SELECT nombre, label, restringe_programa, es_sistema, permisos
FROM roles ORDER BY nombre;

-- Confirmar que ningún rol tiene una clave fuera del catálogo oficial
-- (copiar TODOS_LOS_PERMISOS de shared.jsx a la lista de abajo)
SELECT nombre, jsonb_object_keys(permisos) AS clave
FROM roles
WHERE jsonb_object_keys(permisos) NOT IN (
  'puedeVerTodo','puedeEditarHorarios','puedeBorrarHorarios','puedeGestionarTrimestres',
  'puedeEditarDocentes','puedeEditarMaterias','puedeImportarExcel',
  'puedeHacerBackup','puedeRestaurarBackup',
  'puedeGestionarQR','puedeVerReporteAsistencias','puedeBorrarSesiones','puedeBorrarReportes',
  'puedeGestionarUsuarios','puedeGestionarRoles','puedeVerLogs','puedeVerAuditoria','puedeConfigurarReportes'
);
```

## 6. Mantenimiento

Si se agrega un permiso nuevo: (1) agregarlo a `GRUPOS_PERMISOS` en
`shared.jsx` — es la única fuente de verdad de la UI, (2) agregar la fila
correspondiente aquí con su enforcement real verificado (no asumido), y
(3) si controla algo sensible, confirmar que existe un respaldo en RLS o
RPC — no solo un `if (permisos.x)` en el componente, como en su momento le
faltó a `puedeVerTodo`/`puedeHacerBackup` (ver §3).

---

*Última actualización: 9 de agosto de 2026 — cierre de `PERM-6` y de la
serie `PROG-N`, y nota de `ESTAD-1` (dashboard de estadísticas reutiliza
`puedeVerReporteAsistencias`, sin permiso nuevo).*
