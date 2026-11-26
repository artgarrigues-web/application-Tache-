"use client";

/* Affichage des événements des agendas externes (Google, Outlook, Apple) dans AgendIA.

   Ils doivent se distinguer des tâches d'un coup d'œil, parce qu'on ne peut pas les
   cocher ni les modifier ici (ils appartiennent à Google / Outlook) :
   - pas de case à cocher, une petite icône d'agenda à la place ;
   - fond rayé discret et bordure gauche en pointillé, à la couleur de l'agenda ;
   - texte un peu plus doux ; nom de l'agenda en petit.
   Un événement marqué « disponible » dans Google est affiché en plus pâle (il
   n'est pas évité par la planification).                                          */

import { createContext, useContext } from "react";
import { CalendarDays } from "lucide-react";
import type { EvenementExterne } from "@/lib/ics-lecture";
import type { Couleur } from "@/lib/types";
import { IconeLieu } from "./Icones";

export const ContexteAgendas = createContext<Map<string, { nom: string; couleur: Couleur | null }>>(new Map());

function classeCouleur(c: Couleur | null | undefined) {
  return c ? `couleur-${c}` : "couleur-ardoise";
}

export function CarteEvenement({ evenement: e, compact = false }: { evenement: EvenementExterne; compact?: boolean }) {
  const agenda = useContext(ContexteAgendas).get(e.agendaId);
  const plage = e.fin && e.fin !== e.heure ? `${e.heure}–${e.fin === "24:00" ? "0:00" : e.fin}` : e.heure;
  return (
    <div className={`evenement ${classeCouleur(agenda?.couleur)}${e.libre ? " libre" : ""}${compact ? " compact" : ""}`}
      title={`${e.titre} · ${plage}${e.lieu ? ` · ${e.lieu}` : ""}\n${agenda?.nom ?? "Agenda externe"}${e.libre ? " (marqué disponible)" : ""} — à modifier dans ton agenda d'origine`}>
      <CalendarDays aria-hidden="true" className="evenement-icone" />
      <div className="evenement-corps">
        <span className="evenement-titre"><span className="tache-heure">{plage}</span> {e.titre}</span>
        {!compact && (
          <span className="evenement-infos">
            {agenda?.nom ?? "Agenda externe"}
            {e.lieu && <> · <IconeLieu /> {e.lieu}</>}
            {e.libre && " · disponible"}
          </span>
        )}
      </div>
    </div>
  );
}

// Événements « toute la journée » : une ligne de pastilles en haut du jour.
export function EvenementsJournee({ evenements }: { evenements: EvenementExterne[] }) {
  const agendas = useContext(ContexteAgendas);
  if (evenements.length === 0) return null;
  return (
    <div className="evenements-journee">
      {evenements.map((e) => (
        <span key={e.id} className={`pastille-journee ${classeCouleur(agendas.get(e.agendaId)?.couleur)}`}
          title={`${e.titre} · toute la journée · ${agendas.get(e.agendaId)?.nom ?? "Agenda externe"}`}>
          <CalendarDays aria-hidden="true" /> {e.titre}
        </span>
      ))}
    </div>
  );
}
