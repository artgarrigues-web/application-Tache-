/* Route serveur : GET /api/calendrier/<jeton>.ics
   C'est l'adresse à laquelle Google Agenda, Outlook, etc. s'abonnent.
   Ce code s'exécute sur le serveur Vercel, jamais dans le navigateur.

   Sécurité : l'appelant (Google, Outlook…) n'a pas de session utilisateur.
   On demande donc à la base la fonction taches_du_calendrier(jeton), qui ne
   renvoie QUE les tâches datées du propriétaire de ce jeton (voir
   supabase/schema.sql, section 6). Sans le bon jeton, on obtient 404.      */

import { createClient } from "@supabase/supabase-js";
import { genererICS, type TacheCalendrier } from "@/lib/ics";

// Jamais de version en cache côté Next.js : chaque lecture reflète la base.
export const dynamic = "force-dynamic";

const FORMAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_requete: Request, { params }: { params: Promise<{ fichier: string }> }) {
  const { fichier } = await params;
  const jeton = fichier.replace(/\.ics$/i, "");
  if (!FORMAT_UUID.test(jeton)) return new Response("Adresse de calendrier invalide.", { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle) return new Response("Serveur mal configuré.", { status: 500 });

  // Client neuf à chaque requête, sans session à mémoriser (on est sur le serveur).
  const client = createClient(url, cle, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("taches_du_calendrier", { p_jeton: jeton });
  if (error) return new Response("Erreur de lecture de l'agenda.", { status: 502 });

  const taches = (data ?? []) as TacheCalendrier[];
  // Jeton inconnu (ou révoqué) → 404, pour que le calendrier abonné arrête d'afficher l'agenda.
  if (taches.length === 0) {
    const { data: existe } = await client.rpc("calendrier_existe", { p_jeton: jeton });
    if (!existe) return new Response("Adresse de calendrier inconnue ou révoquée.", { status: 404 });
  }

  return new Response(genererICS(taches), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="agenda-taches.ics"',
      "Cache-Control": "no-store",
    },
  });
}
