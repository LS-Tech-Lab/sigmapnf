# Auditoría y mejoras de frontend — HorariosPNF

Revisión del repositorio `LS-Tech-Lab/horariospnf` con foco en una interfaz
amigable, minimalista, moderna, profesional e institucional. El proyecto
compila correctamente tras los cambios (`npm run build` ✓, 138 módulos, sin
errores).

## 1. Diagnóstico inicial

**Fortalezas ya presentes:**
- Arquitectura de layout sólida: sidebar colapsable + topbar + contenido,
  con buen soporte responsive (overlay en móvil/tablet) ya implementado en
  `src/app/AppStyles.js`.
- Paleta de marca coherente de base (navy `#0F172A` / azul `#2563EB`) y un
  objeto de estilos centralizado (`S` en `src/constants/index.js`) usado en
  17 archivos — buena base para un design system.
- Componentes propios bien resueltos a nivel de UX (`Toast`, `ConfirmModal`,
  bloqueo de intentos de login, modo consulta histórica).

**Problemas identificados:**
1. **Iconografía inconsistente y poco profesional**: se usaban emojis nativos
   del sistema operativo (📅👥⚙️🎓✅⚠️…) como iconos funcionales en sidebar,
   topbar, modales y tarjetas. Esto varía de apariencia según el SO/navegador
   del usuario y no transmite seriedad institucional. La librería de iconos
   **Tabler Icons** ya estaba importada en `index.css` pero nunca se usaba.
2. **Tipografía sin identidad**: solo `system-ui`, sin una fuente propia que
   refuerce la imagen institucional ni jerarquía tipográfica definida.
3. **Tokens de diseño incompletos**: `index.css` definía variables CSS pero
   faltaban escalas de espaciado, sombras, radios y estados de foco
   accesibles; gran parte de los componentes usa estilos inline con valores
   hexadecimal repetidos (`#2563EB`, `#E5E7EB`...) en vez de tokens.
4. **Accesibilidad de foco**: no había un estado `:focus-visible` consistente
   para navegación por teclado.
5. **Pantallas críticas (Login, Selector de módulo, Confirmación)** con
   buena estructura pero terminación visual mejorable (radios, sombras,
   jerarquía tipográfica, iconografía).

## 2. Cambios implementados en esta pasada

| Área | Cambio |
|---|---|
| `src/index.css` | Sistema de tokens institucional: fuente **Inter** (Google Fonts), paleta de marca/superficie/texto/estado, escala de espaciado y sombras, `:focus-visible` accesible global, scrollbar institucional (clara y oscura para el sidebar). |
| `src/constants/index.js` (objeto `S`) | Refinado `card`, `th`, `td`, `badge`, `btn`, `select`, `input` con radios y sombras más suaves/modernas, manteniendo las mismas firmas — el cambio se propaga automáticamente a los 17 archivos que ya consumen `S`. |
| `src/app/buildNavGroups.js` + `src/App.jsx` | Navegación del sidebar, topbar, selector de programa, indicador de trimestre, menú de administración y pestañas del módulo de asistencias: **emojis reemplazados por iconos Tabler** (`ti ti-*`), con tamaños y alineación consistentes. |
| `src/app/AdminMenu.jsx` | Iconos Tabler en las acciones de administración (cargar Excel, backup, restaurar, borrar). |
| `src/components/LoginScreen.jsx` | Rediseño: fondo institucional con degradado radial, tarjeta con sombra y borde sutil, logo con icono, etiquetas en mayúsculas tipo formulario institucional, iconos en mensajes de error/bloqueo y botón de acceso. |
| `src/components/ModuleSelector.jsx` | Iconos Tabler en logo y tarjetas de módulo (antes emoji), flecha de acción e icono de cierre de sesión. |
| `src/components/ConfirmModal.jsx` | Icono Tabler contextual (alerta para acciones destructivas / ayuda para confirmaciones normales) en vez de emoji. |

Todos los cambios usan **CSS puro + Tabler Icons vía CDN** (ya enlazado en el
proyecto), sin nuevas dependencias de npm, por lo que no afectan el tamaño
del bundle de forma relevante.

## 3. Pendiente recomendado (fase 2)

La revisión encontró que el resto de vistas (que no pasan por el objeto `S`
para todo) aún usa emojis como iconografía funcional. Conteo aproximado por
archivo:

```
25  UsuariosView.jsx          14  AdminQRPanel.jsx
24  LogsView.jsx              13  ResumenView.jsx
22  HistorialView.jsx         12  DocentesView.jsx
15  hooks/useAppData/nameEditing.js   11  DocenteScan/index.jsx
                                      11  ReporteAsistencias/index.jsx
```

**Recomendación de orden de intervención** (mayor visibilidad primero):
1. `ResumenView.jsx` y `StatCard.jsx` — es el dashboard, primera pantalla
   que ve la mayoría de roles tras iniciar sesión.
2. `DocentesView.jsx`, `MateriasView.jsx`, `SeccionesView.jsx`,
   `HorariosView.jsx`, `ConflictosView.jsx` — vistas de uso diario.
3. `AdminQRPanel.jsx`, `DocenteScan/`, `ReporteAsistencias/` — módulo de
   asistencias QR.
4. `UsuariosView.jsx`, `LogsView.jsx`, `HistorialView.jsx` — vistas de
   administración, menor frecuencia de uso.

**Patrón a seguir** (ya aplicado en los archivos de esta pasada):
- Sustituir `<span>{emoji}</span>` por `<i className="ti ti-nombre-del-icono" aria-hidden="true" />`.
- Buscar el nombre exacto del icono en <https://tabler.io/icons> (familia
  "outline").
- Para textos de Toast (`"✅ Guardado"`, `"❌ Error"`) es aceptable mantener
  el emoji como refuerzo visual del mensaje, ya que ahí actúa como
  puntuación, no como icono de interfaz — o, si se prefiere coherencia
  total, reemplazar por `<Toast icon="ti-check" .../>` extendiendo el
  componente.
- Reutilizar siempre el objeto `S` de `src/constants/index.js` en vistas
  nuevas en vez de declarar estilos de tabla/tarjeta/botón inline, para que
  los próximos ajustes de marca sigan propagándose automáticamente.

**Otras mejoras sugeridas a futuro:**
- Dividir `App.jsx` (1500+ líneas) y vistas grandes (`HistorialView.jsx`
  32K, `UsuariosView.jsx` 24K) en subcomponentes, para reducir el costo de
  mantenimiento del propio sistema de diseño.
- Sustituir el `box-shadow`/`border` de `S.card` también en los pocos
  lugares donde las vistas grandes redefinen su propia tarjeta inline
  (`ResumenView.jsx`, `HistorialView.jsx`) para heredar la sombra/radio
  nuevos.
- Evaluar `code-splitting` con `import()` dinámico por vista (el build ya
  avisa de un bundle de 917 KB) — mejora de rendimiento percibido, no de
  diseño visual, pero impacta la sensación de "app profesional" en la carga
  inicial.
