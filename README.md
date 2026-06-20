# HorariosPNF

Sistema web para la gestión de horarios académicos y el control automatizado de
asistencia docente, desarrollado para los Programas Nacionales de Formación
(PNF) de UNERMB, sede Cabimas.

## Características

- **Gestión de horarios**: carga desde Excel, visualización por trayecto/sección,
  detección automática de conflictos de horario.
- **Gestión académica**: docentes, materias, secciones y programas
  (PNF Informática, Contaduría Pública, Agroalimentación, Educación Especial).
- **Asistencia docente vía QR**: generación de sesiones QR por jornada, escaneo
  de entrada/salida, vinculación automática del docente por coincidencia
  difusa de nombre (`pg_trgm`), y reportes exportables a PDF.
- **Control de acceso por roles**: admin, coordinador, secretario,
  administrativo y operador QR, con políticas de Row Level Security en
  Supabase y registro de auditoría.
- **Historial por trimestre académico**, con comparación entre lapsos.

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite 5 |
| Backend / BD | [Supabase](https://supabase.com) (PostgreSQL + Auth + Realtime + Edge Functions) |
| Hosting | Vercel |
| Procesamiento de planillas | [xlsx](https://www.npmjs.com/package/xlsx) |

## Estructura del repositorio

```
src/
├── App.jsx           # Componente raíz y enrutamiento de vistas
├── components/        # Vistas y componentes de UI
│   └── asistencias/    # Módulo de asistencia QR
├── hooks/              # Lógica de estado reutilizable (datos, auth, sesión QR)
├── lib/                # Clientes externos (Supabase, realtime)
├── constants/           # Constantes globales (programas, trayectos, horarios)
└── utils/               # Funciones puras (parsing, conflictos, fechas)

supabase/
├── migrations/        # Migraciones SQL, en orden secuencial (0005, 0006...)
└── functions/          # Edge Functions (ej. admin-users)

docs/                  # Documentación de arquitectura y diseño
```

## Requisitos previos

- Node.js 18 o superior
- Una cuenta y proyecto en [Supabase](https://supabase.com)

## Instalación y desarrollo local

```bash
git clone https://github.com/LS-Tech-Lab/horariospnf.git
cd horariospnf
npm install
cp .env.example .env   # completar con tus credenciales de Supabase
npm run dev
```

### Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve localmente el build de producción |

## Base de datos

El esquema vive en `supabase/migrations/`, aplicado de forma secuencial. Para
un nuevo entorno, ejecutar las migraciones en orden desde el SQL Editor de
Supabase o con la CLI oficial. El diseño del sistema de roles y permisos está
documentado en [`docs/SECURITY.md`](docs/SECURITY.md).

## Despliegue

El proyecto está configurado para desplegarse en Vercel (`vercel.json`).
Cada push a la rama principal dispara un build automático.

## Licencia

Ver [`LICENSE`](LICENSE).
