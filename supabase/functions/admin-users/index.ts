// supabase/functions/admin-users/index.ts
//
// Edge Function para operaciones de administración de usuarios que
// requieren la Service Role Key de Supabase. La app (cliente) solo tiene
// la anon key, así que NO puede llamar a `supabase.auth.admin.*`
// directamente — esas llamadas requieren service_role.
//
// La service_role key NUNCA se expone al navegador: solo vive en el
// entorno de ejecución de esta función. En el hosting de Supabase,
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY se
// inyectan automáticamente, no hace falta configurarlas a mano.
//
// Acciones soportadas (POST, body JSON):
//   { action: "create",         email, password, nombre, rol, programa? }
//   { action: "reset_password", user_id, password }
//
// Seguridad: solo se ejecuta si quien llama está autenticado y su perfil
// en `user_profiles` tiene rol "admin" y está activo. Esa verificación se
// hace con el cliente service_role (no depende de RLS).
//
// Nota de diseño: esta función SIEMPRE responde con HTTP 200, incluso
// ante errores de validación o permisos. El detalle del error va en el
// campo `error` del JSON. Esto evita la ambigüedad de supabase-js al
// leer el cuerpo de respuestas con status distinto de 2xx en
// `functions.invoke()`. El cliente debe revisar `data.error`.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function ok(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string) {
  return ok({ error: message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("Método no permitido.");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("Falta el encabezado Authorization.");

  // Cliente con la sesión del que llama, solo para validar quién es.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) return fail("Token inválido o expirado. Vuelve a iniciar sesión.");

  // Cliente con service_role: bypassa RLS. Se usa para verificar el rol
  // del solicitante (sin depender de políticas RLS) y para las
  // operaciones privilegiadas de Auth Admin.
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile, error: profileError } = await adminClient
    .from("user_profiles")
    .select("rol, activo")
    .eq("id", caller.id)
    .single();

  if (profileError || !callerProfile || callerProfile.rol !== "admin" || !callerProfile.activo) {
    return fail("No tienes permiso para gestionar usuarios.");
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Cuerpo de la petición inválido (se esperaba JSON).");
  }

  const action = body.action;

  try {
    // ── Crear usuario ────────────────────────────────────────────────
    if (action === "create") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      const nombre = String(body.nombre || "").trim();
      const rol = String(body.rol || "");
      const programa = body.programa ? String(body.programa) : null;

      if (!email || !password || !nombre || !rol) {
        return fail("Faltan campos requeridos (email, password, nombre, rol).");
      }
      if (password.length < 8) {
        return fail("La contraseña debe tener al menos 8 caracteres.");
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError) return fail(createError.message);

      const userId = created.user?.id;
      if (!userId) return fail("No se obtuvo el ID del usuario creado.");

      const { error: rpcError } = await adminClient.rpc("admin_upsert_user_profile", {
        p_user_id: userId,
        p_email: email,
        p_nombre: nombre,
        p_rol: rol,
        p_programa: programa,
      });

      if (rpcError) {
        // No dejar un usuario huérfano en Auth si el perfil no se pudo crear.
        await adminClient.auth.admin.deleteUser(userId);
        return fail(rpcError.message);
      }

      return ok({ user_id: userId });
    }

    // ── Resetear contraseña de otro usuario ─────────────────────────
    if (action === "reset_password") {
      const userId = String(body.user_id || "");
      const password = String(body.password || "");

      if (!userId || !password) {
        return fail("Faltan campos requeridos (user_id, password).");
      }
      if (password.length < 8) {
        return fail("La contraseña debe tener al menos 8 caracteres.");
      }

      const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, { password });
      if (pwError) return fail(pwError.message);

      return ok({ ok: true });
    }

    return fail(`Acción desconocida: "${action}".`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Error inesperado en el servidor.");
  }
});
