# 🗄️ Esquema de base de datos e índice de migraciones

Documentación completa y **verificada contra la base de datos real**
(no solo contra las migraciones) — columnas, relaciones, RLS, funciones,
índices, particiones, Realtime y roles. Pensada para que auditar o
incorporar a alguien nuevo no requiera leer 49 archivos SQL en orden ni
adivinar qué está realmente activo en producción.

> **Metodología:** verificado el 4 de julio de 2026 contra
> `information_schema`, `pg_policies`, `pg_proc`, `pg_indexes`,
> `pg_publication_tables` y `pg_extension` de la BD real — no inferido de
> las migraciones. Esto importó: la verificación encontró **contradicciones
> reales entre lo que las migraciones dicen y lo que estaba activo**,
> cerradas en `0048`/`0049` (ver § Hallazgos de esta verificación). Aun así,
> esto es una foto de un momento — cualquier cambio hecho directo en el
> dashboard de Supabase después de esta fecha no va a estar reflejado aquí
> hasta la próxima verificación. Las queries para repetirla están en
> `verificacion_esquema_completo.sql`.

---

## 1. Hallazgos de esta verificación

Documentar contra la BD real (no contra el código) encontró dos problemas
que ningún archivo de migración mostraba:

### 🔴 SEC-8 — Grants de `anon` que contradicen su propia migración

4 funciones tenían `REVOKE ALL FROM PUBLIC` explícito en su migración
original, pero la BD real las mostraba ejecutables por `anon`. Ninguna
migración otorgó esto — la explicación más probable es un
`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon` ejecutado directo
en el SQL Editor en algún momento (típico intento de resolver un error de
"permission denied for function"), que revirtió el endurecimiento de varias
funciones a la vez sin quedar registrado en ningún lado.

| Función | Debía ser solo | Impacto real si quedaba abierta |
|---|---|---|
| `limpiar_audit_logs_antiguos` | `service_role` | Cualquiera sin cuenta podía borrar el log de auditoría completo al instante (`p_dias_retencion := 0`) — anti-forense directo |
| `limpiar_scan_rate_limit` | `service_role` | Cualquiera podía resetear el rate limiting de `/scan`, anulando `D-3` por completo |
| `asegurar_particion_lapso` | `authenticated` | Menor: creación de particiones vacías arbitrarias |
| `docentes_con_cedula` | `authenticated` | Menor: ya era información esencialmente pública vía la tabla `docentes` |

Cerrado en `0049`. De paso, `renovar_qr_token` (0006) nunca tuvo **ningún**
chequeo de permiso interno — bastaba conocer el UUID de una sesión activa.
Mitigado en la práctica porque ese UUID nunca se expone al docente anónimo
(la respuesta de `registrar_asistencia` no lo incluye), pero se agregó el
mismo chequeo que ya usa `crear_qr_session`.

### 🔴 SEC-7 — INSERT abierto en `login_attempts`

Política `la_insert_anon`: `INSERT` para `public` con `WITH CHECK (true)` —
cualquiera sin cuenta podía insertar un intento fallido falso con el email
de otra persona. Combinado con `SEC-6` (bloqueo por cuenta, `0047`, misma
sesión): permitía forzar el bloqueo de una cuenta ajena a voluntad. Cerrado
en `0048`. Ver `AUDITORIA_INDICE.md` para el detalle completo de ambos.

**La lección que motiva mantener este documento actualizado:** ambos
hallazgos eran invisibles leyendo solo las migraciones — cada una, por sí
sola, hacía exactamente lo correcto. Solo se ven comparando la intención
del código contra el estado real de la base de datos.

---

## 2. Nomenclaturas de hallazgos (histórico)

Al recorrer las 49 migraciones salieron dos esquemas de ID que
`AUDITORIA_INDICE.md` no tenía registrados en su momento (ya incorporados):

| Esquema | Rango visto | Migraciones | Vigente |
|---|---|---|---|
| `Fix #N` (secuencial simple) | `#2, #3, #4, #8, #10, #16, #17` | `0016`–`0021` | No — reemplazado |
| `Gap #N` | `#16` | `0041` | No — visto una sola vez |
| `S`/`SEC`/`V`/`D`/`O`/`A`/`ARCH`/`U`/`P` (categorizado) | Ver `AUDITORIA_INDICE.md` | `0035` en adelante | ✅ Vigente |

---

## 3. Esquema completo por tabla (verificado)

Todas las tablas tienen **RLS habilitado** (verificado, no asumido).

### `horarios` — particionada por `lapso`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | integer | NO | — (identity vía secuencia de partición) |
| `sheet` | text | NO | — |
| `programa` | text | NO | — |
| `trayecto` | text | NO | — |
| `seccion` | text | NO | — |
| `turno` | text | NO | — |
| `sede` | text | NO | — |
| `aula` | text | sí | — |
| `dia` | text | NO | — |
| `hora` | text | NO | — |
| `clase` | text | NO | — |
| `created_at` | timestamptz | sí | `now()` |
| `lapso` | text | NO | — |
| `clase_raw` | text | sí | — |
| `docente_id` | bigint | sí | — |
| `materia_id` | bigint | sí | — |

- **PK compuesta:** `(id, lapso)` — necesaria por ser tabla particionada.
- **FK:** `docente_id → docentes.id` (`NO ACTION`), `materia_id → materias.id` (`NO ACTION`), `lapso → trimestres.lapso` (`RESTRICT`).
- **Particiones reales (7):** `horarios_lapso_1_2026`, `horarios_lapso_2_2026`, `horarios_lapso_3_2026`, `horarios_lapso_1_2027`, `horarios_lapso_2_2027`, `horarios_lapso_3_2027`, `horarios_lapso_default`. Cada una con su propio RLS habilitado y las mismas 4 políticas que el padre (`S1`/`0045` corrigió que el padre mismo no las aplicaba).
- **Índices:** `horarios_id_idx`, `horarios_lapso_idx`, `horarios_lapso_dia_idx (lapso, dia)`, `horarios_part_pkey (id, lapso)`, `idx_horarios_lapso_programa (lapso, programa)`, `idx_horarios_sheet`.
- **RLS (4 políticas, padre + cada partición):** SELECT público (`true`); INSERT/UPDATE requieren `puedeEditarHorarios`; DELETE requiere `puedeBorrarHorarios`.
- **Realtime:** habilitado (padre no, pero **cada partición sí** — coherente con que Postgres publica por relación física, no por el padre lógico).

### `docentes`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | integer | NO | `nextval('docentes_id_seq')` |
| `nombre_raw` | text | NO | — |
| `nombre_display` | text | NO | — |
| `created_at` / `updated_at` | timestamp (sin TZ) | sí | `now()` |
| `cedula` | text | sí | — |
| `telefono` | text | sí | — |
| `email` | text | sí | — |
| `observaciones` | text | sí | — |

- **UNIQUE:** `cedula` (índice parcial `WHERE cedula IS NOT NULL`, más un índice `UNIQUE` simple adicional — dos índices distintos sobre la misma columna, ver nota abajo), `nombre_raw`.
- **RLS (4 políticas):** SELECT público (`true` — necesario para el autocompletado anónimo en `/scan`); INSERT/UPDATE requieren `puedeEditarDocentes OR puedeImportarExcel`; DELETE requiere `puedeEditarDocentes OR puedeRestaurarBackup`.
- **Realtime:** habilitado.
- ⚠️ **Nota:** existen `docentes_cedula_unique` y `uq_docentes_cedula` — dos índices UNIQUE distintos sobre la misma columna `cedula` (uno total, uno parcial). Funcionalmente redundante; no es un bug de seguridad, pero vale la pena limpiar en una migración futura si se toca esta tabla.

### `materias`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | integer | NO | `nextval('materias_id_seq')` |
| `nombre_raw` / `nombre_display` | text | NO | — |
| `created_at` / `updated_at` | timestamp (sin TZ) | sí | `now()` |
| `trayecto` / `codigo_uc` / `horas_semanales` / `unidades_credito` | text | sí | — |

- **UNIQUE:** `nombre_raw`. **RLS:** mismo patrón que `docentes` (con `puedeEditarMaterias` en vez de `puedeEditarDocentes`). **Realtime:** habilitado.

### `trimestres` — no documentada en ninguna versión anterior de este archivo

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | bigint | NO | `nextval('trimestres_id_seq')` |
| `lapso` | text | NO | — |
| `numero` | smallint | NO | — |
| `anio` | smallint | NO | — |
| `estado` | text | NO | `'activo'` |
| `creado_en` | timestamptz | sí | `now()` |
| `creado_por` / `cerrado_por` | text | sí | — |
| `cerrado_en` | timestamptz | sí | — |
| `notas` | text | sí | — |
| `fecha_inicio` / `fecha_fin` | date | sí | — |

- **UNIQUE:** `lapso` (es el destino de la FK de `horarios.lapso`).
- **RLS (2 políticas):** SELECT público (`true`); todo lo demás (`ALL`) requiere `puedeGestionarTrimestres`.
- Es la tabla que respalda `HistorialView.jsx` — `creado_por`/`cerrado_por` son `text` (email), no FK a `user_profiles`.

### `user_profiles`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | uuid | NO | — (FK a `auth.users`, `ON DELETE CASCADE`) |
| `email` / `nombre` / `rol` | text | NO | — |
| `programa` | text | sí | — |
| `activo` | boolean | NO | `true` |
| `creado_en` / `actualizado_en` | timestamptz | NO | `now()` |
| `creado_por` | text | sí | — |

- **FK:** `id → auth.users.id` (`CASCADE`), `rol → roles.nombre` (`RESTRICT` — no se puede borrar un rol en uso, ver `admin_delete_role`).
- **RLS (4 políticas):** cada usuario ve/edita su propio perfil (`auth.uid() = id`) o quien tenga `puedeGestionarUsuarios` ve/edita cualquiera. Sin acceso público.

### `roles` — RBAC dinámico, no un enum fijo

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `nombre` | text | NO | — (PK) |
| `label` / `permisos` | text / jsonb | NO | — / `'{}'` |
| `emoji` | text | NO | `'👤'` |
| `color` | text | NO | `'#374151'` |
| `restringe_programa` / `es_sistema` | boolean | NO | `false` |
| `creado_en` / `actualizado_en` | timestamptz | NO | `now()` |

- **RLS (1 política):** SELECT para cualquier `authenticated` (`true`) — sin acceso público, sin políticas de escritura (los cambios van exclusivamente vía `admin_upsert_role`/`admin_delete_role`, que validan `puedeGestionarRoles` internamente).
- **6 roles reales en la BD** (no 5 — hay uno personalizado que confirma que el RBAC dinámico está en uso real, no solo en teoría):

| Rol | `es_sistema` | `restringe_programa` | Nota |
|---|---|---|---|
| `admin` | ✅ | no | Todos los permisos en `true` |
| `coordinador` | ✅ | no | Sin `puedeGestionarQR` ni `puedeVerReporteAsistencias` |
| `secretario` | ✅ | **sí** | El único rol base con `restringe_programa` |
| `administrativo` | ✅ | no | Sin permisos de edición, solo operación diaria |
| `operador_qr` | ✅ | no | Solo `puedeGestionarQR` + `puedeVerReporteAsistencias` |
| `coord_administrativo` | ❌ **no es de sistema** | no | Rol personalizado creado desde la UI — combina `puedeGestionarUsuarios` con permisos operativos, sin `puedeGestionarRoles`. Evidencia de que el RBAC dinámico (`ARQUITECTURA.md` / `MATRIZ_PERMISOS.md`) está en uso real, no solo disponible en teoría |

### `qr_sessions`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `token` | uuid | NO | `gen_random_uuid()` |
| `fecha` | date | NO | `CURRENT_DATE` |
| `turno` | text | NO | — |
| `programa` | text | sí | — |
| `creado_por` | uuid | sí | FK → `auth.users`, `SET NULL` |
| `created_at` | timestamptz | NO | `now()` |
| `expires_at` | timestamptz | NO | `now() + 5 min` |
| `activa` | boolean | NO | `true` |

- **UNIQUE:** `token` (además de un índice parcial `idx_qr_sessions_token ... WHERE activa=true` para las búsquedas del hot path).
- **RLS (3 políticas):** SELECT requiere `puedeGestionarQR OR puedeVerReporteAsistencias` (+ perfil activo); INSERT requiere lo mismo, perfil activo, y `fecha = fecha_hoy_ve()` (no se pueden crear sesiones con fecha pasada/futura). **Sin política pública** — el docente anónimo nunca lee esta tabla directo, todo pasa por `registrar_asistencia`. **Realtime:** habilitado.

### `asistencias_diarias`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `cedula_docente` / `nombre_docente` | text | NO | — |
| `fecha` | date | NO | `CURRENT_DATE` |
| `turno` | text | NO | — |
| `programa` | text | sí | — |
| `hora_registro` | timestamptz | NO | `now()` |
| `qr_session_id` | uuid | sí | FK → `qr_sessions.id`, `SET NULL` |
| `device_fingerprint` | text | sí | — |
| `tipo` | text | NO | `'ENTRADA'` |

- **UNIQUE:** `(cedula_docente, fecha, tipo)` — un docente puede tener como máximo una ENTRADA y una SALIDA por día.
- **RLS (2 políticas, ambas SELECT):** requieren `puedeGestionarQR OR puedeVerReporteAsistencias`. **Sin política de INSERT/UPDATE/DELETE — por diseño**, no por omisión: la única vía de escritura es `registrar_asistencia()` (`SECURITY DEFINER`, corre como su propietario y por lo tanto no necesita que `anon` tenga ningún permiso directo sobre la tabla). Confirmar esto contra `pg_policies` antes de asumir que "falta" una política de INSERT — no falta, es intencional.
- **Realtime:** habilitado — es lo que dispara la rotación del token QR (`FLUJO_ASISTENCIAS_QR.md`).

### `login_attempts`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | bigint | NO | `nextval(...)` |
| `email` | text | NO | — |
| `ip` / `user_agent` / `motivo` | text | sí | — |
| `created_at` | timestamptz | NO | `now()` |

- **RLS (3 políticas, post-`0048`):** SELECT para `authenticated` con `puedeVerLogs`; INSERT bloqueado para todos directamente (`false`) — escritura exclusiva vía `log_login_fallido()`/`verificar_bloqueo_login()` (`SECURITY DEFINER`). Antes de `0048` existía `la_insert_anon` (`public`, `WITH CHECK (true)`) — ver `SEC-7`.

### `scan_rate_limit`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `device_fingerprint` | text | NO | — (PK) |
| `intentos` | integer | NO | `1` |
| `ventana_inicio` | timestamptz | NO | `now()` |

- **RLS habilitado, 0 políticas** — esto es intencional y es el patrón más restrictivo posible: sin ninguna política, nadie (ni `authenticated`) puede tocar esta tabla directo vía PostgREST; el único acceso es interno, dentro de `registrar_asistencia()` (mismo rol de ejecución que el dueño de la tabla). Es upsert por dispositivo, no un log append-only como `login_attempts` — una fila por `device_fingerprint`, se actualiza `intentos`/`ventana_inicio` en vez de insertar una fila nueva por intento.

### `audit_logs` / `session_logs`

Estructura ya descrita en `SECURITY.md` — confirmado sin cambios: RLS activo, lectura vía `puedeVerLogs`/`puedeVerAuditoria`, escritura exclusiva vía `log_audit_event`/`log_session_event` (INSERT directo bloqueado con `false` para `authenticated`).

---

## 4. Funciones (RPCs) — 49 en total

Todas corren en `LANGUAGE plpgsql` salvo las utilitarias simples. Resumen
por categoría — el detalle completo de argumentos está en
`verificacion_esquema_completo.sql` (Q6).

| Categoría | Funciones | Seguridad |
|---|---|---|
| Gestión de usuarios/roles | `admin_*` (13 funciones, ver `MATRIZ_PERMISOS.md` §4) | `DEFINER`, todas con guardia interna `tiene_permiso`/`admin_caller_puede_gestionar_usuarios(auth.uid())` — verificado uno por uno, ninguna confía en un parámetro del llamante |
| Módulo QR | `crear_qr_session`, `renovar_qr_token`, `registrar_asistencia` | `DEFINER` — las 3 con guardia interna (`renovar_qr_token` no la tenía antes de `0049`) |
| Horarios | `borrar_horarios`, `restaurar_backup`, `asegurar_particion_lapso`, `_crear_particion_lapso`, `_aplicar_rls_horarios`, `conflictos_horario[_detalle]`, `replace_nombre_en_clases`, `renombrar_docente`, `renombrar_materia`, `unificar_docente`, `unificar_materia`, `horarios_resolver_docente_materia` | Mixto `DEFINER`/`INVOKER` — las `INVOKER` heredan el RLS de quien llama, así que no necesitan guardia propia |
| Auditoría y sesión | `log_audit_event`, `get_audit_logs`, `limpiar_audit_logs_antiguos`, `log_session_event`, `get_session_logs`, `log_login_fallido`, `verificar_bloqueo_login` | `DEFINER` — `limpiar_audit_logs_antiguos` corregida en `0049` para ser solo `service_role` |
| Rate limiting | `limpiar_scan_rate_limit` | `DEFINER`, solo `service_role` desde `0049` |
| Utilitarias de sesión | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa`, `tiene_permiso`, `fecha_hoy_ve` | `DEFINER`, solo lectura — devuelven vacío/null para `anon` sin exponer nada sensible |
| Parsing / triggers | `parse_clase`, `parse_rango_hora`, `time_to_min`, `horario_docente_hoy`, `docentes_con_cedula`, `proteger_columnas_sensibles_user_profiles`, `proteger_roles_sistema`, `update_user_profiles_timestamp` | Mixto — las últimas 3 son funciones de trigger, no invocables directo vía RPC aunque `pg_proc` muestre permisos amplios |

**Cerrado (`SEC-9`, migración `0052`):** `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` aparecían ejecutables por `anon` sin ningún `REVOKE` explícito en ninguna migración. Auditadas con el mismo criterio que `SEC-8`: `0052` resolvió cada función real vía `pg_proc` (ninguna fue creada por una migración de este repo, así que no había firma versionada) y le hizo `REVOKE ... FROM anon` + `GRANT ... TO authenticated`. Verificado contra la BD real tras aplicar: las 4 son `()` sin argumentos y su `EXECUTE` quedó en `authenticated`/`postgres`/`service_role` — `anon` ya no aparece.

---

## 5. Índices — resumen

Cobertura completa por tabla en `verificacion_esquema_completo.sql` (Q7).
Patrones notables:
- `asistencias_diarias` tiene 9 índices, incluyendo uno funcional sobre `lower(nombre_docente)` — pensado para las búsquedas case-insensitive del reporte.
- `horarios` tiene sus índices declarados `ON ONLY` sobre el padre — se propagan a cada partición automáticamente (a diferencia de RLS, que no se propaga sola — ver `ARQUITECTURA.md` §4).
- `qr_sessions.token` tiene **dos** índices UNIQUE (uno total, uno parcial `WHERE activa=true`) — el parcial es el que realmente se usa en el hot path de `registrar_asistencia`.

## 6. Realtime — tablas publicadas

`docentes`, `materias`, todas las particiones de `horarios`, `qr_sessions`,
`asistencias_diarias`. Nota: **`docentes`, `materias` y `horarios` están en
Realtime** — no documentado en ningún lugar antes de esta verificación.
Implica que cualquier cambio a horarios/catálogos se propaga en vivo a
todos los clientes conectados; si se construye una feature nueva que
depende de datos "estáticos" de estas tablas, tenerlo en cuenta.

## 7. Extensiones instaladas

`pgcrypto` (usada por `gen_random_uuid()`/`crypt()` en `admin_create_auth_user`), `uuid-ossp`, `pg_stat_statements`, `plpgsql`, `supabase_vault` (default de Supabase, sin uso confirmado en este proyecto todavía).

---

## 8. Índice cronológico de migraciones

| # | Archivo | Qué hace |
|---|---|---|
| 0005 | `rpc_transaccional_borrado_restauracion.sql` | `borrar_horarios`/restauración envueltas en transacción |
| 0006 | `modulo_asistencias_qr.sql` | Esquema base del módulo QR |
| 0006b | `acceso_anonimo_scan.sql` | Acceso anónimo a `registrar_asistencia` |
| 0007 | `rol_operador_qr.sql` | Rol `operador_qr` |
| 0008 | `entrada_salida_y_horario_docente.sql` | Columna `tipo` en `asistencias_diarias` |
| 0009 | `cedula_como_id_unico_docente.sql` | Cédula como ID único de docente |
| 0010 | `realtime_asistencias_qr.sql` | Realtime en `asistencias_diarias` |
| 0011–0012 | diagnóstico / limpieza de prueba | Scripts puntuales, no parte del pipeline regular |
| 0013 | `seguridad_fecha_servidor.sql` | `fecha_hoy_ve()` |
| 0014–0015 | reset password / fix roles | RPCs de administración inicial |
| 0016–0021 | *(serie `Fix #N`)* | RLS de `user_profiles`, FKs, índices, RPCs de gestión de usuarios |
| 0022–0030 | índices, auditoría, formato v2, cédula única | Mantenimiento e iteración de `docentes`/`materias` |
| 0031–0034 | `session_logs`, `login_attempts`, RPCs faltantes | Documentación de objetos creados sin migración |
| 0035 | `fix_rls_horarios_y_permiso_qr.sql` | **V-1, V-4** |
| 0036 | `fix_rls_qr_permisos_granulares.sql` | **V-2** |
| 0037–0038 | limpieza de backup, retención de audit_logs | Mantenimiento |
| 0039–0040 | `rate_limit_scan.sql` + limpieza | **D-3** |
| 0041 | `restaurar_backup_asistencias.sql` | *(Gap #16)* |
| 0042 | `fix_default_id_horarios.sql` | `IDENTITY` en `horarios.id` |
| 0043 | `enable_rls_user_profiles_y_proteger_columnas.sql` | RLS nunca habilitado a nivel de tabla |
| 0044 | `documentar_tiene_permiso.sql` | Documentación de función sin migración |
| 0045 | `fix_rls_horarios_update_sin_permiso.sql` | **S1** |
| 0046 | `permisos_granulares_docentes_materias.sql` | Mismo patrón que S1 en `docentes`/`materias` |
| 0047 | `bloqueo_login_fuerza_bruta.sql` | **SEC-6** |
| 0048 | `cerrar_insert_directo_login_attempts.sql` | **SEC-7** |
| 0049 | `cerrar_grants_anon_excesivos.sql` | **SEC-8** |

---

## 9. Cómo repetir esta verificación

Correr `verificacion_esquema_completo.sql` (11 queries de solo lectura) en
el SQL Editor de Supabase, un bloque a la vez, y comparar contra este
documento. Recomendado después de cualquier sesión donde se haya tocado
algo directo en el dashboard (la causa raíz de `SEC-8` y de la mitad de
los hallazgos de `S1` en adelante) y periódicamente de todos modos, dado
el patrón ya repetido varias veces en este proyecto.

---

*Última actualización: julio 2026 — verificación completa contra la base de datos real.*
