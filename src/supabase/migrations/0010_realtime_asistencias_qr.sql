-- =====================================================================
-- Migración 0010: Habilitar Realtime en el módulo de Asistencias QR
--
-- CONTEXTO / BUG:
--   El panel admin (AdminQRPanel.jsx -> ContadorSesion, FeedActividad) y
--   el hook useQRSession.js (rotación automática del QR al detectar un
--   escaneo) se suscriben con:
--
--     supabase.channel(...).on("postgres_changes", { event: "INSERT", ... })
--
--   Para que Supabase Realtime emita esos eventos por el websocket, la
--   tabla debe estar agregada a la publicación lógica de Postgres
--   "supabase_realtime". Ninguna migración anterior lo hacía, así que:
--
--     • El contador "🟢 docentes entraron / 🔴 docentes salieron" se
--       quedaba congelado en 0 (solo se actualizaba al montar el panel).
--     • El feed "Actividad reciente" nunca mostraba nada nuevo.
--     • La rotación automática del token QR al detectar un escaneo
--       (pensada para invalidar fotos compartidas) tampoco se disparaba,
--       dejando el mismo QR válido más tiempo del esperado.
--
--   El código ya tiene un poll de respaldo (ver
--   AdminQRPanel.jsx / useQRSession.js / ReporteAsistencias.jsx, fixes
--   "realtime-fallback-polling-*"), pero esta migración corrige la causa
--   raíz para que la actualización vuelva a ser instantánea.
--
-- Nota: si tu proyecto Supabase administra la publicación
--   "supabase_realtime" desde el dashboard (Database → Replication) en
--   vez de por SQL, basta con activar el toggle de Realtime para
--   "qr_sessions" y "asistencias_diarias" ahí; este script es idempotente
--   y no falla si ya estaban agregadas.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'asistencias_diarias'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.asistencias_diarias;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'qr_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_sessions;
  END IF;
END
$$;

COMMENT ON TABLE asistencias_diarias IS
  'Registro de asistencia diaria de docentes mediante escaneo de QR. Agregada a supabase_realtime en la migración 0010 para que el contador y el feed del panel admin se actualicen en vivo.';

COMMENT ON TABLE qr_sessions IS
  'Sesiones QR activas generadas por el administrador para registrar asistencias. Agregada a supabase_realtime en la migración 0010.';
