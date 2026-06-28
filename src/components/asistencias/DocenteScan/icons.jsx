// Iconos de resultado (éxito/error/aviso) y el mapa de UI por código de
// respuesta de la RPC registrar_asistencia. Extraído de DocenteScan.jsx.

// ── Iconos ───────────────────────────────────────────────────────────────────
export const IconCheck = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#22C55E"/>
    <path d="M7 12.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
export const IconError = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#EF4444"/>
    <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);
export const IconWarn = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#F59E0B"/>
    <path d="M12 7v6M12 16v1" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
  </svg>
);

export const IconOffline = () => (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="12" fill="#6366F1"/>
    <path d="M8 12h8M12 8v8" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
    <path d="M5 19l14-14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export const RESULTADO_UI = {
  ok:                   { Icon: IconCheck,   titulo: "¡Registro exitoso!",                    color: "#15803D" },
  OFFLINE:              { Icon: IconOffline, titulo: "Guardado sin conexión",                  color: "#4338CA",
                          hint: "Se sincronizará automáticamente al recuperar conexión." },
  YA_REGISTRADO:        { Icon: IconWarn,  titulo: "Ya registraste tu entrada hoy", color: "#92400E",
                          hint: "Tu entrada ya estaba registrada. No es necesario hacer nada más." },
  YA_REGISTRADO_SALIDA: { Icon: IconWarn,  titulo: "Ya registraste tu salida hoy", color: "#92400E",
                          hint: "Tu salida ya estaba registrada. No es necesario hacer nada más." },
  SIN_ENTRADA_PREVIA:   { Icon: IconWarn,  titulo: "Falta registrar tu entrada", color: "#92400E",
                          hint: "Debes marcar tu entrada antes de poder marcar la salida." },
  TIPO_INVALIDO:        { Icon: IconError, titulo: "Error interno", color: "#991B1B",
                          hint: "Recarga la página e inténtalo de nuevo." },
  TOKEN_EXPIRADO:       { Icon: IconError, titulo: "Código QR expirado", color: "#991B1B",
                          hint: "Pide al administrador que regenere el código." },
  TOKEN_INVALIDO:       { Icon: IconError, titulo: "Código QR no válido", color: "#991B1B",
                          hint: "Asegúrate de escanear el código desde la pantalla del aula." },
  SESION_INACTIVA:      { Icon: IconError, titulo: "Sesión cerrada por el administrador", color: "#1E40AF",
                          hint: "Esta sesión QR fue cerrada. Busca al operador o administrador del aula y pídele que abra una nueva sesión. Cuando lo haga, escanea el nuevo código QR de la pantalla." },
  DEVICE_DUPLICADO:      { Icon: IconError, titulo: "Dispositivo ya utilizado", color: "#991B1B",
                           hint: "Este celular ya registró la asistencia de otro docente en esta sesión." },
  SESION_FECHA_INVALIDA: { Icon: IconError, titulo: "Código QR de otro día", color: "#991B1B",
                           hint: "Este código QR no corresponde a la fecha de hoy. Escanea el código actual de la pantalla del aula." },
  FECHA_INVALIDA:        { Icon: IconError, titulo: "Fecha no permitida", color: "#991B1B",
                           hint: "Solo se puede crear una sesión QR para el día de hoy." },
  // M-2 fix: código RATE_LIMIT devuelto por registrar_asistencia() cuando
  // el dispositivo supera 10 intentos por hora (tabla scan_rate_limit).
  // Antes se mostraba como "Error de conexión" genérico.
  RATE_LIMIT:            { Icon: IconWarn,  titulo: "Demasiados intentos", color: "#92400E",
                           hint: "Este dispositivo ha realizado demasiados intentos en poco tiempo. Espera unos minutos e intenta de nuevo." },
  ERROR:                 { Icon: IconError, titulo: "Error de conexión", color: "#991B1B",
                          hint: "Intenta de nuevo o contacta al administrador." },
};
