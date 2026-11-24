/* "Dépôt" (repository) : la SEULE partie du code qui parle à la base de données.
   Le reste de l'application manipule des objets Tache et ignore tout de Supabase.
   Avantage : si on change de base un jour, on ne réécrit que ce fichier.

   Conventions différentes des deux côtés, d'où les fonctions de conversion :
   - base de données (SQL) : snake_case (cree_le), heure de type "time" ("14:00:00") ou null ;
   - application (TypeScript) : camelCase (creeLe, dureeMinutes), heure "14:00" ou "".  */

import { supabase } from "./supabase";
import { estCouleur } from "./types";
import { validerRecurrence } from "./recurrence";
import type { Categorie, DonneesTache, Groupe, Idee, Priorite, ProjetIdees, Recurrence, Tache } from "./types";

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
  couleur?: string | null; // absente si la migration du 24/11 n'a pas encore été appliquée
  recurrence?: unknown;    // jsonb, absente si supabase/migration-recurrence.sql n'a pas été appliquée
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
    couleur: estCouleur(l.couleur) ? l.couleur : null,
    // Une règle illisible (ou une tâche sans date) est traitée comme une tâche unique.
    recurrence: l.date ? validerRecurrence(l.recurrence) : null,
    faite: l.faite,
    creeLe: l.cree_le,
  };
}

/* Colonnes ajoutées après coup (migrations SQL à coller dans Supabase) :
   - "echeance" le 21/11/2026 (supabase/migration-planification.sql) ;
   - "couleur"  le 24/11/2026 (supabase/migration-couleur.sql) ;
   - "recurrence" le 24/11/2026 (supabase/migration-recurrence.sql).
   Tant qu'une migration n'a pas été collée, envoyer la colonne ferait échouer TOUTES
   les sauvegardes. On essaie donc avec ; si la base répond que la colonne n'existe pas
   (son nom figure dans le message d'erreur), on retient l'information et on renvoie
   sans : l'information n'est alors simplement pas gardée, le reste fonctionne. */
const colonnesOptionnelles = { echeance: true, couleur: true, recurrence: true };
type ColonneOptionnelle = keyof typeof colonnesOptionnelles;

export function echeanceDisponible(): boolean {
  return colonnesOptionnelles.echeance;
}
export function couleurDisponible(): boolean {
  return colonnesOptionnelles.couleur;
}
export function recurrenceDisponible(): boolean {
  return colonnesOptionnelles.recurrence;
}

function versLigne(d: DonneesTache) {
  const ligne: Record<string, unknown> = {
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
  if (colonnesOptionnelles.echeance) ligne.echeance = d.echeance || null;
  if (colonnesOptionnelles.couleur) ligne.couleur = d.couleur;
  if (colonnesOptionnelles.recurrence) ligne.recurrence = d.date ? d.recurrence : null;
  return ligne;
}

/* Exécute une requête ; si elle échoue à cause d'une colonne optionnelle absente,
   la désactive et rejoue. Boucle car plusieurs colonnes peuvent manquer (une reprise par colonne). */
async function avecRepli<T>(requete: () => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  let { data, error } = await requete();
  for (;;) {
    const manquante = (Object.keys(colonnesOptionnelles) as ColonneOptionnelle[])
      .find((c) => colonnesOptionnelles[c] && error?.message.includes(c));
    if (!error || !manquante) break;
    colonnesOptionnelles[manquante] = false;
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

/* Répétition : cocher une occurrence, en supprimer une, arrêter la série… ne changent
   QUE la règle (colonne recurrence) de la tâche « mère ». */
export async function changerRecurrence(id: string, recurrence: Recurrence): Promise<Tache> {
  if (!colonnesOptionnelles.recurrence) throw new Error("La répétition n'est pas encore activée dans la base (supabase/migration-recurrence.sql).");
  const { data, error } = await supabase().from(TABLE).update({ recurrence }).eq("id", id).select().single();
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

/* ---------- Idées de projets (tables projets_idees et idees) ----------
   Même principe que les tâches : les règles RLS ne renvoient que les lignes de
   l'utilisateur connecté, et user_id est rempli par la base (default auth.uid()). */

interface LigneProjet { id: string; titre: string; cree_le: string }
interface LigneIdee { id: string; projet_id: string; texte: string; faite: boolean; cree_le: string }

const versProjet = (l: LigneProjet): ProjetIdees => ({ id: l.id, titre: l.titre, creeLe: l.cree_le });
const versIdee = (l: LigneIdee): Idee => ({ id: l.id, projetId: l.projet_id, texte: l.texte, faite: l.faite, creeLe: l.cree_le });

export async function listerProjetsEtIdees(): Promise<{ projets: ProjetIdees[]; idees: Idee[] }> {
  // Deux requêtes lancées en même temps (Promise.all) plutôt que l'une après l'autre.
  const [p, i] = await Promise.all([
    supabase().from("projets_idees").select("id, titre, cree_le").order("cree_le"),
    supabase().from("idees").select("id, projet_id, texte, faite, cree_le").order("cree_le"),
  ]);
  verifier(p.error);
  verifier(i.error);
  return { projets: (p.data as LigneProjet[]).map(versProjet), idees: (i.data as LigneIdee[]).map(versIdee) };
}

export async function insererProjet(titre: string): Promise<ProjetIdees> {
  const { data, error } = await supabase().from("projets_idees").insert({ titre }).select().single();
  verifier(error);
  return versProjet(data as LigneProjet);
}

export async function renommerProjet(id: string, titre: string): Promise<void> {
  const { error } = await supabase().from("projets_idees").update({ titre }).eq("id", id);
  verifier(error);
}

// Les idées du projet sont supprimées avec lui par la base (on delete cascade).
export async function supprimerProjet(id: string): Promise<void> {
  const { error } = await supabase().from("projets_idees").delete().eq("id", id);
  verifier(error);
}

export async function insererIdee(projetId: string, texte: string): Promise<Idee> {
  const { data, error } = await supabase().from("idees").insert({ projet_id: projetId, texte }).select().single();
  verifier(error);
  return versIdee(data as LigneIdee);
}

export async function modifierIdee(id: string, champs: { texte?: string; faite?: boolean }): Promise<void> {
  const { error } = await supabase().from("idees").update(champs).eq("id", id);
  verifier(error);
}

export async function supprimerIdee(id: string): Promise<void> {
  const { error } = await supabase().from("idees").delete().eq("id", id);
  verifier(error);
}
