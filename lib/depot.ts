/* "Dépôt" (repository) : la SEULE partie du code qui parle à la base de données.
   Le reste de l'application manipule des objets Tache et ignore tout de Supabase.
   Avantage : si on change de base un jour, on ne réécrit que ce fichier.

   Conventions différentes des deux côtés, d'où les fonctions de conversion :
   - base de données (SQL) : snake_case (cree_le), heure de type "time" ("14:00:00") ou null ;
   - application (TypeScript) : camelCase (creeLe, dureeMinutes), heure "14:00" ou "".  */

import { supabase } from "./supabase";
import * as hl from "./hors-ligne";
import type { Ligne as LigneBrute, Table, Valeurs } from "./file-attente";
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

/* Supabase renvoie { data, error } au lieu de lancer une exception : on la lance nous-mêmes.
   Quand la requête n'a pas pu partir (pas de réseau, délai dépassé), le message commence par
   le nom de l'erreur du navigateur (« FetchError: », « TypeError: Failed to fetch »…) :
   on lance alors une ErreurReseau, que le mode hors connexion sait traiter. */
function verifier(error: { message: string } | null) {
  if (!error) return;
  if (/^(FetchError|TypeError|AbortError|TimeoutError)\b/.test(error.message)) throw new hl.ErreurReseau();
  throw new Error(error.message);
}

/* ---------- Hors connexion : envoi et lecture d'UNE ligne ----------
   Toutes les écritures des tâches, projets et idées passent par hl.ecrire() (lib/hors-ligne.ts) :
   avec du réseau, elle appelle tout de suite envoyer() ci-dessous ; sans réseau, elle range le
   changement dans la file d'attente et le rejouera plus tard avec cette même fonction. */
function sansColonnesAbsentes(table: Table, v: Valeurs | undefined): Valeurs {
  const o = { ...(v ?? {}) };
  if (table === TABLE) for (const c of Object.keys(colonnesOptionnelles) as ColonneOptionnelle[]) if (!colonnesOptionnelles[c]) delete o[c];
  return o;
}

async function envoyer(table: Table, type: "inserer" | "modifier" | "supprimer", id: string, valeurs?: Valeurs): Promise<LigneBrute | null> {
  if (type === "supprimer") {
    const { error } = await supabase().from(table).delete().eq("id", id);
    verifier(error);
    return null;
  }
  if (type === "inserer") {
    // upsert + ignoreDuplicates : si la ligne existe déjà (envoi rejoué après une coupure), on ne fait rien.
    const data = await avecRepli(() => supabase().from(table)
      .upsert(sansColonnesAbsentes(table, valeurs), { onConflict: "id", ignoreDuplicates: true }).select().maybeSingle());
    return (data as LigneBrute | null) ?? null;
  }
  if (Object.keys(sansColonnesAbsentes(table, valeurs)).length === 0) return hl.ligne(table, id) ?? null;
  const data = await avecRepli(() => supabase().from(table).update(sansColonnesAbsentes(table, valeurs)).eq("id", id).select().maybeSingle());
  return (data as LigneBrute | null) ?? null;
}

async function lireLigne(table: Table, id: string): Promise<LigneBrute | null> {
  const { data, error } = await supabase().from(table).select("*").eq("id", id).maybeSingle();
  verifier(error);
  return (data as LigneBrute | null) ?? null;
}

hl.brancher({ envoyer, lire: lireLigne });

// Écrit une tâche et la renvoie au format de l'application.
async function ecrireTache(type: "inserer" | "modifier", id: string, valeurs: Valeurs): Promise<Tache> {
  const l = await hl.ecrire(TABLE, type, id, valeurs);
  if (!l) throw new Error("Cette tâche n'existe plus (supprimée sur un autre appareil ?).");
  return depuisLigne(l as unknown as Ligne);
}

/* Lecture avec repli : si le réseau manque, on renvoie la dernière réponse gardée sur l'appareil. */
async function lireAvecCopie<T>(nom: string, lire: () => Promise<T>): Promise<T> {
  if (!hl.reseauCoupe()) {
    try {
      const v = await lire();
      hl.memoriserLecture(nom, v);
      return v;
    } catch (e) {
      if (!(e instanceof hl.ErreurReseau)) throw e;
      hl.signalerCoupure();
    }
  }
  const copie = hl.relireLecture<T>(nom);
  if (copie === null) throw new hl.ErreurReseau();
  return copie;
}

// Tâches gardées sur l'appareil, sans attendre le réseau (premier affichage instantané).
export function tachesEnCopie(): Tache[] {
  return trierParDate(hl.lignes(TABLE).filter((l) => !l.supprimee_le)).map((l) => depuisLigne(l as unknown as Ligne));
}
function trierParDate(l: LigneBrute[]): LigneBrute[] {
  // Même ordre que la base (order("date")) : par date, les tâches sans date à la fin.
  return [...l].sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999")));
}

export async function listerTaches(): Promise<Tache[]> {
  if (hl.reseauCoupe()) return tachesEnCopie();
  try {
    // Pas besoin de filtrer par utilisateur : les règles RLS ne renvoient que ses lignes.
    // Les tâches de la corbeille (supprimee_le rempli) sont écartées.
    const data = await avecRepli(() => {
      const q = supabase().from(TABLE).select("*");
      return (colonnesOptionnelles.supprimee_le ? q.is("supprimee_le", null) : q).order("date");
    });
    // On garde aussi les tâches mises à la corbeille depuis moins de 2 jours (pour « Annuler » hors connexion).
    const recent = Date.now() - 2 * 86_400_000;
    hl.remplacer(TABLE, data as LigneBrute[], (l) => typeof l.supprimee_le === "string" && Date.parse(l.supprimee_le) > recent);
  } catch (e) {
    if (!(e instanceof hl.ErreurReseau)) throw e;
    hl.signalerCoupure();
  }
  return tachesEnCopie();
}

export async function insererTache(d: DonneesTache): Promise<Tache> {
  const id = hl.nouvelId();
  return ecrireTache("inserer", id, { ...versLigne(d), id });
}

export async function insererPlusieurs(taches: Tache[]): Promise<Tache[]> {
  return Promise.all(taches.map((t) => {
    const id = hl.nouvelId();
    return ecrireTache("inserer", id, { ...versLigne(t), faite: t.faite, id });
  }));
}

export async function modifierTache(id: string, d: DonneesTache): Promise<Tache> {
  return ecrireTache("modifier", id, versLigne(d));
}

/* Planification automatique : ne change QUE la date et l'heure (rien d'autre n'est touché,
   ce qui rend l'annulation sûre). Les mises à jour partent en parallèle (Promise.all). */
export interface ChangementHoraire { id: string; date: string; heure: string }

export async function changerHoraires(changements: ChangementHoraire[]): Promise<Tache[]> {
  return Promise.all(changements.map((c) => ecrireTache("modifier", c.id, { date: c.date || null, heure: c.heure || null })));
}

/* ---------- Plages de disponibilité (table disponibilites, une ligne par utilisateur) ---------- */

export async function lirePlages(): Promise<unknown | null> {
  return lireAvecCopie("plages", async () => {
    const { data, error } = await supabase().from("disponibilites").select("plages").maybeSingle();
    verifier(error);
    return data ? (data as { plages: unknown }).plages : null;
  });
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
  return ecrireTache("modifier", id, { recurrence });
}

/* Cocher une étape ou un élément du matériel d'une tâche unique : seules ces deux colonnes changent. */
export async function changerCases(id: string, c: { etapes: Tache["etapes"]; materielPris: string[] }): Promise<void> {
  if (!colonnesOptionnelles.etapes) throw new Error("Les étapes ne sont pas encore activées dans la base (supabase/migration-etapes.sql).");
  await hl.ecrire(TABLE, "modifier", id, { etapes: c.etapes ?? [], materiel_pris: c.materielPris });
}

export async function changerEtat(id: string, faite: boolean): Promise<void> {
  await hl.ecrire(TABLE, "modifier", id, { faite });
}

// Effacement DÉFINITIF (sans corbeille) : sert à annuler une création, et à vider la corbeille.
export async function supprimerTache(id: string): Promise<void> {
  await hl.ecrire(TABLE, "supprimer", id);
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
    const quand = new Date().toISOString();
    await Promise.all(ids.map((id) => hl.ecrire(TABLE, "modifier", id, { supprimee_le: quand })));
    if (colonnesOptionnelles.supprimee_le) return true;
    // La base vient de répondre que la colonne n'existe pas : on efface pour de bon.
  }
  await Promise.all(ids.map((id) => hl.ecrire(TABLE, "supprimer", id)));
  return false; // effacée définitivement (pas de corbeille disponible)
}

export async function listerCorbeille(): Promise<Tache[]> {
  if (!colonnesOptionnelles.supprimee_le) return [];
  const enCopie = () => hl.lignes(TABLE).filter((l) => l.supprimee_le)
    .sort((a, b) => String(b.supprimee_le).localeCompare(String(a.supprimee_le))).map((l) => depuisLigne(l as unknown as Ligne));
  if (hl.reseauCoupe()) return enCopie(); // hors connexion : seulement ce qui a été supprimé récemment sur cet appareil
  const { data, error } = await supabase().from(TABLE).select("*").not("supprimee_le", "is", null).order("supprimee_le", { ascending: false });
  if (error?.message.includes("supprimee_le")) { colonnesOptionnelles.supprimee_le = false; return []; }
  try { verifier(error); } catch (e) { if (e instanceof hl.ErreurReseau) { hl.signalerCoupure(); return enCopie(); } throw e; }
  for (const l of data as LigneBrute[]) hl.memoriserLigne(TABLE, l); // pour pouvoir la restaurer (même hors connexion ensuite)
  return (data as Ligne[]).map(depuisLigne);
}

export async function restaurer(ids: string[]): Promise<Tache[]> {
  return Promise.all(ids.map((id) => ecrireTache("modifier", id, { supprimee_le: null })));
}

export async function supprimerDefinitivement(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => hl.ecrire(TABLE, "supprimer", id)));
}

// « Effacer les tâches terminées » : elles partent aussi à la corbeille (renvoie leurs ids).
export async function supprimerTerminees(ids: string[]): Promise<boolean> {
  return mettreALaCorbeille(ids);
}

/* ---------- Réglages des rappels (table reglages_rappels, une ligne par compte) ---------- */
export interface ReglagesRappels { rappelDefaut: number | null; resumeMatin: string } // resumeMatin "HH:MM" ou ""

export async function lireReglagesRappels(): Promise<ReglagesRappels | null> {
  try {
    return await lireAvecCopie("reglages-rappels", async () => {
      const { data, error } = await supabase().from("reglages_rappels").select("rappel_defaut, resume_matin").maybeSingle();
      if (error) { verifier(error); }
      const l = data as { rappel_defaut: number | null; resume_matin: string | null } | null;
      return { rappelDefaut: l?.rappel_defaut ?? null, resumeMatin: l?.resume_matin ? l.resume_matin.slice(0, 5) : "" };
    });
  } catch {
    return null; // table absente ou pas de réseau : réglages par défaut
  }
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
  return lireAvecCopie("agendas", async () => {
    const { data, error } = await supabase().from("agendas_externes").select("id, nom, url, couleur").order("cree_le");
    verifier(error);
    return (data as { id: string; nom: string; url: string; couleur: string | null }[])
      .map((l) => ({ ...l, couleur: estCouleur(l.couleur) ? l.couleur : null }));
  });
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

export function projetsEtIdeesEnCopie(): { projets: ProjetIdees[]; idees: Idee[] } {
  const parCreation = (a: LigneBrute, b: LigneBrute) => String(a.cree_le).localeCompare(String(b.cree_le));
  return {
    projets: hl.lignes("projets_idees").sort(parCreation).map((l) => versProjet(l as unknown as LigneProjet)),
    idees: hl.lignes("idees").sort(parCreation).map((l) => versIdee(l as unknown as LigneIdee)),
  };
}

export async function listerProjetsEtIdees(): Promise<{ projets: ProjetIdees[]; idees: Idee[] }> {
  if (hl.reseauCoupe()) return projetsEtIdeesEnCopie();
  try {
    // Deux requêtes lancées en même temps (Promise.all) plutôt que l'une après l'autre.
    const [p, i] = await Promise.all([
      supabase().from("projets_idees").select("id, titre, cree_le").order("cree_le"),
      supabase().from("idees").select("id, projet_id, texte, faite, cree_le").order("cree_le"),
    ]);
    verifier(p.error);
    verifier(i.error);
    hl.remplacer("projets_idees", p.data as LigneBrute[]);
    hl.remplacer("idees", i.data as LigneBrute[]);
  } catch (e) {
    if (!(e instanceof hl.ErreurReseau)) throw e;
    hl.signalerCoupure();
  }
  return projetsEtIdeesEnCopie();
}

export async function insererProjet(titre: string): Promise<ProjetIdees> {
  const id = hl.nouvelId();
  const l = await hl.ecrire("projets_idees", "inserer", id, { id, titre });
  return versProjet((l ?? { id, titre, cree_le: new Date().toISOString() }) as unknown as LigneProjet);
}

export async function renommerProjet(id: string, titre: string): Promise<void> {
  await hl.ecrire("projets_idees", "modifier", id, { titre });
}

// En base, les idées du projet sont supprimées avec lui (on delete cascade) ; sur l'appareil,
// on les retire nous-mêmes (et une idée créée hors connexion n'est jamais envoyée).
export async function supprimerProjet(id: string): Promise<void> {
  for (const i of hl.lignes("idees").filter((l) => l.projet_id === id)) {
    if (hl.horsLigne() || hl.nombreEnAttente() > 0) await hl.ecrire("idees", "supprimer", i.id);
    else hl.memoriserLigne("idees", null, i.id);
  }
  await hl.ecrire("projets_idees", "supprimer", id);
}

export async function insererIdee(projetId: string, texte: string): Promise<Idee> {
  const id = hl.nouvelId();
  const l = await hl.ecrire("idees", "inserer", id, { id, projet_id: projetId, texte });
  return versIdee((l ?? { id, projet_id: projetId, texte, faite: false, cree_le: new Date().toISOString() }) as unknown as LigneIdee);
}

export async function modifierIdee(id: string, champs: { texte?: string; faite?: boolean }): Promise<void> {
  await hl.ecrire("idees", "modifier", id, champs);
}

export async function supprimerIdee(id: string): Promise<void> {
  await hl.ecrire("idees", "supprimer", id);
}
