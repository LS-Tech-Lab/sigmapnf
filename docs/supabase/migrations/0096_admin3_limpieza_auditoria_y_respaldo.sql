-- ============================================================================
-- Migración: 0096_admin3_limpieza_auditoria_y_respaldo.sql
-- Fecha: 14 de agosto de 2026
--
-- CONTEXTO (ADMIN-3, solicitado por LS)
-- --------
-- SIGMA está en fase de pruebas. Antes de pasar a producción, LS necesita
-- limpiar datos generados durante las pruebas: asistencias, sesiones QR
-- (ya cubierto por admin_borrar_asistencias_rango / admin_borrar_qr_sesiones,
-- 0053) y ahora también audit_logs, que hasta esta migración NO tenía
-- ninguna vía de borrado accesible desde la app.
--
-- ADVERTENCIA DE DISEÑO — precedente SEC-8 (migración 0049)
-- -----------------------------------------------------------
-- limpiar_audit_logs_antiguos() (0024) se dejó deliberadamente como
-- service_role-only: "cualquiera podía borrar el log de auditoría completo
-- al instante. Anti-forense directo: cualquier acción indebida podía
-- borrarse a sí misma del rastro de auditoría." Esta migración reabre esa
-- capacidad para el rol admin, de forma explícita y a pedido de LS (mismo
-- patrón de UI que TabSesiones/admin_borrar_session_logs). Mitigación
-- parcial: cada purga se auto-registra en audit_logs ANTES de devolver el
-- control (accion 'LIMPIEZA_AUDITORIA_ADMIN', igual que
-- limpiar_audit_logs_antiguos), así que aunque las filas borradas
-- desaparecen, el HECHO de que alguien purgó auditoría (quién, cuándo,
-- cuántas filas) queda trazado. No es un revert de SEC-8: es una excepción
-- consciente, documentada, y limitada al rol admin vía permiso dinámico
-- (revocable desde Usuarios y Roles sin tocar código).
--
-- Nueva clave en roles.permisos: puedeBorrarAuditoria (distinta de
-- puedeBorrarSesiones/puedeBorrarReportes a propósito -- borrar el propio
-- rastro de auditoría es una capacidad más sensible que borrar sesiones o
-- reportes, amerita su propio grant independiente).
-- ============================================================================


-- ── 1. Nuevo permiso, SOLO para el rol admin ─────────────────────────────────
UPDATE public.roles
SET permisos = permisos || jsonb_build_object(
  'puedeBorrarAuditoria', true
)
WHERE nombre = 'admin';


-- ── 2. admin_borrar_audit_logs ───────────────────────────────────────────────
-- Mismo contrato que admin_borrar_session_logs (0054): borra por ids
-- específicos O por antigüedad (antes_de). Exactamente uno de los dos.
CREATE OR REPLACE FUNCTION public.admin_borrar_audit_logs(
  p_ids       UUID[]      DEFAULT NULL,
  p_antes_de  TIMESTAMPTZ DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT tiene_permiso(auth.uid(), 'puedeBorrarAuditoria') THEN
    RAISE EXCEPTION 'No tienes permiso para borrar registros de auditoría.';
  END IF;

  IF (p_ids IS NULL OR array_length(p_ids, 1) IS NULL) AND p_antes_de IS NULL THEN
    RAISE EXCEPTION 'Debes indicar ids específicos o una fecha límite (p_antes_de).';
  END IF;

  DELETE FROM public.audit_logs
  WHERE (p_ids IS NOT NULL AND id = ANY(p_ids))
     OR (p_antes_de IS NOT NULL AND created_at < p_antes_de);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Auto-registro de la purga (mismo patrón que limpiar_audit_logs_antiguos,
  -- 0024): la fila que documenta el borrado se escribe DESPUÉS del DELETE,
  -- así que sobrevive a la propia purga y queda como próximo registro de
  -- auditoría. No es una garantía anti-forense completa (un admin con este
  -- permiso podría, en teoría, purgar de nuevo para tapar la traza previa),
  -- pero deja evidencia inmediata de quién purgó, cuándo y cuánto.
  PERFORM log_audit_event(
    p_accion        := 'LIMPIEZA_AUDITORIA_ADMIN',
    p_entidad       := 'audit_logs',
    p_resumen       := format('Se borraron %s registro(s) de auditoría.', v_count),
    p_datos_despues := jsonb_build_object(
      'cantidad',  v_count,
      'ids',       p_ids,
      'antes_de',  p_antes_de
    )
  );

  RETURN v_count;
END;
$$;

REVOKE ALL    ON FUNCTION public.admin_borrar_audit_logs(UUID[], TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_borrar_audit_logs(UUID[], TIMESTAMPTZ) TO authenticated;

COMMENT ON FUNCTION public.admin_borrar_audit_logs IS
  'Borra registros de audit_logs por ids o por antigüedad. Requiere '
  'permiso puedeBorrarAuditoria (revalidado en el servidor, solo admin por '
  'defecto). Excepción explícita y documentada al patrón anti-forense de '
  'SEC-8 (0049): la purga se auto-registra en audit_logs antes de retornar.';


-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================
-- 1. SELECT nombre, permisos->'puedeBorrarAuditoria' AS auditoria
--    FROM roles WHERE nombre = 'admin';
--    Debe ser `true`. Cualquier otro rol debe seguir en NULL/false.
--
-- 2. Con un usuario SIN el permiso:
--    SELECT admin_borrar_audit_logs(p_antes_de := now());
--    Debe rechazar con "No tienes permiso para borrar registros de auditoría.".
--
-- 3. Con el usuario admin, borrar un id de prueba y confirmar que:
--    a) La fila desaparece de audit_logs.
--    b) Aparece una fila NUEVA con accion = 'LIMPIEZA_AUDITORIA_ADMIN' y
--       datos_despues.cantidad = 1.
-- ============================================================================
