"use client";

/* Glisser-déposer (drag and drop) sur l'agenda — bibliothèque @dnd-kit/core.

   Pourquoi une bibliothèque plutôt que le glisser-déposer natif du navigateur (draggable="true") ?
   Le natif ne marche pas au doigt sur téléphone, son « fantôme » est une image figée et
   impossible à styler, et il n'a rien pour le clavier. @dnd-kit gère la souris, l'appui long
   au doigt, le clavier, l'annulation par Échap, le défilement automatique près des bords et
   les annonces pour lecteur d'écran ; on ne fait que décrire QUOI glisser et OÙ déposer.

   Vocabulaire :
   - un « glissable » (useGlissable) : une carte de tâche, un projet ou une idée ;
   - une « zone de dépôt » (ZoneDepot) : un jour (Semaine, Mois), un créneau horaire (Jour),
     la rubrique « Sans date » de la Checklist, ou les flèches ‹ › (survolées = page suivante) ;
   - une « cible » : la date + l'heure que recevra l'élément déposé.

   Le composant Agenda reçoit seulement « tel élément a été déposé sur telle cible »
   (onDeposer) et décide quoi enregistrer.                                                     */

import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor,
  closestCenter, defaultDropAnimationSideEffects, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
  type DropAnimation, type KeyboardCoordinateGetter, type Modifier, type Over, type Active,
} from "@dnd-kit/core";
import { getEventCoordinates } from "@dnd-kit/utilities";
import type { Idee, ProjetIdees, Tache } from "@/lib/types";
import { depuisISO, formater } from "@/lib/dates";
import { IconeChecklist, IconeIdee, IconePoignee, IconeProjet } from "./Icones";

/* ---------- Ce qu'on glisse, et où ---------- */
export type Glisse =
  | { type: "tache"; tache: Tache; compacte: boolean }
  | { type: "projet"; projet: ProjetIdees }
  | { type: "idee"; idee: Idee; projet: ProjetIdees | null };

/* date "" = sans date (rubrique Checklist).
   heure null = « garder l'heure actuelle de la tâche » (dépôt sur un jour entier en Semaine/Mois) ;
   heure ""   = sans heure ; "HH:MM" = créneau précis (vue Jour). */
export interface Cible { date: string; heure: string | null }

interface DonneesZone { cible?: Cible; nav?: -1 | 1; libelle: string }

/* Texte lisible d'une cible : « mardi 26 novembre · 14:30 ». */
export function libelleCible(c: Cible, g?: Glisse | null): string {
  if (!c.date) return "Sans date (checklist)";
  const jour = formater(depuisISO(c.date), { weekday: "long", day: "numeric", month: "long" });
  const heure = c.heure ?? (g?.type === "tache" ? g.tache.heure : "");
  return heure ? `${jour} · ${heure}` : jour;
}

function nomGlisse(g: Glisse | undefined): string {
  if (!g) return "Élément";
  if (g.type === "tache") return `Tâche « ${g.tache.titre} »`;
  if (g.type === "projet") return `Projet « ${g.projet.titre} »`;
  return `Idée « ${g.idee.texte.slice(0, 60)} »`;
}

/* ---------- Contexte partagé ---------- */
interface EtatGlisser {
  actif: boolean;           // le glisser-déposer est-il disponible dans la vue affichée ?
  enCours: Glisse | null;   // ce qui est en train d'être glissé
  survol: Cible | null;     // la cible sous le pointeur
}
const ContexteGlisser = createContext<EtatGlisser>({ actif: false, enCours: null, survol: null });
export const useGlisser = () => useContext(ContexteGlisser);

/* « D'où » vient une carte : "cal" (calendrier), "chk" (Checklist, Sans date)…
   null = carte non glissable (Liste, Tri, cartes Planifiées/Cochées).
   Le préfixe rend les identifiants uniques : une même tâche peut être affichée deux fois
   (dans la semaine ET dans « Planifiées » sous l'agenda).                              */
export const OrigineGlisser = createContext<string | null>(null);

/* ---------- Capteurs ----------
   Souris : le glissement démarre après 6 px de mouvement, donc un simple clic ouvre
   toujours la tâche. Doigt : appui long de 250 ms (un glissement rapide fait défiler la
   page, comme d'habitude). Les cases à cocher, liens, champs et boutons d'action ne
   déclenchent jamais de glissement (sauf la poignée elle-même).                        */
function surElementInteractif(cible: EventTarget | null): boolean {
  if (!(cible instanceof Element)) return false;
  if (cible.closest("[data-poignee]")) return false;
  return Boolean(cible.closest("input, textarea, select, a, .tache-actions, [data-sans-glisser]"));
}

class CapteurSouris extends MouseSensor {
  static activators = [{
    eventName: "onMouseDown" as const,
    handler: ({ nativeEvent: e }: { nativeEvent: MouseEvent }) => e.button === 0 && !surElementInteractif(e.target),
  }];
}
class CapteurDoigt extends TouchSensor {
  static activators = [{
    eventName: "onTouchStart" as const,
    handler: ({ nativeEvent: e }: { nativeEvent: TouchEvent }) => e.touches.length === 1 && !surElementInteractif(e.target),
  }];
}

/* Clavier : sur la poignée, Espace (ou Entrée) saisit l'élément ; les flèches sautent
   à la zone de dépôt la plus proche DANS LA DIRECTION choisie (jour suivant, créneau
   du dessous…) ; Espace/Entrée dépose ; Échap annule. */
const DIRECTIONS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const coordonneesClavier: KeyboardCoordinateGetter = (event, { context: { collisionRect, droppableRects, droppableContainers } }) => {
  const dir = DIRECTIONS[event.code];
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();
  const cx = collisionRect.left + collisionRect.width / 2;
  const cy = collisionRect.top + collisionRect.height / 2;
  let meilleur: { left: number; top: number; width: number; height: number } | null = null;
  let meilleurScore = Infinity;
  for (const zone of droppableContainers.getEnabled()) {
    const r = droppableRects.get(zone.id);
    if (!r || (zone.data.current as DonneesZone | undefined)?.nav) continue; // les flèches ‹ › : souris/doigt seulement
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const devant = dx * dir[0] + dy * dir[1];        // distance dans la direction voulue
    if (devant <= 4) continue;                        // derrière ou au même endroit
    const decalage = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]); // écart sur le côté
    const score = devant + decalage * 3;
    if (score < meilleurScore) { meilleurScore = score; meilleur = r; }
  }
  if (!meilleur) return undefined;
  return {
    x: meilleur.left + meilleur.width / 2 - collisionRect.width / 2,
    y: meilleur.top + meilleur.height / 2 - collisionRect.height / 2,
  };
};

/* Détection de la zone visée : à la souris et au doigt, la zone SOUS le pointeur
   (et rien si le pointeur est entre deux zones) ; au clavier, la zone la plus proche. */
const detection: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : closestCenter(args));

const zoneDe = (over: Over | null) => (over?.data.current as DonneesZone | undefined) ?? null;
const glisseDe = (active: Active | null) => (active?.data.current as { glisse?: Glisse } | undefined)?.glisse;

/* Annonces pour les lecteurs d'écran (en français). */
const annonces: Announcements = {
  onDragStart: ({ active }) => `${nomGlisse(glisseDe(active))} saisi. Flèches pour choisir un jour ou un créneau, Espace pour déposer, Échap pour annuler.`,
  onDragOver: ({ over }) => (over ? `Au-dessus de : ${zoneDe(over)?.libelle ?? ""}.` : "Hors d'une zone de dépôt."),
  onDragEnd: ({ active, over }) => (zoneDe(over)?.cible
    ? `${nomGlisse(glisseDe(active))} déposé : ${zoneDe(over)?.libelle}.`
    : `${nomGlisse(glisseDe(active))} relâché hors d'une zone ; rien n'a changé.`),
  onDragCancel: () => "Déplacement annulé, rien n'a changé.",
};

/* Fantôme d'une carte très large (vue Jour) : il est limité à LARGEUR_FANTOME px (CSS).
   Si on a saisi la carte loin sur la droite, on le recale pour qu'il reste sous le pointeur. */
const LARGEUR_FANTOME = 420;
const garderSousLePointeur: Modifier = ({ transform, activatorEvent, draggingNodeRect }) => {
  if (!draggingNodeRect || !activatorEvent || draggingNodeRect.width <= LARGEUR_FANTOME) return transform;
  const p = getEventCoordinates(activatorEvent);
  if (!p) return transform;
  const ecart = p.x - draggingNodeRect.left;
  return { ...transform, x: transform.x + ecart - Math.min(ecart, LARGEUR_FANTOME - 60) };
};

const ANIMATION_DEPOT: DropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.35" } } }),
};

/* ---------- Fournisseur : à placer autour de toute la page ---------- */
interface PropsFournisseur {
  actif: boolean;
  onDeposer: (g: Glisse, c: Cible) => void;
  onNaviguer: (sens: -1 | 1) => void;
  rendreTache: (t: Tache, compacte: boolean) => ReactNode; // copie de la carte pour le fantôme
  children: ReactNode;
}

export function FournisseurGlisser({ actif, onDeposer, onNaviguer, rendreTache, children }: PropsFournisseur) {
  const [enCours, setEnCours] = useState<Glisse | null>(null);
  const [survol, setSurvol] = useState<Cible | null>(null);
  const [mouvementReduit, setMouvementReduit] = useState(false);
  const minuterieNav = useRef<ReturnType<typeof setInterval> | null>(null);

  const capteurs = useSensors(
    useSensor(CapteurSouris, { activationConstraint: { distance: 6 } }),
    useSensor(CapteurDoigt, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: coordonneesClavier }),
  );

  useEffect(() => {
    setMouvementReduit(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // Pendant un glissement : curseur « main fermée » partout et pas de sélection de texte.
  useEffect(() => {
    document.body.classList.toggle("glissement-en-cours", enCours !== null);
    document.body.classList.toggle("glissement-hors-zone", enCours !== null && survol === null);
    return () => document.body.classList.remove("glissement-en-cours", "glissement-hors-zone");
  }, [enCours, survol]);

  function arreterNav() {
    if (minuterieNav.current) clearInterval(minuterieNav.current);
    minuterieNav.current = null;
  }
  useEffect(() => arreterNav, []);

  function debut(e: DragStartEvent) {
    setEnCours(glisseDe(e.active) ?? null);
    setSurvol(null);
    // Petit retour haptique au doigt (Android ; iPhone l'ignore).
    if (typeof TouchEvent !== "undefined" && e.activatorEvent instanceof TouchEvent) navigator.vibrate?.(12);
  }

  function survolChange(e: DragOverEvent) {
    const zone = zoneDe(e.over);
    setSurvol(zone?.cible ?? null);
    arreterNav();
    // Garder l'élément au-dessus de ‹ ou › fait défiler les périodes (toutes les 0,8 s).
    if (zone?.nav) {
      const sens = zone.nav;
      minuterieNav.current = setInterval(() => onNaviguer(sens), 800);
    }
  }

  function fin(e: DragEndEvent) {
    arreterNav();
    const g = glisseDe(e.active);
    const cible = zoneDe(e.over)?.cible;
    setEnCours(null);
    setSurvol(null);
    if (g && cible) onDeposer(g, cible);
  }

  function annulation() {
    arreterNav();
    setEnCours(null);
    setSurvol(null);
  }

  const valeur = useMemo(() => ({ actif, enCours, survol }), [actif, enCours, survol]);

  return (
    <ContexteGlisser.Provider value={valeur}>
      <DndContext
        sensors={capteurs}
        collisionDetection={detection}
        // Les zones changent de taille pendant le glissement (réglette de la vue Jour) : on les remesure.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        accessibility={{
          announcements: annonces,
          screenReaderInstructions: { draggable: "Pour déplacer : Espace pour saisir, flèches pour choisir le jour ou le créneau, Espace pour déposer, Échap pour annuler." },
        }}
        onDragStart={debut}
        onDragOver={survolChange}
        onDragEnd={fin}
        onDragCancel={annulation}
      >
        {children}
        <DragOverlay dropAnimation={mouvementReduit ? null : ANIMATION_DEPOT} zIndex={1000} modifiers={[garderSousLePointeur]}>
          {enCours ? <Fantome glisse={enCours} survol={survol} rendreTache={rendreTache} /> : null}
        </DragOverlay>
      </DndContext>
    </ContexteGlisser.Provider>
  );
}

/* ---------- Le « fantôme » qui suit le pointeur ----------
   Une copie légèrement inclinée et surélevée de l'élément, avec une étiquette qui dit
   où il va atterrir (« → mardi 26 novembre · 14:30 ») ou comment annuler.           */
function Fantome({ glisse, survol, rendreTache }: { glisse: Glisse; survol: Cible | null; rendreTache: (t: Tache, compacte: boolean) => ReactNode }) {
  let contenu: ReactNode;
  if (glisse.type === "tache") contenu = rendreTache(glisse.tache, glisse.compacte);
  else if (glisse.type === "projet") contenu = <div className="fantome-pastille"><IconeProjet /> {glisse.projet.titre}</div>;
  else contenu = <div className="fantome-pastille"><IconeIdee /> {glisse.idee.texte}</div>;
  return (
    <div className="fantome">
      <div className="fantome-corps">{contenu}</div>
      <div className={`etiquette-cible${survol ? " visee" : ""}`} aria-hidden="true">
        {survol
          ? <>{survol.date ? "→ " : <IconeChecklist />} {majusculeDebut(libelleCible(survol, glisse))}{glisse.type !== "tache" && survol.date ? " (nouvelle tâche)" : ""}</>
          : <>Relâche sur un jour · <kbd>Échap</kbd> pour annuler</>}
      </div>
    </div>
  );
}
const majusculeDebut = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/* ---------- Rendre un élément glissable ---------- */
export function useGlissable(id: string, glisse: Glisse, desactive = false) {
  const { actif } = useGlisser();
  const possible = actif && !desactive;
  const d = useDraggable({ id, data: { glisse }, disabled: !possible });
  return { ...d, possible };
}

/* La poignée « ⋮⋮ » : visible au survol (souris) et au clavier (Tab). C'est elle qui
   porte le focus clavier ; la souris et le doigt peuvent saisir toute la carte. */
export function Poignee({ glissable, libelle }: { glissable: ReturnType<typeof useGlissable>; libelle: string }) {
  if (!glissable.possible) return null;
  return (
    <button type="button" className="poignee" data-poignee ref={glissable.setActivatorNodeRef}
      {...glissable.attributes} aria-roledescription="élément déplaçable" aria-label={`Déplacer ${libelle}`}
      title="Glisser pour déplacer · au clavier : Espace, flèches, Espace">
      <IconePoignee />
    </button>
  );
}

/* ---------- Zones de dépôt ---------- */
interface PropsZone {
  id: string;
  cible?: Cible;
  nav?: -1 | 1;
  libelle: string;
  as?: "div" | "section" | "li";
  className?: string;
  children?: ReactNode;
}

export function ZoneDepot({ id, cible, nav, libelle, as = "div", className = "", children }: PropsZone) {
  const { actif, enCours } = useGlisser();
  const { setNodeRef, isOver } = useDroppable({ id, data: { cible, nav, libelle } satisfies DonneesZone, disabled: !actif });
  const classes = [className, "zone-depot", enCours && "depot-possible", isOver && enCours && "depot-survol"].filter(Boolean).join(" ");
  return createElement(as, { ref: setNodeRef, className: classes }, children);
}

/* ---------- Vue Jour : réglette de créneaux affichée pendant un glissement ----------
   Une ligne par heure, coupée en :00 et :30. Les tâches déjà prévues sont rappelées
   dans leur créneau (pour éviter les chevauchements). Les heures multiples de 3
   (9h, 12h, 15h…) ont le trait pointillé des repères d'heure (option C).          */
const PREMIERE_HEURE = 6;
const DERNIERE_HEURE = 23;

export function RegletteCreneaux({ iso, taches }: { iso: string; taches: Tache[] }) {
  const { enCours } = useGlisser();
  const heureActuelle = enCours?.type === "tache" && enCours.tache.date === iso ? enCours.tache.heure : null;
  const idGlisse = enCours?.type === "tache" ? enCours.tache.id : null;
  let debut = PREMIERE_HEURE, finH = DERNIERE_HEURE;
  for (const t of taches) if (t.heure) { const h = Number(t.heure.slice(0, 2)); debut = Math.min(debut, h); finH = Math.max(finH, h); }
  const heures: number[] = [];
  for (let h = debut; h <= finH; h++) heures.push(h);
  const jour = formater(depuisISO(iso), { weekday: "long", day: "numeric", month: "long" });

  const occupees = (h: number, m: number) => taches.filter((t) => {
    if (!t.heure || t.id === idGlisse) return false;
    const [th, tm] = t.heure.split(":").map(Number);
    return th === h && tm >= m && tm < m + 30;
  });

  return (
    <div className="reglette" role="group" aria-label={`Créneaux du ${jour}`}>
      <p className="reglette-aide">Choisis un créneau{heureActuelle ? ` (actuellement ${heureActuelle})` : ""}.</p>
      <ZoneDepot id={`creneau:${iso}:`} cible={{ date: iso, heure: "" }} libelle={`${jour}, sans heure`} className="creneau creneau-sans-heure">
        <span>Sans heure</span>
      </ZoneDepot>
      {heures.map((h) => (
        <div key={h} className={`reglette-ligne${h % 3 === 0 ? " repere-3h" : ""}`}>
          <span className="reglette-heure">{h}h</span>
          {[0, 30].map((m) => {
            const heure = `${String(h).padStart(2, "0")}:${m ? "30" : "00"}`;
            const deja = occupees(h, m);
            return (
              <ZoneDepot key={m} id={`creneau:${iso}:${heure}`} cible={{ date: iso, heure }} libelle={`${jour} à ${heure}`}
                className={`creneau${heure === heureActuelle ? " creneau-actuel" : ""}${deja.length ? " creneau-occupe" : ""}`}>
                <span className="creneau-heure">{heure}</span>
                {deja.map((t) => <span key={t.id} className="creneau-tache" title={t.titre}>{t.titre}</span>)}
              </ZoneDepot>
            );
          })}
        </div>
      ))}
    </div>
  );
}
