# Nota (no es una migración SQL — es un cambio en el frontend)

Este fix no toca la base de datos, así que no necesita un archivo en
docs/supabase/migrations/. El cambio va directo en el repo del
frontend, en:

  src/hooks/useAppData/backupActions.js

## Qué se corrigió

El flujo de fallback de `importarDatos()` (que corre cuando el RPC
`restaurar_backup` todavía no existe en la base — código PGRST202)
hacía:

    supabase.from("asistencias_diarias").upsert(asistenciasSinId, {
      onConflict: "cedula_docente,fecha,tipo",
      ignoreDuplicates: true,
    });

El mismo bug que registrar_asistencia() / registrar_asistencia_manual()
/ restaurar_backup() (RPC): la unique constraint real de la tabla es
uq_asistencia_docente_dia_tipo_sede = UNIQUE(sede_id, cedula_docente,
fecha, tipo). Se corrigió a:

    onConflict: "sede_id,cedula_docente,fecha,tipo"

## Verificado

- 9 tests nuevos en backupActions.restaurarBackup.test.js, incluido un
  test de regresión específico para este bug.
- Suite completa corrida: 48 archivos, 412 tests, todo verde.
- ESLint sobre ambos archivos: 0 warnings.
