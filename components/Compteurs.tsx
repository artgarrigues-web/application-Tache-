"use client";

import { useEffect } from "react";
import type { Plage } from "@/lib/dates";
import { estEnRetard } from "@/lib/taches";
import type { Tache } from "@/lib/types";
import { NOM_APP } from "@/lib/marque";

interface Props {
  taches: Tache[];         // toutes les tâches, sans filtre (une entrée par tâche répétée)
  tachesPeriode: Tache[];  // avec toutes les occurrences des tâches répétées de la période
  plage: Plage | null;     // période affichée (null = vue Liste)
}

export function Compteurs({ taches, tachesPeriode, plage }: Props) {
  // Ces valeurs sont recalculées à chaque affichage à partir des données :
  // pas besoin de les stocker dans un état séparé (elles ne peuvent pas se désynchroniser).
  const restantes = taches.filter((t) => !t.faite).length;
  const enRetard = taches.filter(estEnRetard).length;
  const dansPeriode = plage ? tachesPeriode.filter((t) => t.date >= plage.debut && t.date <= plage.fin) : tachesPeriode;
  const faitesPeriode = dansPeriode.filter((t) => t.faite).length;
  const pourcentage = dansPeriode.length ? Math.round((100 * faitesPeriode) / dansPeriode.length) : 0;

  // Nombre de tâches restantes dans le titre de l'onglet du navigateur.
  useEffect(() => {
    document.title = `(${restantes}) ${NOM_APP}`;
  }, [restantes]);

  return (
    <div className="compteurs" aria-live="polite">
      <div className="compteur">
        <span className="nombre">{restantes}</span>
        <span>{restantes > 1 ? "tâches restantes" : "tâche restante"}</span>
      </div>
      {enRetard > 0 && (
        <div className="compteur alerte">
          <span className="nombre">{enRetard}</span>
          <span>en retard</span>
        </div>
      )}
      <div className="compteur" title="Avancement sur la période affichée">
        <span className="nombre">{faitesPeriode}/{dansPeriode.length}</span>
        <span>faites {plage ? "sur la période" : "au total"}</span>
        <div className="progression"><span style={{ width: `${pourcentage}%` }} /></div>
      </div>
    </div>
  );
}
