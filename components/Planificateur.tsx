"use client";

/* Fenêtre « Planifier ma semaine » : 2 étapes.
     1. Réglages : semaine visée + plages de disponibilité (jours et heures).
     2. Choix : 3 propositions calculées par lib/planification.ts (sans IA),
        prévisualisation détaillée, puis « Appliquer » → les tâches de la
        Checklist reçoivent une date et une heure.
   Rien n'est écrit en base avant le clic sur « Appliquer ».                   */

import { useEffect, useMemo, useRef, useState } from "react";
import { aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import * as depot from "@/lib/depot";
import {
  decalerISO, JOURS_LONGS, PLAGES_PAR_DEFAUT, proposerPlannings, validerPlages, versHHMM, versMinutes,
  type IdStrategie, type PlageDispo, type Planning,
} from "@/lib/planification";
import { formaterDuree, heureFin } from "@/lib/taches";
import type { Tache } from "@/lib/types";
import { IconeAjouter, IconeAlerte, IconeContinuer, IconeEchec, IconeEquilibre, IconeFermer, IconeLieu, IconePlanifier, IconeRetour, IconeSucces } from "./Icones";

const CLE_PLAGES = "agenda-plages-dispo"; // copie de secours dans le navigateur

interface Props {
  taches: Tache[];
  onAppliquer: (planning: Planning) => Promise<boolean>;
  onFermer: () => void;
  occupe?: { date: string; debut: string; fin: string }[]; // événements Google / Outlook à éviter
  nbAgendas?: number;
  onAgendas?: () => void; // ouvre « Mes agendas »
}

export function Planificateur({ taches, onAppliquer, onFermer, occupe = [], nbAgendas = 0, onAgendas }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [etape, setEtape] = useState<"reglages" | "choix">("reglages");
  const [plages, setPlages] = useState<PlageDispo[]>(PLAGES_PAR_DEFAUT);
  const [chargees, setChargees] = useState(false);
  const [noteStockage, setNoteStockage] = useState("");
  const [decalage, setDecalage] = useState(0); // 0 = cette semaine, 1 = la suivante…
  const [choisi, setChoisi] = useState<IdStrategie>("echeances");
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
    // Plages : d'abord la base (suivent l'utilisateur sur tous ses appareils), sinon le navigateur, sinon 8 h–20 h.
    (async () => {
      let trouvees: PlageDispo[] | null = null;
      try {
        trouvees = validerPlages(await depot.lirePlages());
      } catch {
        setNoteStockage("Tes plages ne sont gardées que sur cet appareil (la table « disponibilites » n'existe pas encore dans la base).");
      }
      if (!trouvees) {
        try { trouvees = validerPlages(JSON.parse(localStorage.getItem(CLE_PLAGES) ?? "null")); } catch { /* rien */ }
      }
      if (trouvees) setPlages(trouvees);
      setChargees(true);
    })();
  }, []);

  const lundi = versISO(debutSemaine(aujourdhui()));
  const lundiVise = decalerISO(lundi, 7 * decalage);
  const aPlacer = taches.filter((t) => !t.faite && t.date === "");

  // useMemo : les 3 calculs ne sont refaits que si les tâches, la semaine ou les plages changent.
  const plannings = useMemo(
    () => (etape === "choix" ? proposerPlannings({ taches, lundi: lundiVise, plages, maintenant: new Date(), occupe }) : []),
    [etape, taches, lundiVise, plages, occupe],
  );
  const planning = plannings.find((p) => p.id === choisi);

  /* ---------- Édition des plages ---------- */
  function majPlage(index: number, champ: "debut" | "fin", valeur: string) {
    setPlages((ps) => ps.map((p, i) => (i === index ? { ...p, [champ]: valeur } : p)));
  }
  function ajouterPlage(jour: number) {
    const duJour = plages.filter((p) => p.jour === jour);
    const derniere = duJour[duJour.length - 1];
    const debut = derniere ? derniere.fin : "08:00";
    const fin = versHHMM(Math.min(versMinutes(debut) + 120, 23 * 60 + 59)); // nouvelle plage de 2 h par défaut
    setPlages((ps) => [...ps, { jour, debut, fin }]);
  }
  const retirerPlage = (index: number) => setPlages((ps) => ps.filter((_, i) => i !== index));
  function copierLundi(jours: number[]) {
    const modele = plages.filter((p) => p.jour === 0);
    setPlages((ps) => [...ps.filter((p) => !jours.includes(p.jour)), ...jours.flatMap((j) => modele.map((m) => ({ ...m, jour: j })))]
      .sort((a, b) => a.jour - b.jour || a.debut.localeCompare(b.debut)));
  }
  const plagesValides = validerPlages(plages) ?? [];
  const invalides = plages.length - plagesValides.length;

  async function voirPropositions() {
    setPlages(plagesValides);
    try { localStorage.setItem(CLE_PLAGES, JSON.stringify(plagesValides)); } catch { /* navigateur privé */ }
    try {
      await depot.enregistrerPlages(plagesValides);
      setNoteStockage("");
    } catch {
      setNoteStockage("Tes plages ne sont gardées que sur cet appareil (la table « disponibilites » n'existe pas encore dans la base).");
    }
    setEtape("choix");
  }

  async function appliquer() {
    if (!planning || planning.placements.length === 0) return;
    setEnCours(true);
    const ok = await onAppliquer(planning);
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  const titreSemaine = (iso: string) => {
    const d = depuisISO(iso);
    return `semaine du ${formater(d, { day: "numeric", month: "long" })}`;
  };

  return (
    <dialog ref={dialogue} aria-labelledby="titre-planif" onClose={onFermer} className="dialogue-large">
      <div className="formulaire planif">
        <h2 id="titre-planif"><IconePlanifier /> Planifier ma semaine</h2>

        {etape === "reglages" ? (
          <>
            <p className="indice">
              {aPlacer.length === 0
                ? "Ta Checklist est vide : il n'y a aucune tâche sans date à placer."
                : <>{aPlacer.length} tâche(s) de la Checklist à placer. Les créneaux déjà pris par tes tâches datées <strong>avec heure</strong> sont évités. Rien n&apos;est modifié avant que tu choisisses un planning.</>}
            </p>

            <p className={`note-agendas${nbAgendas ? " branche" : ""}`}>
              {nbAgendas
                ? <><IconeSucces /> {occupe.filter((o) => o.date >= lundiVise && o.date <= decalerISO(lundiVise, 6)).length} événement(s) de tes agendas (Google, Outlook…) seront aussi évités cette semaine-là.</>
                : <><IconeAlerte /> Tes cours et rendez-vous de Google / Outlook ne sont pas encore visibles par AgendIA.{" "}
                  {onAgendas && <button type="button" className="lien" onClick={onAgendas}>Brancher mon agenda</button>}</>}
            </p>

            <div className="ligne-semaine">
              <span>Semaine à planifier :</span>
              <div className="onglets">
                {[0, 1, 2].map((d) => (
                  <button key={d} type="button" className={decalage === d ? "actif" : ""} onClick={() => setDecalage(d)}>
                    {d === 0 ? "Cette semaine" : d === 1 ? "La suivante" : "Dans 2 semaines"}
                  </button>
                ))}
              </div>
            </div>

            <fieldset className="plages">
              <legend>Mes disponibilités (chaque semaine)</legend>
              {!chargees ? <p className="vide">Chargement…</p> : JOURS_LONGS.map((nom, jour) => {
                const duJour = plages.map((p, i) => ({ p, i })).filter((x) => x.p.jour === jour);
                return (
                  <div key={jour} className="plage-jour">
                    <span className="plage-nom">{nom}</span>
                    <div className="plage-liste">
                      {duJour.length === 0 && <span className="indice">Indisponible</span>}
                      {duJour.map(({ p, i }) => (
                        <span key={i} className={`plage ${versMinutes(p.fin) > versMinutes(p.debut) ? "" : "plage-erreur"}`}>
                          <input type="time" aria-label={`${nom} début`} value={p.debut} onChange={(e) => majPlage(i, "debut", e.target.value)} />
                          –
                          <input type="time" aria-label={`${nom} fin`} value={p.fin} onChange={(e) => majPlage(i, "fin", e.target.value)} />
                          <button type="button" className="btn-icone" aria-label="Retirer cette plage" onClick={() => retirerPlage(i)}><IconeFermer /></button>
                        </span>
                      ))}
                      <button type="button" className="lien" onClick={() => ajouterPlage(jour)}><IconeAjouter /> plage</button>
                    </div>
                  </div>
                );
              })}
              <div className="plage-raccourcis">
                <button type="button" className="lien" onClick={() => copierLundi([1, 2, 3, 4])}>Copier lundi sur mardi → vendredi</button>
                <button type="button" className="lien" onClick={() => copierLundi([1, 2, 3, 4, 5, 6])}>Copier lundi sur toute la semaine</button>
                <button type="button" className="lien" onClick={() => setPlages(PLAGES_PAR_DEFAUT)}>Rétablir 8 h–20 h</button>
              </div>
              {invalides > 0 && <p className="avertissement"><IconeAlerte /> {invalides} plage(s) dont la fin n&apos;est pas après le début seront ignorées.</p>}
            </fieldset>
            {noteStockage && <p className="indice">{noteStockage}</p>}

            <div className="boutons-dialogue">
              <button type="button" className="btn" onClick={() => dialogue.current?.close()}>Fermer</button>
              <button type="button" className="btn btn-principal" disabled={!chargees || aPlacer.length === 0 || plagesValides.length === 0}
                onClick={voirPropositions}>
                Voir les propositions <IconeContinuer />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="indice">Trois façons de remplir ta {titreSemaine(lundiVise)}. Choisis-en une, regarde le détail, puis applique-la.</p>
            {noteStockage && <p className="indice">{noteStockage}</p>}

            <div className="propositions" role="radiogroup" aria-label="Propositions de planning">
              {plannings.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={choisi === p.id}
                  className={`proposition ${choisi === p.id ? "choisie" : ""}`} onClick={() => setChoisi(p.id)}>
                  <strong>{p.nom}</strong>
                  <span className="indice">{p.description}</span>
                  <span className="stats">
                    <span><IconeSucces /> {p.placements.length}/{p.placements.length + p.nonPlaces.length} placées</span>
                    {p.stats.apresEcheance > 0 && <span className="alerte"><IconeAlerte /> {p.stats.apresEcheance} après échéance</span>}
                    {p.nonPlaces.length > 0 && <span className="alerte"><IconeEchec /> {p.nonPlaces.length} sans place</span>}
                    <span><IconeLieu /> {p.stats.changementsDeLieu} changement(s) de lieu</span>
                    <span><IconeEquilibre /> écart entre jours : {p.stats.ecartCharge ? formaterDuree(p.stats.ecartCharge) : "0"}</span>
                  </span>
                  {p.identiqueA && <span className="indice">= même résultat que « {plannings.find((q) => q.id === p.identiqueA)!.nom} »</span>}
                </button>
              ))}
            </div>

            {planning && <Apercu planning={planning} />}

            <div className="boutons-dialogue">
              <button type="button" className="btn" onClick={() => setEtape("reglages")}><IconeRetour /> Modifier les réglages</button>
              <button type="button" className="btn btn-principal" disabled={enCours || !planning || planning.placements.length === 0} onClick={appliquer}>
                {enCours ? "Application…" : `Appliquer « ${planning?.nom ?? ""} »`}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

// Détail jour par jour du planning sélectionné.
function Apercu({ planning }: { planning: Planning }) {
  const parJour = new Map<string, Planning["placements"]>();
  for (const p of planning.placements) parJour.set(p.date, [...(parJour.get(p.date) ?? []), p]);
  return (
    <div className="apercu">
      {planning.placements.length === 0 && <p className="vide">Aucune tâche n&apos;a pu être placée avec ces disponibilités.</p>}
      {[...parJour.entries()].map(([date, liste]) => (
        <div key={date} className="apercu-jour">
          <h3>{majuscule(formater(depuisISO(date), { weekday: "long", day: "numeric", month: "long" }))}</h3>
          <ul>
            {liste.map((p) => (
              <li key={p.tacheId}>
                <span className="tache-heure">{p.heure}–{heureFin(p.heure, p.dureeMinutes)}</span> {p.titre}
                {p.lieu && <span className="indice"> · <IconeLieu /> {p.lieu}</span>}
                {p.dureeParDefaut && <span className="indice"> · durée inconnue → 1 h</span>}
                {p.apresEcheance && <span className="alerte"> · <IconeAlerte /> après l&apos;échéance (aucune place avant)</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {planning.nonPlaces.length > 0 && (
        <div className="apercu-jour">
          <h3>Restent dans la Checklist</h3>
          <ul>
            {planning.nonPlaces.map((n) => <li key={n.tacheId}>{n.titre} <span className="indice">: {n.raison}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
