"use client";

/* Affichage d'UNE tâche, et d'une liste de tâches.
   En React, on décrit l'écran en JSX (du HTML dans du TypeScript) à partir
   des données. React échappe automatiquement le texte inséré avec {…} :
   un titre contenant "<script>" s'affiche comme du texte (protection XSS).  */

import type { ReactNode } from "react";
import { aujourdhui, formater, depuisISO, versISO } from "@/lib/dates";
import { estEnRetard, formaterDuree, groupesDe, heureFin, lienCarte, listeMateriel } from "@/lib/taches";
import { CATEGORIES, GROUPES, PRIORITES, type Tache } from "@/lib/types";
import { IconeChecklist, IconeDuree, IconeEcheance, IconeGroupe, IconeLieu, IconeMateriel, IconeModifier, IconeSupprimer } from "./Icones";

// Les actions possibles depuis une vue de l'agenda, fournies par le composant Agenda.
export interface ActionsAgenda {
  cocher: (id: string) => void;
  modifier: (id: string) => void;
  supprimer: (id: string) => void;
  ajouterLe: (dateISO: string) => void;
  allerAuJour: (dateISO: string) => void;
  planifier?: () => void; // ouvre la planification automatique (bouton de l'onglet Checklist)
}

interface Props {
  tache: Tache;
  actions: ActionsAgenda;
  compacte?: boolean;   // version réduite (vue Mois)
  avecDate?: boolean;
}

export function CarteTache({ tache, actions, compacte = false, avecDate = false }: Props) {
  const retard = estEnRetard(tache);
  const materiel = listeMateriel(tache.materiel);
  const groupes = groupesDe(tache);
  const classes = [
    "tache", `cat-${tache.categorie}`, `prio-${tache.priorite}`,
    compacte && "compacte", tache.faite && "faite", retard && "retard",
    groupes.includes("urgent") && "urgente",
  ].filter(Boolean).join(" ");

  return (
    <article className={classes}>
      <input
        type="checkbox"
        checked={tache.faite}
        onChange={() => actions.cocher(tache.id)}
        aria-label={`Marquer « ${tache.titre} » comme ${tache.faite ? "à faire" : "faite"}`}
      />

      <div
        className="tache-corps"
        role="button"
        tabIndex={0}
        title="Cliquer pour modifier"
        onClick={() => actions.modifier(tache.id)}
        onKeyDown={(e) => { if (e.key === "Enter") actions.modifier(tache.id); }}
      >
        <div className="tache-titre">
          <span className={`point-prio point-${tache.priorite}`} />
          {tache.heure && (
            <span className="tache-heure">
              {tache.heure}
              {tache.dureeMinutes ? `–${heureFin(tache.heure, tache.dureeMinutes)}` : ""}
            </span>
          )}
          <span>{tache.titre}</span>
        </div>

        {!compacte && (
          <>
            {tache.description && <p className="tache-description">{tache.description}</p>}
            {materiel.length > 0 && (
              <p className="tache-materiel">
                <IconeMateriel />{" "}
                <strong>Matériel :</strong> {materiel.join(" · ")}
              </p>
            )}
            <div className="tache-meta">
              {GROUPES.filter((g) => groupes.includes(g.id)).map((g) => (
                <span key={g.id} className={`badge badge-groupe groupe-${g.id}`} title={tache.groupe ? "Groupe choisi à la main" : g.regle}><IconeGroupe groupe={g.id} /> {g.libelle}</span>
              ))}
              {avecDate && (
                <span className="badge badge-date">
                  {tache.date ? formater(depuisISO(tache.date), { weekday: "short", day: "numeric", month: "short" }) : <><IconeChecklist /> Sans date</>}
                </span>
              )}
              {tache.dureeMinutes && (
                <span className="badge badge-info" title="Durée estimée"><IconeDuree /> {formaterDuree(tache.dureeMinutes)}</span>
              )}
              {tache.echeance && (
                <span className={`badge ${!tache.faite && tache.echeance < versISO(aujourdhui()) ? "badge-retard" : "badge-info"}`} title="Échéance">
                  <IconeEcheance /> avant le {formater(depuisISO(tache.echeance), { weekday: "short", day: "numeric", month: "short" })}
                </span>
              )}
              {tache.lieu && (
                /* stopPropagation : sans ça, le clic remonterait jusqu'à la carte et ouvrirait aussi le formulaire. */
                <a className="badge badge-info badge-lieu" href={lienCarte(tache.lieu)} target="_blank" rel="noopener noreferrer"
                  title="Ouvrir dans Google Maps" onClick={(e) => e.stopPropagation()}>
                  <IconeLieu /> {tache.lieu}
                </a>
              )}
              <span className="badge badge-cat">{CATEGORIES[tache.categorie]}</span>
              <span className={`badge badge-prio-${tache.priorite}`}>
                Priorité {PRIORITES[tache.priorite].toLowerCase()}
              </span>
              {retard && <span className="badge badge-retard">En retard</span>}
            </div>
          </>
        )}
      </div>

      {!compacte && (
        <div className="tache-actions">
          <button type="button" className="btn-icone" title="Modifier" aria-label="Modifier"
            onClick={() => actions.modifier(tache.id)}><IconeModifier /></button>
          <button type="button" className="btn-icone" title="Supprimer" aria-label="Supprimer"
            onClick={() => actions.supprimer(tache.id)}><IconeSupprimer /></button>
        </div>
      )}
    </article>
  );
}

interface PropsListe {
  taches: Tache[];
  actions: ActionsAgenda;
  messageVide?: ReactNode;
  compacte?: boolean;
}

export function ListeTaches({ taches, actions, messageVide, compacte }: PropsListe) {
  return (
    <div className="liste-taches">
      {taches.length === 0 && messageVide && <p className="vide">{messageVide}</p>}
      {/* "key" aide React à savoir quel élément correspond à quelle tâche d'un affichage à l'autre. */}
      {taches.map((t) => <CarteTache key={t.id} tache={t} actions={actions} compacte={compacte} />)}
    </div>
  );
}
