/* Génération d'un fichier iCalendar (.ics, norme RFC 5545).
   C'est le format texte universel des agendas : Google Agenda, Outlook,
   Apple Calendrier, Thunderbird… savent tous "s'abonner" à une adresse
   qui renvoie ce format, et la relisent régulièrement d'eux-mêmes.

   Un fichier .ics ressemble à ceci (une propriété par ligne, fins de ligne CRLF) :
     BEGIN:VCALENDAR
     BEGIN:VEVENT
     UID:…            identifiant stable : permet au calendrier de METTRE À JOUR l'événement
     DTSTART;TZID=Europe/Paris:20261121T140000
     DTEND;TZID=Europe/Paris:20261121T150000
     SUMMARY:Titre
     END:VEVENT
     END:VCALENDAR                                                           */

import { CATEGORIES, PRIORITES, type Categorie, type Priorite } from "./types";
import { NOM_APP } from "./marque";
import { decrireRecurrence, validerRecurrence } from "./recurrence";
import { regleRRULE } from "./ics-recurrence";

// L'app enregistre des heures "locales" sans fuseau : on les interprète en heure de Paris.
export const FUSEAU = "Europe/Paris";
// Durée donnée à une tâche avec heure mais sans durée estimée.
const DUREE_PAR_DEFAUT = 60;

export interface TacheCalendrier {
  id: string;
  titre: string;
  description: string | null;
  date: string;            // "AAAA-MM-JJ" (les tâches sans date sont exclues en amont)
  heure: string | null;    // "HH:MM:SS" ou null
  duree_minutes: number | null;
  lieu: string | null;
  materiel: string | null;
  categorie: Categorie;
  priorite: Priorite;
  faite: boolean;
  cree_le: string;
  recurrence?: unknown;    // règle de répétition (jsonb), absente avant la migration du 24/11
}

// Les occurrences cochées plus anciennes que ça ne sont pas réécrites (fichier plus léger).
const JOURS_HISTORIQUE = 90;

/* Définition du fuseau de Paris (heure d'hiver CET / heure d'été CEST).
   La norme exige qu'un TZID utilisé soit décrit dans le fichier. */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

// Les caractères \ ; , et les retours à la ligne ont un sens spécial dans un .ics : on les "échappe".
export function echapper(texte: string): string {
  return texte.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/* Une ligne ne doit pas dépasser 75 OCTETS (pas caractères : "é" en fait 2 en UTF-8).
   Au-delà, on la "plie" : CRLF + un espace, que le lecteur retire en relisant. */
export function plier(ligne: string): string {
  const encodeur = new TextEncoder();
  const morceaux: string[] = [];
  let courant = "";
  let octets = 0;
  for (const car of ligne) {               // for…of parcourt les caractères Unicode complets
    const n = encodeur.encode(car).length;
    const limite = morceaux.length === 0 ? 75 : 74; // l'espace de début compte pour 1 octet
    if (octets + n > limite) {
      morceaux.push(courant);
      courant = "";
      octets = 0;
    }
    courant += car;
    octets += n;
  }
  morceaux.push(courant);
  return morceaux.join("\r\n ");
}

const deuxChiffres = (n: number) => String(n).padStart(2, "0");

// "2026-11-21" → "20261121"
function dateCompacte(iso: string): string {
  return iso.replace(/-/g, "");
}

// Ajoute des minutes à une date+heure "murale" (sans fuseau) ; calcul en UTC pour éviter tout décalage.
function ajouterMinutes(dateIso: string, heure: string, minutes: number): string {
  const [a, m, j] = dateIso.split("-").map(Number);
  const [h, mi] = heure.split(":").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j, h, mi + minutes));
  return `${d.getUTCFullYear()}${deuxChiffres(d.getUTCMonth() + 1)}${deuxChiffres(d.getUTCDate())}T${deuxChiffres(d.getUTCHours())}${deuxChiffres(d.getUTCMinutes())}00`;
}

function lendemain(dateIso: string): string {
  const [a, m, j] = dateIso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + 1));
  return `${d.getUTCFullYear()}${deuxChiffres(d.getUTCMonth() + 1)}${deuxChiffres(d.getUTCDate())}`;
}

// Horodatage UTC au format iCalendar : 20261121T210000Z
function horodatageUTC(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/* Un événement. Pour une tâche répétée, on écrit :
   - l'événement « maître » avec sa règle RRULE (le calendrier calcule lui-même les dates),
     et EXDATE pour les occurrences supprimées ;
   - un événement « exception » (même UID + RECURRENCE-ID = date de l'occurrence) pour
     chaque occurrence cochée, afin qu'elle s'affiche avec ✓ comme une tâche faite.     */
function evenement(t: TacheCalendrier, maintenant: string, aujourdhuiIso: string): string[] {
  const recurrence = validerRecurrence(t.recurrence);
  const heure = t.heure ? t.heure.slice(0, 5) : null;
  // Le suffixe "@agenda-taches" date d'avant le nom AgendIA : on le GARDE exprès.
  // Le changer ferait croire aux calendriers déjà abonnés que toutes les tâches
  // sont de nouveaux événements (doublons ou clignotements).
  const uid = `UID:${t.id}@agenda-taches`;

  // DTSTART / DTEND (et RECURRENCE-ID) pour une date donnée.
  const debutFin = (date: string): { debut: string; fin: string; id: string } => heure
    ? {
        // Tâche avec heure : événement de [heure] à [heure + durée].
        debut: `DTSTART;TZID=${FUSEAU}:${ajouterMinutes(date, heure, 0)}`,
        fin: `DTEND;TZID=${FUSEAU}:${ajouterMinutes(date, heure, t.duree_minutes ?? DUREE_PAR_DEFAUT)}`,
        id: `RECURRENCE-ID;TZID=${FUSEAU}:${ajouterMinutes(date, heure, 0)}`,
      }
    : {
        // Tâche sans heure : événement "toute la journée". DTEND est EXCLU, d'où le lendemain.
        debut: `DTSTART;VALUE=DATE:${dateCompacte(date)}`,
        fin: `DTEND;VALUE=DATE:${lendemain(date)}`,
        id: `RECURRENCE-ID;VALUE=DATE:${dateCompacte(date)}`,
      };

  const corps = (faite: boolean): string[] => {
    const lignes = [`SUMMARY:${echapper((faite ? "✓ " : "") + t.titre)}`];
    // La description regroupe tout ce qui n'a pas de champ dédié dans un agenda.
    const details: string[] = [];
    if (t.description) details.push(t.description);
    const materiel = (t.materiel ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (materiel.length) details.push("Matériel :\n" + materiel.map((l) => "• " + l).join("\n"));
    details.push(`Catégorie : ${CATEGORIES[t.categorie] ?? t.categorie} · Priorité : ${PRIORITES[t.priorite] ?? t.priorite}`);
    if (recurrence) details.push(`Répétition : ${decrireRecurrence(recurrence, t.date)}.`);
    if (faite) details.push("Tâche terminée.");
    lignes.push(`DESCRIPTION:${echapper(details.join("\n\n"))}`);
    if (t.lieu) lignes.push(`LOCATION:${echapper(t.lieu)}`);
    lignes.push(`CATEGORIES:${echapper(CATEGORIES[t.categorie] ?? t.categorie)}`);
    // PRIORITY iCalendar : 1 = la plus haute, 9 = la plus basse.
    lignes.push(`PRIORITY:${t.priorite === "haute" ? 1 : t.priorite === "moyenne" ? 5 : 9}`);
    // TRANSPARENT : la tâche n'apparaît pas comme "occupé" dans les disponibilités.
    lignes.push("TRANSP:TRANSPARENT");
    return lignes;
  };

  const principal = debutFin(t.date);
  const lignes = ["BEGIN:VEVENT", uid, `DTSTAMP:${maintenant}`, principal.debut, principal.fin];
  if (!recurrence) return [...lignes, ...corps(t.faite), "END:VEVENT"];

  lignes.push(`RRULE:${regleRRULE(recurrence, t.date, heure)}`);
  if (recurrence.exceptions.length) {
    const dates = recurrence.exceptions.map((d) => (heure ? ajouterMinutes(d, heure, 0) : dateCompacte(d)));
    lignes.push(heure ? `EXDATE;TZID=${FUSEAU}:${dates.join(",")}` : `EXDATE;VALUE=DATE:${dates.join(",")}`);
  }
  lignes.push(...corps(false), "END:VEVENT");

  // Occurrences cochées (récentes) : une exception par date.
  const limite = decalerIso(aujourdhuiIso, -JOURS_HISTORIQUE);
  for (const d of recurrence.faites) {
    if (d < limite || d < t.date || recurrence.exceptions.includes(d)) continue;
    const o = debutFin(d);
    lignes.push("BEGIN:VEVENT", uid, `DTSTAMP:${maintenant}`, o.id, o.debut, o.fin, ...corps(true), "END:VEVENT");
  }
  return lignes;
}

function decalerIso(iso: string, n: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return `${d.getUTCFullYear()}-${deuxChiffres(d.getUTCMonth() + 1)}-${deuxChiffres(d.getUTCDate())}`;
}

export function genererICS(taches: TacheCalendrier[], maintenant = new Date()): string {
  const stamp = horodatageUTC(maintenant);
  const aujourdhuiIso = maintenant.toISOString().slice(0, 10);
  const lignes = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AgendIA//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${NOM_APP}`,
    `X-WR-TIMEZONE:${FUSEAU}`,
    // Intervalle de rafraîchissement SOUHAITÉ (Outlook/Apple le respectent à peu près, Google l'ignore).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...VTIMEZONE,
    ...taches.flatMap((t) => evenement(t, stamp, aujourdhuiIso)),
    "END:VCALENDAR",
  ];
  return lignes.map(plier).join("\r\n") + "\r\n";
}
