/* Route serveur : POST /api/rappels/test
   Bouton « Envoyer une notification de test » : envoie une notification à TOUS les
   appareils de l'utilisateur connecté (jeton de connexion dans l'en-tête Authorization),
   pour vérifier que tout marche sans attendre l'heure d'une tâche.                   */

import { clientUtilisateur, envoyerNotification, type AbonnementPush } from "@/lib/serveur";

export const dynamic = "force-dynamic";

export async function POST(requete: Request) {
  const session = await clientUtilisateur(requete);
  if (!session) return Response.json({ erreur: "Connexion requise." }, { status: 401 });
  // RLS : la requête ne voit que les appareils de cet utilisateur.
  const { data, error } = await session.client.from("abonnements_push").select("endpoint, p256dh, auth");
  if (error) return Response.json({ erreur: error.message }, { status: 502 });
  const appareils = (data ?? []) as AbonnementPush[];
  if (appareils.length === 0) return Response.json({ erreur: "Aucun appareil n'a encore activé les rappels." }, { status: 404 });
  const resultats = await Promise.all(appareils.map((a) => envoyerNotification(a, {
    titre: "AgendIA : test réussi", corps: "Les rappels de tes tâches arriveront comme ceci.", url: "/", tag: "test",
  })));
  for (const [i, r] of resultats.entries()) {
    if (r === "expire") await session.client.from("abonnements_push").delete().eq("endpoint", appareils[i].endpoint);
  }
  const ok = resultats.filter((r) => r === "ok").length;
  if (ok === 0) return Response.json({ erreur: "L'envoi a échoué. Réessaie dans un instant." }, { status: 502 });
  return Response.json({ envoyes: ok, appareils: appareils.length });
}
