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

/* Réseau faible (métro, amphi) : une requête peut rester « suspendue » très longtemps sans
   réponse. On l'abandonne au bout de 12 secondes ; l'application la traite alors comme une
   coupure (mode hors connexion, voir lib/hors-ligne.ts) au lieu d'attendre indéfiniment. */
const DELAI_MAX_MS = 12_000;
function fetchAvecDelai(entree: RequestInfo | URL, options: RequestInit = {}): Promise<Response> {
  const controle = new AbortController();
  const minuteur = setTimeout(() => controle.abort(), DELAI_MAX_MS);
  // Si l'appelant annule lui-même sa requête, on transmet l'annulation.
  options.signal?.addEventListener("abort", () => controle.abort());
  return fetch(entree, { ...options, signal: controle.signal }).finally(() => clearTimeout(minuteur));
}

// Crée le client à la première utilisation, puis réutilise toujours le même.
export function supabase(): SupabaseClient {
  if (!url || !cle) {
    throw new Error("Variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY manquantes.");
  }
  // db.retry false : pas de nouvelles tentatives automatiques en cas de coupure (jusqu'à
  // 7 s d'attente en plus) : la file d'attente hors connexion s'en charge.
  client ??= createClient(url, cle, { global: { fetch: fetchAvecDelai }, db: { retry: false } });
  return client;
}
