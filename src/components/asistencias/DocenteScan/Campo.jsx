// Input con estilo y manejo de error/hint, usado en el formulario de primera vez.
// Fix UX-4 (auditoría julio 2026): label e input no estaban asociados
// programáticamente (sin htmlFor/id), por lo que un lector de pantalla no
// anunciaba la etiqueta al enfocar el campo. Se usa useId() para generar
// un id estable por instancia y se enlaza también el mensaje de
// error/hint vía aria-describedby, para que el lector de pantalla lo lea
// junto con el campo en vez de solo visualmente.
import { useId } from "react";
import "./DocenteScan.css";

function Campo({ label, hint, error, success, ...props }) {
  const id = useId();
  const msgId = `${id}-msg`;
  const inputClass = "scan-input" + (error ? " scan-input--error" : success ? " scan-input--success" : "");
  const tieneMensaje = Boolean(error || hint);
  return (
    <div className="scan-field">
      <label htmlFor={id} className="scan-field__label">{label}</label>
      <input
        {...props}
        id={id}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={tieneMensaje ? msgId : undefined}
        className={inputClass}
      />
      {error ? (
        <p id={msgId} className="scan-field__msg scan-field__msg--icon scan-field__msg--error">
          <i className="ti ti-alert-triangle scan-field__msg-icon" aria-hidden="true" />
          {error}
        </p>
      ) : success ? (
        <p id={msgId} className="scan-field__msg scan-field__msg--icon scan-field__msg--success">
          <i className="ti ti-check scan-field__msg-icon" aria-hidden="true" />
          {hint}
        </p>
      ) : hint ? (
        <p id={msgId} className="scan-field__msg scan-field__msg--hint">{hint}</p>
      ) : null}
    </div>
  );
}

export default Campo;
