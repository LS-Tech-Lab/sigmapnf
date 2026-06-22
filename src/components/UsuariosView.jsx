/**
 * UsuariosView.jsx
 *
 * Panel de Gestión de Usuarios y Roles.
 * Dos pestañas:
 *   • Usuarios  — crear, editar, activar/desactivar, resetear password
 *   • Roles     — crear/editar roles con permisos granulares, eliminar roles custom
 *
 * Acceso:
 *   • "Usuarios": requiere puedeGestionarUsuarios
 *   • "Roles":    requiere puedeGestionarRoles (puede estar solo o junto a puedeGestionarUsuarios)
 *
 * Fuente de verdad: tabla `roles` (creada en migración 0013).
 * No hay nombres de roles hardcodeados en este archivo.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { DEFAULT_PROGRAMAS, S } from "../constants";

// ─── Catálogo de permisos ─────────────────────────────────────────────────────
// Orden y agrupación de los permisos que aparecen en el editor de rol.
const GRUPOS_PERMISOS = [
  {
    grupo: "Horarios",
    icono: "ti-calendar-event",
    items: [
      { key: "puedeVerTodo",             label: "Ver todos los programas",   desc: "Puede cambiar entre todos los PNF sin restricción" },
      { key: "puedeEditarHorarios",      label: "Editar horarios",           desc: "Arrastrar y colocar bloques, editar in-line" },
      { key: "puedeBorrarHorarios",      label: "Borrar horarios",           desc: "Eliminar bloques y vaciar trimestres completos" },
      { key: "puedeGestionarTrimestres", label: "Gestionar trimestres",      desc: "Cambiar el lapso activo, crear/eliminar trimestres" },
    ],
  },
  {
    grupo: "Catálogos académicos",
    icono: "ti-book-2",
    items: [
      { key: "puedeEditarDocentes",  label: "Editar docentes",  desc: "Crear, renombrar y agregar cédulas a docentes" },
      { key: "puedeEditarMaterias",  label: "Editar materias",  desc: "Crear y renombrar unidades curriculares" },
      { key: "puedeImportarExcel",   label: "Importar Excel",   desc: "Cargar horarios desde archivo .xlsx" },
    ],
  },
  {
    grupo: "Respaldo de datos",
    icono: "ti-database",
    items: [
      { key: "puedeHacerBackup",      label: "Exportar backup",  desc: "Descargar JSON con todos los datos del sistema" },
      { key: "puedeRestaurarBackup",  label: "Restaurar backup", desc: "Sobrescribir datos desde un archivo de respaldo" },
    ],
  },
  {
    grupo: "Módulo QR",
    icono: "ti-qrcode",
    items: [
      { key: "puedeGestionarQR",           label: "Gestionar QR",             desc: "Abrir sesiones QR, ver proyección, cerrar sesiones" },
      { key: "puedeVerReporteAsistencias",  label: "Ver reporte de asistencias", desc: "Consultar y exportar el historial de asistencias" },
    ],
  },
  {
    grupo: "Administración",
    icono: "ti-shield-lock",
    items: [
      { key: "puedeGestionarUsuarios", label: "Gestionar usuarios",  desc: "Crear, editar, activar/desactivar cuentas" },
      { key: "puedeGestionarRoles",    label: "Gestionar roles",     desc: "Crear/editar roles y definir sus permisos" },
      { key: "puedeVerLogs",           label: "Ver registros",       desc: "Consultar el historial de acciones del sistema" },
      { key: "puedeVerAuditoria",      label: "Ver auditoría",       desc: "Ver quién hizo qué y cuándo" },
    ],
  },
];

const TODOS_LOS_PERMISOS = GRUPOS_PERMISOS.flatMap(g => g.items.map(i => i.key));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const hex2rgba = (hex, a) => {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
};

const COLORES_PRESET = [
  "#7C3AED","#1D4ED8","#0F766E","#374151","#059669",
  "#DC2626","#D97706","#0891B2","#9333EA","#BE185D",
];

const EMOJIS_PRESET = ["👤","👑","🏛️","📋","📷","🔑","🛡️","📊","🎓","🖥️","📌","⚙️"];

function Badge({ color, children }) {
  return (
    <span style={{
      background: hex2rgba(color || "#374151", 0.12),
      color: color || "#374151",
      border: `1px solid ${hex2rgba(color || "#374151", 0.25)}`,
      borderRadius: 999, padding: "2px 10px",
      fontSize: 12, fontWeight: 600,
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <div style={{ width:20, height:20, border:"2px solid #E2E8F0", borderTop:"2px solid #2563EB",
      borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0 }} />
  );
}

// ─── Modal de confirmación genérico ──────────────────────────────────────────
function ModalConfirm({ titulo, mensaje, onConfirm, onCancel, peligro = true }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.6)", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:1100, padding:16 }}>
      <div style={{ background:"#fff", borderRadius:12, padding:28, maxWidth:380, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,0.25)" }}>
        <h3 style={{ margin:"0 0 8px", fontSize:16, color:"#0F172A" }}>{titulo}</h3>
        <p style={{ margin:"0 0 24px", fontSize:13, color:"#475569", lineHeight:1.6 }}>{mensaje}</p>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onCancel} style={{ ...S.btn(false), padding:"8px 18px" }}>Cancelar</button>
          <button onClick={onConfirm} style={{
            padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
            background: peligro ? "#DC2626" : "#2563EB", color:"#fff",
          }}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de Usuario ─────────────────────────────────────────────────────────
function ModalUsuario({ usuario, roles, programas, onSave, onClose, showToast, logAudit }) {
  const esNuevo = !usuario?.id;
  const [form, setForm] = useState({
    email:    usuario?.email    || "",
    nombre:   usuario?.nombre   || "",
    rol:      usuario?.rol      || (roles[0]?.nombre || ""),
    programa: usuario?.programa || "",
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const rolSeleccionado = roles.find(r => r.nombre === form.rol);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSave = async () => {
    setError("");
    if (!form.email.trim())  return setError("El email es obligatorio.");
    if (!form.nombre.trim()) return setError("El nombre es obligatorio.");
    if (!form.rol)           return setError("Selecciona un rol.");
    if (rolSeleccionado?.restringe_programa && !form.programa)
      return setError("Este rol requiere un programa asignado.");
    if (esNuevo && form.password.length < 8)
      return setError("La contraseña debe tener al menos 8 caracteres.");

    setSaving(true);
    try {
      const programa = rolSeleccionado?.restringe_programa ? form.programa : null;

      if (esNuevo) {
        // Crear usuario via RPC SQL (no requiere CLI para redesplegar)
        const { data: nuevoId, error: rpcError } = await supabase.rpc("admin_create_auth_user", {
          p_email:    form.email.trim(),
          p_password: form.password,
          p_nombre:   form.nombre.trim(),
          p_rol:      form.rol,
          p_programa: rolSeleccionado?.restringe_programa ? form.programa : null,
        });
        if (rpcError) throw new Error(rpcError.message);

        await logAudit?.({
          accion:  "CREAR_USUARIO",
          entidad: "usuarios",
          resumen: `Usuario creado: ${form.email.trim()} (${form.rol}${rolSeleccionado?.restringe_programa ? ` - ${form.programa}` : ""})`,
        });
        showToast?.(`✅ Usuario ${form.email.trim()} creado.`, "success");

      } else {
        // Actualizar perfil via RPC
        const { error: profileError } = await supabase.rpc("admin_upsert_user_profile", {
          p_user_id:  usuario.id,
          p_email:    form.email.trim(),
          p_nombre:   form.nombre.trim(),
          p_rol:      form.rol,
          p_programa: programa,
        });
        if (profileError) throw new Error(profileError.message);

        // Reset de contraseña si se llenó el campo
        if (form.password.trim()) {
          if (form.password.length < 8)
            throw new Error("La nueva contraseña debe tener al menos 8 caracteres.");
          const { error: pwError } = await supabase.rpc("admin_reset_user_password", {
            p_user_id: usuario.id,
            p_password: form.password,
          });
          if (pwError) {
            showToast?.(
              "⚠️ Perfil actualizado pero no se pudo cambiar la contraseña: " + pwError.message,
              "warning"
            );
            onSave();
            return;
          }
        }

        await logAudit?.({
          accion:     "EDITAR_USUARIO",
          entidad:    "usuarios",
          entidad_id: usuario.id,
          resumen: `Usuario editado: ${form.email.trim()} (${form.rol}${programa ? ` - ${programa}` : ""})`,
        });
        showToast?.(`✅ Usuario ${form.email.trim()} actualizado.`, "success");
      }
      onSave();
    } catch (e) {
      setError(e.message || "Error al guardar.");
    }
    setSaving(false);
  };

  const inputStyle = { ...S.input, width: "100%", boxSizing: "border-box" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.6)", display:"flex",
      alignItems:"center", justifyContent:"center", zIndex:1000, padding:16 }}>
      <div style={{ background:"#fff", borderRadius:14, padding:28, maxWidth:480, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,0.25)", display:"flex", flexDirection:"column", gap:18 }}>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ margin:0, fontSize:17, color:"#0F172A", fontWeight:700 }}>
            {esNuevo ? "Nuevo usuario" : "Editar usuario"}
          </h2>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer",
            fontSize:20, color:"#94A3B8", lineHeight:1 }}>✕</button>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase",
              letterSpacing:"0.05em", display:"block", marginBottom:5 }}>Nombre completo</label>
            <input style={inputStyle} value={form.nombre} onChange={set("nombre")} placeholder="Ej: María González" />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase",
              letterSpacing:"0.05em", display:"block", marginBottom:5 }}>Email</label>
            <input style={inputStyle} value={form.email} onChange={set("email")}
              placeholder="correo@ejemplo.com" type="email" disabled={!esNuevo} />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase",
              letterSpacing:"0.05em", display:"block", marginBottom:5 }}>
              {esNuevo ? "Contraseña inicial" : "Nueva contraseña (dejar vacío para no cambiar)"}
            </label>
            <input style={inputStyle} value={form.password} onChange={set("password")}
              type="password" placeholder={esNuevo ? "Mínimo 8 caracteres" : "••••••••"} />
          </div>
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase",
              letterSpacing:"0.05em", display:"block", marginBottom:5 }}>Rol</label>
            <select style={{ ...S.select, width:"100%" }} value={form.rol} onChange={set("rol")}>
              {roles.map(r => (
                <option key={r.nombre} value={r.nombre}>
                  {r.emoji} {r.label}
                </option>
              ))}
            </select>
            {rolSeleccionado && (
              <p style={{ margin:"6px 0 0", fontSize:11, color:"#64748B" }}>
                {rolSeleccionado.restringe_programa
                  ? "⚠️ Este rol restringe la vista a un solo programa — debes asignar uno."
                  : "✓ Acceso sin restricción de programa."}
              </p>
            )}
          </div>
          {rolSeleccionado?.restringe_programa && (
            <div>
              <label style={{ fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase",
                letterSpacing:"0.05em", display:"block", marginBottom:5 }}>Programa asignado</label>
              <select style={{ ...S.select, width:"100%" }} value={form.programa} onChange={set("programa")}>
                <option value="">— Seleccionar programa —</option>
                {programas.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
        </div>

        {error && (
          <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:8,
            padding:"10px 14px", color:"#DC2626", fontSize:13 }}>
            {error}
          </div>
        )}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...S.btn(false), padding:"9px 20px" }} disabled={saving}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:"9px 20px", borderRadius:8, border:"none", cursor: saving ? "not-allowed" : "pointer",
              background:"#2563EB", color:"#fff", fontSize:13, fontWeight:600,
              display:"flex", alignItems:"center", gap:8, opacity: saving ? 0.7 : 1 }}>
            {saving && <Spinner />}
            {saving ? "Guardando…" : (esNuevo ? "Crear usuario" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Editor de Rol ────────────────────────────────────────────────────────────
function ModalRol({ rol, onSave, onClose }) {
  const esNuevo = !rol;
  const [form, setForm] = useState({
    nombre:             rol?.nombre             || "",
    label:              rol?.label              || "",
    emoji:              rol?.emoji              || "👤",
    color:              rol?.color              || "#374151",
    restringe_programa: rol?.restringe_programa || false,
    permisos:           { ...Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, false])),
                          ...(rol?.permisos || {}) },
  });
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState("");

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));
  const setPerm = (k) => (v) => setForm(f => ({ ...f, permisos: { ...f.permisos, [k]: v } }));

  const contarPermisos = Object.values(form.permisos).filter(Boolean).length;

  const handleSave = async () => {
    setError("");
    if (!form.label.trim()) return setError("El nombre del rol es obligatorio.");
    if (esNuevo) {
      if (!form.nombre.trim()) return setError("El identificador es obligatorio.");
      if (!/^[a-z0-9_]+$/.test(form.nombre.trim()))
        return setError("El identificador solo puede tener minúsculas, números y guion bajo (sin espacios).");
    }
    setSaving(true);
    try {
      const { error: err } = await supabase.rpc("admin_upsert_role", {
        p_nombre:             esNuevo ? form.nombre.trim() : rol.nombre,
        p_label:              form.label.trim(),
        p_emoji:              form.emoji,
        p_color:              form.color,
        p_restringe_programa: form.restringe_programa,
        p_permisos:           form.permisos,
      });
      if (err) throw err;
      onSave();
    } catch (e) {
      setError(e.message || "Error al guardar el rol.");
    }
    setSaving(false);
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.65)", display:"flex",
      alignItems:"flex-start", justifyContent:"center", zIndex:1000, padding:16,
      overflowY:"auto" }}>
      <div style={{ background:"#fff", borderRadius:14, padding:28, maxWidth:620, width:"100%",
        boxShadow:"0 20px 60px rgba(0,0,0,0.25)", margin:"auto", display:"flex",
        flexDirection:"column", gap:20 }}>

        {/* Cabecera */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:"#0F172A" }}>
            {esNuevo ? "Nuevo rol" : `Editar rol: ${rol.label}`}
          </h2>
          <button onClick={onClose} style={{ background:"none", border:"none",
            cursor:"pointer", fontSize:20, color:"#94A3B8" }}>✕</button>
        </div>

        {/* Campos básicos */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          {esNuevo && (
            <div style={{ gridColumn:"1/-1" }}>
              <label style={{ fontSize:12, fontWeight:600, color:"#475569",
                textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:5 }}>
                Identificador (slug) <span style={{ color:"#94A3B8", fontWeight:400 }}>— no se puede cambiar luego</span>
              </label>
              <input style={{ ...S.input, width:"100%", boxSizing:"border-box" }}
                value={form.nombre}
                onChange={e => set("nombre")(e.target.value.toLowerCase().replace(/\s/g,"_"))}
                placeholder="ej: coord_informatica" />
            </div>
          )}
          <div style={{ gridColumn:"1/-1" }}>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569",
              textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:5 }}>
              Nombre visible
            </label>
            <input style={{ ...S.input, width:"100%", boxSizing:"border-box" }}
              value={form.label} onChange={e => set("label")(e.target.value)}
              placeholder="Ej: Coordinador de Informática" />
          </div>

          {/* Emoji */}
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569",
              textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:5 }}>
              Emoji
            </label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {EMOJIS_PRESET.map(e => (
                <button key={e} onClick={() => set("emoji")(e)}
                  style={{ fontSize:18, cursor:"pointer", background: form.emoji===e ? "#EFF6FF" : "#F8FAFC",
                    border: `2px solid ${form.emoji===e ? "#2563EB" : "#E2E8F0"}`,
                    borderRadius:8, padding:"4px 8px", lineHeight:1 }}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div>
            <label style={{ fontSize:12, fontWeight:600, color:"#475569",
              textTransform:"uppercase", letterSpacing:"0.05em", display:"block", marginBottom:5 }}>
              Color
            </label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
              {COLORES_PRESET.map(c => (
                <button key={c} onClick={() => set("color")(c)}
                  title={c}
                  style={{ width:24, height:24, borderRadius:6, background:c, cursor:"pointer",
                    border: `3px solid ${form.color===c ? "#0F172A" : "transparent"}`,
                    boxSizing:"border-box" }} />
              ))}
              <input type="color" value={form.color}
                onChange={e => set("color")(e.target.value)}
                style={{ width:28, height:28, border:"none", cursor:"pointer",
                  borderRadius:6, padding:0 }} title="Color personalizado" />
            </div>
          </div>
        </div>

        {/* Restricción de programa */}
        <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer",
          background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:10, padding:"12px 14px" }}>
          <input type="checkbox" checked={form.restringe_programa}
            onChange={e => set("restringe_programa")(e.target.checked)}
            style={{ width:16, height:16, cursor:"pointer", accentColor:"#2563EB" }} />
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:"#0F172A" }}>Restringir a un programa</div>
            <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>
              Los usuarios con este rol solo verán los datos del programa que se les asigne al crearlos.
            </div>
          </div>
        </label>

        {/* Vista previa del badge */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:12, color:"#64748B" }}>Vista previa:</span>
          <Badge color={form.color}>{form.emoji} {form.label || "Nombre del rol"}</Badge>
        </div>

        {/* Permisos */}
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <h3 style={{ margin:0, fontSize:14, fontWeight:700, color:"#0F172A" }}>
              Permisos ({contarPermisos}/{TODOS_LOS_PERMISOS.length})
            </h3>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => {
                const all = Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, true]));
                setForm(f => ({ ...f, permisos: all }));
              }} style={{ ...S.btn(false), fontSize:12, padding:"4px 10px" }}>Todos</button>
              <button onClick={() => {
                const none = Object.fromEntries(TODOS_LOS_PERMISOS.map(k => [k, false]));
                setForm(f => ({ ...f, permisos: none }));
              }} style={{ ...S.btn(false), fontSize:12, padding:"4px 10px" }}>Ninguno</button>
            </div>
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            {GRUPOS_PERMISOS.map(g => (
              <div key={g.grupo} style={{ background:"#F8FAFC", border:"1px solid #E2E8F0",
                borderRadius:10, overflow:"hidden" }}>
                <div style={{ padding:"10px 14px", borderBottom:"1px solid #E2E8F0",
                  display:"flex", alignItems:"center", gap:8 }}>
                  <i className={`ti ${g.icono}`} style={{ color:"#64748B", fontSize:14 }} />
                  <span style={{ fontSize:12, fontWeight:700, color:"#475569",
                    textTransform:"uppercase", letterSpacing:"0.05em" }}>{g.grupo}</span>
                  <span style={{ marginLeft:"auto", fontSize:11, color:"#94A3B8" }}>
                    {g.items.filter(i => form.permisos[i.key]).length}/{g.items.length}
                  </span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:0 }}>
                  {g.items.map((item, idx) => (
                    <label key={item.key} style={{
                      display:"flex", alignItems:"flex-start", gap:12, padding:"10px 14px",
                      cursor:"pointer",
                      borderTop: idx > 0 ? "1px solid #F1F5F9" : "none",
                      background: form.permisos[item.key] ? hex2rgba(form.color, 0.05) : "transparent",
                      transition:"background 0.1s",
                    }}>
                      <input type="checkbox" checked={!!form.permisos[item.key]}
                        onChange={e => setPerm(item.key)(e.target.checked)}
                        style={{ width:15, height:15, marginTop:1, cursor:"pointer",
                          accentColor: form.color, flexShrink:0 }} />
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"#0F172A" }}>{item.label}</div>
                        <div style={{ fontSize:11, color:"#64748B", marginTop:1 }}>{item.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background:"#FEF2F2", border:"1px solid #FCA5A5", borderRadius:8,
            padding:"10px 14px", color:"#DC2626", fontSize:13 }}>
            {error}
          </div>
        )}

        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ ...S.btn(false), padding:"9px 20px" }} disabled={saving}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding:"9px 20px", borderRadius:8, border:"none",
              cursor: saving ? "not-allowed" : "pointer",
              background:"#2563EB", color:"#fff", fontSize:13, fontWeight:600,
              display:"flex", alignItems:"center", gap:8, opacity: saving ? 0.7 : 1 }}>
            {saving && <Spinner />}
            {saving ? "Guardando…" : (esNuevo ? "Crear rol" : "Guardar cambios")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pestaña Usuarios ─────────────────────────────────────────────────────────
function PestanaUsuarios({ permisos, roles, programas, showToast: showToastProp, logAudit }) {
  const [usuarios, setUsuarios]     = useState([]);
  const [loading,  setLoading]      = useState(true);
  const [busqueda, setBusqueda]     = useState("");
  const [filtroRol, setFiltroRol]   = useState("todos");
  const [modalEditar,   setModalEditar]   = useState(null);
  const [modalNuevo,    setModalNuevo]    = useState(false);
  const [confirm,       setConfirm]       = useState(null); // { usuario, nuevoActivo }
  const [toastMsg,      setToastMsg]      = useState("");

  // Usar showToast de props si existe (integrado con el sistema global de la app),
  // si no, usar el toast local de este componente.
  const toast = useCallback((msg, type) => {
    if (showToastProp) showToastProp(msg, type);
    else { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); }
  }, [showToastProp]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_users");
      if (error) throw error;
      setUsuarios(data || []);
    } catch (e) {
      toast(`Error al cargar usuarios: ${e.message}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleActivo = async (u, nuevoActivo) => {
    try {
      const { error } = await supabase.rpc("admin_toggle_user_activo", {
        p_user_id: u.id, p_activo: nuevoActivo,
      });
      if (error) throw error;
      const accion = nuevoActivo ? "activar" : "desactivar";
      await logAudit?.({
        accion:     nuevoActivo ? "ACTIVAR_USUARIO" : "DESACTIVAR_USUARIO",
        entidad:    "usuarios",
        entidad_id: u.id,
        resumen:    `Usuario ${accion}do: ${u.email}`,
      });
      toast(nuevoActivo ? `✅ ${u.nombre} activado.` : `${u.nombre} desactivado.`, "success");
      cargar();
    } catch (e) {
      toast(`⚠️ ${e.message}`, "error");
    }
  };

  const usuariosFiltrados = usuarios.filter(u => {
    const coincideBusqueda = !busqueda ||
      u.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      u.email.toLowerCase().includes(busqueda.toLowerCase());
    const coincideRol = filtroRol === "todos" || u.rol === filtroRol;
    return coincideBusqueda && coincideRol;
  });

  const totalActivos = usuarios.filter(u => u.activo).length;

  return (
    <div>
      {/* Barra de herramientas */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16, alignItems:"center" }}>
        <input
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o email…"
          style={{ ...S.input, flex:"1 1 220px" }}
        />
        <select style={S.select} value={filtroRol} onChange={e => setFiltroRol(e.target.value)}>
          <option value="todos">Todos los roles</option>
          {roles.map(r => <option key={r.nombre} value={r.nombre}>{r.emoji} {r.label}</option>)}
        </select>
        {permisos.puedeGestionarUsuarios && (
          <button onClick={() => setModalNuevo(true)}
            style={{ padding:"8px 16px", borderRadius:8, border:"none", cursor:"pointer",
              background:"#2563EB", color:"#fff", fontSize:13, fontWeight:600,
              display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}>
            <i className="ti ti-user-plus" /> Nuevo usuario
          </button>
        )}
      </div>

      {/* Estadística rápida */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        {[
          { label:"Total", value: usuarios.length, color:"#2563EB", bg:"#EFF6FF" },
          { label:"Activos", value: totalActivos, color:"#059669", bg:"#ECFDF5" },
          { label:"Inactivos", value: usuarios.length - totalActivos, color:"#DC2626", bg:"#FEF2F2" },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, border:`1px solid ${hex2rgba(s.color, 0.2)}`,
            borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.value}</span>
            <span style={{ fontSize:12, color:s.color, fontWeight:600 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabla */}
      {loading ? (
        <div style={{ padding:40, textAlign:"center" }}><Spinner /></div>
      ) : (
        <div style={{ ...S.card, overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                {["Usuario","Rol","Programa","Estado",""].map((h,i) => (
                  <th key={i} style={{ ...S.th, textAlign: i===4 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.length === 0 ? (
                <tr><td colSpan={5} style={{ ...S.td, textAlign:"center", padding:32, color:"#94A3B8" }}>
                  Sin resultados
                </td></tr>
              ) : usuariosFiltrados.map(u => {
                const rolInfo = roles.find(r => r.nombre === u.rol);
                return (
                  <tr key={u.id} style={{ opacity: u.activo ? 1 : 0.5 }}>
                    <td style={S.td}>
                      <div style={{ fontWeight:600, color:"#0F172A", fontSize:13 }}>{u.nombre}</div>
                      <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>{u.email}</div>
                    </td>
                    <td style={S.td}>
                      <Badge color={rolInfo?.color}>
                        {rolInfo?.emoji || "👤"} {rolInfo?.label || u.rol}
                      </Badge>
                    </td>
                    <td style={S.td}>
                      <span style={{ fontSize:13, color:"#475569" }}>{u.programa || "—"}</span>
                    </td>
                    <td style={S.td}>
                      <span style={{ ...S.badge(
                        u.activo ? "#ECFDF5" : "#F1F5F9",
                        u.activo ? "#059669" : "#64748B"
                      ) }}>
                        {u.activo ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign:"right" }}>
                      <div style={{ display:"flex", gap:6, justifyContent:"flex-end" }}>
                        {permisos.puedeGestionarUsuarios && (
                          <>
                            <button onClick={() => setModalEditar(u)}
                              title="Editar"
                              style={{ background:"none", border:"1px solid #E2E8F0", borderRadius:7,
                                padding:"5px 10px", cursor:"pointer", fontSize:13, color:"#374151" }}>
                              <i className="ti ti-pencil" />
                            </button>
                            <button
                              onClick={() => setConfirm({ usuario: u, nuevoActivo: !u.activo })}
                              title={u.activo ? "Desactivar" : "Activar"}
                              style={{ background:"none", border:"1px solid #E2E8F0", borderRadius:7,
                                padding:"5px 10px", cursor:"pointer", fontSize:13,
                                color: u.activo ? "#DC2626" : "#059669" }}>
                              <i className={u.activo ? "ti ti-user-off" : "ti ti-user-check"} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modales */}
      {(modalNuevo || modalEditar) && (
        <ModalUsuario
          usuario={modalEditar || null}
          roles={roles}
          programas={programas}
          showToast={toast}
          logAudit={logAudit}
          onSave={() => { setModalNuevo(false); setModalEditar(null); cargar(); }}
          onClose={() => { setModalNuevo(false); setModalEditar(null); }}
        />
      )}

      {confirm && (
        <ModalConfirm
          titulo={confirm.nuevoActivo ? "Activar usuario" : "Desactivar usuario"}
          mensaje={`¿Confirmas ${confirm.nuevoActivo ? "activar" : "desactivar"} la cuenta de ${confirm.usuario.nombre}?`}
          peligro={!confirm.nuevoActivo}
          onConfirm={() => {
            toggleActivo(confirm.usuario, confirm.nuevoActivo);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Toast */}
      {toastMsg && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"#0F172A", color:"#fff", borderRadius:10, padding:"10px 20px",
          fontSize:13, fontWeight:500, zIndex:2000, boxShadow:"0 8px 24px rgba(0,0,0,0.3)",
          whiteSpace:"nowrap" }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

// ─── Pestaña Roles ────────────────────────────────────────────────────────────
function PestanaRoles({ permisos: permisosUsuario, onRolesChanged, showToast: showToastProp }) {
  const [roles,     setRoles]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modalRol,  setModalRol]  = useState(undefined);
  const [confirm,   setConfirm]   = useState(null);
  const [toastMsg,  setToastMsg]  = useState("");
  const [expandido, setExpandido] = useState(null);

  const toast = useCallback((msg, type) => {
    if (showToastProp) showToastProp(msg, type);
    else { setToastMsg(msg); setTimeout(() => setToastMsg(""), 3000); }
  }, [showToastProp]);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_get_roles");
      if (error) throw error;
      setRoles(data || []);
      onRolesChanged?.(data || []);
    } catch (e) {
      toast(`Error: ${e.message}`);
    }
    setLoading(false);
  }, [onRolesChanged]);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminarRol = async (nombre) => {
    try {
      const { error } = await supabase.rpc("admin_delete_role", { p_nombre: nombre });
      if (error) throw error;
      toast("✓ Rol eliminado.");
      cargar();
    } catch (e) {
      toast(`⚠️ ${e.message}`);
    }
  };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <p style={{ margin:0, fontSize:13, color:"#64748B" }}>
          Los roles del sistema (marcados con 🔒) no se pueden eliminar ni renombrar, pero sí puedes
          editar sus permisos. Los roles personalizados son totalmente gestionables.
        </p>
        {permisosUsuario.puedeGestionarRoles && (
          <button onClick={() => setModalRol(null)}
            style={{ padding:"8px 16px", borderRadius:8, border:"none", cursor:"pointer",
              background:"#7C3AED", color:"#fff", fontSize:13, fontWeight:600,
              display:"flex", alignItems:"center", gap:6, flexShrink:0, marginLeft:16 }}>
            <i className="ti ti-plus" /> Nuevo rol
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:"center" }}><Spinner /></div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {roles.map(r => {
            const abierto = expandido === r.nombre;
            const permsCounts = Object.entries(r.permisos || {}).filter(([,v]) => v === true).length;
            return (
              <div key={r.nombre} style={{ ...S.card, overflow:"visible" }}>
                {/* Cabecera del rol */}
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px",
                  cursor:"pointer" }}
                  onClick={() => setExpandido(abierto ? null : r.nombre)}>
                  <div style={{ width:38, height:38, borderRadius:10, background:hex2rgba(r.color,0.12),
                    border:`1px solid ${hex2rgba(r.color,0.25)}`, display:"flex",
                    alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                    {r.emoji}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:14, fontWeight:700, color:"#0F172A" }}>{r.label}</span>
                      {r.es_sistema && (
                        <span title="Rol del sistema" style={{ fontSize:11, color:"#94A3B8" }}>🔒</span>
                      )}
                      {r.restringe_programa && (
                        <span style={{ ...S.badge("#FEF3C7","#92400E"), fontSize:11 }}>
                          Restricción de programa
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:12, color:"#64748B", marginTop:2 }}>
                      <code style={{ background:"#F1F5F9", padding:"1px 5px", borderRadius:4,
                        fontSize:11 }}>{r.nombre}</code>
                      &nbsp;·&nbsp;{permsCounts} permiso{permsCounts !== 1 ? "s" : ""} activo{permsCounts !== 1 ? "s" : ""}
                      &nbsp;·&nbsp;{r.usuarios_count} usuario{r.usuarios_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }} onClick={e => e.stopPropagation()}>
                    {permisosUsuario.puedeGestionarRoles && (
                      <>
                        <button onClick={() => setModalRol(r)} title="Editar"
                          style={{ background:"none", border:"1px solid #E2E8F0", borderRadius:7,
                            padding:"5px 10px", cursor:"pointer", fontSize:13, color:"#374151" }}>
                          <i className="ti ti-pencil" />
                        </button>
                        {!r.es_sistema && (
                          <button
                            onClick={() => setConfirm(r)} title="Eliminar"
                            style={{ background:"none", border:"1px solid #E2E8F0", borderRadius:7,
                              padding:"5px 10px", cursor:"pointer", fontSize:13, color:"#DC2626" }}>
                            <i className="ti ti-trash" />
                          </button>
                        )}
                      </>
                    )}
                    <i className={`ti ti-chevron-${abierto ? "up" : "down"}`}
                      style={{ color:"#94A3B8", fontSize:16 }} />
                  </div>
                </div>

                {/* Detalle expandible: permisos */}
                {abierto && (
                  <div style={{ borderTop:"1px solid #F1F5F9", padding:"16px" }}>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:12 }}>
                      {GRUPOS_PERMISOS.map(g => (
                        <div key={g.grupo}>
                          <div style={{ fontSize:11, fontWeight:700, color:"#94A3B8",
                            textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6,
                            display:"flex", alignItems:"center", gap:5 }}>
                            <i className={`ti ${g.icono}`} /> {g.grupo}
                          </div>
                          {g.items.map(item => {
                            const activo = r.permisos?.[item.key] === true;
                            return (
                              <div key={item.key} style={{ display:"flex", alignItems:"center",
                                gap:6, marginBottom:4 }}>
                                <i className={`ti ti-${activo ? "check" : "x"}`}
                                  style={{ fontSize:13, color: activo ? "#059669" : "#CBD5E1",
                                    flexShrink:0 }} />
                                <span style={{ fontSize:12, color: activo ? "#0F172A" : "#94A3B8" }}>
                                  {item.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal rol */}
      {modalRol !== undefined && (
        <ModalRol
          rol={modalRol || null}
          onSave={() => { setModalRol(undefined); cargar(); toast("✓ Rol guardado."); }}
          onClose={() => setModalRol(undefined)}
        />
      )}

      {/* Confirmar eliminación */}
      {confirm && (
        <ModalConfirm
          titulo="Eliminar rol"
          mensaje={`¿Eliminar el rol "${confirm.label}"? Esta acción no se puede deshacer. Solo es posible si ningún usuario lo tiene asignado.`}
          onConfirm={() => { eliminarRol(confirm.nombre); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toastMsg && (
        <div style={{ position:"fixed", bottom:24, left:"50%", transform:"translateX(-50%)",
          background:"#0F172A", color:"#fff", borderRadius:10, padding:"10px 20px",
          fontSize:13, fontWeight:500, zIndex:2000, boxShadow:"0 8px 24px rgba(0,0,0,0.3)",
          whiteSpace:"nowrap" }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function UsuariosView({ permisos, programas, logAudit, showToast }) {
  const programasDisponibles = programas?.length ? programas : DEFAULT_PROGRAMAS;
  const puedeUsuarios = permisos.puedeGestionarUsuarios;
  const puedeRoles    = permisos.puedeGestionarRoles;

  // Si solo tiene un permiso, fijar la pestaña en ese.
  const defaultTab = puedeUsuarios ? "usuarios" : "roles";
  const [tab, setTab] = useState(defaultTab);

  const [roles, setRoles] = useState([]);

  // Si el usuario solo tiene puedeGestionarUsuarios (sin puedeGestionarRoles),
  // igual necesita la lista de roles para el formulario de usuario. Los carga
  // con la misma RPC admin_get_roles (que también lo permite).
  const cargarRoles = useCallback(async () => {
    try {
      const { data } = await supabase.rpc("admin_get_roles");
      setRoles(data || []);
    } catch { /* sin permisos o red: silencioso */ }
  }, []);

  useEffect(() => { cargarRoles(); }, [cargarRoles]);

  if (!puedeUsuarios && !puedeRoles) {
    return (
      <div style={{ padding:40, textAlign:"center", color:"#94A3B8" }}>
        No tienes permiso para acceder a esta sección.
      </div>
    );
  }

  return (
    <div style={{ padding:"24px", maxWidth:900, margin:"0 auto", fontFamily:"system-ui,-apple-system,sans-serif" }}>
      {/* Encabezado */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ margin:0, fontSize:20, fontWeight:800, color:"#0F172A" }}>
          <i className="ti ti-crown" style={{ marginRight:8, color:"#7C3AED" }} />
          Gestión de Usuarios y Roles
        </h1>
        <p style={{ margin:"6px 0 0", fontSize:13, color:"#64748B" }}>
          Administra quién puede acceder al sistema y qué puede hacer.
        </p>
      </div>

      {/* Pestañas */}
      {(puedeUsuarios && puedeRoles) && (
        <div style={{ display:"flex", gap:2, marginBottom:20,
          background:"#F1F5F9", borderRadius:10, padding:3, width:"fit-content" }}>
          {[
            { id:"usuarios", icon:"ti-users",      label:"Usuarios" },
            { id:"roles",    icon:"ti-shield-lock", label:"Roles y Permisos" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:"7px 18px", borderRadius:8, border:"none",
                cursor:"pointer", fontSize:13, fontWeight:600, transition:"all 0.15s",
                background: tab === t.id ? "#fff" : "transparent",
                color: tab === t.id ? "#0F172A" : "#64748B",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                display:"flex", alignItems:"center", gap:6 }}>
              <i className={`ti ${t.icon}`} /> {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Contenido */}
      {tab === "usuarios" && puedeUsuarios && (
        <PestanaUsuarios
          permisos={permisos}
          roles={roles}
          programas={programasDisponibles}
          showToast={showToast}
          logAudit={logAudit}
        />
      )}
      {tab === "roles" && puedeRoles && (
        <PestanaRoles
          permisos={permisos}
          onRolesChanged={setRoles}
          showToast={showToast}
        />
      )}
    </div>
  );
}
