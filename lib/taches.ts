/* Logique "métier" sur les tâches : création, validation, filtres, tri.
   Aucune de ces fonctions ne touche à React ni à l'écran : elles prennent des
   données et renvoient des données. Le stockage (Supabase) est géré à part,
   dans lib/depot.ts.                                                         */

import { ajouterJours, aujourdhui, versISO } from "./dates";
import {
  CATEGORIES, DUREE_RAPIDE_MAX, GROUPES, JOURS_URGENCE, PRIORITES, RANG_PRIORITE,
  type Categorie, type DonneesTache, type Filtres, type Groupe, type Priorite, type Tache,
} from "./types";

export function genererId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function creerTache(donnees: DonneesTache): Tache {
  return { id: genererId(), ...donnees, faite: false, creeLe: new Date().toISOString() };
}

/* Vérifie des données venant de l'extérieur (localStorage, fichier importé).
   Le type "unknown" oblige TypeScript à nous faire tout vérifier avant usage. */
export function validerTaches(donnees: unknown): Tache[] | null {
  if (!Array.isArray(donnees)) return null;
  return donnees
    .filter((t): t is Record<string, unknown> =>
      typeof t === "object" && t !== null &&
      typeof t.titre === "string" &&
      typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date))
    .map((t) => ({
      id: typeof t.id === "string" ? t.id : genererId(),
      titre: (t.titre as string).slice(0, 120),
      description: typeof t.description === "string" ? t.description : "",
      date: t.date as string,
      heure: typeof t.heure === "string" && /^\d{2}:\d{2}$/.test(t.heure) ? t.heure : "",
      dureeMinutes: typeof t.dureeMinutes === "number" && t.dureeMinutes > 0 ? Math.round(t.dureeMinutes) : null,
      lieu: typeof t.lieu === "string" ? t.lieu.slice(0, 200) : "",
      materiel: typeof t.materiel === "string" ? t.materiel.slice(0, 2000) : "",
      categorie: (typeof t.categorie === "string" && t.categorie in CATEGORIES ? t.categorie : "perso") as Categorie,
      priorite: (typeof t.priorite === "string" && t.priorite in PRIORITES ? t.priorite : "moyenne") as Priorite,
      faite: Boolean(t.faite),
      creeLe: typeof t.creeLe === "string" ? t.creeLe : new Date().toISOString(),
    }));
}

// Minuscules + suppression des accents : "Écrire" et "ecrire" deviennent identiques.
export function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function estEnRetard(tache: Tache): boolean {
  return !tache.faite && tache.date < versISO(aujourdhui());
}

export function passeLesFiltres(tache: Tache, f: Filtres): boolean {
  if (f.categorie !== "toutes" && tache.categorie !== f.categorie) return false;
  if (f.priorite !== "toutes" && tache.priorite !== f.priorite) return false;
  if (f.statut === "afaire" && tache.faite) return false;
  if (f.statut === "faites" && !tache.faite) return false;
  if (f.statut === "retard" && !estEnRetard(tache)) return false;
  if (f.recherche && !normaliser(`${tache.titre} ${tache.description} ${tache.lieu} ${tache.materiel}`).includes(normaliser(f.recherche))) return false;
  return true;
}

// Ordre : date → heure (sans heure = fin de journée) → non faites d'abord → priorité.
export function comparer(a: Tache, b: Tache): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ha = a.heure || "99:99";
  const hb = b.heure || "99:99";
  if (ha !== hb) return ha < hb ? -1 : 1;
  if (a.faite !== b.faite) return a.faite ? 1 : -1;
  return RANG_PRIORITE[a.priorite] - RANG_PRIORITE[b.priorite];
}

export function grouperParDate(liste: Tache[]): Map<string, Tache[]> {
  const groupes = new Map<string, Tache[]>();
  for (const t of liste) {
    const groupe = groupes.get(t.date);
    if (groupe) groupe.push(t);
    else groupes.set(t.date, [t]);
  }
  return groupes;
}

/* ---------- Durée, lieu, matériel ---------- */

// 90 → "1 h 30", 45 → "45 min", 120 → "2 h"
export function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

// Heure de fin à partir de l'heure de début et de la durée : ("14:00", 90) → "15:30".
// Si la tâche se termine un autre jour, on l'indique : ("23:00", 120) → "01:00 (+1 j)".
export function heureFin(heure: string, dureeMinutes: number): string {
  const [h, m] = heure.split(":").map(Number);
  const total = h * 60 + m + dureeMinutes;
  const jours = Math.floor(total / 1440);           // 1440 minutes dans une journée
  const reste = total % 1440;
  const texte = `${String(Math.floor(reste / 60)).padStart(2, "0")}:${String(reste % 60).padStart(2, "0")}`;
  return jours > 0 ? `${texte} (+${jours} j)` : texte;
}

// Le matériel est saisi à raison d'un élément par ligne ; on renvoie la liste nettoyée.
export function listeMateriel(materiel: string): string[] {
  return materiel.split("\n").map((l) => l.trim()).filter(Boolean);
}

// Temps total prévu pour une liste de tâches (celles qui ne sont pas encore faites).
export function chargeRestante(taches: Tache[]): number {
  return taches.reduce((somme, t) => somme + (!t.faite && t.dureeMinutes ? t.dureeMinutes : 0), 0);
}

// Lien de recherche Google Maps pour un lieu.
export function lienCarte(lieu: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lieu)}`;
}

/* ---------- Groupes Urgent / Important / Rapide ---------- */

/* Tous les groupes auxquels une tâche appartient (une tâche peut cocher plusieurs cases :
   un rendu de TP à 20 min, prévu demain et en priorité haute, est les trois à la fois).
   Une tâche déjà faite n'appartient à aucun groupe : il n'y a plus rien à trier.
   Comparer des dates "AAAA-MM-JJ" comme du texte marche car l'ordre alphabétique = l'ordre chronologique. */
export function groupesDe(tache: Tache): Groupe[] {
  if (tache.faite) return [];
  const limiteUrgence = versISO(ajouterJours(aujourdhui(), JOURS_URGENCE));
  const groupes: Groupe[] = [];
  if (tache.date <= limiteUrgence) groupes.push("urgent");
  if (tache.priorite === "haute") groupes.push("important");
  if (tache.dureeMinutes !== null && tache.dureeMinutes <= DUREE_RAPIDE_MAX) groupes.push("rapide");
  return groupes;
}

/* Répartition pour la vue "Tri" : chaque tâche n'est rangée QUE dans son premier groupe,
   dans l'ordre Urgent > Important > Rapide (pour ne pas l'afficher deux fois).
   Les tâches à faire qui ne relèvent d'aucun groupe vont dans "autres". */
export function repartirParGroupe(liste: Tache[]): { groupes: Record<Groupe, Tache[]>; autres: Tache[] } {
  const groupes = Object.fromEntries(GROUPES.map((g) => [g.id, [] as Tache[]])) as Record<Groupe, Tache[]>;
  const autres: Tache[] = [];
  for (const t of liste) {
    if (t.faite) continue;
    const premier = groupesDe(t)[0];
    if (premier) groupes[premier].push(t);
    else autres.push(t);
  }
  return { groupes, autres };
}
