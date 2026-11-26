/* Outils réservés au SERVEUR (routes app/api/…) : jamais importés par une page.

   - clientAnonyme()        : client Supabase sans session (comme un visiteur) ;
   - clientUtilisateur(req) : client Supabase qui agit AU NOM de l'utilisateur dont la
                              requête porte le jeton de connexion (« Authorization: Bearer … ») :
                              les règles RLS s'appliquent donc comme dans le navigateur ;
   - envoyerNotification()  : envoi d'une notification « web push » chiffrée.            */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { VAPID_CLE_PUBLIQUE } from "./notifications-cle";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle) throw new Error("Variables Supabase manquantes sur le serveur.");
  return { url, cle };
}

export function clientAnonyme(): SupabaseClient {
  const { url, cle } = config();
  return createClient(url, cle, options);
}

export async function clientUtilisateur(requete: Request): Promise<{ client: SupabaseClient; userId: string } | null> {
  const jeton = requete.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jeton) return null;
  const { url, cle } = config();
  const client = createClient(url, cle, { ...options, global: { headers: { Authorization: `Bearer ${jeton}` } } });
  const { data, error } = await client.auth.getUser(jeton); // vérifie la signature du jeton auprès de Supabase
  if (error || !data.user) return null;
  return { client, userId: data.user.id };
}

export interface AbonnementPush { endpoint: string; p256dh: string; auth: string }
export interface ContenuNotification { titre: string; corps: string; url: string; tag: string; badge?: number }

let vapidPret = false;
function preparerVapid(): boolean {
  if (vapidPret) return true;
  const privee = process.env.VAPID_CLE_PRIVEE;
  if (!privee) return false;
  // Le « sujet » permet au service de notifications (Google, Apple, Mozilla) de joindre
  // l'éditeur de l'appli en cas d'abus : l'adresse du site suffit.
  webpush.setVapidDetails("https://agendia-taches.vercel.app", process.env.VAPID_CLE_PUBLIQUE || VAPID_CLE_PUBLIQUE, privee);
  vapidPret = true;
  return true;
}

/* Renvoie "ok", "expire" (l'appareil a retiré l'autorisation : à oublier) ou "erreur". */
export async function envoyerNotification(a: AbonnementPush, contenu: ContenuNotification): Promise<"ok" | "expire" | "erreur"> {
  if (!preparerVapid()) return "erreur";
  try {
    await webpush.sendNotification(
      { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
      JSON.stringify(contenu),
      { TTL: 60 * 60, urgency: "high", topic: contenu.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) },
    );
    return "ok";
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    return code === 404 || code === 410 ? "expire" : "erreur";
  }
}
