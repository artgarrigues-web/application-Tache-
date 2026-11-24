"use client";

/* Petite fenêtre affichée quand on supprime (icône corbeille) une occurrence d'une
   tâche répétée : trois choix clairs au lieu d'un simple « OK / Annuler ».        */

import { useEffect, useRef, useState } from "react";
import { dateLongue } from "@/lib/recurrence";
import type { Portee } from "@/lib/types";
import { IconeRepeter, IconeSupprimer } from "./Icones";

interface Props {
  titre: string;
  date: string;
  onChoisir: (p: Portee) => Promise<boolean>;
  onFermer: () => void;
}

const CHOIX: { id: Portee; libelle: string; detail: string }[] = [
  { id: "occurrence", libelle: "Ce jour seulement", detail: "Les autres jours de la série restent." },
  { id: "suivantes", libelle: "Ce jour et les suivants", detail: "La série s'arrête la veille ; le passé est gardé." },
  { id: "serie", libelle: "Toute la série", detail: "Tous les jours, passés compris, sont supprimés." },
];

export function ChoixPortee({ titre, date, onChoisir, onFermer }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function choisir(p: Portee) {
    setEnCours(true);
    const ok = await onChoisir(p);
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  return (
    <dialog ref={dialogue} className="dialogue-portee" aria-labelledby="titre-portee" onClose={onFermer}>
      <div className="formulaire">
        <h2 id="titre-portee"><IconeSupprimer /> Supprimer « {titre} »</h2>
        <p className="indice"><IconeRepeter /> Tâche répétée — occurrence du {dateLongue(date)}.</p>
        <div className="choix-portee">
          {CHOIX.map((c) => (
            <button key={c.id} type="button" className={`btn choix-portee-btn${c.id === "serie" ? " danger" : ""}`}
              disabled={enCours} onClick={() => choisir(c.id)}>
              <strong>{c.libelle}</strong>
              <span>{c.detail}</span>
            </button>
          ))}
        </div>
        <div className="boutons-dialogue">
          <button type="button" className="btn" onClick={() => dialogue.current?.close()}>Annuler</button>
        </div>
      </div>
    </dialog>
  );
}
