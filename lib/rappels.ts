/* Rappels : QUELLES notifications envoyer à un instant donné ?

   Ce calcul tourne sur le serveur (route /api/rappels), appelé chaque minute par
   Supabase (pg_cron). Il est « pur » : on lui donne les tâches et l'heure, il rend
   la liste des notifications à envoyer. Il est donc testable sans réseau
   (tests/rappels.test.ts).

   Règles :
   - une tâche a un rappel si rappel_minutes n'est pas null (0 = à l'heure pile) ;
   - moment du rappel = date + heure de la tâche (heure de Paris) − rappel_minutes ;
     une tâche SANS heure est rappelée par rapport à 9 h (HEURE_SANS_HEURE) ;
   - une notification part si son moment est tombé pendant les FENETRE_MINUTES
     dernières minutes : si une vérification saute (serveur lent), la suivante
     rattrape le rappel au lieu de le perdre ;
   - chaque rappel a une clé unique (tâche + date + heure + délai), notée en base
     après envoi : il ne part jamais deux fois. Si tu changes l'heure de la tâche,
     la clé change et le rappel repart pour la nouvelle heure.                   */

import { decalerDate, heureMurale, instantMural } from "./fuseau";
import { occurrencesEntre, validerRecurrence } from "./recurrence";

export const HEURE_SANS_HEURE = "09:00";
export const FENETRE_MINUTES = 15;

// Choix proposés dans le formulaire (minutes avant l'heure de la tâche).
export const CHOIX_RAPPEL: { minutes: number; libelle: string; court: string }[] = [
  { minutes: 0, libelle: "À l'heure de la tâche", court: "À l'heure" },
  { minutes: 5, libelle: "5 minutes avant", court: "5 min avant" },
  { minutes: 10, libelle: "10 minutes avant", court: "10 min avant" },
  { minutes: 15, libelle: "15 minutes avant", court: "15 min avant" },
  { minutes: 30, libelle: "30 minutes avant", court: "30 min avant" },
  { minutes: 60, libelle: "1 heure avant", court: "1 h avant" },
  { minutes: 120, libelle: "2 heures avant", court: "2 h avant" },
  { minutes: 1440, libelle: "La veille, à la même heure", court: "La veille" },
];

export function libelleRappel(minutes: number | null, court = false): string {
  if (minutes === null) return "Aucun rappel";
  const choix = CHOIX_RAPPEL.find((c) => c.minutes === minutes);
  if (choix) return court ? choix.court : choix.libelle;
  return minutes % 60 === 0 ? `${minutes / 60} h avant` : `${minutes} min avant`;
}

export interface TacheRappel {
  id: string;
  user_id: string;
  titre: string;
  date: string;           // "AAAA-MM-JJ"
  heure: string | null;   // "HH:MM:SS" (format de la base) ou null
  lieu: string | null;
  rappel_minutes: number | null;
  recurrence: unknown;
}

export interface Notification {
  cle: string;
  userId: string;
  titre: string;
  corps: string;
  url: string;
  tag: string;
}

/* Les dates à rappeler d'une tâche, entre deux bornes. Pour une série, on part des
   occurrences calculées et on retire celles déjà cochées (liste « faites »). */
function datesDe(t: TacheRappel, de: string, a: string): string[] {
  const r = validerRecurrence(t.recurrence);
  if (!r) return t.date >= de && t.date <= a ? [t.date] : [];
  return occurrencesEntre(t.date, r, de, a).filter((d) => !r.faites.includes(d));
}

function phraseQuand(minutes: number, heure: string, aHeure: boolean): string {
  if (!aHeure) return minutes === 0 ? "À faire aujourd'hui" : minutes >= 1440 ? "À faire demain" : "À faire aujourd'hui";
  if (minutes === 0) return `C'est l'heure : ${heure.replace(":", " h ")}`;
  if (minutes >= 1440) return `Demain à ${heure.replace(":", " h ")}`;
  return `Dans ${libelleRappel(minutes, true).replace(" avant", "")}, à ${heure.replace(":", " h ")}`;
}

export function rappelsDus(taches: TacheRappel[], maintenant: number, fenetre = FENETRE_MINUTES): Notification[] {
  const auj = heureMurale(maintenant).date;
  // Un rappel « la veille » d'une tâche de dans 7 jours n'est jamais dû aujourd'hui : on
  // regarde de hier à dans 8 jours, ce qui couvre tous les délais proposés (≤ 7 jours).
  const de = decalerDate(auj, -1), a = decalerDate(auj, 8);
  const res: Notification[] = [];
  for (const t of taches) {
    if (t.rappel_minutes === null || t.rappel_minutes === undefined) continue;
    const heure = t.heure ? t.heure.slice(0, 5) : "";
    for (const date of datesDe(t, de, a)) {
      const moment = instantMural(date, heure || HEURE_SANS_HEURE) - t.rappel_minutes * 60000;
      if (moment > maintenant || moment <= maintenant - fenetre * 60000) continue;
      res.push({
        cle: `r|${t.id}|${date}|${heure}|${t.rappel_minutes}`,
        userId: t.user_id,
        titre: t.titre,
        corps: phraseQuand(t.rappel_minutes, heure, Boolean(heure)) + (t.lieu ? ` · ${t.lieu}` : ""),
        url: `/?jour=${date}`,
        tag: `tache-${t.id}-${date}`,
      });
    }
  }
  return res;
}

/* Résumé du matin (« Ma journée ») : à l'heure choisie par l'utilisateur, une
   notification qui compte les tâches du jour et celles en retard, et ouvre
   le parcours « Ma journée » quand on la touche.                              */
export interface ReglageResume { user_id: string; resume_matin: string | null }

export function resumesDus(reglages: ReglageResume[], taches: TacheRappel[], maintenant: number, fenetre = FENETRE_MINUTES): Notification[] {
  const { date: auj, minutes } = heureMurale(maintenant);
  const res: Notification[] = [];
  for (const r of reglages) {
    if (!r.resume_matin) continue;
    const [h, m] = r.resume_matin.split(":").map(Number);
    const debut = h * 60 + m;
    if (minutes < debut || minutes >= debut + fenetre) continue;
    const { duJour, enRetard } = compter(taches.filter((t) => t.user_id === r.user_id), auj);
    const morceaux = [
      duJour === 0 ? "Rien de prévu aujourd'hui" : `${duJour} tâche${duJour > 1 ? "s" : ""} aujourd'hui`,
      enRetard > 0 ? `${enRetard} en retard` : "",
    ].filter(Boolean);
    res.push({
      cle: `m|${r.user_id}|${auj}`,
      userId: r.user_id,
      titre: "Ma journée",
      corps: `${morceaux.join(" · ")}. Touche pour la préparer en 1 minute.`,
      url: "/?ma-journee=1",
      tag: `resume-${auj}`,
    });
  }
  return res;
}

/* Tâches encore à faire aujourd'hui, et en retard (7 jours au plus pour une série,
   comme dans l'application). La base ne renvoie déjà que les tâches non cochées. */
export function compter(taches: TacheRappel[], auj: string): { duJour: number; enRetard: number } {
  let duJour = 0, enRetard = 0;
  for (const t of taches) {
    const r = validerRecurrence(t.recurrence);
    if (!r) {
      if (t.date === auj) duJour++;
      else if (t.date < auj) enRetard++;
      continue;
    }
    for (const d of datesDe(t, decalerDate(auj, -7), auj)) {
      if (d === auj) duJour++; else enRetard++;
    }
  }
  return { duJour, enRetard };
}
