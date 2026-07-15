/**
 * PasoRegistro — pasos "confirmar" (datos ya guardados en este dispositivo,
 * de una visita anterior) y "resultado" (pantalla final tras llamar al RPC
 * de registro, éxito o error) del flujo de DocenteScan. Componente
 * presentacional puro: todo el estado y los handlers viven en el
 * orquestador (`index.jsx`), este archivo solo recibe props y renderiza.
 *
 * Fix ARCH-23 (auditoría QA del 15 de julio): extraído de `index.jsx`
 * (525 líneas, mezclaba estos dos pasos con el resto del flujo), mismo
 * patrón ya usado en ARCH-11/13/18.
 */

import Shell from "./Shell";
import HorarioHoyCard from "./HorarioHoyCard";
import { avisoStale, normalizarCedula } from "./cedula";
import { IconScan, RESULTADO_UI, CODIGOS_REQUIEREN_REESCANEO } from "./icons";

export default function PasoRegistro({
  paso,
  tipo,
  cedula,
  nombre,
  datosGuardados,
  resultado,
  loading,
  onConfirmar,
  onCambiarDatos,
  onVolverTipo,
  onVolverASelectorTipo,
}) {
  // ── Resultado ────────────────────────────────────────────────────────────
  if (paso === "resultado" && resultado) {
    const requiereReescaneo =
      !resultado.ok &&
      CODIGOS_REQUIEREN_REESCANEO.includes(resultado.codigo) &&
      !!datosGuardados;

    if (requiereReescaneo) {
      return (
        <Shell ancho={420}>
          <IconScan />
          <h2 className="scan-result-title scan-color-brand-dark">
            Escanea el código QR para registrar tu {tipo === "SALIDA" ? "salida" : "entrada"}
          </h2>
          <p className="scan-result-desc">
            Por seguridad, el código QR cambia constantemente. Abre la cámara de tu teléfono y apunta al código QR que está ahora en la pantalla del aula para completar tu registro.
          </p>

          <div className="scan-requiere-rescan-card">
            <div className="scan-requiere-rescan-card__label">
              Tus datos ya están confirmados — no necesitas escribirlos de nuevo
            </div>
            <div className="scan-requiere-rescan-card__name">{datosGuardados.nombre}</div>
            <div className="scan-requiere-rescan-card__cedula">{datosGuardados.cedula}</div>
          </div>

          <button
            onClick={onVolverASelectorTipo}
            className="scan-link-btn"
          >
            <i className="ti ti-arrow-left scan-link-btn__icon" aria-hidden="true" />
            Cambiar tipo de registro
          </button>
        </Shell>
      );
    }

    const tipoUi = resultado.ok ? "ok" : (resultado.codigo || "ERROR");
    const ui     = RESULTADO_UI[tipoUi] || RESULTADO_UI.ERROR;
    const { Icon, titulo, colorClass, hint } = ui;
    return (
      <Shell ancho={420}>
        <Icon />
        <h2 className={`scan-result-title ${colorClass}`}>{titulo}</h2>
        <p className="scan-result-desc">{resultado.mensaje}</p>
        {hint && <p className="scan-result-hint">{hint}</p>}

        {resultado.ok && (
          <div className="scan-success-card">
            <div className="scan-success-card__label">
              {resultado.tipo === "SALIDA" ? "Salida registrada" : "Entrada registrada"}
            </div>
            <div className="scan-success-card__name">{nombre || datosGuardados?.nombre}</div>
            <div className="scan-success-card__cedula">{normalizarCedula(cedula || datosGuardados?.cedula || "")}</div>
          </div>
        )}

        {resultado.ok && (
          <HorarioHoyCard horarioHoy={resultado.horario_hoy} diaSemana={resultado.dia_semana} />
        )}

        <button
          onClick={onVolverASelectorTipo}
          className="scan-link-btn"
        >
          <i className="ti ti-arrow-left scan-link-btn__icon" aria-hidden="true" />
          Registrar otra marca
        </button>
      </Shell>
    );
  }

  // ── Confirmación (datos guardados) ───────────────────────────────────────
  const aviso = avisoStale(datosGuardados);
  return (
    <Shell>
      <div className="scan-step-header scan-step-header--mb24">
        <div className="scan-icon-badge">
          <i className={tipo === "SALIDA" ? "ti ti-logout scan-icon-badge__icon" : "ti ti-login scan-icon-badge__icon"} aria-hidden="true" />
        </div>
        <h1 className="scan-step-heading">{tipo === "SALIDA" ? "Registrar Salida" : "Registrar Entrada"}</h1>
        <p className="scan-step-subtitle">Confirma que eres tú para continuar</p>
      </div>

      {aviso && (
        <div className="scan-warn-banner scan-warn-banner--mb14">
          <i className="ti ti-alert-triangle scan-warn-banner__icon" aria-hidden="true" />
          <p className="scan-warn-banner__text">{aviso}</p>
        </div>
      )}

      <div className="scan-saved-card">
        <div className="scan-saved-card__label">Datos guardados en este dispositivo</div>
        <div className="scan-saved-card__name">{datosGuardados.nombre}</div>
        <div className="scan-saved-card__cedula">{datosGuardados.cedula}</div>
      </div>

      <button
        onClick={onConfirmar}
        disabled={loading}
        className="scan-btn-confirm"
      >
        <i className={tipo === "SALIDA" ? "ti ti-logout scan-btn-confirm__icon" : "ti ti-check scan-btn-confirm__icon"} aria-hidden="true" />
        {loading ? "Registrando…" : `Confirmar mi ${tipo === "SALIDA" ? "salida" : "entrada"}`}
      </button>

      <button onClick={onCambiarDatos} className="scan-cambiar-datos-btn">
        No soy yo — usar otros datos
      </button>

      <button onClick={onVolverTipo} className="scan-tipo-link-sm">
        <i className="ti ti-arrow-left scan-tipo-link-sm__icon" aria-hidden="true" />
        Cambiar tipo de registro
      </button>
    </Shell>
  );
}
