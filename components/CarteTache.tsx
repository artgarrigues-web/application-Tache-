"use client";

/* Affichage d'UNE tâche, et d'une liste de tâches.
   En React, on décrit l'écran en JSX (du HTML dans du TypeScript) à partir
   des données. React échappe automatiquement le texte inséré avec {…} :
   un titre contenant "<script>" s'affiche comme du texte (protection XSS).  */

import { useContext, type ReactNode } from "react";
import { aujourdhui, formater, depuisISO, versISO } from "@/lib/dates";
import { estEnRetard, formaterDuree, groupesDe, heureFin, lienCarte, listeMateriel } from "@/lib/taches";
import { CATEGORIES, GROUPES, PRIORITES, type Tache } from "@/lib/types";
import { decrireRecurrence } from "@/lib/recurrence";
import { OrigineGlisser, Poignee, useGlissable } from "./Glisser";
import { Balayable, ContexteBalayage } from "./Balayable";
import { IconeChecklist, IconeProjet, IconeRepeter, IconeDuree, IconeEcheance, IconeGroupe, IconeLieu, IconeMateriel, IconeModifier, IconeSupprimer } from "./Icones";

// Les actions possibles depuis une vue de l'agenda, fournies par le composant Agenda.
export interface ActionsAgenda {
  cocher: (id: string) => void;
  modifier: (id: string) => void;
  supprimer: (id: string) => void;
  ajouterLe: (dateISO: string) => void;
  allerAuJour: (dateISO: string) => void;
  planifier?: () => void; // ouvre la planification automatique (bouton de l'onglet Checklist)
  titreProjet?: (id: string) => string | undefined; // nom du projet lié (badge), s'il existe encore
}

interface Props {
  tache: Tache;
  actions: ActionsAgenda;
  compacte?: boolean;   // version réduite (vue Mois)
  avecDate?: boolean;
  fantome?: boolean;    // copie affichée sous le pointeur pendant un glissement (non interactive)
}

export function CarteTache({ tache, actions, compacte = false, avecDate = false, fantome = false }: Props) {
  /* Glisser-déposer (voir Glisser.tsx) : la carte n'est glissable que si elle est affichée
     dans une zone qui le permet (OrigineGlisser : calendrier ou rubrique « Sans date »). */
  const origine = useContext(OrigineGlisser);
  const glissable = useGlissable(`${fantome ? "fantome" : origine ?? "fixe"}:${tache.id}`,
    { type: "tache", tache, compacte }, fantome || origine === null);
  const retard = estEnRetard(tache);
  const materiel = listeMateriel(tache.materiel);
  const groupes = groupesDe(tache);
  const classes = [
    "tache", `cat-${tache.categorie}`, `prio-${tache.priorite}`,
    tache.couleur && `avec-couleur couleur-${tache.couleur}`,
    compacte && "compacte", tache.faite && "faite", retard && "retard",
    glissable.possible && "glissable", glissable.isDragging && "en-glissement", fantome && "carte-fantome",
    tache.id.startsWith("provisoire-") && "provisoire", // en cours d'enregistrement (après un dépôt)
  ].filter(Boolean).join(" ");

  // Sur téléphone, une carte complète peut être balayée (→ cocher, ← reporter) : voir Balayable.tsx.
  const reporter = useContext(ContexteBalayage);

  const carte = (
    <article className={classes} ref={glissable.setNodeRef} {...(glissable.possible ? glissable.listeners : {})}
      inert={fantome || undefined}>
      <Poignee glissable={glissable} libelle={`la tâche « ${tache.titre} »`} />
      {/* Le label n'a pas de boîte sur ordinateur (display: contents) ; sur téléphone il
          agrandit la zone qui réagit au doigt autour de la case (44 px, voir globals.css). */}
      <label className="zone-case">
        <input
          type="checkbox"
          checked={tache.faite}
          onChange={() => actions.cocher(tache.id)}
          aria-label={`Marquer « ${tache.titre} » comme ${tache.faite ? "à faire" : "faite"}`}
        />
      </label>

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
          {/* Petite icône discrète : la tâche fait partie d'une série répétée (détail au survol). */}
          {tache.recurrence && (
            <span className="icone-repetition" title={decrireRecurrence(tache.recurrence, serieDebut(tache))}>
              <IconeRepeter /><span className="visuellement-cache"> (tâche répétée)</span>
            </span>
          )}
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
              {tache.projetId && actions.titreProjet?.(tache.projetId) && (
                <span className="badge badge-projet" title="Tâche placée depuis ce projet"><IconeProjet /> {actions.titreProjet(tache.projetId)}</span>
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
  if (reporter && !fantome && !compacte) {
    return <Balayable tache={tache} onCocher={() => actions.cocher(tache.id)} onReporter={reporter}>{carte}</Balayable>;
  }
  return carte;
}

// Date de début de la série d'une occurrence (pour la phrase « le 4e mardi », « le 24 »…).
function serieDebut(t: Tache): string {
  return t.occurrence?.debutSerie ?? t.date;
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
