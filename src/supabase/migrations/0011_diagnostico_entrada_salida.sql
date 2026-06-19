-- =====================================================================
-- 0011_diagnostico_entrada_salida.sql
--
-- Este NO es un script que cambie nada — es de SOLO LECTURA, para correr
-- manualmente en el SQL Editor de Supabase y confirmar si la migración
-- 0008 (Entrada/Salida separadas) realmente llegó a aplicarse en
-- producción. Bórralo o no lo incluyas en el pipeline de migraciones
-- automáticas; es una ayuda de diagnóstico puntual.
--
-- POR QUÉ EXISTE:
--   El reporte mostraba "0 Entrada y salida / 1 Solo entrada" para un
--   docente que, según se reportó, sí marcó ambas. El esquema SÍ soporta
--   guardar ENTRADA y SALIDA como dos filas separadas desde la migración
--   0008 (columna `tipo` + UNIQUE(cedula_docente, fecha, tipo)). Pero esa
--   migración vive en src/supabase/migrations/, que NO es la carpeta
--   estándar que usa `supabase db push` — en este proyecto se han estado
--   aplicando a mano en el SQL Editor, así que es fácil saltarse una.
--
--   Si 0008 nunca se corrió, el RPC registrar_asistencia() seguiría
--   aceptando solo 4 parámetros (sin p_tipo) y el cliente (que ya manda 5,
--   incluyendo p_tipo) fallaría con un error de "function not found" al
--   intentar marcar la SALIDA — el docente vería un error visible en
--   /scan, no un fallo silencioso.
-- =====================================================================

-- 1) ¿Existe la columna `tipo` en asistencias_diarias?
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'asistencias_diarias'
  AND column_name  = 'tipo';
-- Si esta consulta no devuelve filas → la migración 0008 NO se aplicó.
-- Corre src/supabase/migrations/0008_entrada_salida_y_horario_docente.sql
-- completo en el SQL Editor.

-- 2) ¿La función registrar_asistencia acepta el 5to parámetro p_tipo?
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'registrar_asistencia';
-- Debe aparecer una fila con 5 argumentos terminando en "p_tipo text".
-- Si solo ves 4 argumentos (sin p_tipo), la migración 0008 no se aplicó
-- o quedó una versión vieja sin reemplazar.

-- 3) ¿Hay docentes con SALIDA registrada hoy? (confirma si el flujo
--    de salida ya está siendo usado en la práctica)
SELECT cedula_docente, nombre_docente, fecha, tipo, hora_registro
FROM asistencias_diarias
WHERE fecha = CURRENT_DATE
ORDER BY cedula_docente, hora_registro;

-- 4) ¿La restricción de unicidad ya incluye `tipo`?
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.asistencias_diarias'::regclass
  AND contype = 'u';
-- Debe verse: UNIQUE (cedula_docente, fecha, tipo)
-- Si en vez de eso ves UNIQUE (cedula_docente, fecha) sin `tipo`, significa
-- que un docente solo puede tener UNA fila por día en total (la migración
-- 0006 original), por lo que la SALIDA simplemente nunca se pudo guardar:
-- el INSERT chocó con el ON CONFLICT de la entrada y se descartó.
