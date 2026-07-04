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

# 🔐 Sistema de Seguridad — Guía de Implementación

## Archivos creados / modificados

### Nuevos archivos
| Archivo | Descripción |
|---|---|
| `src/hooks/useAuth.js` | Hook central de auth: roles, permisos, login, logout, logAudit |
| `src/components/UsuariosView.jsx` | Panel de gestión de usuarios (solo admin) |
| `src/components/LogsView.jsx` | Vista de logs de sesión y auditoría |
| `src/supabase/migrations/0006_seguridad_roles_logs.sql` | Migración completa de BD |

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
src/supabase/migrations/0006_seguridad_roles_logs.sql
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

### Historial de hallazgos y fixes (RLS)

| ID | Hallazgo | Causa raíz | Fix |
|---|---|---|---|
| S1 | Cualquier usuario autenticado podía `UPDATE`/`INSERT`/`DELETE` horarios de **cualquier** programa | Doble causa: (1) una política `FOR ALL` heredada ("Escritura autenticada") se combinaba en `OR` con las políticas granulares y las neutralizaba — las políticas RLS en PostgreSQL son permisivas por defecto; (2) la tabla padre particionada `horarios` nunca tuvo RLS habilitado sobre sí misma, solo en las particiones — y PostgREST accede siempre por el nombre del padre, así que ninguna política se evaluaba nunca en producción | `0035` (políticas granulares en las particiones) + `0045` (elimina la política heredada, habilita RLS en el padre, reaplica en todas las particiones vía `pg_inherits`) |
| — | `docentes`/`materias`: la política de escritura solo exigía `authenticated`, sin verificar el permiso específico (`puedeEditarDocentes`/`puedeEditarMaterias`) | Mismo patrón que S1, alcance más angosto — RLS sí estaba activo (falso positivo parcial de un informe externo), pero sin control granular | `0046` |
| — | RLS de `user_profiles` nunca se activó a nivel de tabla, aunque las políticas existían desde `0016` | Drift entre lo aplicado directo en el dashboard de Supabase y lo versionado en el repo | `0043`, con un trigger adicional para proteger columnas sensibles antes de habilitar RLS |

**Patrón recurrente a vigilar:** varias de estas causas raíz son *drift* entre
cambios hechos directo en el dashboard de Supabase y lo que queda versionado
en `supabase/migrations/`. Antes de dar por buena una política con solo leer
la migración, verificar contra la base real:

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'nombre_tabla';

SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'nombre_tabla';
```

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
> de fuerza bruta server-side en el login) se cerró como `SEC-6` — ver
> `AUDITORIA_INDICE.md`.
