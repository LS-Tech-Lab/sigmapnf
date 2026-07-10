import React from "react";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LoginScreen.jsx sin
// cambios de lógica — es puramente presentacional, todo el estado y los
// handlers (handleLogin, lockout) siguen viviendo en LoginScreen.jsx, que
// es quien los pasa por props.
export default function LoginFormNormal({
  email, setEmail,
  password, setPassword,
  isLocked,
  error,
  failedAttempts, maxAttempts,
  remaining,
  loading,
  handleLogin,
}) {
  return (
    <form onSubmit={handleLogin}>
      <div className="mb-16">
        <label className="form-label">Correo electrónico</label>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          required disabled={isLocked} placeholder="tucorreo@dominio.com"
          autoComplete="email"
          className="form-input"
        />
      </div>

      <div className="mb-22">
        <label className="form-label">Contraseña</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          required disabled={isLocked} placeholder="••••••••"
          autoComplete="current-password"
          className="form-input"
        />
      </div>

      {error && !isLocked && (
        <div className="alert-box alert-box--danger">
          <i className="ti ti-alert-circle icon-alert--top" aria-hidden="true" />
          <div>
            {error}
            {failedAttempts > 0 && failedAttempts < maxAttempts && (
              <div className="login-attempt-count">
                Intento {failedAttempts} de {maxAttempts}.
              </div>
            )}
          </div>
        </div>
      )}

      {isLocked && (
        <div className="alert-box alert-box--warning alert-box--center">
          <i className="ti ti-clock-hour-4 icon-alert" aria-hidden="true" />
          Demasiados intentos fallidos. Intenta de nuevo en {remaining} segundo{remaining === 1 ? "" : "s"}.
        </div>
      )}

      <button
        type="submit" disabled={loading || isLocked}
        className="login-submit-btn"
      >
        {isLocked
          ? `Bloqueado (${remaining}s)`
          : loading
            ? "Iniciando sesión…"
            : <><i className="ti ti-login-2" aria-hidden="true" /> Iniciar sesión</>
        }
      </button>
    </form>
  );
}
