"use client";

/* Repères d'heure dans les vues Jour et Semaine.
   Choix d'Arthur (24/11/2026) : variante C par défaut. Les variantes A, B et D sont
   GARDÉES DE CÔTÉ exprès (Arthur a une idée pour elles plus tard) : on peut les voir
   en ajoutant à l'adresse ?reperes=a | b | d (ou ?reperes=aucune pour l'ancien affichage).
   Pour en changer définitivement, il suffit de modifier VARIANTE_PAR_DEFAUT.

   a : repères fixes toutes les 4 h (8h, 12h, 16h, 20h), toujours visibles ;
   b : intertitres « Matin / Après-midi / Soir », seulement pour les moments qui ont des tâches ;
   c : repères discrets en pointillé toutes les 3 h, seulement ENTRE deux tâches (regroupés sur une ligne) ;
   d : vraie grille horaire (hauteur proportionnelle au temps), une ligne toutes les 3 h.      */

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Tache } from "@/lib/types";
import { CarteTache, ListeTaches, type ActionsAgenda } from "./CarteTache";

export type VarianteReperes = "aucune" | "a" | "b" | "c" | "d";

export const VARIANTE_PAR_DEFAUT: VarianteReperes = "c";

export function useVarianteReperes(): VarianteReperes {
  const [variante, setVariante] = useState<VarianteReperes>(VARIANTE_PAR_DEFAUT);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("reperes");
    if (p === "aucune" || p === "a" || p === "b" || p === "c" || p === "d") setVariante(p);
  }, []);
  return variante;
}

const enMinutes = (heure: string) => { const [h, m] = heure.split(":").map(Number); return h * 60 + m; };

/* Plage d'heures affichée par la grille (variante d) : 8h–20h au minimum,
   élargie si une tâche commence plus tôt ou finit plus tard. Calculée sur toute
   la semaine pour que les colonnes restent alignées.                           */
export interface Plage { debut: number; fin: number } // en heures entières
export function plageDe(taches: Tache[]): Plage {
  let debut = 8, fin = 20;
  for (const t of taches) {
    if (!t.heure) continue;
    const d = enMinutes(t.heure);
    debut = Math.min(debut, Math.floor(d / 60));
    fin = Math.max(fin, Math.min(24, Math.ceil((d + (t.dureeMinutes ?? 60)) / 60)));
  }
  return { debut, fin };
}

interface Props {
  taches: Tache[];
  actions: ActionsAgenda;
  variante: VarianteReperes;
  messageVide?: ReactNode;
  plage?: Plage;
  hauteurHeure?: number; // pixels par heure (variante d)
}

export function ListeAvecReperes({ taches, actions, variante, messageVide, plage, hauteurHeure = 44 }: Props) {
  if (variante === "aucune") return <ListeTaches taches={taches} actions={actions} messageVide={messageVide} />;
  if (variante === "d") return <GrilleHoraire taches={taches} actions={actions} plage={plage ?? plageDe(taches)} hauteurHeure={hauteurHeure} messageVide={messageVide} />;

  const avecHeure = taches.filter((t) => t.heure);
  const sansHeure = taches.filter((t) => !t.heure);
  const elements: ReactNode[] = [];
  const carte = (t: Tache) => <CarteTache key={t.id} tache={t} actions={actions} />;

  if (variante === "a") {
    const reperes = [8, 12, 16, 20];
    let i = 0;
    const poser = (jusqua: number) => {
      while (i < reperes.length && reperes[i] * 60 <= jusqua) {
        elements.push(<div key={`r${reperes[i]}`} className="repere repere-a"><span>{reperes[i]}h</span></div>);
        i++;
      }
    };
    for (const t of avecHeure) { poser(enMinutes(t.heure)); elements.push(carte(t)); }
    poser(24 * 60);
  } else if (variante === "b") {
    const moment = (m: number) => (m < 12 * 60 ? "Matin" : m < 18 * 60 ? "Après-midi" : "Soir");
    let courant = "";
    for (const t of avecHeure) {
      const nom = moment(enMinutes(t.heure));
      if (nom !== courant) { elements.push(<div key={`m${nom}`} className="repere repere-b"><span>{nom}</span></div>); courant = nom; }
      elements.push(carte(t));
    }
  } else {
    let precedente = -1;
    for (const t of avecHeure) {
      const m = enMinutes(t.heure);
      if (precedente >= 0) {
        // Une seule ligne par intervalle, même si plusieurs repères sont franchis (ex. « 9h · 12h »).
        const franchies: number[] = [];
        for (let h = 3; h < 24; h += 3) if (precedente < h * 60 && h * 60 <= m) franchies.push(h);
        if (franchies.length > 0) elements.push(<div key={`c${franchies[0]}`} className="repere repere-c"><span>{franchies.map((h) => `${h}h`).join(" · ")}</span></div>);
      }
      elements.push(carte(t));
      precedente = m;
    }
  }

  return (
    <div className="liste-taches">
      {taches.length === 0 && messageVide && <p className="vide">{messageVide}</p>}
      {elements}
      {sansHeure.length > 0 && avecHeure.length > 0 && <div className="repere repere-sans"><span>Sans heure</span></div>}
      {sansHeure.map(carte)}
    </div>
  );
}

/* ---------- Variante d : grille horaire proportionnelle ----------
   Chaque tâche est placée à sa hauteur exacte (top = heure de début) et sa
   hauteur suit sa durée (minimum 45 min pour rester lisible). Deux tâches qui
   se chevauchent sont mises côte à côte (algorithme glouton par « couloirs »). */
const DUREE_MIN_AFFICHEE = 45;

function GrilleHoraire({ taches, actions, plage, hauteurHeure, messageVide }: { taches: Tache[]; actions: ActionsAgenda; plage: Plage; hauteurHeure: number; messageVide?: ReactNode }) {
  const avecHeure = taches.filter((t) => t.heure);
  const sansHeure = taches.filter((t) => !t.heure);

  // Couloirs : chaque tâche prend le premier couloir libre ; un « paquet » = tâches qui se chevauchent en chaîne.
  const places: { t: Tache; debut: number; fin: number; couloir: number; paquet: number }[] = [];
  const finsCouloirs: number[] = [];
  let paquet = 0, finPaquet = -1;
  for (const t of avecHeure) {
    const debut = enMinutes(t.heure);
    const fin = debut + Math.max(t.dureeMinutes ?? 60, DUREE_MIN_AFFICHEE);
    if (debut >= finPaquet) { paquet++; finsCouloirs.length = 0; }
    let couloir = finsCouloirs.findIndex((f) => f <= debut);
    if (couloir === -1) { couloir = finsCouloirs.length; finsCouloirs.push(fin); } else finsCouloirs[couloir] = fin;
    finPaquet = Math.max(finPaquet, fin);
    places.push({ t, debut, fin, couloir, paquet });
  }
  const largeurPaquet = new Map<number, number>();
  for (const p of places) largeurPaquet.set(p.paquet, Math.max(largeurPaquet.get(p.paquet) ?? 0, p.couloir + 1));

  const heures: number[] = [];
  for (let h = plage.debut; h <= plage.fin; h++) heures.push(h);

  return (
    <div className={`liste-taches${avecHeure.length === 0 ? " grille-vide" : ""}`}>
      {taches.length === 0 && messageVide && <p className="vide">{messageVide}</p>}
      <div className="grille-horaire" style={{ height: (plage.fin - plage.debut) * hauteurHeure } as CSSProperties}>
        {heures.map((h) => (
          <Fragment key={h}>
            {h % 3 === 0 && (
              <div className="ligne-heure" style={{ top: (h - plage.debut) * hauteurHeure }}><span>{h}h</span></div>
            )}
          </Fragment>
        ))}
        {places.map(({ t, debut, fin, couloir, paquet: pq }) => {
          const n = largeurPaquet.get(pq) ?? 1;
          return (
            <div key={t.id} className="place-tache" style={{
              top: ((debut - plage.debut * 60) / 60) * hauteurHeure,
              height: ((fin - debut) / 60) * hauteurHeure - 2,
              left: `calc(var(--marge-heures) + (100% - var(--marge-heures)) * ${couloir / n})`,
              width: `calc((100% - var(--marge-heures)) / ${n} - 2px)`,
            }}>
              <CarteTache tache={t} actions={actions} compacte />
            </div>
          );
        })}
      </div>
      {sansHeure.length > 0 && <><div className="repere repere-sans"><span>Sans heure</span></div>{sansHeure.map((t) => <CarteTache key={t.id} tache={t} actions={actions} compacte />)}</>}
    </div>
  );
}
