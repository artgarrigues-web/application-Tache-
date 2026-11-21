/* Types et constantes partagés par toute l'application.
   TypeScript vérifie à la compilation qu'on n'utilise que des valeurs autorisées :
   écrire categorie: "boulot" provoquerait une erreur avant même de lancer l'app. */

export type Categorie = "perso" | "travail" | "projets";
export type Priorite = "haute" | "moyenne" | "basse";
export type Vue = "jour" | "semaine" | "mois" | "liste" | "tri" | "checklist";
export type Statut = "toutes" | "afaire" | "faites" | "retard";

export interface Tache {
  id: string;
  titre: string;
  description: string;
  date: string;      // "AAAA-MM-JJ", ou "" pour une tâche sans date (checklist)
  heure: string;     // "HH:MM" ou "" si pas d'heure
  dureeMinutes: number | null; // durée estimée en minutes, null si non renseignée
  lieu: string;      // "" si non renseigné
  echeance: string;  // "AAAA-MM-JJ" : date limite (sert à la planification automatique), "" si aucune
  materiel: string;  // un élément par ligne, "" si rien
  categorie: Categorie;
  priorite: Priorite;
  groupe: Groupe | null; // groupe choisi à la main dans le formulaire, null = automatique
  faite: boolean;
  creeLe: string;    // date ISO complète
}

// Les champs saisis dans le formulaire (le reste est généré automatiquement).
export type DonneesTache = Omit<Tache, "id" | "faite" | "creeLe">;

export interface Filtres {
  recherche: string;
  categorie: Categorie | "toutes";
  priorite: Priorite | "toutes";
  statut: Statut;
}

export const CATEGORIES: Record<Categorie, string> = { perso: "Personnel", travail: "Travail", projets: "Projets" };
export const PRIORITES: Record<Priorite, string> = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };
export const RANG_PRIORITE: Record<Priorite, number> = { haute: 0, moyenne: 1, basse: 2 };
export const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const VUES: { id: Vue; libelle: string }[] = [
  { id: "jour", libelle: "Jour" },
  { id: "semaine", libelle: "Semaine" },
  { id: "mois", libelle: "Mois" },
  { id: "liste", libelle: "Liste" },
  { id: "tri", libelle: "Tri" },
  { id: "checklist", libelle: "Checklist" },
];

/* ---------- Les 3 groupes de tri : Urgent / Important / Rapide ----------
   Ils ne sont PAS stockés en base : ils sont calculés à partir des champs
   existants (date, priorité, durée). Voir groupesDe() dans lib/taches.ts. */
export type Groupe = "urgent" | "important" | "rapide";
export const GROUPES: { id: Groupe; libelle: string; regle: string }[] = [
  { id: "urgent", libelle: "Urgent", regle: "À faire aujourd'hui, demain, ou déjà en retard" },
  { id: "important", libelle: "Important", regle: "Priorité haute" },
  { id: "rapide", libelle: "Rapide", regle: "Durée estimée de 30 min ou moins" },
];
// Seuils réglables : modifier ces deux nombres suffit à changer les règles.
export const JOURS_URGENCE = 1;      // 0 = aujourd'hui seulement, 1 = jusqu'à demain inclus, etc.
export const DUREE_RAPIDE_MAX = 30;  // en minutes
export const FILTRES_INITIAUX: Filtres = { recherche: "", categorie: "toutes", priorite: "toutes", statut: "toutes" };
