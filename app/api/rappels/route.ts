/* Route serveur : POST /api/rappels
   Appelée CHAQUE MINUTE par Supabase (tâche planifiée pg_cron « agendia-rappels »),
   avec le secret partagé dans l'en-tête Authorization. Elle :
     1. lit les tâches à rappeler et les appareils abonnés (fonction rappels_donnees) ;
     2. calcule les rappels dus maintenant (lib/rappels.ts) ;
     3. les note comme envoyés (rappels_marquer : ainsi un rappel ne part jamais 2 fois) ;
     4. envoie les notifications ; un appareil qui a retiré l'autorisation est oublié.

   Pourquoi pas une tâche planifiée Vercel ? La formule gratuite (Hobby) n'en lance
   qu'une par jour. Supabase Cron, lui, peut tourner chaque minute gratuitement.     */

import { clientAnonyme, envoyerNotification, type AbonnementPush } from "@/lib/serveur";
import { compter, rappelsDus, resumesDus, type ReglageResume, type TacheRappel } from "@/lib/rappels";
import { heureMurale } from "@/lib/fuseau";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface Donnees {
  abonnements: (AbonnementPush & { user_id: string })[];
  reglages: ReglageResume[];
  taches: TacheRappel[];
}

export async function POST(requete: Request) {
  const secret = process.env.RAPPELS_SECRET;
  if (!secret || requete.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ erreur: "Accès refusé." }, { status: 401 });
  }
  const client = clientAnonyme();
  const { data, error } = await client.rpc("rappels_donnees", { p_secret: secret });
  if (error) return Response.json({ erreur: error.message }, { status: 502 });
  const d = data as Donnees;
  if (d.abonnements.length === 0) return Response.json({ envoyes: 0 });

  const maintenant = Date.now();
  const dus = [...rappelsDus(d.taches, maintenant), ...resumesDus(d.reglages, d.taches, maintenant)];
  if (dus.length === 0) return Response.json({ envoyes: 0 });

  const { data: nouvelles, error: e2 } = await client.rpc("rappels_marquer",
    { p_secret: secret, p_cles: dus.map((n) => n.cle), p_users: dus.map((n) => n.userId) });
  if (e2) return Response.json({ erreur: e2.message }, { status: 502 });
  const aEnvoyer = new Set((nouvelles as string[] | null) ?? []);

  // Pastille sur l'icône : nombre de tâches encore à faire aujourd'hui, par compte.
  const auj = heureMurale(maintenant).date;
  const pastille = (userId: string) => compter(d.taches.filter((t) => t.user_id === userId), auj).duJour;

  let envoyes = 0;
  const oublies = new Set<string>();
  await Promise.all(dus.filter((n) => aEnvoyer.has(n.cle)).flatMap((n) =>
    d.abonnements.filter((a) => a.user_id === n.userId).map(async (a) => {
      const r = await envoyerNotification(a, { titre: n.titre, corps: n.corps, url: n.url, tag: n.tag, badge: pastille(n.userId) });
      if (r === "ok") envoyes++;
      if (r === "expire") oublies.add(a.endpoint);
    })));
  await Promise.all([...oublies].map((endpoint) => client.rpc("rappels_oublier", { p_secret: secret, p_endpoint: endpoint })));
  return Response.json({ envoyes, appareilsOublies: oublies.size });
}
