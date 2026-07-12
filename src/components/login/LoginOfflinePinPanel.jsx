import React, { useId } from "react";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LoginScreen.jsx sin
// cambios de lógica — es puramente presentacional, todo el estado y los
// handlers (handlePinLogin, lockout, carga de usuarios offline) siguen
// viviendo en LoginScreen.jsx, que es quien los pasa por props.
//
// Fix U-7 (auditoría 11 de julio): los <label> quedaron como hermanos del
// <input>/<select> tras la extracción de ARCH-10, sin htmlFor/id, por lo
// que un lector de pantalla no anunciaba el campo al enfocarlo. Se usa
// useId() (mismo patrón de Campo.jsx / U-4) para generar ids estables por
// instancia y enlazar cada label con su campo.
export default function LoginOfflinePinPanel({
  usuariosOffline,
  usuarioSelec, setUsuarioSelec,
  pin, setPin,
  pinError, setPinError,
  isPinLocked, pinRemaining,
  pinLoading,
  handlePinLogin,
}) {
  const uid = useId();
  const usuarioId = `${uid}-usuario`;
  const pinId = `${uid}-pin`;

  return (
    <>
      {usuariosOffline.length > 1 && (
        <div className="mb-16">
          <label htmlFor={usuarioId} className="form-label">Usuario</label>
          <select
            id={usuarioId}
            value={usuarioSelec?.userId || ""}
            onChange={e => {
              const u = usuariosOffline.find(x => x.userId === e.target.value);
              setUsuarioSelec(u || null);
              setPin(""); setPinError(null);
            }}
            className="form-input"
          >
            <option value="">— Selecciona usuario —</option>
            {usuariosOffline.map(u => (
              <option key={u.userId} value={u.userId}>
                {u.nombre} ({u.email})
              </option>
            ))}
          </select>
        </div>
      )}

      {usuarioSelec && usuariosOffline.length === 1 && (
        <div className="login-user-badge">
          <i className="ti ti-user-circle login-user-badge__icon" aria-hidden="true" />
          <div>
            <div className="login-user-badge__name">{usuarioSelec.nombre}</div>
            <div className="login-user-badge__email">{usuarioSelec.email}</div>
          </div>
        </div>
      )}

      <div className="mb-22">
        <label htmlFor={pinId} className="form-label">PIN offline</label>
        <input
          id={pinId}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setPinError(null); }}
          onKeyDown={e => e.key === "Enter" && handlePinLogin()}
          disabled={isPinLocked || !usuarioSelec}
          placeholder="••••"
          autoFocus
          className="pin-offline-input"
        />
      </div>

      {pinError && (
        <div className="alert-box alert-box--danger">
          <i className="ti ti-alert-circle icon-alert--top" aria-hidden="true" />
          {pinError}
        </div>
      )}

      {isPinLocked && (
        <div className="alert-box alert-box--warning alert-box--center">
          <i className="ti ti-clock-hour-4 icon-alert" aria-hidden="true" />
          Bloqueado. Intenta de nuevo en {Math.ceil(pinRemaining / 60)} min {pinRemaining % 60}s.
        </div>
      )}

      <button
        onClick={handlePinLogin}
        disabled={pinLoading || isPinLocked || !usuarioSelec || pin.length < 4}
        className="pin-login-btn"
      >
        {pinLoading
          ? "Verificando…"
          : isPinLocked
            ? `Bloqueado (${Math.ceil(pinRemaining / 60)}:${String(pinRemaining % 60).padStart(2, "0")})`
            : <><i className="ti ti-shield-check" aria-hidden="true" /> Entrar con PIN</>
        }
      </button>

      <div className="login-offline-hint">
        Modo offline — los datos se sincronizarán al reconectar
      </div>
    </>
  );
}
