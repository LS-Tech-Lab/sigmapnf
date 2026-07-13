// api/admin-users.js
// Vercel Serverless Function — reemplaza la Edge Function de Supabase
// para crear usuarios y resetear contraseñas usando la Service Role Key.

import { validarPassword } from "../src/utils/password.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── ARCH-11: helper central para llamadas a Supabase con service_role ─
// Antes, cada una de las 13 llamadas a Supabase repetía a mano el
// armado de headers (Authorization + apikey + Content-Type condicional)
// y el `${SUPABASE_URL}${path}`. Este helper centraliza ese bloque para
// que un cambio futuro (timeout, header nuevo, logging de errores) se
// haga en un solo lugar. No cambia ninguna lógica de permisos ni de
// negocio: cada call site sigue parseando la respuesta y decidiendo qué
// hacer con `.ok` / status exactamente igual que antes.
//
// `options.headers` se aplica DESPUÉS de los headers por defecto, así
// que puede sobreescribirlos — lo usa la verificación de sesión inicial,
// que necesita `Authorization: Bearer <token del usuario>` en vez del
// service role.
async function supabaseAdminFetch(path, options = {}) {
  const { method = "GET", headers = {}, body } = options;
  const hasBody = body !== undefined;

  return fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

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

  // ── SEC-13: allowlist explícito de origen (defensa en profundidad) ──
  // Este endpoint solo debe llamarse desde el propio frontend de
  // sigmapnf (mismo origen que sirve la SPA en Vercel). Hoy no era
  // explotable porque Vercel sirve frontend y función del mismo origen
  // y el navegador ya bloquea la lectura de la respuesta cross-origin
  // sin cabeceras CORS explícitas — pero nada rechazaba la petición en
  // sí del lado del servidor si viniera de otro origen. Se compara el
  // *host* de `Origin` contra `req.headers.host` (el dominio real que
  // Vercel resolvió para esta request), ignorando el protocolo a
  // propósito — en desarrollo local (`vercel dev`) el frontend puede
  // servirse por `http://` mientras producción usa `https://`, y no es
  // el protocolo lo que hay que validar sino la identidad del origen.
  // Así funciona igual en producción, previews de Vercel y desarrollo
  // local sin configuración adicional. Los navegadores modernos siempre
  // envían `Origin` en peticiones POST (spec fetch), así que un origen
  // ausente no es indicio de ataque — solo se rechaza cuando el origen
  // SÍ vino y no coincide, para no romper clientes legítimos sin ese
  // header.
  const origin = req.headers.origin;
  if (origin && origin.replace(/^https?:\/\//, "") !== req.headers.host) {
    return res.status(403).json({ error: "Origen no autorizado." });
  }

  // ── Verificar que el caller tiene sesión válida ──────────────────
  const authHeader = req.headers.authorization || "";
  const userToken = authHeader.replace("Bearer ", "");
  if (!userToken) {
    return res.status(401).json({ error: "No autenticado." });
  }

  // Obtener el usuario actual con su token
  const userRes = await supabaseAdminFetch("/auth/v1/user", {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const userData = await userRes.json();
  if (!userRes.ok || !userData.id) {
    return res.status(401).json({ error: "Sesión inválida." });
  }

  // Verificar permiso via RPC (usa service_role para bypassear RLS)
  const permRes = await supabaseAdminFetch(
    "/rest/v1/rpc/admin_caller_puede_gestionar_usuarios",
    { method: "POST", body: { p_user_id: userData.id } }
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
  const rateLimitRes = await supabaseAdminFetch(
    "/rest/v1/rpc/registrar_admin_action_rate_limit",
    { method: "POST", body: { p_actor_id: userData.id } }
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
  // Nota (ARCH-16): sin valor inicial — el bloque de abajo siempre lo
  // asigna antes de la primera lectura; si `supabaseAdminFetch`/`.json()`
  // lanzara, el `try/catch` de `handler()` ya corta la respuesta con 500
  // antes de llegar a ningún chequeo de `callerEsAdmin`, así que un valor
  // inicial nunca cambia el comportamiento en ningún camino real.
  let callerEsAdmin;
  {
    const callerProfileRes = await supabaseAdminFetch(
      `/rest/v1/user_profiles?id=eq.${userData.id}&select=rol`
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
    const createRes = await supabaseAdminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { nombre },
      },
    });
    const created = await createRes.json();
    if (!createRes.ok) {
      return res.status(400).json({ error: created.msg || created.message || "Error al crear usuario en Auth." });
    }

    const userId = created.id;

    // Crear perfil en user_profiles
    const profileRes = await supabaseAdminFetch("/rest/v1/user_profiles", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        id:        userId,
        email,
        nombre,
        rol,
        programa:  programa || null,
        activo:    true,
        creado_por: userData.email,
      },
    });

    if (!profileRes.ok) {
      const profileErr = await profileRes.json();
      // Revertir: borrar el usuario de Auth si el perfil falló
      await supabaseAdminFetch(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
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
      const targetProfileRes = await supabaseAdminFetch(
        `/rest/v1/user_profiles?id=eq.${user_id}&select=rol`
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

    const resetRes = await supabaseAdminFetch(`/auth/v1/admin/users/${user_id}`, {
      method: "PUT",
      body: { password },
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
      const targetProfileRes = await supabaseAdminFetch(
        `/rest/v1/user_profiles?id=eq.${user_id}&select=rol`
      );
      const targetProfileArr = await targetProfileRes.json();
      if (targetProfileArr?.[0]?.rol === "admin") {
        return res.status(403).json({ error: "Solo una cuenta con rol admin puede eliminar otra cuenta admin." });
      }
    }

    // Borrar perfil primero
    await supabaseAdminFetch(`/rest/v1/user_profiles?id=eq.${user_id}`, {
      method: "DELETE",
    });

    // Borrar de auth.users
    const delAuthRes = await supabaseAdminFetch(`/auth/v1/admin/users/${user_id}`, {
      method: "DELETE",
    });

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

    const delAuthRes = await supabaseAdminFetch(`/auth/v1/admin/users/${user_id}`, {
      method: "DELETE",
    });

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
