"use client";

/* Les quatre vues de l'agenda. Chacune reçoit la liste DÉJÀ filtrée et triée,
   et se contente de la disposer à l'écran.                                    */

import { ajouterJours, aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import { grouperParDate } from "@/lib/taches";
import { JOURS_COURTS, type Tache } from "@/lib/types";
import { CarteTache, ListeTaches, type ActionsAgenda } from "./CarteTache";

const MAX_TACHES_CASE_MOIS = 3;

interface Props {
  dateRef: Date;
  liste: Tache[];
  actions: ActionsAgenda;
}

/* ---------- Vue Jour ---------- */
export function VueJour({ dateRef, liste, actions }: Props) {
  const iso = versISO(dateRef);
  return (
    <section className="jour-unique">
      <ListeTaches taches={liste.filter((t) => t.date === iso)} actions={actions} messageVide="Aucune tâche prévue ce jour." />
      <button type="button" className="btn-ajouter" onClick={() => actions.ajouterLe(iso)}>
        + Ajouter une tâche ce jour
      </button>
    </section>
  );
}

/* ---------- Vue Semaine : 7 colonnes du lundi au dimanche ---------- */
export function VueSemaine({ dateRef, liste, actions }: Props) {
  const lundi = debutSemaine(dateRef);
  const parDate = grouperParDate(liste);
  const isoAujourdhui = versISO(aujourdhui());
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));

  return (
    <div className="grille-semaine">
      {jours.map((jour, i) => {
        const iso = versISO(jour);
        return (
          <section key={iso} className={`colonne-jour${iso === isoAujourdhui ? " aujourdhui" : ""}`}>
            <button type="button" className="entete-jour" title="Voir ce jour" onClick={() => actions.allerAuJour(iso)}>
              <span className="nom-jour">{JOURS_COURTS[i]}</span>
              <span className="num-jour">{jour.getDate()}</span>
            </button>
            <ListeTaches taches={parDate.get(iso) ?? []} actions={actions} />
            <button type="button" className="btn-ajouter" title="Ajouter une tâche ce jour" onClick={() => actions.ajouterLe(iso)}>+</button>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- Vue Mois : grille de 5 ou 6 semaines ---------- */
export function VueMois({ dateRef, liste, actions }: Props) {
  const mois = dateRef.getMonth();
  const premier = new Date(dateRef.getFullYear(), mois, 1);
  const dernier = new Date(dateRef.getFullYear(), mois + 1, 0);
  const debut = debutSemaine(premier);
  const fin = ajouterJours(debutSemaine(dernier), 6);
  const parDate = grouperParDate(liste);
  const isoAujourdhui = versISO(aujourdhui());

  const jours: Date[] = [];
  for (let j = debut; j <= fin; j = ajouterJours(j, 1)) jours.push(j);

  return (
    <div className="grille-mois">
      {JOURS_COURTS.map((nom) => <div key={nom} className="nom-colonne">{nom}</div>)}
      {jours.map((jour) => {
        const iso = versISO(jour);
        const taches = parDate.get(iso) ?? [];
        const restantes = taches.filter((t) => !t.faite).length;
        const classes = ["case-mois", jour.getMonth() !== mois && "hors-mois", iso === isoAujourdhui && "aujourdhui"]
          .filter(Boolean).join(" ");
        return (
          <div key={iso} className={classes}>
            <div className="haut-case">
              <button type="button" className="num-case" title="Voir ce jour" onClick={() => actions.allerAuJour(iso)}>
                {jour.getDate()}
              </button>
              {restantes > 0 && <span className="compte-case">{restantes}</span>}
            </div>
            <ListeTaches taches={taches.slice(0, MAX_TACHES_CASE_MOIS)} actions={actions} compacte />
            {taches.length > MAX_TACHES_CASE_MOIS && (
              <button type="button" className="lien-plus" onClick={() => actions.allerAuJour(iso)}>
                +{taches.length - MAX_TACHES_CASE_MOIS} autre(s)
              </button>
            )}
            <button type="button" className="btn-ajouter-mini" title="Ajouter une tâche ce jour" onClick={() => actions.ajouterLe(iso)}>+</button>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Vue Liste : toutes les tâches, regroupées par date ---------- */
export function VueListe({ liste, actions }: Props) {
  if (liste.length === 0) {
    return <section className="liste-complete"><p className="vide">Aucune tâche ne correspond à ces critères.</p></section>;
  }
  const isoAujourdhui = versISO(aujourdhui());
  return (
    <section className="liste-complete">
      {[...grouperParDate(liste)].map(([iso, taches]) => (
        <section key={iso} className={`groupe-date${iso === isoAujourdhui ? " aujourdhui" : ""}`}>
          <h3>
            {majuscule(formater(depuisISO(iso), { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}
            {iso === isoAujourdhui && " — aujourd'hui"}
          </h3>
          <div className="liste-taches">
            {taches.map((t) => <CarteTache key={t.id} tache={t} actions={actions} />)}
          </div>
        </section>
      ))}
    </section>
  );
}
