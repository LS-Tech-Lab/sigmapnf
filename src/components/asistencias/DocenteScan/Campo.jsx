// Input con estilo y manejo de error/hint, usado en el formulario de primera vez.
import "./DocenteScan.css";

function Campo({ label, hint, error, success, ...props }) {
  const inputClass = "scan-input" + (error ? " scan-input--error" : success ? " scan-input--success" : "");
  return (
    <div className="scan-field">
      <label className="scan-field__label">{label}</label>
      <input
        {...props}
        className={inputClass}
      />
      {error ? (
        <p className="scan-field__msg scan-field__msg--icon scan-field__msg--error">
          <i className="ti ti-alert-triangle scan-field__msg-icon" aria-hidden="true" />
          {error}
        </p>
      ) : success ? (
        <p className="scan-field__msg scan-field__msg--icon scan-field__msg--success">
          <i className="ti ti-check scan-field__msg-icon" aria-hidden="true" />
          {hint}
        </p>
      ) : hint ? (
        <p className="scan-field__msg scan-field__msg--hint">{hint}</p>
      ) : null}
    </div>
  );
}

export default Campo;
