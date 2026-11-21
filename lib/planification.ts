/* Planification automatique des tâches de la Checklist — SANS IA.

   Principe : un algorithme "glouton" (greedy) et déterministe. Même entrée →
   même sortie, à chaque fois, sans hasard ni service extérieur, donc gratuit
   et testable (voir tests/planification.test.ts).

   Étapes communes aux 3 stratégies :
     1. On découpe la semaine en "créneaux libres" : les plages de disponibilité
        réglées par l'utilisateur, MOINS les tâches déjà datées ET avec heure,
        MOINS le temps déjà écoulé (on ne planifie pas dans le passé).
     2. On prend les tâches à placer (non faites, sans date) ; durée = celle
        saisie, ou 1 h par défaut.
     3. Chaque stratégie choisit un ORDRE de traitement et une RÈGLE de choix
        du créneau ; chaque tâche "consomme" un morceau de créneau libre.

   Toutes les heures sont manipulées en MINUTES depuis minuit (ex. 14:30 → 870) :
   c'est bien plus simple à comparer et additionner que du texte "HH:MM".

   Ce fichier n'importe que des TYPES (effacés à la compilation) : il ne dépend
   de rien d'autre et peut être exécuté tel quel par Node pour les tests.       */

import type { Priorite, Tache } from "./types";

/* ---------- Types ---------- */

// Une plage de disponibilité hebdomadaire : jour 0 = lundi … 6 = dimanche.
export interface PlageDispo { jour: number; debut: string; fin: string }

export type IdStrategie = "echeances" | "lieu" | "equilibre";

export interface Placement {
  tacheId: string;
  titre: string;
  lieu: string;
  date: string;          // "AAAA-MM-JJ"
  heure: string;         // "HH:MM"
  dureeMinutes: number;  // durée utilisée pour le calcul (1 h si non renseignée)
  dureeParDefaut: boolean;
  apresEcheance: boolean; // vrai si aucun créneau ne tenait avant l'échéance
}

export interface NonPlace { tacheId: string; titre: string; raison: string }

export interface Planning {
  id: IdStrategie;
  nom: string;
  description: string;
  placements: Placement[];
  nonPlaces: NonPlace[];
  stats: {
    minutesPlacees: number;
    apresEcheance: number;      // nb de tâches placées après leur échéance
    changementsDeLieu: number;  // nb de fois où l'on change de lieu d'une tâche à la suivante dans une journée
    ecartCharge: number;        // charge du jour le plus chargé − du moins chargé (minutes, jours disponibles seulement)
  };
  identiqueA?: IdStrategie;     // rempli si ce planning donne exactement le même résultat qu'un autre
}

export interface EntreePlanification {
  taches: Tache[];
  lundi: string;            // "AAAA-MM-JJ" : lundi de la semaine à planifier
  plages: PlageDispo[];
  maintenant: Date;         // pour ne rien placer dans le passé
}

/* ---------- Réglages ---------- */

export const DUREE_PAR_DEFAUT = 60;  // minutes, si la tâche n'a pas de durée
export const PAS_MINUTES = 5;        // les débuts de tâche sont arrondis aux 5 min
export const JOURS_LONGS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// 8 h – 20 h tous les jours : point de départ modifiable dans la fenêtre de réglage.
export const PLAGES_PAR_DEFAUT: PlageDispo[] = Array.from({ length: 7 }, (_, jour) => ({ jour, debut: "08:00", fin: "20:00" }));

export const STRATEGIES: { id: IdStrategie; nom: string; description: string }[] = [
  { id: "echeances", nom: "Échéances d'abord",
    description: "Les tâches à rendre le plus tôt passent en premier, au plus tôt dans la semaine." },
  { id: "lieu", nom: "Regroupé par lieu",
    description: "Les tâches d'un même lieu sont mises à la suite, pour limiter les déplacements." },
  { id: "equilibre", nom: "Charge équilibrée",
    description: "Chaque tâche va le jour le moins chargé possible, pour lisser la semaine." },
];

const RANG: Record<Priorite, number> = { haute: 0, moyenne: 1, basse: 2 };

/* ---------- Petits outils (dates et heures) ---------- */

export function versMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function versHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// "2026-11-23" + 2 → "2026-11-25" (construit en heure locale : pas de décalage UTC)
export function decalerISO(iso: string, jours: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  return isoLocal(new Date(a, m - 1, j + jours));
}

const arrondiHaut = (min: number) => Math.ceil(min / PAS_MINUTES) * PAS_MINUTES;

// Minuscules, sans accents ni espaces superflus : "Bât. B " et "bat. b" = même lieu.
export function cleLieu(lieu: string): string {
  return lieu.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function dureeDe(t: Pick<Tache, "dureeMinutes">): number {
  return t.dureeMinutes && t.dureeMinutes > 0 ? t.dureeMinutes : DUREE_PAR_DEFAUT;
}

/* ---------- Étape 1 : les créneaux libres ---------- */

interface Intervalle { debut: number; fin: number } // minutes depuis minuit, fin exclue

// Retire [debut, fin[ d'une liste d'intervalles triés (peut couper un intervalle en deux).
function soustraire(liste: Intervalle[], debut: number, fin: number): Intervalle[] {
  const res: Intervalle[] = [];
  for (const iv of liste) {
    if (fin <= iv.debut || debut >= iv.fin) { res.push(iv); continue; } // pas de chevauchement
    if (iv.debut < debut) res.push({ debut: iv.debut, fin: debut });
    if (fin < iv.fin) res.push({ debut: fin, fin: iv.fin });
  }
  return res;
}

// Fusionne les plages qui se chevauchent (ex. 8-12 et 11-14 → 8-14).
function fusionner(liste: Intervalle[]): Intervalle[] {
  const tries = [...liste].sort((a, b) => a.debut - b.debut);
  const res: Intervalle[] = [];
  for (const iv of tries) {
    const dernier = res[res.length - 1];
    if (dernier && iv.debut <= dernier.fin) dernier.fin = Math.max(dernier.fin, iv.fin);
    else res.push({ ...iv });
  }
  return res;
}

interface Jour {
  index: number;            // 0 = lundi
  date: string;
  libres: Intervalle[];
  charge: number;           // minutes déjà occupées (tâches datées + placées)
  lieux: string[];          // lieux des tâches placées ce jour (pour la stratégie "lieu")
  disponible: boolean;      // le jour a au moins une plage réglée
}

function construireJours(entree: EntreePlanification): Jour[] {
  const maintenantISO = isoLocal(entree.maintenant);
  const minutesMaintenant = entree.maintenant.getHours() * 60 + entree.maintenant.getMinutes();
  const jours: Jour[] = [];

  for (let i = 0; i < 7; i++) {
    const date = decalerISO(entree.lundi, i);
    let libres = fusionner(
      entree.plages
        .filter((p) => p.jour === i)
        .map((p) => ({ debut: versMinutes(p.debut), fin: versMinutes(p.fin) }))
        .filter((iv) => iv.fin > iv.debut),
    );
    const disponible = libres.length > 0;
    let charge = 0;

    for (const t of entree.taches) {
      if (t.faite || t.date !== date) continue;
      const duree = dureeDe(t);
      charge += duree; // même sans heure, une tâche datée occupe la journée (compte pour l'équilibre)
      if (t.heure) {
        const debut = versMinutes(t.heure);
        libres = soustraire(libres, debut, debut + duree);
      }
    }
    // Pas de planification dans le passé : jours écoulés vidés, aujourd'hui coupé à l'heure actuelle.
    if (date < maintenantISO) libres = [];
    else if (date === maintenantISO) libres = soustraire(libres, 0, arrondiHaut(minutesMaintenant));

    // Les débuts de créneau sont arrondis aux 5 min (14:07 → 14:10).
    libres = libres
      .map((iv) => ({ debut: arrondiHaut(iv.debut), fin: iv.fin }))
      .filter((iv) => iv.fin > iv.debut);

    jours.push({ index: i, date, libres, charge, lieux: [], disponible });
  }
  return jours;
}

/* ---------- Étape 2 : les tâches à placer ---------- */

interface Candidate { tache: Tache; duree: number; lieu: string }

// Clé de tri "urgence" : échéance (sans échéance = à la fin), puis priorité, puis la plus longue d'abord
// (placer les grosses tâches en premier laisse les petits trous pour les petites : c'est la règle classique
// du "bin packing" glouton, First Fit Decreasing).
function comparerUrgence(a: Candidate, b: Candidate): number {
  const ea = a.tache.echeance || "9999-12-31";
  const eb = b.tache.echeance || "9999-12-31";
  if (ea !== eb) return ea < eb ? -1 : 1;
  if (a.tache.priorite !== b.tache.priorite) return RANG[a.tache.priorite] - RANG[b.tache.priorite];
  if (a.duree !== b.duree) return b.duree - a.duree;
  return a.tache.titre.localeCompare(b.tache.titre) || a.tache.id.localeCompare(b.tache.id); // départage stable
}

function candidates(entree: EntreePlanification): Candidate[] {
  return entree.taches
    .filter((t) => !t.faite && t.date === "")
    .map((t) => ({ tache: t, duree: dureeDe(t), lieu: cleLieu(t.lieu) }));
}

/* ---------- Étape 3 : placer une tâche ---------- */

interface Etat { jours: Jour[]; placements: Placement[]; nonPlaces: NonPlace[] }

// Premier créneau du jour qui peut contenir `duree` minutes d'un seul tenant.
function premierCreneau(jour: Jour, duree: number): number | null {
  for (const iv of jour.libres) if (iv.fin - iv.debut >= duree) return iv.debut;
  return null;
}

// Réserve [debut, debut+duree[ dans un jour et enregistre le placement.
function reserver(etat: Etat, jour: Jour, debut: number, c: Candidate, apresEcheance: boolean) {
  jour.libres = soustraire(jour.libres, debut, debut + c.duree);
  jour.charge += c.duree;
  if (c.lieu) jour.lieux.push(c.lieu);
  etat.placements.push({
    tacheId: c.tache.id, titre: c.tache.titre, lieu: c.tache.lieu, date: jour.date, heure: versHHMM(debut),
    dureeMinutes: c.duree, dureeParDefaut: !c.tache.dureeMinutes, apresEcheance,
  });
}

// Jours autorisés par l'échéance (une tâche "à rendre mercredi" peut aller lundi, mardi ou mercredi).
function joursAvantEcheance(jours: Jour[], c: Candidate): Jour[] {
  return c.tache.echeance ? jours.filter((j) => j.date <= c.tache.echeance) : jours;
}

/* Place une tâche selon une règle de choix du jour. Si rien ne tient avant l'échéance,
   on essaie après (en le signalant) ; si rien ne tient de la semaine, elle reste en checklist. */
function placer(etat: Etat, c: Candidate, choisirJour: (jours: Jour[]) => Jour[]) {
  const essayer = (jours: Jour[]) => {
    for (const jour of choisirJour(jours)) {
      const debut = premierCreneau(jour, c.duree);
      if (debut !== null) return { jour, debut };
    }
    return null;
  };
  const avant = essayer(joursAvantEcheance(etat.jours, c));
  if (avant) return reserver(etat, avant.jour, avant.debut, c, false);
  const apres = c.tache.echeance ? essayer(etat.jours.filter((j) => j.date > c.tache.echeance)) : null;
  if (apres) return reserver(etat, apres.jour, apres.debut, c, true);
  etat.nonPlaces.push({ tacheId: c.tache.id, titre: c.tache.titre, raison: raisonNonPlace(etat.jours, c) });
}

function raisonNonPlace(jours: Jour[], c: Candidate): string {
  const plusGrand = Math.max(0, ...jours.flatMap((j) => j.libres.map((iv) => iv.fin - iv.debut)));
  const h = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? String(m % 60).padStart(2, "0") : ""}` : `${m} min`);
  return plusGrand === 0
    ? "plus aucun créneau libre cette semaine"
    : `il faut ${h(c.duree)} d'un seul tenant, le plus grand créneau restant fait ${h(plusGrand)}`;
}

/* ---------- Les 3 stratégies ---------- */

const ordreChrono = (jours: Jour[]) => jours;

// A. Échéances d'abord : ordre d'urgence, premier créneau libre de la semaine ("First Fit").
function strategieEcheances(etat: Etat, liste: Candidate[]) {
  for (const c of [...liste].sort(comparerUrgence)) placer(etat, c, ordreChrono);
}

// C. Charge équilibrée : ordre d'urgence, mais on préfère le jour le moins chargé
// (charge = tâches déjà datées de ce jour + tâches déjà placées par l'algorithme).
function strategieEquilibre(etat: Etat, liste: Candidate[]) {
  for (const c of [...liste].sort(comparerUrgence)) {
    placer(etat, c, (jours) => [...jours].sort((a, b) => a.charge - b.charge || a.index - b.index));
  }
}

/* B. Regroupé par lieu :
   - une tâche sans lieu est traitée seule, à son rang d'urgence ;
   - les lieux sont pris du plus urgent au moins urgent (échéance la plus proche du groupe) ;
   - pour chaque lieu, on cherche UN créneau assez long pour enchaîner toutes ses tâches
     (en respectant l'échéance la plus stricte du groupe) ;
   - à défaut, chaque tâche du lieu va de préférence un jour où ce lieu est déjà prévu. */
function strategieLieu(etat: Etat, liste: Candidate[]) {
  const parLieu = new Map<string, Candidate[]>();
  const sansLieu: Candidate[] = [];
  for (const c of liste) {
    if (!c.lieu) { sansLieu.push(c); continue; }
    const groupe = parLieu.get(c.lieu);
    if (groupe) groupe.push(c);
    else parLieu.set(c.lieu, [c]);
  }
  // Une tâche sans lieu forme un "groupe" à elle seule : ainsi une tâche urgente sans lieu
  // passe quand même avant un groupe de tâches qui peuvent attendre.
  const groupes = [...[...parLieu.values()].map((g) => g.sort(comparerUrgence)), ...sansLieu.map((c) => [c])]
    .sort((a, b) => comparerUrgence(a[0], b[0]));

  for (const groupe of groupes) {
    const total = groupe.reduce((s, c) => s + c.duree, 0);
    const echeanceMin = groupe.map((c) => c.tache.echeance).filter(Boolean).sort()[0];
    const joursPossibles = echeanceMin ? etat.jours.filter((j) => j.date <= echeanceMin) : etat.jours;
    let bloc: { jour: Jour; debut: number } | null = null;
    for (const jour of joursPossibles) {
      const debut = premierCreneau(jour, total);
      if (debut !== null) { bloc = { jour, debut }; break; }
    }
    if (bloc) {
      let t = bloc.debut;
      for (const c of groupe) { reserver(etat, bloc.jour, t, c, false); t += c.duree; }
      continue;
    }
    for (const c of groupe) {
      placer(etat, c, (jours) => [...jours].sort((a, b) =>
        Number(b.lieux.includes(c.lieu)) - Number(a.lieux.includes(c.lieu)) || a.index - b.index));
    }
  }
}

/* ---------- Point d'entrée ---------- */

function statistiques(etat: Etat): Planning["stats"] {
  let changementsDeLieu = 0;
  const parJour = new Map<string, Placement[]>();
  for (const p of etat.placements) parJour.set(p.date, [...(parJour.get(p.date) ?? []), p]);
  for (const liste of parJour.values()) {
    const lieux = liste.sort((a, b) => a.heure.localeCompare(b.heure)).map((p) => cleLieu(p.lieu)).filter(Boolean);
    for (let i = 1; i < lieux.length; i++) if (lieux[i] !== lieux[i - 1]) changementsDeLieu++;
  }
  const charges = etat.jours.filter((j) => j.disponible).map((j) => j.charge);
  return {
    minutesPlacees: etat.placements.reduce((s, p) => s + p.dureeMinutes, 0),
    apresEcheance: etat.placements.filter((p) => p.apresEcheance).length,
    changementsDeLieu,
    ecartCharge: charges.length ? Math.max(...charges) - Math.min(...charges) : 0,
  };
}

export function planifier(entree: EntreePlanification, strategie: IdStrategie): Planning {
  const etat: Etat = { jours: construireJours(entree), placements: [], nonPlaces: [] };
  const liste = candidates(entree);
  if (strategie === "echeances") strategieEcheances(etat, liste);
  else if (strategie === "lieu") strategieLieu(etat, liste);
  else strategieEquilibre(etat, liste);

  etat.placements.sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
  const infos = STRATEGIES.find((s) => s.id === strategie)!;
  return { ...infos, placements: etat.placements, nonPlaces: etat.nonPlaces, stats: statistiques(etat) };
}

// Les 3 propositions ; si deux donnent exactement le même résultat, on le signale.
export function proposerPlannings(entree: EntreePlanification): Planning[] {
  const plannings = STRATEGIES.map((s) => planifier(entree, s.id));
  const signature = (p: Planning) => p.placements.map((x) => `${x.tacheId}@${x.date}T${x.heure}`).sort().join("|");
  for (let i = 1; i < plannings.length; i++) {
    const deja = plannings.slice(0, i).find((q) => !q.identiqueA && signature(q) === signature(plannings[i]));
    if (deja) plannings[i].identiqueA = deja.id;
  }
  return plannings;
}

/* ---------- Validation des plages (données venant de la base ou du navigateur) ---------- */

export function validerPlages(donnees: unknown): PlageDispo[] | null {
  if (!Array.isArray(donnees)) return null;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
  return donnees.filter((p): p is PlageDispo =>
    typeof p === "object" && p !== null &&
    Number.isInteger(p.jour) && p.jour >= 0 && p.jour <= 6 &&
    typeof p.debut === "string" && hhmm.test(p.debut) &&
    typeof p.fin === "string" && hhmm.test(p.fin) &&
    versMinutes(p.fin) > versMinutes(p.debut));
}
