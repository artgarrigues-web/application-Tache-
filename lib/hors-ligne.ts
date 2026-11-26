/* Mode HORS CONNEXION, côté navigateur (le « moteur » ; la logique pure est dans file-attente.ts).

   Ce fichier garde sur l'appareil, dans le localStorage, pour l'utilisateur connecté :
   - une COPIE des lignes (tâches, projets, idées) telles qu'on les a lues la dernière fois,
     mise à jour à chaque écriture : c'est elle qu'on affiche sans réseau ;
   - la FILE des changements pas encore envoyés ;
   - les AVIS à montrer (conflits, changements refusés par la base).

   Il expose aussi un petit « état » (en ligne ? combien en attente ? envoi en cours ?) que
   l'interface écoute (hooks/useHorsLigne.ts) pour afficher le bandeau.

   Pour éviter une dépendance circulaire avec depot.ts, ce module ne parle pas lui-même à
   Supabase : depot.ts lui « branche » deux fonctions (envoyer une opération, lire une ligne). */

import { appliquer, enfiler, resoudre, type Ligne, type Operation, type Table, type Valeurs } from "./file-attente";

/* Erreur « réseau » : la requête n'a pas pu partir ou n'a pas eu de réponse (pas de réseau,
   délai dépassé). Toute autre erreur (règle de la base, champ invalide…) est un REFUS. */
export class ErreurReseau extends Error {
  constructor() { super("Pas de connexion : cette action a besoin du réseau. Réessaie quand tu seras connecté."); }
}

export interface Avis {
  cle: string;
  titre: string;      // titre de la tâche (ou texte de l'idée) concernée
  texte: string;      // explication en une phrase
  quand: string;
}

export interface EtatHorsLigne {
  enLigne: boolean;
  enAttente: number;        // nombre de changements pas encore envoyés
  envoiEnCours: boolean;
  derniereSynchro: string | null; // dernière lecture réussie depuis la base (ISO)
  avis: Avis[];
  envoyesRecemment: number; // nombre de changements envoyés lors du dernier envoi (pour « ✓ envoyés »)
}

type Envoyer = (table: Table, type: Operation["type"], id: string, valeurs?: Valeurs) => Promise<Ligne | null>;
type LireLigne = (table: Table, id: string) => Promise<Ligne | null>;

const TABLES: Table[] = ["taches", "projets_idees", "idees"];
const DELAI_REESSAI_MS = 30_000;

let utilisateur: string | null = null;
let branchement: { envoyer: Envoyer; lire: LireLigne } | null = null;
let cache: Record<Table, Map<string, Ligne>> = { taches: new Map(), projets_idees: new Map(), idees: new Map() };
let etat: EtatHorsLigne = { enLigne: true, enAttente: 0, envoiEnCours: false, derniereSynchro: null, avis: [], envoyesRecemment: 0 };
const ecouteurs = new Set<() => void>();
let ecoutesPosees = false;
let minuteur: ReturnType<typeof setTimeout> | null = null;

/* ---------- Stockage dans le navigateur ----------
   Clés propres à chaque compte : deux personnes qui se connectent sur le même ordinateur
   ne voient pas les données l'une de l'autre. Toute lecture/écriture est protégée par
   try/catch (navigation privée, stockage plein ou bloqué). */
const cleCache = () => `agendia-hors-ligne-${utilisateur}`;
const cleFile = () => `agendia-file-attente-${utilisateur}`;
const cleAvis = () => `agendia-avis-${utilisateur}`;
const cleLecture = (nom: string) => `agendia-lecture-${utilisateur}-${nom}`;

function lireJSON<T>(cle: string, defaut: T): T {
  try {
    const brut = localStorage.getItem(cle);
    return brut ? (JSON.parse(brut) as T) : defaut;
  } catch { return defaut; }
}
function ecrireJSON(cle: string, valeur: unknown) {
  try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou bloqué */ }
}

// La file est TOUJOURS relue juste avant d'être changée : un 2e onglet ouvert a pu y ajouter des opérations.
const lireFile = (): Operation[] => (utilisateur ? lireJSON<Operation[]>(cleFile(), []) : []);
function ecrireFile(file: Operation[]) {
  ecrireJSON(cleFile(), file);
  changerEtat({ enAttente: file.length });
}

let sauvegardePrevue = false;
function sauverCache() {
  if (sauvegardePrevue || !utilisateur) return;
  sauvegardePrevue = true;
  // Regroupe les sauvegardes d'une même série de changements (une seule écriture).
  setTimeout(() => {
    sauvegardePrevue = false;
    if (!utilisateur) return;
    const objet: Record<string, Ligne[]> = {};
    for (const t of TABLES) objet[t] = [...cache[t].values()];
    ecrireJSON(cleCache(), { lignes: objet, synchro: etat.derniereSynchro });
  }, 50);
}

function changerEtat(maj: Partial<EtatHorsLigne>) {
  etat = { ...etat, ...maj };
  for (const f of ecouteurs) f();
}

/* ---------- Ce que l'interface utilise ---------- */
export function abonner(f: () => void): () => void {
  ecouteurs.add(f);
  return () => { ecouteurs.delete(f); };
}
export const lireEtat = (): EtatHorsLigne => etat;

export function retirerAvis(cle?: string) {
  const avis = cle ? etat.avis.filter((a) => a.cle !== cle) : [];
  ecrireJSON(cleAvis(), avis);
  changerEtat({ avis });
}

// Vrai quand on sait qu'il ne sert à rien d'essayer le réseau.
export function horsLigne(): boolean {
  return (typeof navigator !== "undefined" && navigator.onLine === false) || !etat.enLigne;
}

// Une lecture vient d'échouer faute de réseau : on passe en mode hors connexion et on réessaiera.
// Pour les LECTURES : on tente le réseau dès que le navigateur dit en avoir un.
export function reseauCoupe(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function signalerCoupure() {
  changerEtat({ enLigne: false });
  planifierEnvoi(DELAI_REESSAI_MS);
}

export function brancher(f: { envoyer: Envoyer; lire: LireLigne }) { branchement = f; }

/* Appelé à la connexion d'un compte : recharge sa copie locale et sa file. */
export function initialiser(userId: string) {
  if (utilisateur === userId) return;
  utilisateur = userId;
  const enregistre = lireJSON<{ lignes?: Partial<Record<Table, Ligne[]>>; synchro?: string | null }>(cleCache(), {});
  cache = { taches: new Map(), projets_idees: new Map(), idees: new Map() };
  for (const t of TABLES) for (const l of enregistre.lignes?.[t] ?? []) cache[t].set(l.id, l);
  changerEtat({
    enLigne: typeof navigator === "undefined" || navigator.onLine !== false,
    enAttente: lireFile().length,
    derniereSynchro: enregistre.synchro ?? null,
    avis: lireJSON<Avis[]>(cleAvis(), []),
  });
  if (typeof window !== "undefined" && !ecoutesPosees) {
    ecoutesPosees = true;
    window.addEventListener("online", auRetourReseau);
    window.addEventListener("offline", () => changerEtat({ enLigne: false }));
    // Un autre onglet a changé la file : on met le compteur à jour.
    window.addEventListener("storage", (e) => { if (e.key === cleFile()) changerEtat({ enAttente: lireFile().length }); });
  }
  planifierEnvoi(0);
}

/* À la déconnexion : on efface la copie locale (ordinateur partagé, salle info…). */
export function oublier() {
  if (!utilisateur) return;
  for (const cle of [cleCache(), cleFile(), cleAvis()]) { try { localStorage.removeItem(cle); } catch { /* rien */ } }
  try {
    const prefixe = `agendia-lecture-${utilisateur}-`;
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k?.startsWith(prefixe)) localStorage.removeItem(k); }
  } catch { /* rien */ }
  utilisateur = null;
  cache = { taches: new Map(), projets_idees: new Map(), idees: new Map() };
  changerEtat({ enAttente: 0, avis: [], derniereSynchro: null });
}

export const nombreEnAttente = () => lireFile().length;

/* ---------- Copie locale des lignes ---------- */
export function lignes(table: Table): Ligne[] {
  return [...cache[table].values()];
}
export function ligne(table: Table, id: string): Ligne | undefined {
  return cache[table].get(id);
}
export function aDesDonnees(): boolean {
  return etat.derniereSynchro !== null;
}

/* Après une lecture réussie depuis la base : la copie locale devient cette lecture, PLUS les
   changements encore dans la file (sinon ils disparaîtraient de l'écran en attendant l'envoi).
   garder : lignes à conserver même si la lecture ne les contient pas (ex. tâches de la corbeille). */
export function remplacer(table: Table, depuisBase: Ligne[], garder?: (l: Ligne) => boolean) {
  const m = new Map(depuisBase.map((l) => [l.id, l]));
  if (garder) for (const l of cache[table].values()) if (!m.has(l.id) && garder(l)) m.set(l.id, l);
  const maintenant = new Date().toISOString();
  for (const op of lireFile()) if (op.table === table) appliquer(m, op, maintenant);
  cache[table] = m;
  changerEtat({ enLigne: true, derniereSynchro: maintenant });
  sauverCache();
  if (lireFile().length > 0) planifierEnvoi(0);
}

export function memoriserLigne(table: Table, l: Ligne | null, id?: string) {
  if (l) cache[table].set(l.id, l);
  else if (id) cache[table].delete(id);
  sauverCache();
}

/* Petites lectures annexes (plages de disponibilité, agendas branchés, événements…) :
   on garde la dernière réponse pour l'afficher hors connexion. */
export function memoriserLecture(nom: string, valeur: unknown) { if (utilisateur) ecrireJSON(cleLecture(nom), valeur); }
export function relireLecture<T>(nom: string): T | null { return utilisateur ? lireJSON<T | null>(cleLecture(nom), null) : null; }

/* ---------- Écrire (en ligne directement, sinon dans la file) ----------
   Renvoie la ligne telle qu'elle sera en base : celle renvoyée par la base si l'envoi a
   réussi tout de suite, sinon la prévision locale.
   Une erreur autre que réseau (refus de la base) est relancée, comme avant. */
export async function ecrire(table: Table, type: Operation["type"], id: string, valeurs?: Valeurs): Promise<Ligne | null> {
  if (!branchement) throw new Error("Mode hors connexion non initialisé.");
  // S'il reste des changements en attente, on passe derrière eux pour garder l'ordre.
  if (!horsLigne() && lireFile().length === 0) {
    try {
      const recu = await branchement.envoyer(table, type, id, valeurs);
      // Création déjà présente en base (rare) : la base ne renvoie rien, on garde notre version.
      const l = recu ?? (type === "inserer" ? { faite: false, cree_le: new Date().toISOString(), ...valeurs, id } : null);
      memoriserLigne(table, l, id);
      if (!etat.enLigne) changerEtat({ enLigne: true });
      return l;
    } catch (e) {
      if (!(e instanceof ErreurReseau)) throw e;
      changerEtat({ enLigne: false });
    }
  }
  const maintenant = new Date().toISOString();
  const avant = cache[table].get(id) ?? null;
  const op = { table, type, id, valeurs };
  ecrireFile(enfiler(lireFile(), op, avant, maintenant, nouvelId()));
  const m = cache[table];
  appliquer(m, { ...op, cle: "", quand: {} }, maintenant);
  sauverCache();
  planifierEnvoi(navigator.onLine === false ? DELAI_REESSAI_MS : 0);
  return type === "supprimer" ? null : m.get(id) ?? null;
}

export function nouvelId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Repli (très vieux navigateurs) : un UUID v4 construit à la main.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ---------- Envoi de la file ---------- */
function auRetourReseau() {
  changerEtat({ enLigne: true });
  if (lireFile().length > 0) planifierEnvoi(0);
  else window.dispatchEvent(new CustomEvent("agendia-synchro")); // les écrans relisent la base
}

export function planifierEnvoi(delai: number) {
  if (minuteur) clearTimeout(minuteur);
  minuteur = setTimeout(() => { minuteur = null; envoyerFile(); }, delai);
}

const NOMS_CHAMPS: Record<string, string> = {
  titre: "le titre", description: "la description", date: "la date", heure: "l'heure", duree_minutes: "la durée",
  lieu: "le lieu", echeance: "l'échéance", materiel: "le matériel", categorie: "la catégorie", priorite: "la priorité",
  groupe: "le groupe", couleur: "la couleur", recurrence: "la répétition", projet_id: "le projet", rappel_minutes: "le rappel",
  supprimee_le: "la corbeille", faite: "la case « faite »", etapes: "les étapes", materiel_pris: "le matériel coché", texte: "le texte",
};
function listeChamps(champs: string[]): string {
  const noms = [...new Set(champs.map((c) => NOMS_CHAMPS[c] ?? c))];
  return noms.length <= 1 ? noms.join("") : `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

function titreDe(op: Operation): string {
  const l = cache[op.table].get(op.id) ?? (op.valeurs as Ligne | undefined);
  const t = (l?.titre ?? l?.texte) as string | undefined;
  return t ? `« ${t} »` : op.table === "taches" ? "Une tâche" : op.table === "idees" ? "Une idée" : "Un projet";
}

function ajouterAvis(titre: string, texte: string) {
  const avis = [...lireJSON<Avis[]>(cleAvis(), []), { cle: nouvelId(), titre, texte, quand: new Date().toISOString() }].slice(-20);
  ecrireJSON(cleAvis(), avis);
  changerEtat({ avis });
}

/* Le « verrou » (Web Locks API) empêche deux onglets d'envoyer la même file en même temps.
   Navigateur sans verrou : on envoie quand même (les opérations sont prévues pour être rejouées). */
async function sousVerrou(f: () => Promise<void>) {
  const locks = (navigator as Navigator & { locks?: { request: (n: string, cb: () => Promise<void>) => Promise<void> } }).locks;
  if (locks) await locks.request(`agendia-envoi-${utilisateur}`, f);
  else await f();
}

let envoiActif: Promise<void> | null = null;

export function envoyerFile(): Promise<void> {
  if (envoiActif) return envoiActif;
  if (!utilisateur || !branchement) return Promise.resolve();
  if (navigator.onLine === false) { changerEtat({ enLigne: false }); return Promise.resolve(); }
  const b = branchement;
  if (lireFile().length === 0) {
    if (etat.enLigne) return Promise.resolve();
    // Rien à envoyer mais une requête a échoué tout à l'heure : petite lecture « test » pour
    // savoir si le réseau est revenu ; si oui, les écrans relisent la base.
    envoiActif = b.lire("taches", "00000000-0000-0000-0000-000000000000")
      .then(() => { changerEtat({ enLigne: true }); window.dispatchEvent(new CustomEvent("agendia-synchro")); })
      .catch(() => planifierEnvoi(DELAI_REESSAI_MS))
      .finally(() => { envoiActif = null; });
    return envoiActif;
  }
  envoiActif = (async () => {
    changerEtat({ envoiEnCours: true });
    let envoyes = 0;
    let coupure = false;
    try {
      await sousVerrou(async () => {
        for (;;) {
          const op = lireFile()[0];
          if (!op) break;
          try {
            await rejouer(op, b);
            envoyes++;
          } catch (e) {
            if (e instanceof ErreurReseau) { coupure = true; break; }
            // Refusé par la base : on l'abandonne (sinon il bloquerait toute la file) et on prévient.
            ajouterAvis(titreDe(op), `Ce changement fait hors connexion a été refusé par la base et n'a pas été gardé (${e instanceof Error ? e.message : String(e)}).`);
          }
          ecrireFile(lireFile().filter((o) => o.cle !== op.cle));
        }
      });
    } finally {
      envoiActif = null;
      changerEtat({ envoiEnCours: false, enLigne: !coupure, envoyesRecemment: coupure ? etat.envoyesRecemment : envoyes });
    }
    if (coupure) planifierEnvoi(DELAI_REESSAI_MS);
    else if (envoyes > 0 && typeof window !== "undefined") {
      // Tout est parti : les écrans relisent la base (ils récupèrent ainsi la version gagnante des conflits).
      window.dispatchEvent(new CustomEvent("agendia-synchro"));
    }
  })();
  return envoiActif;
}

async function rejouer(op: Operation, b: { envoyer: Envoyer; lire: LireLigne }) {
  if (op.type !== "modifier") {
    await b.envoyer(op.table, op.type, op.id, op.valeurs);
    return;
  }
  // Modification : on regarde d'abord la ligne en base pour repérer un changement fait ailleurs.
  const serveur = await b.lire(op.table, op.id);
  if (!serveur) {
    ajouterAvis(titreDe(op), "Elle avait été supprimée sur un autre appareil : la modification faite hors connexion n'a pas pu être appliquée.");
    memoriserLigne(op.table, null, op.id);
    return;
  }
  const r = resoudre(op, serveur, typeof serveur.modifie_le === "string" ? serveur.modifie_le : null);
  if (Object.keys(r.aEnvoyer).length > 0) {
    const l = await b.envoyer(op.table, "modifier", op.id, r.aEnvoyer);
    memoriserLigne(op.table, l ?? { ...serveur, ...r.aEnvoyer }, op.id);
  } else {
    memoriserLigne(op.table, serveur, op.id);
  }
  const gagneAutre = r.conflits.filter((c) => c.gagnant === "autre").map((c) => c.champ);
  const gagneMoi = r.conflits.filter((c) => c.gagnant === "moi").map((c) => c.champ);
  if (gagneAutre.length) {
    ajouterAvis(titreDe(op), `Modifiée aussi sur un autre appareil (${listeChamps(gagneAutre)}), et plus tard que ton changement hors connexion : c'est la version de l'autre appareil qui est gardée.`);
  }
  if (gagneMoi.length) {
    ajouterAvis(titreDe(op), `Modifiée aussi sur un autre appareil (${listeChamps(gagneMoi)}), mais ton changement hors connexion est plus récent : c'est lui qui est gardé.`);
  }
}
