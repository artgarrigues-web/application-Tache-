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
  /* Sous-tâches (« étapes ») cochables, et éléments du matériel déjà « pris ».
     Facultatifs (?) : une tâche sans étapes n'a pas besoin du champ, et le code qui crée
     des tâches ailleurs (saisie rapide, glisser-déposer…) n'a rien à changer.
     Pour une tâche RÉPÉTÉE, la LISTE (textes) appartient à la série, mais ce qui est coché
     appartient à chaque jour : voir Recurrence.cases et lib/etapes.ts. */
  etapes?: Etape[];
  materielPris?: string[]; // textes des éléments de « materiel » déjà cochés
  categorie: Categorie;
  priorite: Priorite;
  groupe: Groupe | null; // groupe choisi à la main dans le formulaire, null = automatique
  couleur: Couleur | null; // couleur choisie dans la palette du formulaire, null = aucune
  recurrence: Recurrence | null; // règle de répétition (voir lib/recurrence.ts), null = tâche unique
  projetId: string | null; // projet de la Checklist dont vient la tâche (glissé sur l'agenda), null = aucun
  rappelMinutes: number | null; // notification N minutes avant l'heure (0 = à l'heure), null = aucun rappel
  faite: boolean;
  creeLe: string;    // date ISO complète
  /* Rempli UNIQUEMENT pour une occurrence d'une tâche répétée, fabriquée à l'affichage
     (elle n'existe pas en base) : id de la tâche « mère », date de cette occurrence et
     date de début de la série.
     L'id de l'occurrence vaut alors "<serieId>~<date>". */
  occurrence?: { serieId: string; date: string; debutSerie: string };
  supprimeeLe?: string; // date ISO de mise à la corbeille (rempli seulement dans la liste de la corbeille)
}

/* Une étape (sous-tâche) : un texte et une case. L'id (court, aléatoire) reste le même
   quand on corrige le texte : c'est grâce à lui qu'une case cochée « suit » son étape. */
export interface Etape {
  id: string;
  texte: string;
  faite: boolean;
}

// Les champs saisis dans le formulaire (le reste est généré automatiquement).
export type DonneesTache = Omit<Tache, "id" | "faite" | "creeLe" | "occurrence" | "supprimeeLe">;

/* ---------- Répétition (récurrence) d'une tâche ----------
   Une tâche répétée n'est enregistrée qu'UNE fois en base (la « série ») ; ses
   occurrences sont calculées à l'affichage (lib/recurrence.ts). Ce qui diffère d'une
   occurrence à l'autre est rangé dans la règle elle-même :
   - faites     : les dates des occurrences cochées ;
   - exceptions : les dates supprimées (ou modifiées à part, devenues des tâches uniques). */
export type Frequence = "jour" | "semaine" | "mois" | "annee";
/* Pour un rythme mensuel :
   - "jour"    : le même numéro de jour (le 15 de chaque mois). Un 29, 30 ou 31 tombe
                 le dernier jour des mois plus courts (31 → 30 avril, 28 ou 29 février) ;
   - "rang"    : le même rang de jour de semaine (le 2e mardi de chaque mois) ;
   - "dernier" : le dernier jour de semaine du mois (le dernier vendredi). */
export type ModeMois = "jour" | "rang" | "dernier";
export type FinRecurrence =
  | { type: "jamais" }
  | { type: "date"; date: string }       // dernière date possible (incluse)
  | { type: "nombre"; nombre: number };  // nombre total d'occurrences

export interface Recurrence {
  frequence: Frequence;
  intervalle: number;      // « tous les N » jours / semaines / mois / ans (1 = chaque)
  joursSemaine: number[];  // rythme hebdomadaire : 0 = lundi … 6 = dimanche
  modeMois: ModeMois;
  fin: FinRecurrence;
  exceptions: string[];    // "AAAA-MM-JJ"
  faites: string[];        // "AAAA-MM-JJ"
  /* Étapes et matériel cochés, JOUR PAR JOUR (clé "AAAA-MM-JJ") : cocher « Gourde » pour
     le sport de lundi ne la coche pas pour lundi prochain. Absent = rien de coché. */
  cases?: Record<string, CasesJour>;
}

export interface CasesJour {
  etapes: string[];   // ids des étapes cochées ce jour-là
  materiel: string[]; // textes des éléments de matériel cochés ce jour-là
}

export const FREQUENCES: { id: Frequence; libelle: string; unite: [string, string] }[] = [
  { id: "jour", libelle: "Tous les jours", unite: ["jour", "jours"] },
  { id: "semaine", libelle: "Toutes les semaines", unite: ["semaine", "semaines"] },
  { id: "mois", libelle: "Tous les mois", unite: ["mois", "mois"] },
  { id: "annee", libelle: "Tous les ans", unite: ["an", "ans"] },
];

// Ce que vise une modification ou une suppression faite sur une occurrence.
export type Portee = "occurrence" | "suivantes" | "serie";

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

/* ---------- Projets (catégorie de la Checklist) ----------
   Un projet = un titre ; ses idées = une liste de notes cochables, sans date.
   Tables Supabase projets_idees et idees (supabase/migration-idees.sql). */
export interface ProjetIdees {
  id: string;
  titre: string;
  creeLe: string;
}

export interface Idee {
  id: string;
  projetId: string;
  texte: string;
  faite: boolean;    // « réalisée » / retenue : cochée = barrée en vert, comme une tâche faite
  creeLe: string;
}

/* ---------- Couleur d'une tâche (palette du formulaire) ----------
   On stocke un NOM de couleur ("bleu"), pas un code ("#2563eb") : la teinte exacte
   est définie dans globals.css (variables --c-bleu…), avec une version claire et une
   version sombre. Changer une teinte ne demande donc aucune mise à jour de la base.
   Pas de rouge (réservé aux tâches en retard) ni de vert vif (réservé aux tâches faites). */
export type Couleur = "bleu" | "turquoise" | "sauge" | "violet" | "rose" | "orange" | "jaune" | "ardoise";
export const COULEURS: { id: Couleur; libelle: string }[] = [
  { id: "bleu", libelle: "Bleu" },
  { id: "turquoise", libelle: "Turquoise" },
  { id: "sauge", libelle: "Sauge" },
  { id: "violet", libelle: "Violet" },
  { id: "rose", libelle: "Rose" },
  { id: "orange", libelle: "Orange" },
  { id: "jaune", libelle: "Jaune" },
  { id: "ardoise", libelle: "Ardoise" },
];
export function estCouleur(v: unknown): v is Couleur {
  return typeof v === "string" && COULEURS.some((c) => c.id === v);
}
