/* Traduction d'une règle de répétition AgendIA en règle iCalendar « RRULE » (RFC 5545),
   le langage commun de Google Agenda, Outlook et Apple Calendrier.
   Exemples : "FREQ=WEEKLY;WKST=MO;BYDAY=MO,TH"  (toutes les semaines lundi et jeudi)
              "FREQ=MONTHLY;BYDAY=-1FR"           (le dernier vendredi de chaque mois)

   L'objectif est que le calendrier synchronisé affiche EXACTEMENT les mêmes dates que
   l'application (voir lib/recurrence.ts) ; les tests le vérifient cas par cas.
   Fichier séparé de lib/ics.ts et sans dépendance (types seulement) : testable par Node. */

import type { Recurrence } from "./types";

const CODES_JOURS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]; // 0 = lundi, comme dans l'app

function infos(iso: string) {
  const [a, m, j] = iso.split("-").map(Number);
  const dim = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const js = (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
  return { a, m, j, rang: Math.ceil(j / 7), js, dernier: j + 7 > dim };
}

/* « Le 30 de chaque mois, ou le dernier jour s'il est plus court » n'existe pas tel quel :
   BYMONTHDAY=28,29,30 donne les jours 28, 29 et 30 qui existent dans le mois, et
   BYSETPOS=-1 garde le DERNIER d'entre eux → 30 en avril, 28 ou 29 en février. */
function jourDuMois(j: number): string {
  if (j <= 28) return `BYMONTHDAY=${j}`;
  const jours = [];
  for (let d = 28; d <= j; d++) jours.push(d);
  return `BYMONTHDAY=${jours.join(",")};BYSETPOS=-1`;
}

/* Instant UTC correspondant à 23:59:59 heure de Paris le jour donné (heure d'été ou d'hiver).
   Nécessaire car la norme impose un UNTIL en UTC quand l'événement a une heure et un fuseau. */
function finDeJourneeParisUTC(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  const supposition = Date.UTC(a, m - 1, j, 23, 59, 59);
  const parties = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(supposition)).map((p) => [p.type, p.value]));
  const vuAParis = Date.UTC(+parties.year, +parties.month - 1, +parties.day, +parties.hour, +parties.minute, +parties.second);
  const d = new Date(supposition - (vuAParis - supposition)); // on retire le décalage (+1 h ou +2 h)
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// heure : "HH:MM" si la tâche a une heure, null pour une tâche « toute la journée ».
export function regleRRULE(r: Recurrence, debut: string, heure: string | null): string {
  const i = infos(debut);
  const parties: string[] = [];
  if (r.frequence === "jour") parties.push("FREQ=DAILY");
  else if (r.frequence === "semaine") parties.push("FREQ=WEEKLY");
  else if (r.frequence === "mois") parties.push("FREQ=MONTHLY");
  else parties.push("FREQ=YEARLY");
  if (r.intervalle > 1) parties.push(`INTERVAL=${r.intervalle}`);

  if (r.frequence === "semaine") {
    // WKST=MO : les semaines commencent le lundi (compte pour « toutes les 2 semaines »).
    parties.push("WKST=MO", `BYDAY=${[...r.joursSemaine].sort().map((j) => CODES_JOURS[j]).join(",")}`);
  } else if (r.frequence === "mois") {
    if (r.modeMois === "rang") parties.push(`BYDAY=${i.rang}${CODES_JOURS[i.js]}`);
    else if (r.modeMois === "dernier") parties.push(`BYDAY=-1${CODES_JOURS[i.js]}`);
    else parties.push(jourDuMois(i.j));
  } else if (r.frequence === "annee") {
    parties.push(`BYMONTH=${i.m}`, i.m === 2 && i.j === 29 ? "BYMONTHDAY=28,29;BYSETPOS=-1" : `BYMONTHDAY=${i.j}`);
  }

  if (r.fin.type === "nombre") parties.push(`COUNT=${r.fin.nombre}`);
  else if (r.fin.type === "date") parties.push(`UNTIL=${heure ? finDeJourneeParisUTC(r.fin.date) : r.fin.date.replace(/-/g, "")}`);
  return parties.join(";");
}
