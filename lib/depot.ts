/* "Dépôt" (repository) : la SEULE partie du code qui parle à la base de données.
   Le reste de l'application manipule des objets Tache et ignore tout de Supabase.
   Avantage : si on change de base un jour, on ne réécrit que ce fichier.

   Conventions différentes des deux côtés, d'où les fonctions de conversion :
   - base de données (SQL) : snake_case (cree_le), heure de type "time" ("14:00:00") ou null ;
   - application (TypeScript) : camelCase (creeLe, dureeMinutes), heure "14:00" ou "".  */

import { supabase } from "./supabase";
import type { Categorie, DonneesTache, Priorite, Tache } from "./types";

const TABLE = "taches";

interface Ligne {
  id: string;
  user_id: string;
  titre: string;
  description: string | null;
  date: string;
  heure: string | null;
  duree_minutes: number | null;
  lieu: string | null;
  materiel: string | null;
  categorie: Categorie;
  priorite: Priorite;
  faite: boolean;
  cree_le: string;
}

function depuisLigne(l: Ligne): Tache {
  return {
    id: l.id,
    titre: l.titre,
    description: l.description ?? "",
    date: l.date,
    heure: l.heure ? l.heure.slice(0, 5) : "",
    dureeMinutes: l.duree_minutes,
    lieu: l.lieu ?? "",
    materiel: l.materiel ?? "",
    categorie: l.categorie,
    priorite: l.priorite,
    faite: l.faite,
    creeLe: l.cree_le,
  };
}

function versLigne(d: DonneesTache) {
  return {
    titre: d.titre,
    description: d.description,
    date: d.date,
    heure: d.heure || null,
    duree_minutes: d.dureeMinutes,
    lieu: d.lieu,
    materiel: d.materiel,
    categorie: d.categorie,
    priorite: d.priorite,
  };
}

// Supabase renvoie { data, error } au lieu de lancer une exception : on la lance nous-mêmes.
function verifier(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function listerTaches(): Promise<Tache[]> {
  // Pas besoin de filtrer par utilisateur : les règles RLS ne renvoient que ses lignes.
  const { data, error } = await supabase().from(TABLE).select("*").order("date");
  verifier(error);
  return (data as Ligne[]).map(depuisLigne);
}

export async function insererTache(d: DonneesTache): Promise<Tache> {
  const { data, error } = await supabase().from(TABLE).insert(versLigne(d)).select().single();
  verifier(error);
  return depuisLigne(data as Ligne);
}

export async function insererPlusieurs(taches: Tache[]): Promise<Tache[]> {
  const lignes = taches.map((t) => ({ ...versLigne(t), faite: t.faite }));
  const { data, error } = await supabase().from(TABLE).insert(lignes).select();
  verifier(error);
  return (data as Ligne[]).map(depuisLigne);
}

export async function modifierTache(id: string, d: DonneesTache): Promise<Tache> {
  const { data, error } = await supabase().from(TABLE).update(versLigne(d)).eq("id", id).select().single();
  verifier(error);
  return depuisLigne(data as Ligne);
}

export async function changerEtat(id: string, faite: boolean): Promise<void> {
  const { error } = await supabase().from(TABLE).update({ faite }).eq("id", id);
  verifier(error);
}

export async function supprimerTache(id: string): Promise<void> {
  const { error } = await supabase().from(TABLE).delete().eq("id", id);
  verifier(error);
}

export async function supprimerTerminees(): Promise<void> {
  const { error } = await supabase().from(TABLE).delete().eq("faite", true);
  verifier(error);
}
