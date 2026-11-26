"use client";

/* Balayage d'une carte sur téléphone (inspiré de Todoist et Things) :
   - vers la droite → cocher (ou décocher) la tâche ;
   - vers la gauche → la reporter : au lendemain, ou à aujourd'hui si elle est en retard.
   Le doigt doit parcourir SEUIL_ACTION pixels ; en dessous, la carte revient en place.

   Activé seulement quand un composant parent fournit ContexteBalayage (Agenda, sur
   téléphone). Sur ordinateur, la carte s'affiche telle quelle.

   Cohabitation avec les autres gestes :
   - défilement vertical : on ne réagit que si le mouvement est surtout horizontal
     (et touch-action: pan-y laisse le navigateur faire défiler) ;
   - glisser-déposer : il ne démarre qu'après un appui long immobile (0,25 s), un
     balayage bouge tout de suite, donc les deux ne se confondent pas ;
   - balayage de la journée (changer de jour) : un balayage de carte s'arrête à la carte. */

import { createContext, useRef, useState, type PointerEvent as EvPointeur, type ReactNode } from "react";
import { aujourdhui, versISO } from "@/lib/dates";
import type { Tache } from "@/lib/types";
import { IconeContinuer, IconeValide } from "./Icones";

export const ContexteBalayage = createContext<((t: Tache) => void) | null>(null);

const SEUIL_ACTION = 90;

export function Balayable({ tache, onCocher, onReporter, children }: {
  tache: Tache; onCocher: () => void; onReporter: (t: Tache) => void; children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const depart = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const aBouge = useRef(false);
  const retard = !!tache.date && tache.date < versISO(aujourdhui());

  const bas = (e: EvPointeur) => { depart.current = { x: e.clientX, y: e.clientY, horizontal: null }; aBouge.current = false; };
  const deplace = (e: EvPointeur) => {
    const d = depart.current;
    if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    if (d.horizontal === null && Math.hypot(mx, my) > 8) d.horizontal = Math.abs(mx) > Math.abs(my);
    if (d.horizontal) {
      aBouge.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDx(Math.max(-140, Math.min(140, mx)));
    }
  };
  const haut = (e: EvPointeur) => {
    if (aBouge.current) e.stopPropagation(); // ne pas changer aussi de jour
    if (dx > SEUIL_ACTION) onCocher();
    else if (dx < -SEUIL_ACTION && tache.date) onReporter(tache);
    depart.current = null;
    setDx(0);
  };

  return (
    <div className={`balayable${dx ? " en-cours" : ""}`}
      onPointerDown={bas} onPointerMove={deplace} onPointerUp={haut} onPointerCancel={haut}
      // Après un balayage, le « clic » qui suit ne doit pas ouvrir le formulaire.
      onClickCapture={(e) => { if (aBouge.current) { e.stopPropagation(); e.preventDefault(); aBouge.current = false; } }}>
      <div className={`fond-action gauche${dx > SEUIL_ACTION ? " pret" : ""}`} style={{ opacity: dx > 0 ? 1 : 0 }} aria-hidden="true">
        <IconeValide /> {tache.faite ? "À refaire" : "Fait"}
      </div>
      <div className={`fond-action droite${dx < -SEUIL_ACTION ? " pret" : ""}`} style={{ opacity: dx < 0 ? 1 : 0 }} aria-hidden="true">
        {tache.date ? (retard ? "Aujourd'hui" : "Demain") : "—"} <IconeContinuer />
      </div>
      <div className="balayable-carte" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}>
        {children}
      </div>
    </div>
  );
}
