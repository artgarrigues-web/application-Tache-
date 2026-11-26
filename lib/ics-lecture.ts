/* Lecture d'un agenda externe (Google Agenda, Outlook, Apple…) au format iCalendar (.ics).

   C'est le sens INVERSE de lib/ics.ts : là, AgendIA fabrique un .ics pour Google ;
   ici, AgendIA lit le .ics que Google (ou Outlook) donne avec « l'adresse secrète »,
   pour afficher tes cours et rendez-vous et pour que la planification les évite.

   Le format est piégeux (fuseaux horaires, événements répétés, exceptions…) :
   on s'appuie sur ical.js, la bibliothèque de Mozilla (celle de Thunderbird).
   Ce fichier ne fait QUE transformer du texte .ics en une liste d'événements
   par jour, en heure de Paris : il est testé sans réseau (tests/ics-lecture.test.ts). */

import ICAL from "ical.js";
import { decalerDate, fuseauValide, heureMurale, instantMural } from "./fuseau";

export interface EvenementExterne {
  id: string;            // unique dans la réponse (uid + date d'occurrence + jour)
  agendaId: string;
  titre: string;
  date: string;          // "AAAA-MM-JJ" (heure de Paris)
  heure: string;         // "HH:MM" de début ce jour-là, "" pour un événement « toute la journée »
  fin: string;           // "HH:MM" de fin ce jour-là ("24:00" si l'événement continue le lendemain)
  journee: boolean;      // événement « toute la journée » (anniversaire, vacances…)
  libre: boolean;        // marqué « disponible » dans l'agenda : affiché mais pas évité
  lieu: string;
}

const MAX_EVENEMENTS = 3000;
const MAX_ITERATIONS = 20000;

type Temps = InstanceType<typeof ICAL.Time>;

/* Instant (ms) d'une heure iCalendar. Trois cas :
   - heure UTC (« 20261126T130000Z ») ou fuseau décrit dans le fichier : ical.js sait faire ;
   - fuseau nommé mais non décrit (« TZID=Europe/Paris » sans VTIMEZONE) : on le demande à Intl ;
   - heure « flottante » (sans fuseau) : on la considère à l'heure de Paris. */
function instantDe(t: Temps): number {
  const nom = t.zone?.tzid ?? (t as unknown as { timezone?: string }).timezone ?? "";
  if (nom === "UTC" || nom === "Z") return t.toUnixTime() * 1000;
  if (t.zone && nom !== "floating" && ICAL.TimezoneService.has(nom)) return t.toUnixTime() * 1000;
  const date = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  const heure = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  return instantMural(date, heure, nom && nom !== "floating" && fuseauValide(nom) ? nom : undefined);
}

const dateDe = (t: Temps) => `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

/* Découpe un événement en morceaux d'un jour (un cours de 22 h à 1 h occupe deux jours). */
function morceaux(base: Omit<EvenementExterne, "id" | "date" | "heure" | "fin" | "journee">, cle: string,
  debut: Temps, fin: Temps, de: string, a: string, sortie: EvenementExterne[]) {
  if (debut.isDate) {
    // Toute la journée : la date de fin est EXCLUE (norme iCalendar), au moins 1 jour.
    const d0 = dateDe(debut);
    let d1 = fin && fin.isDate ? dateDe(fin) : decalerDate(d0, 1);
    if (d1 <= d0) d1 = decalerDate(d0, 1);
    for (let d = d0 < de ? de : d0; d < d1 && d <= a; d = decalerDate(d, 1)) {
      sortie.push({ ...base, id: `${cle}|${d}`, date: d, heure: "", fin: "", journee: true });
    }
    return;
  }
  const i0 = instantDe(debut);
  const i1 = Math.max(i0, fin ? instantDe(fin) : i0);
  const m0 = heureMurale(i0), m1 = heureMurale(i1);
  for (let d = m0.date; d <= m1.date && d <= a; d = decalerDate(d, 1)) {
    if (d < de) continue;
    const heure = d === m0.date ? m0.heure : "00:00";
    const finJour = d === m1.date ? m1.heure : "24:00";
    if (d === m1.date && d !== m0.date && m1.minutes === 0) continue; // finit pile à minuit
    sortie.push({ ...base, id: `${cle}|${d}`, date: d, heure, fin: finJour === heure && i1 === i0 ? heure : finJour, journee: false });
  }
}

/* Tous les événements entre deux dates incluses ("AAAA-MM-JJ", heure de Paris). */
export function lireICS(texte: string, agendaId: string, de: string, a: string): EvenementExterne[] {
  const racine = new ICAL.Component(ICAL.parse(texte));
  // Les fuseaux décrits dans le fichier (Outlook écrit « Romance Standard Time » pour Paris).
  for (const vtz of racine.getAllSubcomponents("vtimezone")) {
    const tz = new ICAL.Timezone(vtz);
    if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) ICAL.TimezoneService.register(tz);
  }

  // Les « exceptions » (une occurrence déplacée ou renommée) sont rangées avec leur série.
  const composants = racine.getAllSubcomponents("vevent");
  const series = new Map<string, InstanceType<typeof ICAL.Event>>();
  const isoles: InstanceType<typeof ICAL.Event>[] = [];
  const exceptions: InstanceType<typeof ICAL.Event>[] = [];
  for (const c of composants) {
    const e = new ICAL.Event(c);
    if (c.hasProperty("recurrence-id")) exceptions.push(e);
    else if (e.isRecurring()) series.set(e.uid, e);
    else isoles.push(e);
  }
  for (const ex of exceptions) {
    const serie = series.get(ex.uid);
    if (serie) serie.relateException(ex); else isoles.push(ex);
  }

  const sortie: EvenementExterne[] = [];
  const annule = (c: InstanceType<typeof ICAL.Component>) => String(c.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";
  const infos = (e: InstanceType<typeof ICAL.Event>) => ({
    agendaId,
    titre: (e.summary || "Occupé").trim().slice(0, 200),
    libre: String(e.component.getFirstPropertyValue("transp") ?? "").toUpperCase() === "TRANSPARENT",
    lieu: (e.location || "").trim().slice(0, 200),
  });
  // Borne large pour la recherche (un événement qui commence la veille peut déborder sur « de »).
  const limiteHaute = instantMural(decalerDate(a, 1), "00:00");
  const limiteBasse = instantMural(decalerDate(de, -1), "00:00");

  for (const e of isoles) {
    if (annule(e.component) || !e.startDate) continue;
    morceaux(infos(e), `${agendaId}|${e.uid}|${e.startDate.toString()}`, e.startDate, e.endDate, de, a, sortie);
    if (sortie.length > MAX_EVENEMENTS) break;
  }

  for (const e of series.values()) {
    if (annule(e.component) || !e.startDate) continue;
    const it = e.iterator();
    for (let n = 0, suivant = it.next(); suivant && n < MAX_ITERATIONS; n++, suivant = it.next()) {
      const det = e.getOccurrenceDetails(suivant);
      const debutMs = det.startDate.isDate ? instantMural(dateDe(det.startDate), "00:00") : instantDe(det.startDate);
      if (debutMs >= limiteHaute) break;
      const finMs = det.endDate ? (det.endDate.isDate ? instantMural(dateDe(det.endDate), "00:00") : instantDe(det.endDate)) : debutMs;
      if (finMs < limiteBasse) continue;
      if (annule(det.item.component)) continue;
      morceaux(infos(det.item), `${agendaId}|${e.uid}|${det.recurrenceId.toString()}`, det.startDate, det.endDate, de, a, sortie);
      if (sortie.length > MAX_EVENEMENTS) break;
    }
  }

  return sortie
    .filter((x) => x.date >= de && x.date <= a)
    .sort((x, y) => (x.date + (x.journee ? "" : x.heure)).localeCompare(y.date + (y.journee ? "" : y.heure)));
}

/* ---------- Adresse d'un agenda : contrôles avant de la lire ----------
   Le serveur va télécharger une adresse donnée par l'utilisateur : on refuse tout ce
   qui n'est pas une adresse web publique (pas d'adresse IP, pas de « localhost »…),
   pour qu'on ne puisse pas s'en servir pour sonder le réseau interne du serveur. */
export function normaliserAdresse(brute: string): { url: string } | { erreur: string } {
  let texte = brute.trim();
  if (/^webcals?:\/\//i.test(texte)) texte = texte.replace(/^webcals?:\/\//i, "https://");
  let u: URL;
  try { u = new URL(texte); } catch { return { erreur: "Ce n'est pas une adresse web valide." }; }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") return { erreur: "L'adresse doit commencer par https:// ou webcal://." };
  const hote = u.hostname.toLowerCase();
  if (!hote.includes(".") || hote === "localhost" || hote.endsWith(".local") || hote.endsWith(".internal")
    || /^[\d.]+$/.test(hote) || hote.includes(":") || hote.startsWith("[")) {
    return { erreur: "Cette adresse n'est pas une adresse publique d'agenda." };
  }
  if (u.username || u.password || (u.port && u.port !== "443")) return { erreur: "Cette adresse n'est pas acceptée." };
  if (u.pathname.startsWith("/api/calendrier/")) return { erreur: "C'est l'adresse d'AgendIA lui-même : colle plutôt celle de ton agenda Google ou Outlook." };
  return { url: u.toString() };
}
