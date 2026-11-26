/* Sous-tâches (« étapes ») et matériel cochables.

   DEUX LISTES, UN MÊME PRINCIPE : une liste de textes + l'état coché de chaque élément.
   - étapes   : colonne taches.etapes (jsonb) = [{ id, texte, faite }] ;
   - matériel : la colonne texte taches.materiel reste la liste (un élément par ligne, ce
                qui garde intacts la recherche, le calendrier .ics et les anciennes données) ;
                les éléments déjà « pris » sont dans taches.materiel_pris (jsonb, liste de
                CLÉS : le texte en minuscules sans accents, voir cleMateriel).

   TÂCHE RÉPÉTÉE : la liste appartient à la SÉRIE (corriger « Gourde » la corrige pour tous
   les jours), mais ce qui est coché appartient à CHAQUE JOUR. On range donc les cases
   cochées dans la règle de répétition, par date : recurrence.cases["2026-11-30"].
   C'est le même mécanisme que recurrence.faites (dates des jours cochés) : rien n'est
   dupliqué en base, et chaque occurrence calculée reçoit SES cases (lib/recurrence.ts).
   Pourquoi pas « cocher pour toute la série » ? Une étape d'une tâche qui revient (ménage
   du samedi, sac de sport) est à refaire à chaque fois : la cocher une fois pour toutes
   la ferait paraître faite les semaines suivantes, ce qui est faux.

   Fichier « pur » (aucun accès à React ni à la base) : testable avec Node.            */

import type { CasesJour, Etape, Recurrence, Tache } from "./types";

export const MAX_ETAPES = 50;
export const MAX_TEXTE_ETAPE = 200;
// Les cases d'une série plus vieilles que ce nombre de jours sont oubliées (la règle ne grossit pas sans fin).
export const JOURS_CASES_GARDEES = 60;

export function nouvelIdEtape(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function creerEtape(texte: string): Etape {
  return { id: nouvelIdEtape(), texte: texte.trim().slice(0, MAX_TEXTE_ETAPE), faite: false };
}

/* « Gourde », « gourde » et « Gourde  » désignent le même élément : la clé ignore
   majuscules, accents et espaces en trop. */
export function cleMateriel(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Un texte collé sur plusieurs lignes (liste copiée d'un mail…) donne plusieurs éléments.
export function decouperLignes(texte: string): string[] {
  return texte.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·]|\[[ xX]?\]|\d+[.)])\s+/, "").trim()).filter(Boolean);
}

/* ---------- Validation (données venant de la base ou d'un fichier importé) ---------- */

export function validerEtapes(v: unknown): Etape[] {
  if (!Array.isArray(v)) return [];
  const vus = new Set<string>();
  const res: Etape[] = [];
  for (const e of v) {
    if (typeof e !== "object" || e === null) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.texte !== "string" || !o.texte.trim()) continue;
    let id = typeof o.id === "string" && o.id ? o.id.slice(0, 40) : nouvelIdEtape();
    if (vus.has(id)) id = nouvelIdEtape();
    vus.add(id);
    res.push({ id, texte: o.texte.trim().slice(0, MAX_TEXTE_ETAPE), faite: o.faite === true });
    if (res.length >= MAX_ETAPES) break;
  }
  return res;
}

export function validerCles(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200))] : [];
}

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function validerCases(v: unknown): Record<string, CasesJour> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const res: Record<string, CasesJour> = {};
  for (const [date, c] of Object.entries(v as Record<string, unknown>)) {
    if (!FORMAT_DATE.test(date) || typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    const jour = { etapes: validerCles(o.etapes), materiel: validerCles(o.materiel) };
    if (jour.etapes.length || jour.materiel.length) res[date] = jour;
  }
  return Object.keys(res).length ? res : undefined;
}

/* ---------- Lecture ---------- */

// Les éléments du matériel (une ligne = un élément, lignes vides ignorées).
export function elementsMateriel(materiel: string): string[] {
  return materiel.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function estPris(t: Pick<Tache, "materielPris">, element: string): boolean {
  return (t.materielPris ?? []).includes(cleMateriel(element));
}

// Avancement : nombre d'éléments cochés / total, pour les étapes et pour le matériel.
export function avancement(t: Pick<Tache, "etapes" | "materiel" | "materielPris">) {
  const etapes = t.etapes ?? [];
  const materiel = elementsMateriel(t.materiel);
  const pris = new Set(t.materielPris ?? []);
  return {
    etapesFaites: etapes.filter((e) => e.faite).length,
    etapesTotal: etapes.length,
    materielPris: materiel.filter((m) => pris.has(cleMateriel(m))).length,
    materielTotal: materiel.length,
  };
}

/* Les cases d'UN jour d'une série, appliquées à la liste de la série : renvoie les étapes
   (avec faite = coché ce jour-là) et le matériel pris ce jour-là. */
export function casesDuJour(serie: Pick<Tache, "etapes" | "recurrence">, date: string): { etapes: Etape[]; materielPris: string[] } {
  const jour = serie.recurrence?.cases?.[date];
  return {
    etapes: (serie.etapes ?? []).map((e) => ({ ...e, faite: jour ? jour.etapes.includes(e.id) : false })),
    materielPris: jour ? [...jour.materiel] : [],
  };
}

/* ---------- Modifications (renvoient de NOUVELLES valeurs) ---------- */

export type GenreCase = "etape" | "materiel";

// Tâche unique : coche / décoche une étape (par id) ou un élément du matériel (par texte).
export function basculerCaseTache(t: Pick<Tache, "etapes" | "materielPris">, genre: GenreCase, cle: string) {
  if (genre === "etape") {
    return { etapes: (t.etapes ?? []).map((e) => (e.id === cle ? { ...e, faite: !e.faite } : e)), materielPris: t.materielPris ?? [] };
  }
  const k = cleMateriel(cle);
  const pris = t.materielPris ?? [];
  return { etapes: t.etapes ?? [], materielPris: pris.includes(k) ? pris.filter((x) => x !== k) : [...pris, k] };
}

/* Série : coche / décoche pour UN jour (date de l'occurrence). Les jours trop anciens
   (plus de JOURS_CASES_GARDEES avant aujourd'hui) sont oubliés au passage. */
export function basculerCaseSerie(r: Recurrence, date: string, genre: GenreCase, cle: string, aujourdhui: string): Recurrence {
  const jour: CasesJour = r.cases?.[date] ? { etapes: [...r.cases[date].etapes], materiel: [...r.cases[date].materiel] } : { etapes: [], materiel: [] };
  const liste = genre === "etape" ? jour.etapes : jour.materiel;
  const k = genre === "etape" ? cle : cleMateriel(cle);
  const i = liste.indexOf(k);
  if (i >= 0) liste.splice(i, 1); else liste.push(k);
  const cases: Record<string, CasesJour> = {};
  const limite = decaler(aujourdhui, -JOURS_CASES_GARDEES);
  for (const [d, c] of Object.entries({ ...r.cases, [date]: jour })) {
    if ((d >= limite || d === date) && (c.etapes.length || c.materiel.length)) cases[d] = c;
  }
  return { ...r, cases };
}

// Ne garde que les cases des dates qui vérifient le test (série coupée, jour retiré…).
export function filtrerCases(r: Recurrence, garder: (date: string) => boolean): Recurrence {
  if (!r.cases) return r;
  const cases = Object.fromEntries(Object.entries(r.cases).filter(([d]) => garder(d)));
  return { ...r, cases };
}

/* Avant enregistrement : retire les étapes vides, et les « pris » qui ne correspondent
   plus à aucun élément du matériel (élément renommé ou supprimé). */
export function nettoyer(etapes: Etape[], materiel: string, materielPris: string[]) {
  const cles = new Set(elementsMateriel(materiel).map(cleMateriel));
  return {
    etapes: etapes.map((e) => ({ ...e, texte: e.texte.trim().slice(0, MAX_TEXTE_ETAPE) })).filter((e) => e.texte).slice(0, MAX_ETAPES),
    materielPris: [...new Set(materielPris)].filter((k) => cles.has(k)),
  };
}

function decaler(iso: string, n: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1, j) + n * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
