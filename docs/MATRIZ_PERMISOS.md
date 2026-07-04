# 🔑 Matriz de permisos (RBAC)

Catálogo completo de permisos del sistema, dónde se define cada uno, y —lo
más importante para auditoría— **dónde se hace cumplir realmente** (RLS,
RPC, o solo la interfaz). Construido a partir de `src/components/usuarios/shared.jsx`
(fuente de verdad del catálogo oficial) y verificado contra cada punto de
uso en `src/` y `supabase/migrations/`.

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
| `puedeVerTodo` | Cambiar libremente entre todos los PNF | **Solo UI** — ver §3 |
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
| `puedeHacerBackup` | Descargar JSON con todos los datos | **Solo UI** — ver §3 |
| `puedeRestaurarBackup` | Sobrescribir datos desde un archivo | RPC (`0018`, `0041`) |

### Módulo QR
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeGestionarQR` | Abrir/cerrar sesiones QR, ver proyección | RLS + RPC `crear_qr_session` (`0035`, `0036`) |
| `puedeVerReporteAsistencias` | Consultar/exportar historial de asistencias | RLS (`asistencias_diarias`, `0036`) |

### Administración
| Permiso | Qué habilita | Enforcement real |
|---|---|---|
| `puedeGestionarUsuarios` | Crear/editar/activar cuentas | RLS (`user_profiles`, `0016`/`0043`) + guard en cada RPC `admin_*` (`0021`) |
| `puedeGestionarRoles` | Crear/editar roles y sus permisos | RPC (`0021`) |
| `puedeVerLogs` | Historial de acciones del sistema | RPC (`0024`, `0031`–`0033`) |
| `puedeVerAuditoria` | Ver quién hizo qué y cuándo | RPC `get_audit_logs` (`0024`) |

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
documento aquí explícitamente porque, a diferencia de los otros 16, grepear
`roles.permisos` por esta clave no la va a encontrar — y sin esta nota, la
próxima persona que audite el sistema de permisos puede asumir que falta.

---

## 3. Hallazgo: dos permisos sin respaldo en RLS/RPC

`puedeVerTodo` y `puedeHacerBackup` **no aparecen en ningún archivo SQL** —
solo controlan si un botón/selector se muestra en la interfaz. Investigué
el impacto real de cada uno antes de calificarlo:

- **`puedeVerTodo`** — controla si el selector de programa deja elegir
  "todos" o lo restringe. La tabla `horarios` tiene `SELECT` público
  (`USING (true)`, ver `SECURITY.md`), así que quitarle este permiso a
  alguien no le impide nada a nivel de datos — solo le simplifica la UI.
  **No es un hallazgo de seguridad**, es una capa de conveniencia sin más.

- **`puedeHacerBackup`** — mismo patrón, pero encontré algo al revisar
  `exportarDatos()` (`src/hooks/useAppData/backupActions.js`): hace
  `SELECT *` directo contra `horarios`, `docentes`, `materias` y una tabla
  llamada **`asistencias`** (sin RPC de por medio). Como esas cuatro tablas
  ya tienen su propio RLS, alguien sin `puedeHacerBackup` que ejecute la
  misma consulta manualmente obtiene exactamente lo que su RLS ya le
  permitía ver — tampoco es una fuga nueva. **Pero:**

  > 🔴 **`asistencias` no es `asistencias_diarias`.** No hay ningún
  > `CREATE TABLE asistencias` en las migraciones — no es la tabla del
  > módulo QR que documenta `ESQUEMA_Y_MIGRACIONES.md`.
  >
  > **Confirmado contra la BD real** (`SELECT to_regclass('public.asistencias')` → `NULL`):
  > la tabla no existe. No era drift de una tabla legacy sin versionar —
  > era un nombre de tabla incorrecto. Cada backup exportado hasta ahora
  > tenía `asistencias: []` con `asistencias_incluidas: true` (falso
  > positivo silencioso: `.data || []` no distingue "tabla inexistente"
  > de "tabla vacía", así que nunca lanzó un error visible).
  >
  > **Cerrado como `D-4`** — un cambio de una línea en
  > `src/hooks/useAppData/backupActions.js` (`exportarDatos`): la consulta
  > ahora apunta a `asistencias_diarias`, igual que ya hacía el lado de
  > restauración (`importarDatos`, que nunca tuvo este bug). Ver
  > `AUDITORIA_INDICE.md` para el registro formal.

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
  'puedeGestionarQR','puedeVerReporteAsistencias',
  'puedeGestionarUsuarios','puedeGestionarRoles','puedeVerLogs','puedeVerAuditoria'
);
```

## 6. Mantenimiento

Si se agrega un permiso nuevo: (1) agregarlo a `GRUPOS_PERMISOS` en
`shared.jsx` — es la única fuente de verdad de la UI, (2) agregar la fila
correspondiente aquí con su enforcement real verificado (no asumido), y
(3) si controla algo sensible, confirmar que existe un respaldo en RLS o
RPC — no solo un `if (permisos.x)` en el componente, como ya se ve en
`puedeVerTodo`/`puedeHacerBackup`.

---

*Última actualización: julio 2026.*
