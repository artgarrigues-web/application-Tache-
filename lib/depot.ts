/* "Dépôt" (repository) : la SEULE partie du code qui parle à la base de données.
   Le reste de l'application manipule des objets Tache et ignore tout de Supabase.
   Avantage : si on change de base un jour, on ne réécrit que ce fichier.

   Conventions différentes des deux côtés, d'où les fonctions de conversion :
   - base de données (SQL) : snake_case (cree_le), heure de type "time" ("14:00:00") ou null ;
   - application (TypeScript) : camelCase (creeLe, dureeMinutes), heure "14:00" ou "".  */

import { supabase } from "./supabase";
import { estCouleur } from "./types";
import { validerRecurrence } from "./recurrence";
import { validerCles, validerEtapes } from "./etapes";
import type { Categorie, Couleur, DonneesTache, Groupe, Idee, Priorite, ProjetIdees, Recurrence, Tache } from "./types";

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
  projet_id?: string | null; // absente si supabase/migration-projet-agenda.sql n'a pas été appliquée
  rappel_minutes?: number | null; // absentes si supabase/migration-rappels-corbeille-agendas.sql
  supprimee_le?: string | null;   // n'a pas encore été appliquée
  etapes?: unknown;          // jsonb, absentes si supabase/migration-etapes.sql
  materiel_pris?: unknown;   // n'a pas encore été appliquée
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
    projetId: l.projet_id ?? null,
    rappelMinutes: l.rappel_minutes ?? null,
    etapes: validerEtapes(l.etapes),
    materielPris: validerCles(l.materiel_pris),
    faite: l.faite,
    creeLe: l.cree_le,
    ...(l.supprimee_le ? { supprimeeLe: l.supprimee_le } : {}),
  };
}

/* Colonnes ajoutées après coup (migrations SQL à coller dans Supabase) :
   - "echeance" le 21/11/2026 (supabase/migration-planification.sql) ;
   - "couleur"  le 24/11/2026 (supabase/migration-couleur.sql) ;
   - "recurrence" le 24/11/2026 (supabase/migration-recurrence.sql) ;
   - "projet_id" le 25/11/2026 (supabase/migration-projet-agenda.sql) ;
   - "rappel_minutes" et "supprimee_le" le 26/11/2026 (supabase/migration-rappels-corbeille-agendas.sql) ;
   - "etapes" et "materiel_pris" le 26/11/2026 (supabase/migration-etapes.sql).
   Tant qu'une migration n'a pas été collée, envoyer la colonne ferait échouer TOUTES
   les sauvegardes. On essaie donc avec ; si la base répond que la colonne n'existe pas
   (son nom figure dans le message d'erreur), on retient l'information et on renvoie
   sans : l'information n'est alors simplement pas gardée, le reste fonctionne. */
const colonnesOptionnelles = { echeance: true, couleur: true, recurrence: true, projet_id: true, rappel_minutes: true, supprimee_le: true, etapes: true, materiel_pris: true };
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
export function rappelsDisponibles(): boolean {
  return colonnesOptionnelles.rappel_minutes;
}
export function corbeilleDisponible(): boolean {
  return colonnesOptionnelles.supprimee_le;
}
export function etapesDisponibles(): boolean {
  return colonnesOptionnelles.etapes;
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
  if (colonnesOptionnelles.projet_id) ligne.projet_id = d.projetId;
  if (colonnesOptionnelles.rappel_minutes) ligne.rappel_minutes = d.date ? d.rappelMinutes : null;
  /* Tâche répétée : on enregistre la LISTE des étapes, jamais leur état (décochées) ; ce qui
     est coché chaque jour est dans recurrence.cases (voir lib/etapes.ts). */
  const serie = Boolean(d.date && d.recurrence);
  if (colonnesOptionnelles.etapes) ligne.etapes = (d.etapes ?? []).map((e) => ({ id: e.id, texte: e.texte, faite: serie ? false : e.faite }));
  if (colonnesOptionnelles.materiel_pris) ligne.materiel_pris = serie ? [] : d.materielPris ?? [];
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
  // Les tâches de la corbeille (supprimee_le rempli) sont écartées.
  const data = await avecRepli(() => {
    const q = supabase().from(TABLE).select("*");
    return (colonnesOptionnelles.supprimee_le ? q.is("supprimee_le", null) : q).order("date");
  });
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

/* Cocher une étape ou un élément du matériel d'une tâche unique : seules ces deux colonnes changent. */
export async function changerCases(id: string, c: { etapes: Tache["etapes"]; materielPris: string[] }): Promise<void> {
  if (!colonnesOptionnelles.etapes) throw new Error("Les étapes ne sont pas encore activées dans la base (supabase/migration-etapes.sql).");
  const { error } = await supabase().from(TABLE).update({ etapes: c.etapes ?? [], materiel_pris: c.materielPris }).eq("id", id);
  verifier(error);
}

export async function changerEtat(id: string, faite: boolean): Promise<void> {
  const { error } = await supabase().from(TABLE).update({ faite }).eq("id", id);
  verifier(error);
}

// Effacement DÉFINITIF (sans corbeille) : sert à annuler une création, et à vider la corbeille.
export async function supprimerTache(id: string): Promise<void> {
  const { error } = await supabase().from(TABLE).delete().eq("id", id);
  verifier(error);
}

/* ---------- Corbeille ----------
   « Supprimer » une tâche la met à la corbeille : on note la date dans supprimee_le.
   Elle disparaît de l'agenda et du calendrier synchronisé, mais reste récupérable
   30 jours ; ensuite la base l'efface toute seule (tâche planifiée chaque nuit).
   Tant que la colonne n'existe pas (migration non appliquée), on efface pour de vrai. */
export const JOURS_CORBEILLE = 30;

export async function mettreALaCorbeille(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  if (colonnesOptionnelles.supprimee_le) {
    const { error } = await supabase().from(TABLE).update({ supprimee_le: new Date().toISOString() }).in("id", ids);
    if (!error) return true;
    if (!error.message.includes("supprimee_le")) throw new Error(error.message);
    colonnesOptionnelles.supprimee_le = false;
  }
  const { error } = await supabase().from(TABLE).delete().in("id", ids);
  verifier(error);
  return false; // effacée définitivement (pas de corbeille disponible)
}

export async function listerCorbeille(): Promise<Tache[]> {
  if (!colonnesOptionnelles.supprimee_le) return [];
  const { data, error } = await supabase().from(TABLE).select("*").not("supprimee_le", "is", null).order("supprimee_le", { ascending: false });
  if (error?.message.includes("supprimee_le")) { colonnesOptionnelles.supprimee_le = false; return []; }
  verifier(error);
  return (data as Ligne[]).map(depuisLigne);
}

export async function restaurer(ids: string[]): Promise<Tache[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase().from(TABLE).update({ supprimee_le: null }).in("id", ids).select();
  verifier(error);
  return (data as Ligne[]).map(depuisLigne);
}

export async function supprimerDefinitivement(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase().from(TABLE).delete().in("id", ids);
  verifier(error);
}

// « Effacer les tâches terminées » : elles partent aussi à la corbeille (renvoie leurs ids).
export async function supprimerTerminees(ids: string[]): Promise<boolean> {
  return mettreALaCorbeille(ids);
}

/* ---------- Réglages des rappels (table reglages_rappels, une ligne par compte) ---------- */
export interface ReglagesRappels { rappelDefaut: number | null; resumeMatin: string } // resumeMatin "HH:MM" ou ""

export async function lireReglagesRappels(): Promise<ReglagesRappels | null> {
  const { data, error } = await supabase().from("reglages_rappels").select("rappel_defaut, resume_matin").maybeSingle();
  if (error) return null; // table absente : réglages par défaut
  const l = data as { rappel_defaut: number | null; resume_matin: string | null } | null;
  return { rappelDefaut: l?.rappel_defaut ?? null, resumeMatin: l?.resume_matin ? l.resume_matin.slice(0, 5) : "" };
}

export async function enregistrerReglagesRappels(r: ReglagesRappels): Promise<void> {
  const { error } = await supabase().from("reglages_rappels").upsert(
    { rappel_defaut: r.rappelDefaut, resume_matin: r.resumeMatin || null, modifie_le: new Date().toISOString() },
    { onConflict: "user_id" });
  verifier(error);
}

/* ---------- Appareils qui reçoivent les notifications (table abonnements_push) ---------- */
export async function enregistrerAbonnement(a: { endpoint: string; p256dh: string; auth: string; appareil: string }): Promise<void> {
  const { error } = await supabase().rpc("enregistrer_abonnement_push",
    { p_endpoint: a.endpoint, p_p256dh: a.p256dh, p_auth: a.auth, p_appareil: a.appareil });
  verifier(error);
}

export async function retirerAbonnement(endpoint: string): Promise<void> {
  const { error } = await supabase().from("abonnements_push").delete().eq("endpoint", endpoint);
  verifier(error);
}

export async function compterAppareils(): Promise<number> {
  const { count, error } = await supabase().from("abonnements_push").select("id", { count: "exact", head: true });
  verifier(error);
  return count ?? 0;
}

/* ---------- Agendas externes (table agendas_externes) ---------- */
export interface AgendaExterne { id: string; nom: string; url: string; couleur: Couleur | null }

export async function listerAgendas(): Promise<AgendaExterne[]> {
  const { data, error } = await supabase().from("agendas_externes").select("id, nom, url, couleur").order("cree_le");
  verifier(error);
  return (data as { id: string; nom: string; url: string; couleur: string | null }[])
    .map((l) => ({ ...l, couleur: estCouleur(l.couleur) ? l.couleur : null }));
}

export async function ajouterAgenda(a: Omit<AgendaExterne, "id">): Promise<AgendaExterne> {
  const { data, error } = await supabase().from("agendas_externes").insert(a).select("id, nom, url, couleur").single();
  verifier(error);
  const l = data as AgendaExterne;
  return { ...l, couleur: estCouleur(l.couleur) ? l.couleur : null };
}

export async function modifierAgenda(id: string, champs: Partial<Omit<AgendaExterne, "id">>): Promise<void> {
  const { error } = await supabase().from("agendas_externes").update(champs).eq("id", id);
  verifier(error);
}

export async function retirerAgenda(id: string): Promise<void> {
  const { error } = await supabase().from("agendas_externes").delete().eq("id", id);
  verifier(error);
}

/* ---------- Projets de la Checklist (tables projets_idees et idees) ----------
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
