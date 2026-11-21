/* "Dépôt" (repository) : la SEULE partie du code qui parle à la base de données.
   Le reste de l'application manipule des objets Tache et ignore tout de Supabase.
   Avantage : si on change de base un jour, on ne réécrit que ce fichier.

   Conventions différentes des deux côtés, d'où les fonctions de conversion :
   - base de données (SQL) : snake_case (cree_le), heure de type "time" ("14:00:00") ou null ;
   - application (TypeScript) : camelCase (creeLe, dureeMinutes), heure "14:00" ou "".  */

import { supabase } from "./supabase";
import type { Categorie, DonneesTache, Groupe, Priorite, Tache } from "./types";

const TABLE = "taches";

interface Ligne {
  id: string;
  user_id: string;
  titre: string;
  description: string | null;
  date: string | null;
  heure: string | null;
  duree_minutes: number | null;
  lieu: string | null;
  echeance?: string | null; // absente si la migration du 21/11 n'a pas encore été appliquée
  materiel: string | null;
  categorie: Categorie;
  priorite: Priorite;
  groupe: Groupe | null;
  faite: boolean;
  cree_le: string;
}

function depuisLigne(l: Ligne): Tache {
  return {
    id: l.id,
    titre: l.titre,
    description: l.description ?? "",
    date: l.date ?? "",          // null en base = tâche sans date
    heure: l.heure ? l.heure.slice(0, 5) : "",
    dureeMinutes: l.duree_minutes,
    lieu: l.lieu ?? "",
    echeance: l.echeance ?? "",
    materiel: l.materiel ?? "",
    categorie: l.categorie,
    priorite: l.priorite,
    groupe: l.groupe ?? null,
    faite: l.faite,
    creeLe: l.cree_le,
  };
}

/* La colonne "echeance" a été ajoutée le 21/11/2026. Tant que la migration SQL n'a pas
   été collée dans Supabase, envoyer ce champ ferait échouer TOUTES les sauvegardes.
   On essaie donc avec ; si la base répond que la colonne n'existe pas, on retient
   l'information et on renvoie sans (l'échéance n'est alors simplement pas gardée). */
let colonneEcheance = true;
export function echeanceDisponible(): boolean {
  return colonneEcheance;
}

function versLigne(d: DonneesTache) {
  const ligne = {
    titre: d.titre,
    description: d.description,
    date: d.date || null,
    heure: d.heure || null,
    duree_minutes: d.dureeMinutes,
    lieu: d.lieu,
    materiel: d.materiel,
    categorie: d.categorie,
    priorite: d.priorite,
    groupe: d.groupe,
  };
  return colonneEcheance ? { ...ligne, echeance: d.echeance || null } : ligne;
}

// Exécute une requête ; si elle échoue à cause de la colonne echeance absente, la rejoue sans.
async function avecRepli<T>(requete: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  let { data, error } = await requete();
  if (error && colonneEcheance && error.message.includes("echeance")) {
    colonneEcheance = false;
    ({ data, error } = await requete());
  }
  verifier(error);
  return data;
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
  const data = await avecRepli(() => supabase().from(TABLE).insert(versLigne(d)).select().single());
  return depuisLigne(data as Ligne);
}

export async function insererPlusieurs(taches: Tache[]): Promise<Tache[]> {
  const data = await avecRepli(() => supabase().from(TABLE).insert(taches.map((t) => ({ ...versLigne(t), faite: t.faite }))).select());
  return (data as Ligne[]).map(depuisLigne);
}

export async function modifierTache(id: string, d: DonneesTache): Promise<Tache> {
  const data = await avecRepli(() => supabase().from(TABLE).update(versLigne(d)).eq("id", id).select().single());
  return depuisLigne(data as Ligne);
}

/* Planification automatique : ne change QUE la date et l'heure (rien d'autre n'est touché,
   ce qui rend l'annulation sûre). Les mises à jour partent en parallèle (Promise.all). */
export interface ChangementHoraire { id: string; date: string; heure: string }

export async function changerHoraires(changements: ChangementHoraire[]): Promise<Tache[]> {
  return Promise.all(changements.map(async (c) => {
    const { data, error } = await supabase().from(TABLE)
      .update({ date: c.date || null, heure: c.heure || null }).eq("id", c.id).select().single();
    verifier(error);
    return depuisLigne(data as Ligne);
  }));
}

/* ---------- Plages de disponibilité (table disponibilites, une ligne par utilisateur) ---------- */

export async function lirePlages(): Promise<unknown | null> {
  const { data, error } = await supabase().from("disponibilites").select("plages").maybeSingle();
  verifier(error);
  return data ? (data as { plages: unknown }).plages : null;
}

export async function enregistrerPlages(plages: unknown): Promise<void> {
  const { error } = await supabase().from("disponibilites")
    .upsert({ plages, modifie_le: new Date().toISOString() }, { onConflict: "user_id" });
  verifier(error);
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
