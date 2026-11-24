/* Répétition des tâches (récurrence).

   PRINCIPE : une tâche répétée n'est enregistrée qu'UNE SEULE fois en base (la « série »,
   avec sa règle dans la colonne recurrence). Ses occurrences (lundi 24, lundi 1er,
   lundi 8…) sont CALCULÉES à l'affichage, pour la période regardée. Avantages :
   - une série « sans fin » ne crée pas des milliers de lignes ;
   - modifier la série (titre, heure, règle) met à jour toutes les occurrences d'un coup.

   Ce qui est propre à UNE occurrence est rangé dans la règle :
   - faites     : dates des occurrences cochées ;
   - exceptions : dates retirées de la série (supprimées, ou modifiées à part : elles
                  deviennent alors une tâche unique ordinaire).

   Ce fichier est « pur » (aucun accès à React ni à la base), il n'importe que des TYPES,
   ce qui permet de le tester directement avec Node (tests/recurrence.test.ts).
   Toutes les dates sont du texte "AAAA-MM-JJ" ; les calculs passent par Date.UTC
   pour ne jamais subir de décalage d'heure d'été/hiver.                              */

import type { FinRecurrence, Frequence, ModeMois, Recurrence, Tache } from "./types";

/* Les occurrences non cochées des 7 derniers jours restent « à rattraper » (en retard)
   dans les vues Liste, Tri et Checklist ; au-delà, on considère qu'elles sont passées. */
export const JOURS_RATTRAPAGE = 7;
// Garde-fou : nombre maximal de périodes parcourues pour une série (≈ 27 ans en quotidien).
const MAX_PERIODES = 10000;

/* ---------- Petits outils de dates (en UTC, pour éviter tout décalage) ---------- */

function enUTC(iso: string): number {
  const [a, m, j] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, j);
}
function versIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function decalerJours(iso: string, n: number): string {
  return versIso(enUTC(iso) + n * 86400000);
}
function ecartJours(a: string, b: string): number {
  return Math.round((enUTC(b) - enUTC(a)) / 86400000);
}
// Nombre de jours d'un mois (mois de 0 à 11) : le « jour 0 » du mois suivant est le dernier.
function joursDansMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois + 1, 0)).getUTCDate();
}
// Date à partir d'une année et d'un mois qui peut déborder (mois 13 = janvier suivant).
function dateDe(annee: number, mois: number, jour: number): string {
  return versIso(Date.UTC(annee, mois, jour));
}
// Jour de la semaine, 0 = lundi … 6 = dimanche (getUTCDay() donne 0 = dimanche).
export function jourSemaine(iso: string): number {
  return (new Date(enUTC(iso)).getUTCDay() + 6) % 7;
}

/* Position d'une date dans son mois, pour le rythme mensuel :
   rang 1 à 5 (« 4e mardi »), et estDernier si c'est le dernier mardi du mois. */
export function infosMois(iso: string) {
  const [a, m, j] = iso.split("-").map(Number);
  return { jour: j, rang: Math.ceil(j / 7), estDernier: j + 7 > joursDansMois(a, m - 1), jourSemaine: jourSemaine(iso) };
}

/* ---------- Création et validation d'une règle ---------- */

export function recurrenceParDefaut(dateDebut: string, frequence: Frequence = "semaine"): Recurrence {
  return {
    frequence, intervalle: 1,
    joursSemaine: dateDebut ? [jourSemaine(dateDebut)] : [0],
    modeMois: "jour", fin: { type: "jamais" }, exceptions: [], faites: [],
  };
}

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
const listeDates = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === "string" && FORMAT_DATE.test(d)))].sort() : [];

/* Vérifie une règle venant de l'extérieur (base de données, fichier importé) :
   tout ce qui est invalide est remplacé par une valeur sûre, ou la règle est refusée (null). */
export function validerRecurrence(v: unknown): Recurrence | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!["jour", "semaine", "mois", "annee"].includes(r.frequence as string)) return null;
  const intervalle = typeof r.intervalle === "number" && r.intervalle >= 1 ? Math.min(99, Math.round(r.intervalle)) : 1;
  const jours = Array.isArray(r.joursSemaine)
    ? [...new Set(r.joursSemaine.filter((j): j is number => Number.isInteger(j) && j >= 0 && j <= 6))].sort()
    : [];
  const modeMois: ModeMois = r.modeMois === "rang" || r.modeMois === "dernier" ? r.modeMois : "jour";
  let fin: FinRecurrence = { type: "jamais" };
  const f = r.fin as Record<string, unknown> | undefined;
  if (f && f.type === "date" && typeof f.date === "string" && FORMAT_DATE.test(f.date)) fin = { type: "date", date: f.date };
  else if (f && f.type === "nombre" && typeof f.nombre === "number" && f.nombre >= 1) fin = { type: "nombre", nombre: Math.min(999, Math.round(f.nombre)) };
  return {
    frequence: r.frequence as Frequence, intervalle, joursSemaine: jours.length ? jours : [0],
    modeMois, fin, exceptions: listeDates(r.exceptions), faites: listeDates(r.faites),
  };
}

/* Règle « propre » avant enregistrement : un rang 5 (« 5e mardi ») n'existe pas tous les
   mois, on le transforme en « dernier mardi » ; la liste des jours n'est jamais vide. */
export function normaliserRecurrence(r: Recurrence, dateDebut: string): Recurrence {
  const copie: Recurrence = { ...r, joursSemaine: [...new Set(r.joursSemaine)].sort() };
  if (copie.joursSemaine.length === 0) copie.joursSemaine = [jourSemaine(dateDebut)];
  if (copie.modeMois === "rang" && infosMois(dateDebut).rang === 5) copie.modeMois = "dernier";
  if (copie.fin.type === "date" && copie.fin.date < dateDebut) copie.fin = { type: "date", date: dateDebut };
  return copie;
}

/* ---------- Calcul des occurrences ---------- */

/* Dates « brutes » de la série, dans l'ordre : chaque période (jour, semaine, mois, an)
   donne 0, 1 ou plusieurs dates. La date de début est TOUJOURS la première occurrence
   (le formulaire la cale sur la règle, voir premiereOccurrence).
   - borneFin : on s'arrête dès qu'on la dépasse ;
   - sautPossible : on peut sauter directement près de « depuis » (impossible avec une
     fin « après N fois », où il faut compter depuis le début).                       */
function* datesBrutes(debut: string, r: Recurrence, depuis: string, borneFin: string): Generator<string> {
  const [a, m, j] = debut.split("-").map(Number);
  const N = Math.max(1, r.intervalle);
  const finRegle = r.fin.type === "date" ? r.fin.date : null;
  const limite = finRegle && finRegle < borneFin ? finRegle : borneFin;
  const maxCompte = r.fin.type === "nombre" ? r.fin.nombre : Infinity;

  // Première période à examiner (saut en avant si on n'a pas besoin de compter).
  let k = 0;
  if (maxCompte === Infinity && depuis > debut) {
    const ecart = ecartJours(debut, depuis);
    const parPeriode = r.frequence === "jour" ? N : r.frequence === "semaine" ? 7 * N : r.frequence === "mois" ? 28 * N : 365 * N;
    k = Math.max(0, Math.floor(ecart / parPeriode) - 1);
  }

  const lundiDebut = decalerJours(debut, -jourSemaine(debut));
  const infos = infosMois(debut);
  let compte = 0;
  for (; k < MAX_PERIODES; k++) {
    const candidates: string[] = [];
    if (r.frequence === "jour") {
      candidates.push(decalerJours(debut, k * N));
    } else if (r.frequence === "semaine") {
      const lundi = decalerJours(lundiDebut, 7 * N * k);
      for (const js of r.joursSemaine) candidates.push(decalerJours(lundi, js));
    } else if (r.frequence === "mois") {
      const mois = m - 1 + N * k;
      const an = a + Math.floor(mois / 12), mo = ((mois % 12) + 12) % 12;
      const dim = joursDansMois(an, mo);
      if (r.modeMois === "jour") {
        candidates.push(dateDe(an, mo, Math.min(j, dim)));        // 31 → dernier jour des mois courts
      } else {
        const premier = dateDe(an, mo, 1);
        const premierJs = (infos.jourSemaine - jourSemaine(premier) + 7) % 7 + 1; // 1er « mardi » du mois
        if (r.modeMois === "rang") {
          const jour = premierJs + 7 * (infos.rang - 1);
          if (jour <= dim) candidates.push(dateDe(an, mo, jour));
        } else {
          let jour = premierJs;
          while (jour + 7 <= dim) jour += 7;                      // dernier « mardi » du mois
          candidates.push(dateDe(an, mo, jour));
        }
      }
    } else {
      const an = a + N * k;
      candidates.push(dateDe(an, m - 1, Math.min(j, joursDansMois(an, m - 1)))); // 29 février → 28
    }

    for (const d of candidates) {
      if (d < debut) continue;              // jours de la 1re semaine situés avant le début
      if (d > limite) return;
      if (compte >= maxCompte) return;
      compte++;
      yield d;
    }
  }
}

/* Dates des occurrences entre deux bornes incluses, exceptions retirées.
   Une fin « après N fois » compte AUSSI les occurrences supprimées (comme la norme
   iCalendar : le calendrier synchronisé affiche donc exactement les mêmes dates). */
export function occurrencesEntre(debut: string, r: Recurrence, de: string, a: string): string[] {
  if (!debut || a < de) return [];
  const exceptions = new Set(r.exceptions);
  const resultat: string[] = [];
  for (const d of datesBrutes(debut, r, de, a)) {
    if (d >= de && !exceptions.has(d)) resultat.push(d);
  }
  return resultat;
}

// Première date de la règle à partir de « date » (sert à caler la date de début sur les jours choisis).
export function premiereOccurrence(date: string, r: Recurrence): string {
  // Seul le rythme hebdomadaire peut ne pas tomber sur la date choisie (ex. : date un mardi,
  // jours choisis lundi et jeudi → la série commence le jeudi qui suit).
  if (r.frequence !== "semaine") return date;
  for (let i = 0; i < 7; i++) {
    const d = decalerJours(date, i);
    if (r.joursSemaine.includes(jourSemaine(d))) return d;
  }
  return date;
}

// Nombre d'occurrences (exceptions comprises) strictement avant une date.
export function nombreAvant(debut: string, r: Recurrence, date: string): number {
  let n = 0;
  for (const d of datesBrutes(debut, r, debut, decalerJours(date, -1))) { void d; n++; }
  return n;
}

// La date fait-elle partie de la série (hors exceptions) ?
export function estOccurrence(debut: string, r: Recurrence, date: string): boolean {
  return occurrencesEntre(debut, r, date, date).length === 1;
}

/* ---------- Occurrences « virtuelles » affichées par les vues ---------- */

export const SEPARATEUR = "~";
export function idOccurrence(serieId: string, date: string): string {
  return `${serieId}${SEPARATEUR}${date}`;
}
// "abc~2026-11-24" → { serieId: "abc", date: "2026-11-24" } ; un id ordinaire → null.
export function analyserId(id: string): { serieId: string; date: string } | null {
  const i = id.lastIndexOf(SEPARATEUR);
  return i > 0 ? { serieId: id.slice(0, i), date: id.slice(i + 1) } : null;
}

function occurrence(serie: Tache, date: string): Tache {
  const r = serie.recurrence!;
  // L'échéance suit l'occurrence : « à rendre 2 jours après » reste vrai chaque semaine.
  const echeance = serie.echeance ? decalerJours(date, ecartJours(serie.date, serie.echeance)) : "";
  return {
    ...serie, id: idOccurrence(serie.id, date), date, echeance,
    faite: r.faites.includes(date), occurrence: { serieId: serie.id, date, debutSerie: serie.date },
  };
}

export function estSerie(t: Tache): boolean {
  return t.recurrence !== null && t.date !== "";
}

/* Vues calendrier (Jour, Semaine, Mois) : TOUTES les occurrences de la période.
   Les tâches non répétées sont renvoyées telles quelles (la vue filtre par date). */
export function developper(taches: Tache[], de: string, a: string): Tache[] {
  return taches.flatMap((t) =>
    estSerie(t) ? occurrencesEntre(t.date, t.recurrence!, de, a).map((d) => occurrence(t, d)) : [t]);
}

/* Vues Liste, Tri, Checklist et compteurs : UNE seule entrée « à faire » par série,
   pour ne pas noyer la liste (une tâche quotidienne y apparaîtrait 365 fois) :
   la plus ancienne occurrence non cochée depuis 7 jours (rattrapage), sinon la prochaine.
   S'y ajoutent les occurrences cochées des 7 derniers jours (section « Cochées »,
   pour pouvoir décocher une erreur). Cocher l'entrée fait apparaître la suivante.     */
export function entreesCourantes(taches: Tache[], aujourdhui: string): Tache[] {
  const depuis = decalerJours(aujourdhui, -JOURS_RATTRAPAGE);
  return taches.flatMap((t) => {
    if (!estSerie(t)) return [t];
    const r = t.recurrence!;
    const resultat: Tache[] = [];
    for (const d of occurrencesEntre(t.date, r, depuis, aujourdhui)) {
      if (r.faites.includes(d)) resultat.push(occurrence(t, d));
    }
    // Prochaine non cochée : on cherche par tranches d'un an (au plus 10 ans) pour ne pas tout calculer.
    // Si la série est terminée et entièrement cochée, elle n'a plus d'entrée « à faire ».
    let de = depuis;
    for (let essai = 0; essai < 10; essai++) {
      const a = decalerJours(de, 365);
      const prochaine = occurrencesEntre(t.date, r, de, a).find((d) => !r.faites.includes(d));
      if (prochaine) { resultat.push(occurrence(t, prochaine)); break; }
      if (r.fin.type === "date" && r.fin.date < a) break;
      de = decalerJours(a, 1);
    }
    return resultat;
  });
}

/* ---------- Modifications de la règle (renvoient une NOUVELLE règle) ---------- */

export function basculerFaite(r: Recurrence, date: string): Recurrence {
  const faites = r.faites.includes(date) ? r.faites.filter((d) => d !== date) : [...r.faites, date].sort();
  return { ...r, faites };
}

// Retire une date de la série (suppression d'une occurrence, ou occurrence modifiée à part).
export function ajouterException(r: Recurrence, date: string): Recurrence {
  return { ...r, exceptions: [...new Set([...r.exceptions, date])].sort(), faites: r.faites.filter((d) => d !== date) };
}

// Arrête la série la veille d'une date (« cette occurrence et les suivantes »).
export function arreterAvant(r: Recurrence, date: string): Recurrence {
  const veille = decalerJours(date, -1);
  return {
    ...r, fin: { type: "date", date: veille },
    exceptions: r.exceptions.filter((d) => d <= veille), faites: r.faites.filter((d) => d <= veille),
  };
}

/* ---------- Phrase lisible (« Toutes les 2 semaines le lundi et le jeudi ») ---------- */

const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function enumerer(mots: string[]): string {
  return mots.length <= 1 ? mots.join("") : `${mots.slice(0, -1).join(", ")} et ${mots[mots.length - 1]}`;
}
export function ordinal(n: number): string {
  return n === 1 ? "1er" : `${n}e`;
}
export function dateLongue(iso: string): string {
  const [a, m, j] = iso.split("-").map(Number);
  return `${j === 1 ? "1er" : j} ${NOMS_MOIS[m - 1]} ${a}`;
}

export function decrireRecurrence(r: Recurrence, debut: string): string {
  const N = r.intervalle;
  const im = debut ? infosMois(debut) : null;
  let texte: string;
  if (r.frequence === "jour") texte = N === 1 ? "Tous les jours" : `Tous les ${N} jours`;
  else if (r.frequence === "semaine") {
    const jours = [...r.joursSemaine].sort();
    const quand = jours.join() === "0,1,2,3,4" ? "du lundi au vendredi"
      : jours.length === 7 ? "tous les jours de la semaine"
      : enumerer(jours.map((j) => `le ${NOMS_JOURS[j]}`));
    texte = `${N === 1 ? "Toutes les semaines" : `Toutes les ${N} semaines`} ${quand}`;
  } else if (r.frequence === "mois") {
    texte = N === 1 ? "Tous les mois" : `Tous les ${N} mois`;
    if (im) {
      if (r.modeMois === "rang") texte += ` le ${ordinal(im.rang)} ${NOMS_JOURS[im.jourSemaine]}`;
      else if (r.modeMois === "dernier") texte += ` le dernier ${NOMS_JOURS[im.jourSemaine]}`;
      else texte += ` le ${im.jour === 1 ? "1er" : im.jour}` + (im.jour >= 29 ? " (ou le dernier jour des mois plus courts)" : "");
    }
  } else {
    texte = N === 1 ? "Tous les ans" : `Tous les ${N} ans`;
    if (debut) {
      const [, m, j] = debut.split("-").map(Number);
      texte += ` le ${j === 1 ? "1er" : j} ${NOMS_MOIS[m - 1]}` + (m === 2 && j === 29 ? " (le 28 les années non bissextiles)" : "");
    }
  }
  if (r.fin.type === "date") texte += `, jusqu'au ${dateLongue(r.fin.date)}`;
  else if (r.fin.type === "nombre") texte += `, ${r.fin.nombre} fois`;
  return texte;
}
