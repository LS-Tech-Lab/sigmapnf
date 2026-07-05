// api/admin-users.js
// Vercel Serverless Function — reemplaza la Edge Function de Supabase
// para crear usuarios y resetear contraseñas usando la Service Role Key.

import { validarPassword } from "../src/utils/password.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  try {
    return await handleRequest(req, res);
  } catch (err) {
    console.error("[api/admin-users] Error no capturado:", err);
    return res.status(500).json({ error: "Error interno del servidor." });
  }
}

async function handleRequest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido." });
  }

  // ── Verificar que el caller tiene sesión válida ──────────────────
  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) {
    return res.status(401).json({ error: "No autenticado." });
  }

  // Obtener el usuario actual con su token
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${userToken}`,
      apikey: SERVICE_ROLE_KEY,
    },
  });
  const userData = await userRes.json();
  if (!userRes.ok || !userData.id) {
    return res.status(401).json({ error: "Sesión inválida." });
  }

  // Verificar permiso via RPC (usa service_role para bypassear RLS)
  const permRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/admin_caller_puede_gestionar_usuarios`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ p_user_id: userData.id }),
    }
  );
  const puedeGestionar = await permRes.json();
  if (!puedeGestionar) {
    return res.status(403).json({ error: "No tienes permiso para gestionar usuarios." });
  }

  // ── SEC-11: rate limiting por cuenta ─────────────────────────────
  // Máx. 10 acciones por minuto por cuenta que llama a este endpoint
  // (create/reset_password/delete/delete_orphan comparten el mismo
  // límite: es por endpoint, no por acción). Mismo patrón que
  // scan_rate_limit (D-3) — ver migración 0051.
  const rateLimitRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/registrar_admin_action_rate_limit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ p_actor_id: userData.id }),
    }
  );
  const rateLimitData = await rateLimitRes.json();
  if (!rateLimitRes.ok) {
    // Fail-closed: si la RPC de rate limiting falla (ej. migración no
    // aplicada aún), no se debe abrir la puerta a acciones ilimitadas.
    return res.status(500).json({ error: "No se pudo verificar el límite de solicitudes." });
  }
  if (!rateLimitData.permitido) {
    return res.status(429).json({
      error: `Demasiadas acciones administrativas en poco tiempo. Intenta de nuevo en ${rateLimitData.reintentar_en_seg}s.`,
    });
  }

  // ── SEC-10: jerarquía fija del rol admin ─────────────────────────
  // Regla fija (no depende de la tabla dinámica `roles`, igual que
  // en las RPCs SQL — ver migración 0050): solo una cuenta con rol
  // 'admin' puede asignar el rol 'admin' o tocar (resetear contraseña,
  // eliminar) una cuenta que ya lo tiene. Este endpoint reimplementa
  // create/reset_password/delete directamente contra Auth Admin API +
  // REST con la Service Role Key, sin pasar por las RPCs SQL — por
  // eso necesita su propio guard, no basta con corregir la BD.
  let callerEsAdmin = false;
  {
    const callerProfileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userData.id}&select=rol`,
      {
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      }
    );
    const callerProfileArr = await callerProfileRes.json();
    callerEsAdmin = callerProfileArr?.[0]?.rol === "admin";
  }

  const body = req.body;
  const { action } = body;

  // ── action: create ───────────────────────────────────────────────
  if (action === "create") {
    const { email, password, nombre, rol, programa } = body;

    if (!email || !password || !nombre || !rol) {
      return res.status(400).json({ error: "Faltan campos obligatorios." });
    }
    if (rol === "admin" && !callerEsAdmin) {
      return res.status(403).json({ error: "Solo una cuenta con rol admin puede asignar el rol admin." });
    }
    const errorPwd = validarPassword(password);
    if (errorPwd) {
      return res.status(400).json({ error: errorPwd });
    }

    // Crear usuario en Supabase Auth con service_role
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre },
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) {
      return res.status(400).json({ error: created.msg || created.message || "Error al crear usuario en Auth." });
    }

    const userId = created.id;

    // Crear perfil en user_profiles
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id:        userId,
        email,
        nombre,
        rol,
        programa:  programa || null,
        activo:    true,
        creado_por: userData.email,
      }),
    });

    if (!profileRes.ok) {
      const profileErr = await profileRes.json();
      // Revertir: borrar el usuario de Auth si el perfil falló
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      });
      return res.status(400).json({ error: profileErr.message || "Error al crear el perfil del usuario." });
    }

    return res.status(200).json({ user_id: userId });
  }

  // ── action: reset_password ───────────────────────────────────────
  if (action === "reset_password") {
    const { user_id, password } = body;

    if (!user_id || !password) {
      return res.status(400).json({ error: "Faltan campos obligatorios." });
    }
    if (!callerEsAdmin) {
      const targetProfileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user_id}&select=rol`,
        {
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
        }
      );
      const targetProfileArr = await targetProfileRes.json();
      if (targetProfileArr?.[0]?.rol === "admin") {
        return res.status(403).json({ error: "Solo una cuenta con rol admin puede resetear la contraseña de otra cuenta admin." });
      }
    }
    const errorPwdReset = validarPassword(password);
    if (errorPwdReset) {
      return res.status(400).json({ error: errorPwdReset });
    }

    const resetRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ password }),
    });
    const resetData = await resetRes.json();
    if (!resetRes.ok) {
      return res.status(400).json({ error: resetData.msg || resetData.message || "Error al cambiar la contraseña." });
    }

    return res.status(200).json({ ok: true });
  }

  // ── action: delete ──────────────────────────────────────────────
  if (action === "delete") {
    const { user_id } = body;

    if (!user_id) {
      return res.status(400).json({ error: "Falta el campo user_id." });
    }

    // Evitar auto-eliminación
    if (user_id === userData.id) {
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
    }

    if (!callerEsAdmin) {
      const targetProfileRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user_id}&select=rol`,
        {
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
        }
      );
      const targetProfileArr = await targetProfileRes.json();
      if (targetProfileArr?.[0]?.rol === "admin") {
        return res.status(403).json({ error: "Solo una cuenta con rol admin puede eliminar otra cuenta admin." });
      }
    }

    // Borrar perfil primero
    const delProfileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user_id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      }
    );

    // Borrar de auth.users
    const delAuthRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${user_id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      }
    );

    if (!delAuthRes.ok && delAuthRes.status !== 404) {
      const delAuthErr = await delAuthRes.json().catch(() => ({}));
      return res.status(400).json({
        error: delAuthErr.msg || delAuthErr.message || "Error al eliminar el usuario de Auth.",
      });
    }

    return res.status(200).json({ ok: true });
  }

  // ── action: delete_orphan ────────────────────────────────────────
  // Elimina un usuario que solo existe en auth.users (sin perfil en user_profiles).
  if (action === "delete_orphan") {
    const { user_id } = body;

    if (!user_id) {
      return res.status(400).json({ error: "Falta el campo user_id." });
    }

    if (user_id === userData.id) {
      return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
    }

    const delAuthRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${user_id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
        },
      }
    );

    if (!delAuthRes.ok && delAuthRes.status !== 404) {
      const delAuthErr = await delAuthRes.json().catch(() => ({}));
      return res.status(400).json({
        error: delAuthErr.msg || delAuthErr.message || "Error al eliminar el usuario.",
      });
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: `Acción desconocida: "${action}".` });
}
