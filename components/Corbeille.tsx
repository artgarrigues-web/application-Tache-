"use client";

/* Fenêtre « Corbeille » : les tâches supprimées depuis moins de 30 jours.
   Pour chacune : Restaurer (elle revient exactement à sa place, avec sa date, son
   heure, sa répétition…) ou Supprimer définitivement. La base efface d'elle-même
   les tâches restées plus de 30 jours (tâche planifiée chaque nuit).              */

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { depuisISO, formater } from "@/lib/dates";
import { JOURS_CORBEILLE } from "@/lib/depot";
import type { Tache } from "@/lib/types";
import { IconeChecklist, IconeFermer, IconeRepeter, IconeSupprimer } from "./Icones";

interface Props {
  lister: () => Promise<Tache[]>;
  restaurer: (ids: string[]) => Promise<boolean>;
  supprimerDefinitivement: (ids: string[]) => Promise<boolean>;
  disponible: boolean;
  onFermer: () => void;
}

function ilYA(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} h`;
  const jours = Math.round(heures / 24);
  return jours === 1 ? "hier" : `il y a ${jours} jours`;
}
function joursRestants(iso: string): number {
  return Math.max(0, JOURS_CORBEILLE - Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

export function Corbeille({ lister, restaurer, supprimerDefinitivement, disponible, onFermer }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [liste, setListe] = useState<Tache[] | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null); // id en cours de traitement ("tout" = vider)
  const [message, setMessage] = useState("");

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
    lister().then(setListe).catch(() => setListe([]));
  }, [lister]);

  async function remettre(t: Tache) {
    setEnCours(t.id);
    if (await restaurer([t.id])) {
      setListe((l) => l?.filter((x) => x.id !== t.id) ?? null);
      setMessage(`« ${t.titre} » est revenue dans ton agenda.`);
    }
    setEnCours(null);
  }
  async function effacer(t: Tache) {
    if (!confirm(`Supprimer définitivement « ${t.titre} » ? Elle ne pourra plus être récupérée.`)) return;
    setEnCours(t.id);
    if (await supprimerDefinitivement([t.id])) setListe((l) => l?.filter((x) => x.id !== t.id) ?? null);
    setEnCours(null);
  }
  async function vider() {
    if (!liste?.length || !confirm(`Vider la corbeille ? Les ${liste.length} tâche(s) seront supprimées définitivement.`)) return;
    setEnCours("tout");
    if (await supprimerDefinitivement(liste.map((t) => t.id))) { setListe([]); setMessage("Corbeille vidée."); }
    setEnCours(null);
  }

  return (
    <dialog ref={dialogue} aria-labelledby="titre-corbeille" onClose={onFermer} className="dialogue-corbeille">
      <div className="formulaire">
        <div className="titre-dialogue-ligne">
          <h2 id="titre-corbeille"><IconeSupprimer /> Corbeille</h2>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => dialogue.current?.close()}><IconeFermer /></button>
        </div>
        <p className="indice">
          {disponible
            ? <>Les tâches supprimées restent ici <strong>{JOURS_CORBEILLE} jours</strong>, puis sont effacées automatiquement.</>
            : "La corbeille n'est pas encore activée dans la base : pour l'instant, une tâche supprimée est effacée tout de suite."}
        </p>
        {message && <p className="message-info" role="status">{message}</p>}

        {liste === null ? <p className="vide">Chargement…</p>
          : liste.length === 0 ? (
            <div className="corbeille-vide">
              <IconeSupprimer />
              <p><strong>La corbeille est vide.</strong><br />Une tâche supprimée par erreur se retrouve ici.</p>
            </div>
          ) : (
            <ul className="liste-corbeille">
              {liste.map((t) => (
                <li key={t.id} className={`ligne-corbeille${t.couleur ? ` avec-couleur couleur-${t.couleur}` : ` cat-${t.categorie}`}`}>
                  <div className="ligne-corbeille-texte">
                    <strong>{t.titre}{t.recurrence && <span className="icone-repetition" title="Tâche répétée"><IconeRepeter /></span>}</strong>
                    <span className="indice">
                      {t.date ? formater(depuisISO(t.date), { weekday: "short", day: "numeric", month: "short" }) + (t.heure ? ` · ${t.heure}` : "") : <><IconeChecklist /> Sans date</>}
                      {t.supprimeeLe && <> · supprimée {ilYA(t.supprimeeLe)} · encore {joursRestants(t.supprimeeLe)} j</>}
                    </span>
                  </div>
                  <div className="ligne-corbeille-actions">
                    <button type="button" className="btn" disabled={enCours !== null} onClick={() => remettre(t)}>
                      <RotateCcw aria-hidden="true" /> Restaurer
                    </button>
                    <button type="button" className="btn-icone btn-effacer" disabled={enCours !== null} aria-label={`Supprimer définitivement « ${t.titre} »`}
                      title="Supprimer définitivement" onClick={() => effacer(t)}><IconeSupprimer /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}

        <div className="boutons-dialogue">
          {!!liste?.length && <button type="button" className="btn btn-danger" id="btn-supprimer-dialogue" disabled={enCours !== null} onClick={vider}>Vider la corbeille</button>}
          <button type="button" className="btn btn-principal" onClick={() => dialogue.current?.close()}>Fermer</button>
        </div>
      </div>
    </dialog>
  );
}
