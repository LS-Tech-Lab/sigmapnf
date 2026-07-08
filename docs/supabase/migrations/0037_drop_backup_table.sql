-- =============================================================================
-- Migración 0037 — P2: Eliminar tabla de backup obsoleta
--
-- La tabla _backup_horarios_pre_particion fue creada como salvaguarda
-- durante la migración a particiones por lapso. Desde entonces el sistema
-- usa backups JSONB exportados desde la app y restaurados vía
-- restaurar_backup() (0005/0018). La tabla ya no tiene uso activo.
--
-- Se elimina con IF EXISTS para que la migración sea idempotente y no falle
-- si ya fue eliminada manualmente desde el Dashboard.
-- =============================================================================

DROP TABLE IF EXISTS public._backup_horarios_pre_particion CASCADE;
