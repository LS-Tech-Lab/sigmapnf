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
│   └── usuarios/              # Gestión de usuarios y roles (carpeta, no un solo archivo)
├── hooks/
│   ├── useAuth.js             # Auth + permisos + Realtime + idle timeout
│   ├── useAppData/
│   │   └── useDataSync.js     # Sincronización de horarios
│   └── useQRSession.js        # Estado de sesión QR activa
├── lib/                       # Clientes externos (Supabase)
├── constants/                 # Programas, trayectos, horarios de turno
└── utils/                     # parsing.js, conflictos, lapso, cache

supabase/
└── migrations/                # SQL secuencial (0005 → 0046)

api/
└── admin-users.js             # Vercel Function: crear/resetear usuarios
                                # (reemplaza una Edge Function de Supabase
                                # que ya no forma parte del repo)

docs/
├── SECURITY.md                # Roles, RLS y su historial de hallazgos
├── AUDITORIA_FRONTEND.md      # Auditoría de componentes frontend
├── AUDITORIA_INDICE.md        # Índice de todos los hallazgos de auditoría
├── ESQUEMA_Y_MIGRACIONES.md   # Esquema de BD e índice de migraciones
├── MATRIZ_PERMISOS.md         # Catálogo completo de permisos (RBAC)
├── ARQUITECTURA.md            # Decisiones de arquitectura y sus motivos
└── FLUJO_ASISTENCIAS_QR.md    # Flujo end-to-end del módulo QR
```

## Roles y permisos

Los roles se definen en la tabla `roles` (no en código) — cualquier admin
puede crear un rol nuevo con su propia combinación de permisos desde la UI,
sin tocar SQL. Cada rol tiene un objeto JSONB `permisos` con 16 claves
booleanas (`puedeEditarHorarios`, `puedeGestionarQR`, `puedeVerAuditoria`,
etc.) agrupadas en 5 categorías: Horarios, Catálogos académicos, Respaldo
de datos, Módulo QR y Administración.

El catálogo completo, con qué controla cada permiso y dónde se hace
cumplir (RLS, RPC, o solo la interfaz), está en
[`docs/MATRIZ_PERMISOS.md`](docs/MATRIZ_PERMISOS.md).

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
git clone https://github.com/LS-Tech-Lab/sigmapnf.git
cd sigmapnf
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
`0046`). Para un entorno nuevo, ejecutar las migraciones en orden desde el SQL
Editor de Supabase o con la CLI:

```bash
supabase db push
```

La arquitectura de seguridad (RLS, `tiene_permiso()`, tablas de auditoría)
está documentada en [`docs/SECURITY.md`](docs/SECURITY.md); el esquema
completo por tabla y el índice de todas las migraciones, en
[`docs/ESQUEMA_Y_MIGRACIONES.md`](docs/ESQUEMA_Y_MIGRACIONES.md).

## Despliegue

Configurado para Vercel (`vercel.json`). Cada push a `main` dispara un build
automático. Variables de entorno requeridas en Vercel:

| Variable | Descripción |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública anon |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service role (solo para `api/`) |

## Licencia

Ver [`LICENSE`](LICENSE).
