"use client";

/* Affichage d'UNE tâche, et d'une liste de tâches.
   En React, on décrit l'écran en JSX (du HTML dans du TypeScript) à partir
   des données. React échappe automatiquement le texte inséré avec {…} :
   un titre contenant "<script>" s'affiche comme du texte (protection XSS).

   Refonte « Carnet » (26/11/2026) : une tâche est une LIGNE d'agenda, pas une boîte.
     ○  08:30   Cours de thermodynamique
        10:30   Amphi A · chaque jeudi
   - la case ronde porte la couleur (catégorie, ou couleur choisie) ; rouge si en retard,
     verte et cochée une fois faite ;
   - l'heure a sa propre colonne (début, et fin en plus petit dessous) ;
   - « ! » orange devant le titre = priorité haute (comme dans Rappels d'Apple) ;
   - une seule ligne d'infos en texte simple, séparée par des « · », au lieu de 5 à 8 badges.
   Les vues Semaine et Mois affichent la même carte en « bloc » teinté (voir globals.css). */

import { useContext, type ReactNode } from "react";
import { aujourdhui, formater, depuisISO, versISO } from "@/lib/dates";
import { estEnRetard, formaterDuree, groupesDe, heureFin, lienCarte } from "@/lib/taches";
import type { GenreCase } from "@/lib/etapes";
import { GROUPES, type Groupe, type Tache } from "@/lib/types";
import { decrireRecurrence, resumerRecurrence } from "@/lib/recurrence";
import { libelleRappel } from "@/lib/rappels";
import { Bell } from "lucide-react";
import { OrigineGlisser, Poignee, useGlissable } from "./Glisser";
import { Balayable, ContexteBalayage } from "./Balayable";
import { CasesCarte, CompteurCases } from "./ListesCochables";
import { IconeProjet, IconeRepeter, IconeGroupe, IconeLieu, IconeModifier, IconeSupprimer } from "./Icones";

// Les actions possibles depuis une vue de l'agenda, fournies par le composant Agenda.
export interface ActionsAgenda {
  cocher: (id: string) => void;
  cocherCase?: (id: string, genre: GenreCase, cle: string) => void; // une étape ou un élément du matériel
  modifier: (id: string) => void;
  supprimer: (id: string) => void;
  ajouterLe: (dateISO: string) => void;
  allerAuJour: (dateISO: string) => void;
  planifier?: () => void; // ouvre la planification automatique (bouton de l'onglet Checklist)
  titreProjet?: (id: string) => string | undefined; // nom du projet lié, s'il existe encore
}

interface Props {
  tache: Tache;
  actions: ActionsAgenda;
  compacte?: boolean;   // version réduite (vue Mois)
  avecDate?: boolean;
  /* Vue Tri : groupe de la colonne où la carte est rangée. La carte rappelle alors ses AUTRES
     groupes (« Important · Rapide » pour une tâche rangée dans Urgent). */
  colonneTri?: Groupe;
  fantome?: boolean;    // copie affichée sous le pointeur pendant un glissement (non interactive)
}

const dateCourte = (iso: string) => formater(depuisISO(iso), { weekday: "short", day: "numeric", month: "short" });

export function CarteTache({ tache, actions, compacte = false, avecDate = false, colonneTri, fantome = false }: Props) {
  /* Glisser-déposer (voir Glisser.tsx) : la carte n'est glissable que si elle est affichée
     dans une zone qui le permet (OrigineGlisser : calendrier ou rubrique « Sans date »). */
  const origine = useContext(OrigineGlisser);
  const glissable = useGlissable(`${fantome ? "fantome" : origine ?? "fixe"}:${tache.id}`,
    { type: "tache", tache, compacte }, fantome || origine === null);
  const retard = estEnRetard(tache);
  const avecHoraire = !compacte && !!tache.heure;
  const classes = [
    "tache", `cat-${tache.categorie}`, `prio-${tache.priorite}`,
    tache.couleur && `avec-couleur couleur-${tache.couleur}`,
    compacte && "compacte", tache.faite && "faite", retard && "retard", avecHoraire && "avec-horaire",
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
        {/* Colonne de l'heure : début, puis fin en plus petit (vue Semaine : « 08:30–10:30 » sur une ligne). */}
        {avecHoraire && (
          <p className="tache-horaire">
            <span className="horaire-debut">{tache.heure}</span>
            {tache.dureeMinutes ? (
              <span className="horaire-fin"><span className="visuellement-cache"> à </span>{heureFin(tache.heure, tache.dureeMinutes)}</span>
            ) : null}
          </p>
        )}

        <div className="tache-texte">
          <div className="tache-titre">
            {tache.priorite === "haute" && (
              <span className="marque-prio" title="Priorité haute">
                <span aria-hidden="true">!</span><span className="visuellement-cache">Priorité haute : </span>
              </span>
            )}
            {compacte && tache.heure && <span className="tache-heure">{tache.heure}</span>}
            <span className="tache-nom">{tache.titre}</span>
            {/* Petite icône : la tâche fait partie d'une série répétée. Sur les cartes complètes,
                la répétition est écrite en toutes lettres dans la ligne d'infos (« chaque jeudi »). */}
            {tache.recurrence && (
              <span className="icone-repetition" title={decrireRecurrence(tache.recurrence, serieDebut(tache))}>
                <IconeRepeter /><span className="visuellement-cache"> (tâche répétée)</span>
              </span>
            )}
            {/* Décompte « 2/5 » des étapes : vue Mois et vue Semaine (les cases elles-mêmes sont masquées). */}
            <CompteurCases tache={tache} />
            {tache.rappelMinutes !== null && !tache.faite && (
              <span className="icone-repetition icone-rappel" title={`Rappel : ${libelleRappel(tache.rappelMinutes).toLowerCase()}`}>
                <Bell aria-hidden="true" /><span className="visuellement-cache"> (rappel {libelleRappel(tache.rappelMinutes).toLowerCase()})</span>
              </span>
            )}
          </div>

          {!compacte && (
            <>
              <LigneInfos tache={tache} actions={actions} retard={retard} avecDate={avecDate} colonneTri={colonneTri} />
              {tache.description && <p className="tache-description">{tache.description}</p>}
              {/* Étapes et matériel : cochables directement sur la carte (fantôme : affichage seul). */}
              <CasesCarte tache={tache} cocher={fantome || !actions.cocherCase ? undefined : (genre, cle) => actions.cocherCase!(tache.id, genre, cle)} />
            </>
          )}
        </div>
      </div>

      {!compacte && (
        <div className="tache-actions">
          <button type="button" className="btn-icone" title="Modifier" aria-label={`Modifier « ${tache.titre} »`}
            onClick={() => actions.modifier(tache.id)}><IconeModifier /></button>
          <button type="button" className="btn-icone" title="Supprimer" aria-label={`Supprimer « ${tache.titre} »`}
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

/* La ligne d'infos sous le titre : « En retard · mar. 24 nov. · Amphi A · chaque jeudi ».
   Du texte simple, dans l'ordre où on en a besoin ; le rouge ne sert qu'au retard. */
function LigneInfos({ tache, actions, retard, avecDate, colonneTri }:
  { tache: Tache; actions: ActionsAgenda; retard: boolean; avecDate: boolean; colonneTri?: Groupe }) {
  const infos: ReactNode[] = [];
  if (retard) infos.push(<span key="retard" className="meta-retard">En retard</span>);
  if (colonneTri) {
    const groupes = groupesDe(tache);
    for (const g of GROUPES.filter((x) => x.id !== colonneTri && groupes.includes(x.id))) {
      infos.push(
        <span key={g.id} className={`meta-groupe groupe-${g.id}`} title={tache.groupe ? "Groupe choisi à la main" : g.regle}>
          <IconeGroupe groupe={g.id} /> {g.libelle}
        </span>,
      );
    }
  }
  if (avecDate) infos.push(<span key="date" className="meta-date">{tache.date ? dateCourte(tache.date) : "Sans date"}</span>);
  if (tache.recurrence) {
    infos.push(<span key="rep" title={decrireRecurrence(tache.recurrence, serieDebut(tache))}>{resumerRecurrence(tache.recurrence)}</span>);
  }
  // Durée : seulement si l'heure de fin ne la donne pas déjà (tâche sans heure).
  if (tache.dureeMinutes && !tache.heure) infos.push(<span key="duree" title="Durée estimée">{formaterDuree(tache.dureeMinutes)}</span>);
  if (tache.echeance) {
    const depassee = !tache.faite && tache.echeance < versISO(aujourdhui());
    infos.push(<span key="echeance" className={depassee ? "meta-depassee" : undefined} title="Échéance">avant le {dateCourte(tache.echeance)}</span>);
  }
  if (tache.lieu) {
    infos.push(
      /* stopPropagation : sans ça, le clic remonterait jusqu'à la carte et ouvrirait aussi le formulaire. */
      <a key="lieu" className="meta-lieu" href={lienCarte(tache.lieu)} target="_blank" rel="noopener noreferrer"
        title="Ouvrir dans Google Maps" onClick={(e) => e.stopPropagation()}>
        <IconeLieu /> {tache.lieu}
      </a>,
    );
  }
  const projet = tache.projetId ? actions.titreProjet?.(tache.projetId) : undefined;
  if (projet) infos.push(<span key="projet" className="meta-projet" title="Tâche placée depuis ce projet"><IconeProjet /> {projet}</span>);
  if (infos.length === 0) return null;
  return <p className="tache-meta">{infos}</p>;
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
