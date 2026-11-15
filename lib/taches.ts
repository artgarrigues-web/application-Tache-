/* Logique "métier" sur les tâches : création, validation, filtres, tri.
   Aucune de ces fonctions ne touche à React ni à l'écran : elles prennent des
   données et renvoient des données. Le stockage (Supabase) est géré à part,
   dans lib/depot.ts.                                                         */

import { aujourdhui, versISO } from "./dates";
import {
  CATEGORIES, PRIORITES, RANG_PRIORITE,
  type Categorie, type DonneesTache, type Filtres, type Priorite, type Tache,
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
  if (f.recherche && !normaliser(`${tache.titre} ${tache.description}`).includes(normaliser(f.recherche))) return false;
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
