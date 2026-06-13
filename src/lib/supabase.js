import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigError = (!supabaseUrl || !supabaseAnonKey)
  ? 'Faltan las variables de entorno de Supabase (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Configúralas en tu proveedor de hosting (por ejemplo, Vercel) y vuelve a desplegar.'
  : null

if (supabaseConfigError) {
  // No lanzamos un error a nivel de módulo: eso provoca un "crash" silencioso
  // (pantalla blanca) antes de que React y el ErrorBoundary puedan montarse.
  // En su lugar, registramos el problema en consola y usamos valores de
  // marcador de posición. Las llamadas a supabase fallarán de forma controlada
  // y los componentes/ErrorBoundary pueden mostrar un mensaje amigable.
  console.error(`❌ ${supabaseConfigError}`)
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
)
