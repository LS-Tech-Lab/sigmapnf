-- SEC-39 (1)/(2): hardening de seguridad señalado por el advisor nativo
-- de Supabase (get_advisors), 11 ago. Ninguno de los dos era explotable
-- hoy -- se cierra por el mismo principio ya establecido en SEC-34: no
-- depender de que la configuración "no tenga motivo" para ser un problema.
--
-- (1) 3 funciones SECURITY DEFINER sin `search_path` fijo. Sin esto, una
-- función SECURITY DEFINER resuelve nombres de tabla/función contra el
-- search_path de quien la LLAMA, no de quien la creó -- un atacante con
-- privilegios para crear objetos en algún schema del search_path del
-- llamador podría, en teoría, "secuestrar" una referencia sin calificar
-- dentro de la función (ej. crear una función homónima que shadowee la
-- real). Mismo patrón ya aplicado a ~24 funciones en SEC-33 (0073) y a
-- todas las nuevas desde entonces -- estas 3 quedaron fuera de esa pasada
-- por ser anteriores y de bajo perfil (nunca aparecieron en el barrido
-- manual de SEC-33, solo las destapó el advisor automático en SEC-39).
--
-- (2) extensión pg_trgm instalada en el schema `public` en vez de uno
-- dedicado. Confirmado (16 ago, grep exhaustivo de src/ + pg_proc real)
-- que ningún código del proyecto -- ni funciones SQL ni frontend -- usa
-- similarity()/word_similarity()/operadores %/<-> en la práctica; el
-- comentario original de SEC-39 que la asociaba a "auto-linking fuzzy" de
-- buscar_docente_scan() era impreciso -- esa función hace match exacto
-- de cédula, sin similarity(). Extensión sin uso real hoy, se reubica de
-- todos modos por higiene: `public` compartido es superficie más amplia
-- de la necesaria para una extensión que nadie llama.

-- (1) search_path fijo en las 3 funciones restantes
ALTER FUNCTION public.get_my_role() SET search_path = 'public';
ALTER FUNCTION public.get_my_programa() SET search_path = 'public';
ALTER FUNCTION public.limpiar_scan_rate_limit() SET search_path = 'public';

-- (2) pg_trgm fuera de public
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
