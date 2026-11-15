/* Connexion à Supabase.
   Les variables qui commencent par NEXT_PUBLIC_ sont recopiées dans le code
   envoyé au navigateur au moment du build : elles sont donc PUBLIQUES.
   C'est normal pour l'URL et la clé "publishable" (ex-"anon") de Supabase :
   la protection des données repose sur les règles RLS (supabase/schema.sql),
   pas sur le secret de cette clé. Ne mets JAMAIS la clé "secret"/"service_role"
   dans une variable NEXT_PUBLIC_.                                            */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const configurationOk = Boolean(url && cle);

let client: SupabaseClient | null = null;

// Crée le client à la première utilisation, puis réutilise toujours le même.
export function supabase(): SupabaseClient {
  if (!url || !cle) {
    throw new Error("Variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquantes.");
  }
  client ??= createClient(url, cle);
  return client;
}
