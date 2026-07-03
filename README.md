# SIGMA — Sistema de Gestión de Horarios y Asistencias

Sistema web para la gestión de horarios académicos y el control automatizado de
asistencia docente, desarrollado para los Programas Nacionales de Formación
(PNF) de UNERMB, sede Cabimas.

## Características

- **Gestión de horarios**: carga desde Excel con detección automática de
  docentes por coincidencia difusa (Levenshtein), visualización por
  trayecto/sección y detección de conflictos de horario.
- **Gestión académica**: docentes, materias, secciones y programas
  (Informática, Contaduría Pública, Agroalimentación, Educación Especial).
- **Asistencia docente vía QR**: generación de sesiones QR por jornada y
  turno, escaneo de entrada/salida en la ruta pública `/scan`, vinculación
  automática del docente por `pg_trgm`, reporte exportable a PDF y proyección
  en pantalla para el aula.
- **Control de acceso por roles**: roles granulares definidos en BD (no en
  código), con Row Level Security en todas las tablas sensibles, invalidación
  de permisos en tiempo real vía Supabase Realtime, y registro completo de
  auditoría (`audit_logs`, `session_logs`, `login_attempts`).
- **Historial por trimestre académico** con comparación entre lapsos y filtro
  por programa para usuarios con restricción de acceso.
- **Seguridad**: timeout de inactividad por rol (30 min admin / 60 min resto),
  rate limiting en `/scan` (10 intentos/hora por dispositivo), re-autenticación
  obligatoria para cambio de contraseña y correo.

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 (code splitting por módulo) |
| Backend / BD | [Supabase](https://supabase.com) (PostgreSQL + Auth + Realtime) |
| Hosting | Vercel |
| Procesamiento de planillas | [xlsx](https://www.npmjs.com/package/xlsx) |
| API serverless | Vercel Functions (`api/admin-users.js`) |

## Estructura del repositorio

```
src/
├── App.jsx                    # Raíz: enrutamiento y guards de auth
├── app/
│   ├── HorariosLayout.jsx     # Módulo principal de horarios
│   ├── AsistenciasModulo.jsx  # Módulo QR/asistencias (lazy-loaded)
│   ├── AdminMenu.jsx
│   └── UserMenu.jsx
├── components/
│   ├── asistencias/
│   │   ├── AdminQRPanel.jsx   # Panel de gestión de sesiones QR
│   │   ├── QRProyeccion.jsx   # Vista de proyección en aula
│   │   ├── ReporteAsistencias.jsx
│   │   └── DocenteScan/       # Ruta pública /scan (sin auth)
│   ├── LogsView.jsx           # Registros de sesión + auditoría
│   ├── HistorialView.jsx      # Historial de trimestres
│   └── UsuariosView.jsx       # Gestión de usuarios y roles
├── hooks/
│   ├── useAuth.js             # Auth + permisos + Realtime + idle timeout
│   ├── useDataSync.js         # Sincronización de horarios
│   └── useQRSession.js        # Estado de sesión QR activa
├── lib/                       # Clientes externos (Supabase)
├── constants/                 # Programas, trayectos, horarios de turno
└── utils/                     # parsing.js, conflictos, lapso, cache

supabase/
├── migrations/                # SQL secuencial (0005 → 0039)
└── functions/                 # Edge Functions legacy

api/
└── admin-users.js             # Vercel Function: crear/resetear usuarios

docs/
├── SECURITY.md                # Arquitectura de roles y RLS
├── AUDITORIA_FRONTEND.md      # Auditoría de componentes frontend
└── SIGMA_Estado_Actual.md     # Estado de implementación y pendientes
```

## Roles y permisos

Los roles se definen en la tabla `roles` (no en código). Cada rol tiene un
objeto JSONB `permisos` con las claves booleanas del sistema:

| Permiso | Descripción |
|---|---|
| `puedeImportarExcel` | Cargar planillas de horarios |
| `puedeEditarHorarios` / `puedeBorrarHorarios` | Modificar datos de horarios |
| `puedeGestionarTrimestres` | Crear/cerrar lapsos académicos |
| `puedeGestionarUsuarios` / `puedeGestionarRoles` | Administrar acceso |
| `puedeGestionarQR` | Abrir/cerrar sesiones QR |
| `puedeVerReporteAsistencias` | Ver reportes sin gestionar QR |
| `puedeVerLogs` / `puedeVerAuditoria` | Acceso a registros del sistema |

Los roles pueden tener `restringe_programa = true`, que limita la visibilidad
del usuario a los datos de su programa asignado.

## Módulo QR — Flujo

```
Admin abre sesión QR (turno + programa)
    ↓
Sistema genera token UUID + TTL (5 min renovable)
    ↓
QR apunta a /scan?token=<uuid>  ← ruta pública, sin auth
    ↓
Docente escanea → ingresa cédula y nombre
    ↓
registrar_asistencia() en PostgreSQL:
  · Rate limit: 10 intentos/hora por dispositivo
  · Valida token, TTL, sesión activa, fecha Venezuela
  · Detecta device fingerprint duplicado en otra cédula
  · Inserta ENTRADA o SALIDA (idempotente por ON CONFLICT)
  · Devuelve horario del día del docente
```

## Carga de horarios desde Excel

El parser (`src/utils/parsing.js`) aplica tres estrategias en cascada:

1. **Split por newline** — docentes separados por salto de línea en la celda.
2. **Separador `Prof`** — múltiples docentes en la misma línea.
3. **Coincidencia difusa** — Levenshtein con normalización de tildes para
   emparejar nombres con errores tipográficos contra el catálogo de docentes.

Una vista previa (`UploadPreviewModal`) muestra los datos antes del insert.

## Instalación y desarrollo local

```bash
git clone https://github.com/LS-Tech-Lab/horariospnf.git
cd horariospnf
npm install
cp .env.example .env   # completar con credenciales de Supabase
npm run dev
```

### Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve localmente el build de producción |

## Base de datos

El esquema vive en `supabase/migrations/`, numerado secuencialmente (`0005` →
`0039`). Para un entorno nuevo, ejecutar las migraciones en orden desde el SQL
Editor de Supabase o con la CLI:

```bash
supabase db push
```

La arquitectura de seguridad (RLS, `tiene_permiso()`, tablas de auditoría)
está documentada en [`docs/SECURITY.md`](docs/SECURITY.md).

## Despliegue

Configurado para Vercel (`vercel.json`). Cada push a `main` dispara un build
automático. Variables de entorno requeridas en Vercel:

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública anon |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service role (solo para `api/`) |

## Licencia

Ver [`LICENSE`](LICENSE)
