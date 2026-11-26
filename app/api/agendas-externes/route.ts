/* Route serveur : GET /api/agendas-externes?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ
   Lit les agendas Google / Outlook / Apple de l'utilisateur connecté (leurs adresses
   iCal secrètes sont dans la table agendas_externes) et renvoie leurs événements
   entre les deux dates, en heure de Paris.

   Pourquoi passer par le serveur ? Le navigateur n'a pas le droit de lire directement
   un fichier sur calendar.google.com (règle de sécurité « CORS ») ; le serveur, si.
   Le fichier lu n'est jamais conservé : seule une copie en mémoire de 5 minutes évite
   de le retélécharger à chaque changement de semaine.                                  */

import { clientUtilisateur } from "@/lib/serveur";
import { lireICS, normaliserAdresse, type EvenementExterne } from "@/lib/ics-lecture";
import { decalerDate } from "@/lib/fuseau";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAILLE_MAX = 5 * 1024 * 1024; // 5 Mo : largement assez pour des années d'agenda
const DELAI_MS = 9000;
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { texte: string; lu: number }>();

// Téléchargement prudent : https seulement, redirections revérifiées, taille et durée limitées.
async function telecharger(adresse: string): Promise<string> {
  const deja = cache.get(adresse);
  if (deja && Date.now() - deja.lu < CACHE_MS) return deja.texte;
  let url = adresse;
  for (let saut = 0; saut < 4; saut++) {
    const rep = await fetch(url, {
      redirect: "manual", signal: AbortSignal.timeout(DELAI_MS),
      headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.5", "User-Agent": "AgendIA (lecture d'agenda iCal)" },
    });
    if (rep.status >= 300 && rep.status < 400 && rep.headers.get("location")) {
      const suite = normaliserAdresse(new URL(rep.headers.get("location")!, url).toString());
      if ("erreur" in suite) throw new Error("Redirection refusée.");
      url = suite.url;
      continue;
    }
    if (rep.status === 401 || rep.status === 403 || rep.status === 404) throw new Error("Adresse refusée ou introuvable : vérifie qu'il s'agit bien de l'adresse secrète iCal.");
    if (!rep.ok) throw new Error(`L'agenda a répondu ${rep.status}.`);
    const longueur = Number(rep.headers.get("content-length") ?? 0);
    if (longueur > TAILLE_MAX) throw new Error("Agenda trop volumineux (plus de 5 Mo).");
    const texte = await rep.text();
    if (texte.length > TAILLE_MAX) throw new Error("Agenda trop volumineux (plus de 5 Mo).");
    if (!texte.includes("BEGIN:VCALENDAR")) throw new Error("Ce lien ne renvoie pas un agenda iCal (.ics).");
    cache.set(adresse, { texte, lu: Date.now() });
    return texte;
  }
  throw new Error("Trop de redirections.");
}

export async function GET(requete: Request) {
  const session = await clientUtilisateur(requete);
  if (!session) return Response.json({ erreur: "Connexion requise." }, { status: 401 });
  const p = new URL(requete.url).searchParams;
  const debut = p.get("debut") ?? "", fin = p.get("fin") ?? "";
  if (!DATE.test(debut) || !DATE.test(fin) || fin < debut || fin > decalerDate(debut, 150)) {
    return Response.json({ erreur: "Période invalide." }, { status: 400 });
  }

  const { data, error } = await session.client.from("agendas_externes").select("id, nom, url, couleur").order("cree_le");
  if (error) return Response.json({ erreur: error.message, agendas: [], evenements: [] }, { status: error.message.includes("agendas_externes") ? 200 : 502 });
  const agendas = (data ?? []) as { id: string; nom: string; url: string; couleur: string | null }[];

  const resultats = await Promise.all(agendas.map(async (a) => {
    const adresse = normaliserAdresse(a.url);
    if ("erreur" in adresse) return { id: a.id, ok: false, erreur: adresse.erreur, evenements: [] as EvenementExterne[] };
    try {
      const evenements = lireICS(await telecharger(adresse.url), a.id, debut, fin);
      return { id: a.id, ok: true, erreur: "", evenements };
    } catch (e) {
      const message = e instanceof Error && e.name !== "TimeoutError" ? e.message : "L'agenda n'a pas répondu à temps.";
      return { id: a.id, ok: false, erreur: message.startsWith("Invalid") || message.includes("parse") ? "Le fichier de cet agenda est illisible." : message, evenements: [] };
    }
  }));

  return Response.json({
    agendas: resultats.map((r) => ({ id: r.id, ok: r.ok, erreur: r.erreur, nombre: r.evenements.length })),
    evenements: resultats.flatMap((r) => r.evenements),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
