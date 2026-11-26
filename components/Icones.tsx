/* Jeu d'icônes de l'interface (remplace les anciens emoji).

   Source : la bibliothèque "lucide-react" (licence libre ISC). Chaque icône est un
   petit dessin SVG "au trait" (épaisseur 2, coins arrondis) : elles ont donc toutes
   le même style, quel que soit l'appareil — contrairement aux emoji, qui changent
   d'apparence entre iPhone, Android et Windows.

   Pourquoi passer par ce fichier plutôt qu'importer lucide-react partout ?
   Pour changer une icône dans TOUTE l'application en ne modifiant qu'une ligne ici.
   Les noms sont en français et décrivent la FONCTION, pas le dessin.

   Règles communes (voir .lucide dans app/globals.css) :
   - taille = 1,15 × la taille du texte voisin (elles grandissent avec lui) ;
   - couleur = "currentColor", c.-à-d. la couleur du texte : elles suivent le thème,
     les badges colorés, les boutons bleus, etc. sans rien régler ;
   - décoratives par défaut (aria-hidden) : le texte à côté suffit aux lecteurs
     d'écran. Pour un bouton SANS texte, mettre un aria-label sur le <button>.    */

import { Flame, Star, Zap } from "lucide-react";
import type { Groupe } from "@/lib/types";

export {
  // Groupes de tri
  Flame as IconeUrgent,
  Star as IconeImportant,
  Zap as IconeRapide,
  // Actions
  Plus as IconeAjouter,
  Pencil as IconeModifier,
  Trash2 as IconeSupprimer,
  X as IconeFermer,
  Undo2 as IconeAnnuler,
  Check as IconeValide,
  Ban as IconeAucune,
  Search as IconeRecherche,
  Download as IconeExporter,
  Upload as IconeImporter,
  CalendarSync as IconeSynchro,
  Menu as IconeMenu,
  WandSparkles as IconePlanifier,
  GripVertical as IconePoignee,
  Move as IconeDeplacer,
  // Navigation
  ChevronLeft as IconePrecedent,
  ChevronRight as IconeSuivant,
  ChevronDown as IconeDeplier,
  SlidersHorizontal as IconeOptions,
  ArrowLeft as IconeRetour,
  ArrowRight as IconeContinuer,
  // Informations sur une tâche
  Timer as IconeDuree,
  Hourglass as IconeEcheance,
  MapPin as IconeLieu,
  Backpack as IconeMateriel,
  ListChecks as IconeChecklist,
  ListTodo as IconeEtapes,
  Lightbulb as IconeIdee,
  FolderOpen as IconeProjet,
  CalendarClock as IconeCalendrier,
  Repeat as IconeRepeter,
  // Messages et statistiques
  CircleCheck as IconeSucces,
  CircleX as IconeEchec,
  TriangleAlert as IconeAlerte,
  Scale as IconeEquilibre,
  PartyPopper as IconeBravo,
} from "lucide-react";

// L'icône de chaque groupe Urgent / Important / Rapide.
const ICONES_GROUPES = { urgent: Flame, important: Star, rapide: Zap } as const;

export function IconeGroupe({ groupe }: { groupe: Groupe }) {
  const Icone = ICONES_GROUPES[groupe];
  return <Icone aria-hidden="true" />;
}
