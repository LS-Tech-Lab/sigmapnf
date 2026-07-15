/**
 * PasoValidacionCedula — pasos "formulario" (ingreso de datos, primera vez
 * que el docente escanea desde este dispositivo) y "confirmar_nuevo"
 * (verificación visual de cédula/nombre antes de registrar). Componente
 * presentacional puro: todo el estado y los handlers viven en el
 * orquestador (`index.jsx`), este archivo solo recibe props y renderiza.
 *
 * Fix ARCH-23 (auditoría QA del 15 de julio): extraído de `index.jsx`
 * (525 líneas, mezclaba estos dos pasos con el resto del flujo), mismo
 * patrón ya usado en ARCH-11/13/18.
 */

import Shell from "./Shell";
import Campo from "./Campo";

export default function PasoValidacionCedula({
  paso,
  tipo,
  cedula,
  nombre,
  errorCedula,
  docenteEncontrado,
  buscandoDocente,
  datosNuevos,
  loading,
  onCedulaChange,
  onNombreChange,
  onSubmit,
  onConfirmarNuevo,
  onCorregirNuevo,
  onVolverTipo,
}) {
  // ── Confirmación visual de datos nuevos (primera vez) ────────────────────
  if (paso === "confirmar_nuevo" && datosNuevos) {
    return (
      <Shell>
        <div className="scan-step-header scan-step-header--mb20">
          <div className="scan-icon-badge">
            <i className="ti ti-eye scan-icon-badge__icon" aria-hidden="true" />
          </div>
          <h1 className="scan-step-heading">Verifica tus datos</h1>
          <p className="scan-step-subtitle">Revisa especialmente tu cédula antes de continuar</p>
        </div>

        <div className="scan-warn-banner scan-warn-banner--mb16">
          <i className="ti ti-alert-triangle scan-warn-banner__icon" aria-hidden="true" />
          <p className="scan-warn-banner__text">
            Un solo número equivocado registra tu asistencia con una identidad distinta y puede hacer que aparezcas como ausente.
          </p>
        </div>

        <div className="scan-cedula-card">
          <div className="scan-cedula-card__label--mb8">Tu cédula</div>
          <div className="scan-cedula-card__value">
            {datosNuevos.cedula}
          </div>
          <div className="scan-cedula-card__divider" />
          <div className="scan-cedula-card__label--mb6">Tu nombre</div>
          <div className="scan-cedula-card__name">{datosNuevos.nombre}</div>
        </div>

        <button
          onClick={onConfirmarNuevo}
          disabled={loading}
          className="scan-btn-confirm"
        >
          <i className="ti ti-check scan-btn-confirm__icon" aria-hidden="true" />
          {loading ? "Registrando…" : `Confirmar y registrar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>

        <button
          onClick={onCorregirNuevo}
          className="scan-corregir-btn"
        >
          <i className="ti ti-pencil scan-link-btn__icon" aria-hidden="true" />
          Corregir mis datos
        </button>
      </Shell>
    );
  }

  // ── Formulario (primera vez) ─────────────────────────────────────────────
  return (
    <Shell>
      <div className="scan-step-header scan-step-header--mb24 scan-step-header--full">
        <div className="scan-icon-badge">
          <i className={tipo === "SALIDA" ? "ti ti-logout scan-icon-badge__icon" : "ti ti-login scan-icon-badge__icon"} aria-hidden="true" />
        </div>
        <h1 className="scan-step-heading">{tipo === "SALIDA" ? "Registro de Salida" : "Registro de Entrada"}</h1>
        <p className="scan-step-subtitle">Primera vez — ingresa tus datos</p>
      </div>

      <form onSubmit={onSubmit} className="scan-form-full">
        <Campo
          label="Cédula de identidad"
          value={cedula}
          onChange={onCedulaChange}
          required
          placeholder="V-12345678"
          inputMode="text"
          autoComplete="off"
          autoFocus
          error={errorCedula}
          hint={buscandoDocente ? "Buscando en el sistema…" : "Solo números después del guion. Ej: V-12345678 o E-87654321"}
        />
        <Campo
          label="Nombre completo"
          value={nombre}
          onChange={onNombreChange}
          required
          placeholder="Prof. Juan García"
          autoComplete="name"
          success={docenteEncontrado}
          hint={docenteEncontrado ? "Encontrado en el sistema — puedes corregirlo si no es correcto" : "Será recordado para la próxima vez"}
        />

        <button
          type="submit"
          disabled={loading || !cedula.trim() || !nombre.trim()}
          className="scan-btn-submit"
        >
          {loading ? "Registrando…" : `Registrar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
        </button>
      </form>

      <button onClick={onVolverTipo} className="scan-tipo-link-sm scan-tipo-link-sm--mt14">
        <i className="ti ti-arrow-left scan-tipo-link-sm__icon" aria-hidden="true" />
        Cambiar tipo de registro
      </button>

      <p className="scan-footer-note">
        Tus datos se guardan en este dispositivo para agilizar futuros registros.
      </p>
    </Shell>
  );
}
