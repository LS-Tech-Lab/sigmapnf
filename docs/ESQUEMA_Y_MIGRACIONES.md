# 🗄️ Esquema de base de datos e índice de migraciones

Documentación completa y **verificada contra la base de datos real**
(no solo contra las migraciones) — columnas, relaciones, RLS, funciones,
índices, particiones, Realtime y roles. Pensada para que auditar o
incorporar a alguien nuevo no requiera leer 85 archivos SQL en orden ni
adivinar qué está realmente activo en producción.

> **Metodología:** verificado por última vez el 4 de julio de 2026 contra
> `information_schema`, `pg_policies`, `pg_proc`, `pg_indexes`,
> `pg_publication_tables` y `pg_extension` de la BD real — no inferido de
> las migraciones. Esto importó: la verificación encontró **contradicciones
> reales entre lo que las migraciones dicen y lo que estaba activo**,
> cerradas en `0048`/`0049` (ver § Hallazgos de esta verificación). Aun así,
> esto es una foto de un momento — cualquier cambio hecho directo en el
> dashboard de Supabase después de esta fecha no va a estar reflejado aquí
> hasta la próxima verificación. Las queries para repetirla están en
> `verificacion_esquema_completo.sql`.
>
> **Reverificado el 11 de agosto de 2026**, esta vez por conector directo
> a la BD real (`information_schema`/`pg_proc` en vivo, no archivos SQL
> clonados) — cubre las ~40 migraciones de julio-agosto (`0061`–`0088`)
> ausentes en la verificación de julio: el sistema de Sedes (`SEDE-N`),
> filtrado por programa (`PROG-N`), y varias tablas/funciones nuevas. No
> es una reverificación 1:1 de las 11 queries originales — ver anotaciones
> "(11 ago)" en las secciones que sí se recorrieron contra la BD real esta
> vez; el resto conserva su última verificación de julio, marcada donde
> corresponde.

---

## 1. Hallazgos de esta verificación

Documentar contra la BD real (no contra el código) encontró dos problemas
que ningún archivo de migración mostraba:

### 🔴 SEC-9 — Grants de `anon` que contradicen su propia migración

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
| `limpiar_scan_rate_limit` | `service_role` | Cualquiera podía resetear el rate limiting de `/scan`, anulando `SEC-13` por completo |
| `asegurar_particion_lapso` | `authenticated` | Menor: creación de particiones vacías arbitrarias |
| `docentes_con_cedula` | `authenticated` | Menor: ya era información esencialmente pública vía la tabla `docentes` |

Cerrado en `0049`. De paso, `renovar_qr_token` (0006) nunca tuvo **ningún**
chequeo de permiso interno — bastaba conocer el UUID de una sesión activa.
Mitigado en la práctica porque ese UUID nunca se expone al docente anónimo
(la respuesta de `registrar_asistencia` no lo incluye), pero se agregó el
mismo chequeo que ya usa `crear_qr_session`.

### 🔴 SEC-8 — INSERT abierto en `login_attempts`

Política `la_insert_anon`: `INSERT` para `public` con `WITH CHECK (true)` —
cualquiera sin cuenta podía insertar un intento fallido falso con el email
de otra persona. Combinado con `SEC-7` (bloqueo por cuenta, `0047`, misma
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
- **Particiones reales (7):** `horarios_lapso_1_2026`, `horarios_lapso_2_2026`, `horarios_lapso_3_2026`, `horarios_lapso_1_2027`, `horarios_lapso_2_2027`, `horarios_lapso_3_2027`, `horarios_lapso_default`. Cada una con su propio RLS habilitado y las mismas 4 políticas que el padre (`SEC-1`/`0045` corrigió que el padre mismo no las aplicaba).
- **Índices:** `horarios_id_idx`, `horarios_lapso_idx`, `horarios_lapso_dia_idx (lapso, dia)`, `horarios_part_pkey (id, lapso)`, `idx_horarios_lapso_programa (lapso, programa)`, `idx_horarios_sheet`.
- **RLS (4 políticas, padre + cada partición):** SELECT público (`true`); INSERT/UPDATE requieren `puedeEditarHorarios`; DELETE requiere `puedeBorrarHorarios`.
- **Realtime:** habilitado (padre no, pero **cada partición sí** — coherente con que Postgres publica por relación física, no por el padre lógico).
- **`sede_id` (text, sí nulo) agregada por `0061`/`SEDE-1`** (confirmada en vivo el 11 ago, presente en el padre y las 7 particiones) — el aislamiento real por sede se exige en RLS desde `0063` (`SEC-N`/`SEDE-3`), no solo por la columna. Ver § Sistema multi-sede en `AUDITORIA_INDICE.md` para las 18 pasadas completas.

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
- **`sede_id` (text, sí nulo) agregada por `0061`** (confirmada en vivo el 11 ago) — desde `0061`/`SEDE-1` el catálogo de docentes es independiente por sede (`docentes_sede_cedula_unique`, `UNIQUE (sede_id, cedula)`, no global); `docentes_con_cedula()` filtra por sede desde `0066`.

### `materias`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | integer | NO | `nextval('materias_id_seq')` |
| `nombre_raw` / `nombre_display` | text | NO | — |
| `created_at` / `updated_at` | timestamp (sin TZ) | sí | `now()` |
| `trayecto` / `codigo_uc` / `horas_semanales` / `unidades_credito` | text | sí | — |

- **UNIQUE:** `nombre_raw`. **RLS:** mismo patrón que `docentes` (con `puedeEditarMaterias` en vez de `puedeEditarDocentes`). **Realtime:** habilitado.
- **`sede_id` (text, sí nulo) agregada por `0061`** (confirmada en vivo el 11 ago), mismo patrón que `docentes`.

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
| `sede_id` | text | sí | — |

- **FK:** `id → auth.users.id` (`CASCADE`), `rol → roles.nombre` (`RESTRICT` — no se puede borrar un rol en uso, ver `admin_delete_role`).
- **RLS (4 políticas):** cada usuario ve/edita su propio perfil (`auth.uid() = id`) o quien tenga `puedeGestionarUsuarios` ve/edita cualquiera. Sin acceso público.
- **`sede_id` agregada por `0061`/`SEDE-1`.** `programa` (columna singular, preexistente) queda **desde `0078`/`PROG-2` solo como el programa "principal"** para roles `restringe_programa` de un solo programa — el soporte real multi-programa vive en la tabla nueva `user_profiles_programas` (N:N), no en esta columna. Ver esa tabla más abajo y `admin_set_user_programas()`/`admin_get_user_profiles_programas()`.

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
- **`sede_id` (text, sí nulo) agregada por `0061`**, con `WITH CHECK`/`USING` de sede reforzados en `0064` (INSERT) y `0071` (el `WITH CHECK` de INSERT no tenía el chequeo de sede hasta entonces — ver `SEC-32`).

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

- **UNIQUE:** ~~`(cedula_docente, fecha, tipo)`~~ — **reemplazada por `uq_asistencia_docente_dia_tipo_sede`, `(sede_id, cedula_docente, fecha, tipo)` en `0082`/`SEC-35`** (9 ago): la constraint vieja no tenía `sede_id`, así que un mismo docente en dos sedes distintas el mismo día/tipo rechazaba el segundo registro aunque fueran asistencias legítimas en sedes diferentes. **Ojo con `0085`–`0088`:** el `ON CONFLICT` de `registrar_asistencia()`/`registrar_asistencia_manual()`/`restaurar_backup()`/`horarios_resolver_docente_materia()` seguía apuntando a la constraint vieja tras `0082` — corregido recién en esos 4 fixes del 10 ago, ver `AUDITORIA_INDICE.md` para la ventana real de exposición.
- **`sede_id`** (text, sí nulo) agregada por `0061`, forma parte de la UNIQUE desde `0082` (ver arriba).
- **RLS (2 políticas, ambas SELECT):** requieren `puedeGestionarQR OR puedeVerReporteAsistencias` (más el filtro de sede vigente desde `0064`). **Sin política de INSERT/UPDATE/DELETE — por diseño**, no por omisión: la única vía de escritura es `registrar_asistencia()`/`registrar_asistencia_manual()` (`SECURITY DEFINER`, corren como su propietario y por lo tanto no necesitan que `anon`/`authenticated` tengan ningún permiso directo sobre la tabla). Confirmar esto contra `pg_policies` antes de asumir que "falta" una política de INSERT — no falta, es intencional.
- **Realtime:** habilitado — es lo que dispara la rotación del token QR (`FLUJO_ASISTENCIAS_QR.md`).

### `login_attempts`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | bigint | NO | `nextval(...)` |
| `email` | text | NO | — |
| `ip` / `user_agent` / `motivo` | text | sí | — |
| `created_at` | timestamptz | NO | `now()` |

- **RLS (3 políticas, post-`0048`):** SELECT para `authenticated` con `puedeVerLogs`; INSERT bloqueado para todos directamente (`false`) — escritura exclusiva vía `log_login_fallido()`/`verificar_bloqueo_login()` (`SECURITY DEFINER`). Antes de `0048` existía `la_insert_anon` (`public`, `WITH CHECK (true)`) — ver `SEC-8`.

### `scan_rate_limit`

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `device_fingerprint` | text | NO | — (PK) |
| `intentos` | integer | NO | `1` |
| `ventana_inicio` | timestamptz | NO | `now()` |

- **RLS habilitado, 0 políticas** — esto es intencional y es el patrón más restrictivo posible: sin ninguna política, nadie (ni `authenticated`) puede tocar esta tabla directo vía PostgREST; el único acceso es interno, dentro de `registrar_asistencia()` (mismo rol de ejecución que el dueño de la tabla). Es upsert por dispositivo, no un log append-only como `login_attempts` — una fila por `device_fingerprint`, se actualiza `intentos`/`ventana_inicio` en vez de insertar una fila nueva por intento.

### `sedes` — nueva, no existía en la verificación de julio

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | text | NO | — (PK, slug legible, ej. `cabimas`) |
| `nombre` | text | NO | — |
| `activa` | boolean | NO | `true` |
| `orden` | smallint | NO | — |
| `creado_en` | timestamptz | NO | `now()` |

- Creada en `0061`/`SEDE-1`. Sin `DELETE` real por diseño — dar de baja una sede es desactivarla (`activa=false`), no borrarla, porque `docentes`/`materias`/`horarios`/`qr_sessions`/`asistencias_diarias`/`user_profiles` tienen FK entrante. Gestión desde la UI (pestaña "Sedes" del módulo Sistema) agregada en `0070`/`SEDE-17`, permiso `puedeGestionarSedes`.
- **RLS:** SELECT público (necesario para el selector de sede en `/scan`, anónimo); escritura vía RPCs de gestión de sedes con guardia interna.

### `user_profiles_programas` — nueva, no existía en la verificación de julio

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `user_id` | uuid | NO | FK → `user_profiles.id` |
| `programa` | text | NO | — |
| `creado_en` | timestamptz | NO | `now()` |

- Relación N:N creada en `0078`/`PROG-2`: reemplaza a la columna singular `user_profiles.programa` como fuente real para roles con `restringe_programa` que necesitan ver **más de un** programa (la columna vieja se conserva solo como "programa principal", ver nota en `user_profiles` arriba). Enforcement real en RLS de `horarios`/`asistencias_diarias` desde `0081`/`PROG-3 fase 3`. Gestión vía `admin_set_user_programas()`/`admin_get_user_profiles_programas()`.

### `admin_actions_rate_limit` — nueva, no existía en la verificación de julio

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `actor_id` | uuid | NO | — (PK) |
| `intentos` | integer | NO | `1` |
| `ventana_inicio` | timestamptz | NO | `now()` |

- Creada en `0051`/`SEC-11` (rate limit de `api/admin-users.js`, 10 acciones/min por `actor_id`) — existía desde julio pero nunca se documentó en este archivo. **RLS habilitado, 0 políticas** — mismo patrón intencional que `scan_rate_limit`: acceso exclusivo vía `registrar_admin_action_rate_limit()` (`SECURITY DEFINER`). Confirmado en el advisor de seguridad de Supabase (11 ago) que esto es intencional, no un hallazgo — ver `SEC-39` en `AUDITORIA_INDICE.md`. `autovacuum` ajustado por tabla en `0083`/`ARCH-40` (bloat invisible con pocas filas vivas).

### `csp_report_rate_limit` — nueva, no existía en la verificación de julio

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `ip` | text | NO | — (PK) |
| `intentos` | integer | NO | `1` |
| `ventana_inicio` | timestamptz | NO | `now()` |

- Creada en `0060`/`OFF-9` (rate limit persistente de `api/csp-report.js`, reemplaza el `Map()` en memoria que no sobrevivía entre invocaciones serverless) — existía desde julio, no documentada hasta ahora. Mismo patrón de RLS sin políticas que `scan_rate_limit`/`admin_actions_rate_limit`. `autovacuum` ajustado en `0083`.

### `configuracion_reportes` — nueva, no existía en la verificación de julio

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| `id` | integer | NO | `1` (singleton) |
| `nombre_institucion` | text | NO | `'UNERMB'` |
| `subtitulo_1` | text | NO | `'Programas Nacionales de Formación'` |
| `subtitulo_2` | text | NO | `'Control de Asistencia Docente'` |
| `pie_texto` | text | NO | — |
| `firma_label` | text | NO | `'Firma y sello del Coordinador(a)'` |
| `logo_base64` | text | sí | — |
| `color_clase` | text | NO | `'rp-color--azul'` |
| `updated_at` | timestamptz | NO | `now()` |
| `updated_by` | uuid | sí | — |

- Tabla singleton (una sola fila, `id=1`) creada en `0056`/`ADMIN-6` para la personalización de reportes impresos (logo como data-URI, colores institucionales de una paleta CSP-safe predefinida — ver `color_clase`). No documentada hasta ahora.

### `audit_logs` / `session_logs`

Estructura ya descrita en `SECURITY.md` — confirmado sin cambios: RLS activo, lectura vía `puedeVerLogs`/`puedeVerAuditoria`, escritura exclusiva vía `log_audit_event`/`log_session_event` (INSERT directo bloqueado con `false` para `authenticated`).

---

## 4. Funciones (RPCs) — 102 en total (reverificado en vivo, 11 ago)

**Sube de las 49 documentadas en julio a 102** — no es una discrepancia
sospechosa, es la cuenta real (`pg_proc`/`pg_namespace`, `prokind='f'`,
schema `public`) tras ~40 migraciones de sedes (`SEDE-N`), multi-programa
(`PROG-N`) y funcionalidad nueva (`ESTAD-1`, `admin_get_orphan_auth_users`,
gestión de sedes, etc.) que nunca se sumaron a este conteo. Todas corren
en `LANGUAGE plpgsql` salvo las utilitarias simples. Resumen por
categoría — el detalle completo de argumentos está en
`verificacion_esquema_completo.sql` (Q6), sin actualizar desde julio.

> ⚠️ **`SEC-39` (11 ago, `AUDITORIA_INDICE.md`):** el advisor de seguridad
> de Supabase encontró `restaurar_backup()` con **dos firmas distintas**
> registradas en `pg_proc` — posible overload viejo sin `DROP FUNCTION`.
> Pendiente que LS confirme cuál usa el frontend real antes de asumir
> que la tabla de abajo describe una sola función.

| Categoría | Funciones | Seguridad |
|---|---|---|
| Gestión de usuarios/roles | `admin_*` (13 funciones, ver `MATRIZ_PERMISOS.md` §4) | `DEFINER`, todas con guardia interna `tiene_permiso`/`admin_caller_puede_gestionar_usuarios(auth.uid())` — verificado uno por uno, ninguna confía en un parámetro del llamante |
| Módulo QR | `crear_qr_session`, `renovar_qr_token`, `registrar_asistencia` | `DEFINER` — las 3 con guardia interna (`renovar_qr_token` no la tenía antes de `0049`) |
| Horarios | `borrar_horarios`, `restaurar_backup`, `asegurar_particion_lapso`, `_crear_particion_lapso`, `_aplicar_rls_horarios`, `conflictos_horario[_detalle]`, `replace_nombre_en_clases`, `renombrar_docente`, `renombrar_materia`, `unificar_docente`, `unificar_materia`, `horarios_resolver_docente_materia` | Mixto `DEFINER`/`INVOKER` — las `INVOKER` heredan el RLS de quien llama, así que no necesitan guardia propia |
| Auditoría y sesión | `log_audit_event`, `get_audit_logs`, `limpiar_audit_logs_antiguos`, `log_session_event`, `get_session_logs`, `log_login_fallido`, `verificar_bloqueo_login` | `DEFINER` — `limpiar_audit_logs_antiguos` corregida en `0049` para ser solo `service_role` |
| Rate limiting | `limpiar_scan_rate_limit` | `DEFINER`, solo `service_role` desde `0049` |
| Utilitarias de sesión | `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa`, `tiene_permiso`, `fecha_hoy_ve` | `DEFINER`, solo lectura — devuelven vacío/null para `anon` sin exponer nada sensible |
| Parsing / triggers | `parse_clase`, `parse_rango_hora`, `time_to_min`, `horario_docente_hoy`, `docentes_con_cedula`, `proteger_columnas_sensibles_user_profiles`, `proteger_roles_sistema`, `update_user_profiles_timestamp` | Mixto — las últimas 3 son funciones de trigger, no invocables directo vía RPC aunque `pg_proc` muestre permisos amplios |

**Cerrado (`SEC-17`, migración `0052`):** `get_auth_role`, `get_my_role`, `get_auth_programa`, `get_my_programa` aparecían ejecutables por `anon` sin ningún `REVOKE` explícito en ninguna migración. Auditadas con el mismo criterio que `SEC-9`: `0052` resolvió cada función real vía `pg_proc` (ninguna fue creada por una migración de este repo, así que no había firma versionada) y le hizo `REVOKE ... FROM anon` + `GRANT ... TO authenticated`. Verificado contra la BD real tras aplicar: las 4 son `()` sin argumentos y su `EXECUTE` quedó en `authenticated`/`postgres`/`service_role` — `anon` ya no aparece.

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
**No reverificado el 11 de agosto** (sin query de `pg_publication_tables`
en esta pasada) — asumir que sigue igual, pero confirmar si se sospecha
un problema de sincronización en vivo con `sedes`/`user_profiles_programas`
(tablas nuevas, no confirmadas en Realtime ni con RLS motivo para necesitarlo).

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
| 0035 | `fix_rls_horarios_y_permiso_qr.sql` | **SEC-10, SEC-12** |
| 0036 | `fix_rls_qr_permisos_granulares.sql` | **SEC-11** |
| 0037–0038 | limpieza de backup, retención de audit_logs | Mantenimiento |
| 0039–0040 | `rate_limit_scan.sql` + limpieza | **SEC-13** |
| 0041 | `restaurar_backup_asistencias.sql` | *(Gap #16)* |
| 0042 | `fix_default_id_horarios.sql` | `IDENTITY` en `horarios.id` |
| 0043 | `enable_rls_user_profiles_y_proteger_columnas.sql` | RLS nunca habilitado a nivel de tabla |
| 0044 | `documentar_tiene_permiso.sql` | Documentación de función sin migración |
| 0045 | `fix_rls_horarios_update_sin_permiso.sql` | **SEC-1** |
| 0046 | `permisos_granulares_docentes_materias.sql` | Mismo patrón que SEC-1 en `docentes`/`materias` |
| 0047 | `bloqueo_login_fuerza_bruta.sql` | **SEC-7** |
| 0048 | `cerrar_insert_directo_login_attempts.sql` | **SEC-8** |
| 0049 | `cerrar_grants_anon_excesivos.sql` | **SEC-9** |
| 0050 | `sec10_jerarquia_rol_admin.sql` | **SEC-10** — escalada de privilegios en gestión de usuarios |
| 0051 | `sec11_rate_limit_admin_users.sql` | **SEC-11** — rate limit propio en `api/admin-users.js` |
| 0052 | `sec9_cerrar_grants_anon_utilitarias.sql` | **SEC-9** (continuación) — grants `anon` sobre funciones utilitarias |
| 0053 | `limpieza_sesiones_expiradas.sql` | Limpieza periódica de `session_logs` expirados |
| 0054 | `permisos_borrado_sesiones_reportes.sql` | Permisos granulares de borrado sobre sesiones y reportes |
| 0055 | `reporte_rango_agregado_perf.sql` | **ARCH-27** — agregación server-side para "Reporte por Rango" |
| 0056 | `config_reportes_branding.sql` | **ADMIN-6** — tabla singleton de identidad visual/branding para reportes |
| 0057 | `arch29_bloqueo_optimista_horarios.sql` | **ARCH-29/ARCH-31** — columna `updated_at` + trigger `set_updated_at()` en `horarios` para bloqueo optimista |
| 0058 | `arch32_backoff_progresivo_scan.sql` | **ARCH-32** — backoff progresivo en `registrar_asistencia()` |
| 0059 | `arch33_fix_race_condition_rate_limit.sql` | **ARCH-33** — condición de carrera real en `registrar_asistencia()`, verificada contra Postgres real |
| 0060 | `off9_rate_limit_persistente_csp_report.sql` | **OFF-9** — rate limit persistente (antes `Map()` en memoria) para `api/csp-report.js` |
| 0061 | `sedes_catalogo_y_columnas.sql` | **SEDE-1** — tabla `sedes` + columna `sede_id` en `docentes`/`materias`/`horarios`/`qr_sessions`/`asistencias_diarias`/`user_profiles` |
| 0062 | `permiso_ver_todas_sedes_y_rpc_usuarios.sql` | **SEDE-2** — permiso dinámico `puedeVerTodasLasSedes` |
| 0063 | `rls_aislamiento_docentes_materias_horarios.sql` | **SEDE-3** — RLS empieza a exigir `sede_id` (hasta acá la columna existía pero no se filtraba) |
| 0064 | `qr_sessions_asistencias_y_scan_por_sede.sql` | **SEDE-4/5** — aislamiento por sede en el módulo QR (`crear_qr_session`, `registrar_asistencia`) |
| 0065 | `borrar_y_restaurar_backup_por_sede.sql` | **SEDE-6** — `borrar_horarios`/`restaurar_backup` (`SECURITY DEFINER`) filtrados por sede |
| 0066 | `docentes_con_cedula_por_sede.sql` | **SEDE-7** — bug real: el selector de sede no filtraba el catálogo de docentes |
| 0067 | `conflictos_horario_por_sede.sql` | **SEDE-8** — mismo bug que `SEDE-7` en "Conflictos detectados" |
| 0068 | `auditoria_sede_gestion_usuarios_borrado.sql` | **SEDE-9/10, ARCH-37, SEC-28/29** — auditoría completa de `SECURITY DEFINER` con `sede_id`; cierra `admin_borrar_asistencias_rango`/`admin_borrar_qr_sesiones` sin chequeo de sede |
| 0069 | `reporte_rango_agregado_por_sede.sql` | **SEDE-16** — `reporte_asistencias_rango_agregado()` (`SECURITY INVOKER`) reforzado con filtro explícito de sede |
| 0070 | `gestion_sedes_permiso_y_rls.sql` | **SEDE-17** — alta/edición de sedes desde la UI, permiso `puedeGestionarSedes` |
| 0071 | `cierre_politicas_zombi_y_sede_qr_insert.sql` | **SEC-30/31/32** — 2 políticas RLS huérfanas (`qr_sessions`/`asistencias_diarias`) creadas a mano, nunca versionadas; política `sl_insert` zombi en `session_logs` |
| 0072 | `ux33_docentes_esperados_hoy.sql` | **UX-33** — RPC `contar_docentes_esperados()`, sede-scoped |
| 0073 | `sec33_cerrar_grants_publicos_rpcs_admin.sql` | **SEC-33** — ~24 funciones administrativas ejecutables por `anon`/`PUBLIC` sin que ninguna migración lo otorgara, cerradas de una sola vez |
| 0074 | `sec34_default_privileges_anon_funciones.sql` | **SEC-34** — causa raíz de `SEC-8`/`SEC-9`/`SEC-33`: privilegio por defecto de `postgres` otorgaba `EXECUTE` a `anon` en toda función nueva |
| 0075 | `off10_registrar_asistencia_manual.sql` | **OFF-10** — RPC `registrar_asistencia_manual()`, respaldo sin token QR para cortes de red sin sesión pre-generada |
| 0076 | `perm6_backup_server_side.sql` | **PERM-6** — `exportar_backup_completo()` mueve el chequeo de `puedeHacerBackup` al servidor |
| 0077 | `prog1_backup_valida_programa.sql` | **PROG-1** — `exportar_backup_completo()` valida también restricción por programa |
| 0078 | `prog2_user_profiles_programas.sql` | **PROG-2** — tabla `user_profiles_programas` (N:N), primera fase de multi-programa |
| 0079 | `prog3_rpcs_multi_programa.sql` | **PROG-3 fase 1** — RPCs de gestión de usuarios adaptados a multi-programa (`admin_set_user_programas`, etc.) |
| 0080 | `prog3_reporte_rango_valida_programa.sql` | **PROG-3 fase 2** — `reporte_asistencias_rango_agregado()` valida programa |
| 0081 | `prog3_rls_programa_horarios_asistencias.sql` | **PROG-3 fase 3 (cierre)** — enforcement real en RLS de `horarios`/`asistencias_diarias` por programa |
| 0082 | `sec35_36_unique_sede_y_trimestres_privado.sql` | **SEC-35/36** — `UNIQUE` de `asistencias_diarias` reemplazada para incluir `sede_id`; política pública de `trimestres` cerrada a `authenticated` |
| 0083 | `arch_autovacuum_tablas_rate_limit.sql` | **ARCH-40** — `autovacuum` ajustado por tabla en las 3 tablas de rate limit (bloat invisible con pocas filas vivas) |
| 0084 | `estad1_reporte_estadisticas_academicas.sql` | **ESTAD-1** — primera funcionalidad del dashboard de estadísticas académicas |
| 0085 | `fix_registrar_asistencia_on_conflict_sede_id.sql` | Fix — `ON CONFLICT` de `registrar_asistencia()` seguía apuntando a la constraint vieja tras `0082` (renumerada de `0082`, colisión con la fila de arriba) |
| 0086 | `fix_registrar_asistencia_manual_on_conflict_sede_id.sql` | Mismo fix que `0085`, en `registrar_asistencia_manual()` |
| 0087 | `fix_restaurar_backup_on_conflict_sede_id.sql` | Mismo fix que `0085`, en `restaurar_backup()` |
| 0088 | `fix_horarios_resolver_docente_materia_sede_id.sql` | Mismo fix que `0085`, en `horarios_resolver_docente_materia()` |

**Ventana de exposición real de `0085`–`0088`:** entre que `0082` se
aplicó (9 ago) y estos 4 fixes se aplicaron (10 ago), cualquier intento
real de `registrar_asistencia`/`registrar_asistencia_manual`/
`restaurar_backup` habría fallado con "no unique or exclusion
constraint matching ON CONFLICT" — pendiente que LS confirme el alcance
real revisando logs de Postgres/API de esa ventana (no verificable
desde este entorno). Ver `AUDITORIA_INDICE.md`, entrada del 10 ago.

---

## 9. Cómo repetir esta verificación

Correr `verificacion_esquema_completo.sql` (11 queries de solo lectura) en
el SQL Editor de Supabase, un bloque a la vez, y comparar contra este
documento. Recomendado después de cualquier sesión donde se haya tocado
algo directo en el dashboard (la causa raíz de `SEC-9` y de la mitad de
los hallazgos de `SEC-1` en adelante) y periódicamente de todos modos, dado
el patrón ya repetido varias veces en este proyecto.

---

*Última actualización: 11 de agosto de 2026 — tablas/columnas nuevas
(§3), conteo de funciones (§4) e índice de migraciones (§8, `0061`–`0088`)
reverificados en vivo contra la base de datos real vía conector directo
de Supabase (no contra código/migraciones clonadas). Índices (§5),
Realtime (§6) y extensiones (§7) **conservan su última verificación de
julio 2026** — no se recorrieron de nuevo en esta pasada, ver nota en
§6. Verificación completa anterior: 4 de julio de 2026.*
