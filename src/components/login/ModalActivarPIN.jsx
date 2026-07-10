import React, { useState } from "react";
import { guardarPinOffline } from "../../utils/pinOffline";
import "../LoginScreen.css";

// Fix ARCH-10 (auditoría 9 de julio): extraído de LoginScreen.jsx sin
// cambios de lógica — ya era una función separada dentro del archivo,
// solo se movió a su propio módulo. Modal para activar PIN offline tras
// un login exitoso.
export default function ModalActivarPIN({ user, profile, onDone }) {
  const [pin,    setPin]    = useState("");
  const [pin2,   setPin2]   = useState("");
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState(null);

  const handleGuardar = async () => {
    setErr(null);
    if (!/^\d{4,6}$/.test(pin))     { setErr("El PIN debe tener entre 4 y 6 dígitos."); return; }
    if (pin !== pin2)                { setErr("Los PINs no coinciden."); return; }
    setSaving(true);
    try {
      await guardarPinOffline(user, profile, pin);
      onDone(true);
    } catch (e) {
      setErr("No se pudo guardar el PIN: " + e.message);
    }
    setSaving(false);
  };

  return (
    <div className="pin-modal-overlay">
      <div className="pin-modal-card">
        <div className="pin-modal-header">
          <i className="ti ti-shield-lock pin-modal-icon" aria-hidden="true" />
          <div className="pin-modal-title">Activar PIN offline</div>
          <div className="pin-modal-subtitle">
            Si el internet falla podrás entrar con este PIN. Solo funciona en este dispositivo.
          </div>
        </div>

        <div className="mb-14">
          <label className="form-label">
            PIN (4–6 dígitos)
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, ""))} className="pin-input" placeholder="••••" />
        </div>
        <div className="mb-20">
          <label className="form-label">
            Confirmar PIN
          </label>
          <input type="password" inputMode="numeric" maxLength={6} value={pin2}
            onChange={e => setPin2(e.target.value.replace(/\D/g, ""))} className="pin-input" placeholder="••••" />
        </div>

        {err && (
          <div className="pin-modal-error">
            <i className="ti ti-alert-circle pin-modal-error__icon" aria-hidden="true" />
            {err}
          </div>
        )}

        <div className="pin-modal-btn-row">
          <button onClick={() => onDone(false)} disabled={saving} className="pin-modal-btn-cancel">
            Ahora no
          </button>
          <button onClick={handleGuardar} disabled={saving || pin.length < 4} className="pin-modal-btn-confirm">
            {saving ? "Guardando…" : "Activar PIN"}
          </button>
        </div>
      </div>
    </div>
  );
}
