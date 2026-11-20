/* Types et constantes partagés par toute l'application.
   TypeScript vérifie à la compilation qu'on n'utilise que des valeurs autorisées :
   écrire categorie: "boulot" provoquerait une erreur avant même de lancer l'app. */

export type Categorie = "perso" | "travail" | "projets";
export type Priorite = "haute" | "moyenne" | "basse";
export type Vue = "jour" | "semaine" | "mois" | "liste";
export type Statut = "toutes" | "afaire" | "faites" | "retard";

export interface Tache {
  id: string;
  titre: string;
  description: string;
  date: string;      // "AAAA-MM-JJ"
  heure: string;     // "HH:MM" ou "" si pas d'heure
  dureeMinutes: number | null; // durée estimée en minutes, null si non renseignée
  lieu: string;      // "" si non renseigné
  materiel: string;  // un élément par ligne, "" si rien
  categorie: Categorie;
  priorite: Priorite;
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
];
export const FILTRES_INITIAUX: Filtres = { recherche: "", categorie: "toutes", priorite: "toutes", statut: "toutes" };
