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
  periode?: string;        // « la semaine », « le mois »… (libellé de la période affichée)
}

/* Le bilan en une phrase (« 14 à faire · 2 en retard · 3 sur 12 faites sur la semaine »)
   plutôt que trois boîtes à gros chiffres : on le lit comme une note, pas comme un tableau
   de bord. Le rouge ne sert qu'au retard ; la barre fine montre l'avancement. */
export function Compteurs({ taches, tachesPeriode, plage, periode = "la période" }: Props) {
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
      <p className="bilan">
        <span><strong>{restantes}</strong> à faire</span>
        {enRetard > 0 && <span className="alerte"><strong>{enRetard}</strong> en retard</span>}
        <span title="Avancement sur la période affichée">
          <strong>{faitesPeriode}</strong> sur {dansPeriode.length} faite{faitesPeriode > 1 ? "s" : ""} {plage ? `sur ${periode}` : "au total"}
        </span>
      </p>
      <div className="progression" aria-hidden="true"><span style={{ width: `${pourcentage}%` }} /></div>
    </div>
  );
}
