# 📘 Manual de Usuario — SIGMA PNF

Guía completa de uso del sistema, organizada por función. Cada sección
indica qué rol puede hacer qué — si no ves una opción descrita aquí en tu
pantalla, es porque tu rol no tiene ese permiso, no porque esté roto.

> Este manual describe el comportamiento real del sistema al momento de
> escribirlo (julio 2026). Las imágenes son ilustraciones del flujo, no
> capturas de pantalla reales — los textos, botones y mensajes sí son
> exactos.

---

## Índice

1. [Acceso al sistema](#1-acceso-al-sistema)
2. [Módulo de Horarios](#2-módulo-de-horarios)
3. [Módulo de Asistencias QR](#3-módulo-de-asistencias-qr)
4. [Gestión de usuarios y roles](#4-gestión-de-usuarios-y-roles)
5. [Registros y auditoría](#5-registros-y-auditoría)
6. [Modo sin conexión](#6-modo-sin-conexión)
7. [Preguntas frecuentes](#7-preguntas-frecuentes)

---

## 1. Acceso al sistema

### 1.1 Iniciar sesión

Entra con tu correo y contraseña institucional. Si te equivocas la
contraseña **5 veces**, el sistema bloquea intentos nuevos por un minuto
— es una protección automática, no un error. Si sigues sin poder entrar
después de eso, puede que la cuenta esté bloqueada por seguridad a nivel
de servidor; contacta a un administrador.

Si tu cuenta fue desactivada por un administrador, verás una pantalla
explicándolo en vez del sistema — no es un error tuyo, contacta a quien
administre el sistema en tu institución.

### 1.2 Elegir módulo (solo si tienes acceso a los dos)

El sistema tiene dos módulos independientes: **Gestión de Horarios** y
**Control de Asistencias**. Si tu rol solo tiene acceso a uno, entras
directo a ese — no vas a ver ninguna pantalla de selección. Si tienes
acceso a ambos (por ejemplo, el rol Admin), verás una pantalla para elegir
cuál usar; puedes cambiar de módulo después desde el menú.

### 1.3 PIN sin conexión

Si tu institución tiene mala conexión a internet, el sistema permite
configurar un PIN de 4-6 dígitos para volver a entrar sin necesitar red
después del primer login (con conexión) del día. El PIN se guarda
únicamente en tu dispositivo — cambiar de computadora o celular requiere
volver a iniciar sesión con contraseña la primera vez.

### 1.4 Cambiar tu contraseña

Desde el menú de tu usuario (arriba a la derecha) puedes cambiar tu propia
contraseña en cualquier momento, sin necesitar a un administrador.

---

## 2. Módulo de Horarios

### 2.1 Vista general (Resumen)

Al entrar al módulo de Horarios verás un panel con cuatro indicadores:
**conflictos activos**, **trayectos activos**, **promedio de clases por
día** y **docentes con conflictos**. Es la foto rápida del estado del
trimestre actual — si "Conflictos activos" está en rojo, hay choques de
horario sin resolver (ver §2.5).

Arriba hay una **búsqueda global**: escribe el nombre de un docente, una
materia, o una sección, y el sistema te lleva directo a esa clase en la
grilla — más rápido que navegar turno por turno.

### 2.2 Ver los horarios

![Grilla de horarios](./images/grid-horarios.svg)

La grilla se organiza por turno (Diurno, Vespertino, Nocturno) y muestra
cada bloque de clase con la materia, el docente y el aula asignada. Usa
los selectores de **trayecto** y **sección** arriba para filtrar. Haz clic
en cualquier bloque para ver el detalle completo.

**Un bloque en rojo con ⚠** significa que hay un conflicto — normalmente,
el mismo docente o la misma aula asignada dos veces en el mismo horario.

### 2.3 Editar un horario

*(Requiere el permiso "Editar Horarios" — si no ves la opción de editar al
hacer clic en un bloque, tu rol no lo tiene.)*

Al hacer clic en un bloque con permiso de edición, puedes cambiar materia,
docente, aula o el bloque horario. Los cambios se guardan de inmediato y
se sincronizan en vivo — si otra persona tiene el sistema abierto al mismo
tiempo, va a ver tu cambio reflejado sin necesitar recargar la página.

**Borrar un horario** requiere un permiso adicional ("Borrar Horarios") —
es intencional: alguien puede tener permiso para editar contenido sin
poder eliminarlo.

### 2.4 Importar horarios desde Excel

*(Requiere el permiso "Importar Excel".)*

Desde el menú de administración puedes subir un archivo `.xlsx` con el
formato de horarios de tu programa. El sistema previsualiza los cambios
antes de aplicarlos — revisa la vista previa con cuidado, especialmente si
es una carga masiva que reemplaza un trimestre completo.

### 2.5 Conflictos de horario

La vista de **Conflictos** lista cada choque detectado automáticamente:
mismo docente en dos clases al mismo tiempo, o misma aula ocupada dos
veces. Haz clic en un conflicto para ir directo al docente involucrado y
resolverlo desde ahí.

### 2.6 Gestión de docentes y materias

Desde las vistas de **Docentes** y **Materias** puedes:
- Ver el listado completo, con teléfono/email/observaciones si están cargados.
- Renombrar un docente o materia — el cambio se refleja en todos los horarios donde aparece.
- **Unificar** dos entradas duplicadas (por ejemplo, "J. Pérez" y "Juan Pérez" cargados por error como dos personas distintas) en una sola, sin perder el historial de clases de ninguna de las dos.

*(Editar/unificar requiere el permiso correspondiente — "Editar Docentes"
o "Editar Materias".)*

### 2.7 Historial de trimestres

Cada trimestre académico ("lapso") queda registrado con su fecha de
apertura y cierre. Desde esta vista (*requiere el permiso "Gestionar
Trimestres"*) puedes:
- Cerrar el trimestre actual y abrir uno nuevo — los horarios de trimestres cerrados quedan disponibles para consulta, pero no editables desde la vista normal.
- Consultar horarios de cualquier trimestre pasado sin afectar el trimestre activo.

### 2.8 Respaldo y restauración

*(Requiere el permiso "Hacer Backup"/"Restaurar Backup", según la acción.)*

Desde el menú de administración puedes **descargar un respaldo completo**
(horarios, docentes, materias y asistencias) en un archivo `.json`, y
**restaurar** el sistema desde un respaldo anterior si algo salió mal. La
restauración sobrescribe los datos actuales — úsala con cuidado, idealmente
después de confirmar con otro administrador.

---

## 3. Módulo de Asistencias QR

Este módulo tiene tres pantallas distintas, cada una para una persona
distinta: el **operador** (quien abre la sesión), la **proyección** (lo
que se ve en el aula), y el **docente** (quien escanea desde su celular).

### 3.1 Panel del operador

*(Requiere el permiso "Gestionar QR".)*

![Panel de administración QR](./images/panel-qr-admin.svg)

Para tomar asistencia:
1. Elige el **turno** y, si aplica, el **programa**.
2. El sistema genera un código QR y lo muestra en pantalla — proyecta esta
   pantalla (o la de "solo proyección", ver 3.2) en el aula.
3. El código **cambia solo**, por seguridad, tanto por tiempo (cada 5
   minutos como máximo) como cada vez que alguien escanea — una foto vieja
   del QR deja de servir en cuestión de segundos.
4. El panel muestra en vivo quién ha marcado entrada/salida, con contador
   de presentes en tiempo real.
5. Al terminar, usa **"Cerrar sesión"** — el QR proyectado deja de
   funcionar de inmediato.

**Botón "Regenerar QR ahora":** fuerza un cambio de código manual, por si
sospechas que alguien fuera del aula tiene una foto del código actual.

### 3.2 Pantalla de proyección

Una versión simplificada del panel, pensada solo para mostrarse en el
televisor o proyector del aula — sin los controles administrativos, solo
el código QR y las instrucciones para el docente. Útil si quien opera el
panel prefiere manejarlo desde su propio celular o laptop mientras se
proyecta desde otro dispositivo.

### 3.3 Cómo escanea un docente

No necesita cuenta ni contraseña — cualquier docente con cédula registrada
en el sistema puede marcar su asistencia.

![Flujo de escaneo del docente](./images/flujo-scan-docente.svg)

1. **Escanear** el QR proyectado con la cámara del celular — se abre
   directo en el navegador, sin necesidad de ninguna app.
2. **La primera vez** en ese dispositivo, confirma tu cédula y nombre. **A
   partir de la segunda vez**, el sistema ya te reconoce y solo pide
   confirmar si es Entrada o Salida.
3. Confirmar — el sistema registra la hora exacta.

**Si el mensaje dice "vuelve a escanear":** no es un error — el código
cambió justo en ese momento (ver 3.1, punto 3). Solo hay que escanear de
nuevo; si ya habías usado el sistema antes en ese dispositivo, no vas a
tener que volver a escribir tu cédula.

**Un docente solo puede marcar una Entrada y una Salida por día** — si
intentas marcar Entrada dos veces, el sistema te avisa que ya estaba
registrada, en vez de duplicarla.

### 3.4 Reportes de asistencia

*(Requiere el permiso "Ver Reporte de Asistencias".)*

Desde el reporte puedes consultar la asistencia por rango de fechas,
filtrando por turno y programa, y **exportar a PDF o CSV** — el CSV cruza
automáticamente con el listado de docentes para incluir cédula completa,
útil para llevar a nómina o control administrativo.

---

## 4. Gestión de usuarios y roles

*(Requiere el permiso "Gestionar Usuarios"; editar roles requiere además
"Gestionar Roles" — son dos permisos independientes.)*

### 4.1 Crear y editar usuarios

Desde el panel de usuarios puedes crear una cuenta nueva (con correo y
contraseña temporal), activar/desactivar una cuenta existente, resetear la
contraseña de alguien que la olvidó, y asignar o cambiar su rol.

**Desactivar** una cuenta (en vez de borrarla) es la opción recomendada
si alguien deja de trabajar en la institución — conserva su historial de
acciones en los registros de auditoría, solo le impide iniciar sesión.

### 4.2 Roles — no son fijos

El sistema no tiene una lista cerrada de roles. Además de los roles base
(Admin, Coordinador, Secretario, Administrativo, Operador QR), quien tenga
el permiso "Gestionar Roles" puede **crear roles personalizados**,
combinando cualquier conjunto de permisos según la necesidad real de la
institución — por ejemplo, un rol que solo pueda ver reportes de
asistencia sin ninguna otra capacidad.

Los permisos se agrupan en 5 categorías: **Horarios**, **Catálogos
académicos** (docentes/materias), **Respaldo de datos**, **Módulo QR**, y
**Administración**. Cada permiso se activa o desactiva de forma
independiente al crear o editar un rol.

**Un rol puede "restringir por programa":** si se activa esa opción,
cualquier usuario con ese rol solo ve y gestiona datos de su propio
programa asignado, sin acceso al resto — pensado para secretarías que
atienden un solo PNF.

---

## 5. Registros y auditoría

*(Requiere el permiso "Ver Logs" y/o "Ver Auditoría", según la vista.)*

- **Registros de sesión:** quién inició sesión, cuándo, y desde qué
  dispositivo — incluye también los intentos fallidos de inicio de
  sesión.
- **Auditoría:** un historial de acciones administrativas (creación de
  usuarios, cambios de rol, eliminación de horarios, restauración de
  respaldos, cierre de trimestres, etc.), con quién la hizo y cuándo. No
  se puede editar ni borrar manualmente — existe específicamente para que
  quede un rastro confiable.

---

## 6. Modo sin conexión

Si la conexión a internet se cae mientras trabajas:

- **En el módulo de Horarios**, los datos ya cargados siguen visibles,
  pero no se pueden guardar cambios nuevos hasta que vuelva la conexión.
- **En el escaneo de asistencia (`/scan`)**, el sistema detecta la
  desconexión y guarda tu marca de asistencia en el propio dispositivo,
  mostrando una confirmación de "guardado, pendiente de enviar" — en
  cuanto vuelva la señal, se sincroniza solo, sin que tengas que volver a
  escanear.
- El sistema muestra un aviso visible cuando detecta que no hay conexión,
  para que sepas que estás en ese modo.

---

## 7. Preguntas frecuentes

**"Escaneé el QR y dice que vuelva a escanear, ¿perdí mi asistencia?"**
No. El código cambia por seguridad — solo hay que apuntar la cámara otra
vez al código que está en pantalla en ese momento.

**"Marqué mi entrada pero no veo confirmación."**
Revisa que tengas conexión a internet en el celular. Si estabas sin señal,
el sistema debería haber mostrado un aviso de "guardado sin conexión" — si
no viste ningún mensaje, vuelve a escanear para confirmar.

**"No puedo iniciar sesión, dice demasiados intentos."**
Es una protección automática después de varios intentos fallidos —
espera un minuto e intenta de nuevo con la contraseña correcta. Si estás
seguro de tu contraseña y sigue sin funcionar, contacta a un administrador.

**"No veo la opción de editar/borrar que debería tener."**
Tu rol no tiene ese permiso específico activado. Contacta a quien
administre el sistema en tu institución para que revise tu rol asignado.

**"¿Puedo usar el sistema desde el celular?"**
El escaneo de asistencia (`/scan`) está pensado para celular. El resto del
sistema (horarios, reportes, administración) funciona mejor en una
pantalla más grande, aunque no está bloqueado desde el celular.

---

*Para reportar un problema que no está en este manual, contacta a quien
administre el sistema en tu institución. Este documento se actualiza a
medida que el sistema cambia — si notas que algo ya no coincide con lo que
ves en pantalla, avisa para corregirlo.*
