# 🗄️ Esquema de base de datos e índice de migraciones

Índice cronológico de las 42 migraciones versionadas y estado actual
reconstruido del esquema. Pensado para que auditar o incorporar a alguien
nuevo no requiera leer 42 archivos SQL en orden.

> **Metodología y su límite:** esto se reconstruyó leyendo `supabase/migrations/*.sql`,
> no consultando la base de datos real (`information_schema`). El propio historial de
> migraciones (`0021`, `0031`, `0032`, `0043`, `0044`) muestra que **varias veces hubo
> objetos en producción que no tenían archivo de migración correspondiente** — es decir,
> leer solo el código ya demostró no ser suficiente antes. Antes de confiar en una columna
> o política listada aquí para una decisión importante, verificar contra la BD real con
> las queries de la sección final.

---

## 1. Hallazgo al construir este índice: tres nomenclaturas de hallazgos distintas

Al recorrer las 42 migraciones para este documento salieron **dos esquemas de ID que
`AUDITORIA_INDICE.md` no tenía registrados** — ese documento solo cubre el esquema
lettered actual (`S1`, `V-1`, `O-3`, `A-4`...). Quedan pendientes de incorporar ahí:

| Esquema | Rango visto | Migraciones | Vigente |
|---|---|---|---|
| `Fix #N` (secuencial simple) | `#2, #3, #4, #8, #10, #16, #17` | `0016`–`0021` | No — reemplazado por el esquema lettered |
| `Gap #N` | `#16` (probablemente hay más sin buscar exhaustivamente) | `0041` | No — visto una sola vez |
| `S`/`V`/`D`/`O`/`A`/`ARCH`/`U`/`P` (categorizado) | Ver `AUDITORIA_INDICE.md` | `0035` en adelante | ✅ Sí, es el que se sigue usando |

No los mezclé en `AUDITORIA_INDICE.md` todavía porque son de otra sesión de trabajo —
lo señalo aquí para que se agregue como sección "histórico" en ese documento cuando
lo retomes, en vez de perderse otra vez.

---

## 2. Índice cronológico de migraciones

| # | Archivo | Qué hace |
|---|---|---|
| 0005 | `rpc_transaccional_borrado_restauracion.sql` | `borrar_horarios`/restauración envueltas en transacción (evita BD a medio borrar si se corta la conexión) |
| 0006 | `modulo_asistencias_qr.sql` | Esquema base del módulo QR: `qr_sessions`, `asistencias_diarias`, RPCs `crear_qr_session`/`renovar_qr_token`/`registrar_asistencia` |
| 0006b | `acceso_anonimo_scan.sql` | Habilita acceso anónimo (rol `anon`) a `registrar_asistencia` — necesario para que `/scan` funcione sin login |
| 0007 | `rol_operador_qr.sql` | Nuevo rol `operador_qr` en `user_profiles` |
| 0008 | `entrada_salida_y_horario_docente.sql` | Columna `tipo` (ENTRADA/SALIDA) en `asistencias_diarias`; `docentes.cedula`; función `horario_docente_hoy()` |
| 0009 | `cedula_como_id_unico_docente.sql` | Cédula como identificador único de docente; RPC `docentes_con_cedula()` |
| 0010 | `realtime_asistencias_qr.sql` | Agrega `asistencias_diarias` a la publicación `supabase_realtime` (habilita la rotación de QR por escaneo) |
| 0011 | `diagnostico_entrada_salida.sql` | Script de solo lectura para verificar en producción que `0008` se aplicó — no forma parte del pipeline |
| 0012 | `limpieza_datos_prueba_opcional.sql` | Opcional: borra un registro de prueba ("John Doe") detectado contaminando reportes |
| 0013 | `seguridad_fecha_servidor.sql` | Valida la fecha en el servidor (evita que un reloj de dispositivo manipulado falsifique `fecha`) |
| 0014 | `rpc_reset_password.sql` | RPC `admin_reset_user_password` |
| 0015 | `fix_rol_constraint_y_borrar_usuario.sql` | Corrige constraint de `rol` en `user_profiles`; RPC para eliminar usuario |
| 0016 | `fix_rls_user_profiles.sql` | *(Fix #2/#4)* Políticas RLS con rol `{public}` corregidas a `{authenticated}`; elimina recursión en `get_auth_role()` |
| 0017 | `drop_fk_duplicada_rol.sql` | *(Fix #3)* Elimina FK duplicada que bloqueaba el login (`PGRST201`) |
| 0018 | `fix_rpc_permisos_faltantes.sql` | *(Fix #8)* Agrega verificación de permisos a `borrar_horarios`/`restaurar_backup` |
| 0019 | `trigger_protect_roles_sistema.sql` | *(Fix #10)* Trigger que impide borrar roles con `es_sistema = true` |
| 0020 | `indices_horarios.sql` | *(Fix #16)* Índices en `horarios` para evitar full table scans |
| 0021 | `rpcs_gestion_usuarios.sql` | *(Fix #17)* Documenta RPCs de gestión de usuarios creadas directo en Supabase (sin esto, un reset de BD las perdería) |
| 0022 | `indices_asistencias.sql` | Índices en `asistencias_diarias` (documenta índices ya creados manualmente) |
| 0023 | `redeclarar_docentes_con_cedula.sql` | Redeclara `docentes_con_cedula()`, perdida al no estar en ninguna migración previa completa |
| 0024 | `audit_logs_tabla_y_retencion.sql` | Tabla `audit_logs` + RPCs `get_audit_logs`/`log_audit_event` + política de retención |
| 0025 | `correcciones_auditoria_bd.sql` | Correcciones varias de la auditoría de BD de junio 2026 (idempotentes) |
| 0026 | `formato_v2_docentes_y_materias.sql` | Columnas nuevas para el formato Excel v2: `docentes.telefono/email/observaciones`, `materias.trayecto/codigo_uc/horas_semanales/unidades_credito` |
| 0027 | `cedula_unique_y_upsert.sql` | `docentes.cedula` con constraint `UNIQUE` + lógica de upsert |
| 0028 | `reset_y_cedula_obligatoria.sql` | `docentes.cedula` pasa a `NOT NULL` |
| 0029 | `cedula_nullable.sql` | Revierte `0028` — `cedula` vuelve a ser nullable (algún caso de uso legítimo sin cédula todavía) |
| 0030 | `renombrar_docente_busca_por_raw.sql` | `renombrar_docente()` ahora busca duplicados también por el campo raw, no solo por `nombre_display` |
| 0031 | `session_logs_y_login_attempts.sql` | Documenta `session_logs`, `login_attempts`, `log_session_event`, `log_login_fallido` — existían en Supabase sin migración |
| 0032 | `rpcs_faltantes.sql` | Documenta 4 funciones más sin migración: `asegurar_particion_lapso`, `_aplicar_rls_horarios`, entre otras — creación dinámica de particiones de `horarios` por lapso |
| 0033 | `sync_session_logs_schema.sql` | Sincroniza el esquema documentado en `0031` con columnas reales encontradas en producción |
| 0034 | `rpcs_rls_y_conflictos.sql` | Documenta `_aplicar_rls_horarios()` y `conflictos_horario()` |
| 0035 | `fix_rls_horarios_y_permiso_qr.sql` | **V-1, V-4** — RLS granular de INSERT/DELETE en `horarios`; `crear_qr_session()` exige `puedeGestionarQR` |
| 0036 | `fix_rls_qr_permisos_granulares.sql` | **V-2** — RLS granular en `qr_sessions`/`asistencias_diarias` |
| 0037 | `drop_backup_table.sql` | Elimina tabla de backup obsoleta |
| 0038 | `activar_limpieza_audit_logs.sql` | Activa limpieza automática programada de `audit_logs` |
| 0039 | `rate_limit_scan.sql` | **D-3** — Tabla `scan_rate_limit`; límite de 10 intentos/hora por `device_fingerprint` en `registrar_asistencia` |
| 0040 | `scan_rate_limit_cleanup.sql` | Limpieza automática programada de `scan_rate_limit` |
| 0041 | `restaurar_backup_asistencias.sql` | `importarDatos()` no restauraba la tabla `asistencias` desde un backup — corregido |
| 0042 | `fix_default_id_horarios.sql` | `horarios.id` no tenía `DEFAULT`/`IDENTITY` — insertar sin especificar `id` fallaba |
| 0043 | `enable_rls_user_profiles_y_proteger_columnas.sql` | **Crítico** — RLS nunca estuvo *habilitado* en `user_profiles` pese a que las políticas existían desde `0016`; agrega trigger de protección de columnas sensibles |
| 0044 | `documentar_tiene_permiso.sql` | Documenta `tiene_permiso(uuid, text)`, existente en producción sin migración |
| 0045 | `fix_rls_horarios_update_sin_permiso.sql` | **S1** — Elimina política heredada que neutralizaba las granulares; habilita RLS en la tabla padre particionada `horarios` |
| 0046 | `permisos_granulares_docentes_materias.sql` | Mismo patrón que S1 en `docentes`/`materias`: exige permiso granular, no solo `authenticated` |

---

## 3. Esquema actual — tablas versionadas desde su creación

Estas se pueden reconstruir con confianza porque su `CREATE TABLE` completo vive en
una sola migración, sin objetos previos sin versionar.

### `qr_sessions` (`0006`)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `token` | UUID | `UNIQUE`, se regenera en cada rotación |
| `fecha` | DATE | default `CURRENT_DATE` |
| `turno` | TEXT | `CHECK IN ('DIURNO','VESPERTINO','NOCTURNO')` |
| `programa` | TEXT | `NULL` = válida para todos los programas |
| `creado_por` | UUID | FK → `auth.users(id)`, `ON DELETE SET NULL` |
| `created_at` / `expires_at` | TIMESTAMPTZ | `expires_at` default `+5 min` |
| `activa` | BOOLEAN | permite invalidar sin borrar |

### `asistencias_diarias` (`0006`, + `tipo` en `0008`)
| Columna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `cedula_docente` / `nombre_docente` | TEXT | |
| `fecha` / `turno` / `programa` | DATE / TEXT / TEXT | |
| `hora_registro` | TIMESTAMPTZ | |
| `qr_session_id` | UUID | FK → `qr_sessions(id)`, `ON DELETE SET NULL` |
| `device_fingerprint` | TEXT | anti-fraude |
| `tipo` | TEXT | `'ENTRADA' \| 'SALIDA'` — agregada en `0008`, default `'ENTRADA'` para compatibilidad |
| — | | `UNIQUE` original `(cedula_docente, fecha)` → ampliada en `0008` a `(cedula_docente, fecha, tipo)` |

### `audit_logs` (`0024`), `session_logs` / `login_attempts` (`0031`, ajustada en `0033`), `scan_rate_limit` (`0039`)
Ver los archivos de migración respectivos para el detalle completo de columnas —
se omiten aquí por espacio; son de uso interno (auditoría/seguridad) y cambian con
poca frecuencia.

---

## 4. Esquema actual — tablas base (creadas antes del historial de migraciones)

`horarios`, `docentes`, `materias` y `user_profiles` **no tienen un `CREATE TABLE`
en el repo** — existían antes de que se adoptara el versionado de migraciones. Lo
de abajo es solo lo que se puede confirmar a partir de los `ALTER TABLE` posteriores;
**no es la lista completa de columnas.**

| Tabla | Columnas confirmadas por migraciones posteriores | Notas estructurales |
|---|---|---|
| `horarios` | `id` (INTEGER, ahora `IDENTITY` desde `0042`), `lapso`, `programa`, `dia`, `hora`, `sheet`, `docente_id` (FK) | **Particionada por `lapso`** (`horarios_lapso_<N>`, creadas dinámicamente por `asegurar_particion_lapso()`, `0032`) — cualquier cambio de RLS debe aplicarse tanto al padre como a cada partición (la causa raíz de S1 fue justo olvidar el padre) |
| `docentes` | `cedula` (`0008`, `UNIQUE` desde `0027`, nullable de nuevo desde `0029`), `telefono`, `email`, `observaciones` (`0026`) | |
| `materias` | `trayecto`, `codigo_uc`, `horas_semanales`, `unidades_credito` (`0026`) | |
| `user_profiles` | `rol` (con constraint corregido en `0007`/`0015`), FK a `roles` (duplicada y luego corregida en `0017`) | RLS con políticas desde `0016`, pero **no habilitado a nivel de tabla hasta `0043`** — la política existía y nunca se aplicó, silenciosamente |

---

## 5. Cómo verificar esto contra la base de datos real

Antes de tomar una decisión de auditoría basada en este documento, confirmar con:

```sql
-- Columnas reales de una tabla
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'nombre_tabla' ORDER BY ordinal_position;

-- RLS habilitado a nivel de tabla (no solo si existen políticas)
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'nombre_tabla';

-- Particiones existentes de horarios
SELECT inhrelid::regclass AS particion
FROM pg_inherits WHERE inhparent = 'public.horarios'::regclass;
```

## 6. Mantenimiento de este índice

Cada migración nueva: agregar una fila en la tabla de §2 (número, archivo, qué
hace) y, si crea o modifica columnas de una tabla listada en §3/§4, actualizar
esa fila. Si se toca `horarios`, verificar explícitamente que el cambio de RLS
o esquema se aplicó también a las particiones — es el error que ya costó `S1`.

---

*Última actualización: julio 2026.*
