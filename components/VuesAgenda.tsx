"use client";

/* Les six vues de l'agenda. Chacune reçoit la liste DÉJÀ filtrée et triée,
   et se contente de la disposer à l'écran.                                    */

import { ajouterJours, aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import { chargeRestante, estSansDate, formaterDuree, grouperParDate, repartirParGroupe } from "@/lib/taches";
import { DUREE_RAPIDE_MAX, GROUPES, JOURS_COURTS, type Groupe, type Tache } from "@/lib/types";
import { CarteTache, ListeTaches, type ActionsAgenda } from "./CarteTache";
import { IconeAjouter, IconeChecklist, IconeDuree, IconeGroupe, IconeIdee, IconePlanifier } from "./Icones";
import { useEffect, useState } from "react";
import type { DonneesIdees } from "@/hooks/useIdees";
import { MenuProjets, PanneauProjet } from "./IdeesProjets";
import { ListeAvecReperes, plageDe, useVarianteReperes } from "./ReperesHeure";
import { OrigineGlisser, RegletteCreneaux, ZoneDepot, useGlisser } from "./Glisser";
import type { EvenementExterne } from "@/lib/ics-lecture";

const libelleJour = (iso: string) => formater(depuisISO(iso), { weekday: "long", day: "numeric", month: "long" });

const MAX_TACHES_CASE_MOIS = 3;

interface Props {
  dateRef: Date;
  liste: Tache[];
  actions: ActionsAgenda;
  evenements?: Map<string, EvenementExterne[]>; // agendas externes (Google, Outlook…), par date
}

/* ---------- Vue Jour ---------- */
export function VueJour({ dateRef, liste, actions, evenements }: Props) {
  const iso = versISO(dateRef);
  const taches = liste.filter((t) => t.date === iso);
  const charge = chargeRestante(taches);
  const variante = useVarianteReperes();
  /* Pendant un glissement, la liste laisse place à une réglette de créneaux (:00 / :30) :
     c'est la seule vue assez large pour choisir l'heure. La liste reste montée (masquée)
     pour que la carte d'origine ne disparaisse pas en plein glissement. */
  const { enCours } = useGlisser();
  return (
    <OrigineGlisser.Provider value="cal">
    <section className={`jour-unique${enCours ? " avec-reglette" : ""}`}>
      {charge > 0 && <p className="charge-jour"><IconeDuree /> Temps prévu restant ce jour : <strong>{formaterDuree(charge)}</strong></p>}
      {/* La liste reste AVANT la réglette : repliée à hauteur 0, elle ne bouge pas, et le
          fantôme (calé sur la position de la carte d'origine) reste sous le pointeur. */}
      <div className="contenu-jour">
        <ListeAvecReperes taches={taches} actions={actions} variante={variante} hauteurHeure={56} messageVide="Aucune tâche prévue ce jour."
          evenements={evenements?.get(iso)} />
      </div>
      {enCours && <RegletteCreneaux iso={iso} taches={taches} />}
      <button type="button" className="btn-ajouter" onClick={() => actions.ajouterLe(iso)}>
        <IconeAjouter /> Ajouter une tâche ce jour
      </button>
    </section>
    </OrigineGlisser.Provider>
  );
}

/* ---------- Vue Semaine : 7 colonnes du lundi au dimanche ---------- */
export function VueSemaine({ dateRef, liste, actions, evenements }: Props) {
  const lundi = debutSemaine(dateRef);
  const parDate = grouperParDate(liste);
  const isoAujourdhui = versISO(aujourdhui());
  const jours = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const variante = useVarianteReperes();
  const plage = plageDe(jours.flatMap((j) => parDate.get(versISO(j)) ?? []));

  return (
    <OrigineGlisser.Provider value="cal">
    <div className={`grille-semaine${variante === "d" ? " reperes-d" : ""}`}>
      {jours.map((jour, i) => {
        const iso = versISO(jour);
        const charge = chargeRestante(parDate.get(iso) ?? []);
        return (
          /* Toute la colonne est une zone de dépôt : la tâche change de jour et garde son heure. */
          <ZoneDepot as="section" key={iso} id={`jour:${iso}`} cible={{ date: iso, heure: null }} libelle={libelleJour(iso)}
            className={`colonne-jour${iso === isoAujourdhui ? " aujourdhui" : ""}`}>
            <button type="button" className="entete-jour" title="Voir ce jour" onClick={() => actions.allerAuJour(iso)}>
              <span className="nom-jour">{JOURS_COURTS[i]}</span>
              <span className="num-jour">{jour.getDate()}</span>
              {charge > 0 && <span className="charge-colonne" title="Temps prévu restant"><IconeDuree /> {formaterDuree(charge)}</span>}
            </button>
            <ListeAvecReperes taches={parDate.get(iso) ?? []} actions={actions} variante={variante} plage={plage}
              evenements={evenements?.get(iso)} compactEvenements />
            <button type="button" className="btn-ajouter" title="Ajouter une tâche ce jour" aria-label="Ajouter une tâche ce jour" onClick={() => actions.ajouterLe(iso)}><IconeAjouter /></button>
          </ZoneDepot>
        );
      })}
    </div>
    </OrigineGlisser.Provider>
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
    <OrigineGlisser.Provider value="cal">
    <div className="grille-mois">
      {JOURS_COURTS.map((nom) => <div key={nom} className="nom-colonne">{nom}</div>)}
      {jours.map((jour) => {
        const iso = versISO(jour);
        const taches = parDate.get(iso) ?? [];
        const restantes = taches.filter((t) => !t.faite).length;
        const classes = ["case-mois", jour.getMonth() !== mois && "hors-mois", iso === isoAujourdhui && "aujourdhui"]
          .filter(Boolean).join(" ");
        return (
          <ZoneDepot key={iso} id={`jour:${iso}`} cible={{ date: iso, heure: null }} libelle={libelleJour(iso)} className={classes}>
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
            <button type="button" className="btn-ajouter-mini" title="Ajouter une tâche ce jour" aria-label="Ajouter une tâche ce jour" onClick={() => actions.ajouterLe(iso)}><IconeAjouter /></button>
          </ZoneDepot>
        );
      })}
    </div>
    </OrigineGlisser.Provider>
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
            {iso === "" ? "Sans date"
              : majuscule(formater(depuisISO(iso), { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}
            {iso === isoAujourdhui && <span className="etiquette-aujourdhui">Aujourd&apos;hui</span>}
          </h3>
          <div className="liste-taches">
            {taches.map((t) => <CarteTache key={t.id} tache={t} actions={actions} />)}
          </div>
        </section>
      ))}
    </section>
  );
}

/* ---------- Vue Tri : tâches à faire réparties en Urgent / Important / Rapide ----------
   Refonte « Carnet » : chaque groupe est une colonne SANS boîte (titre souligné de la couleur
   du groupe, règle en une ligne dessous). Les explications détaillées sont repliées dans
   « Comment c'est rangé ? » : on les lit une fois, elles n'ont pas à occuper l'écran ensuite. */
const VIDE_TRI: Record<Groupe, string> = {
  urgent: "Rien d'urgent.",
  important: "Aucune tâche en priorité haute.",
  rapide: `Indique une durée de ${DUREE_RAPIDE_MAX} min ou moins dans une tâche pour la retrouver ici.`,
};

export function VueTri({ liste, actions }: Props) {
  const { groupes, autres } = repartirParGroupe(liste);
  return (
    <section className="vue-tri-contenu">
      <details className="aide-repliable">
        <summary>Comment c&apos;est rangé ?</summary>
        <p>
          Seules les tâches <strong>à faire</strong> apparaissent ici. Une tâche qui entre dans plusieurs groupes
          est rangée dans le premier (Urgent, puis Important, puis Rapide) ; sa ligne d&apos;infos rappelle ses
          autres groupes. Un groupe choisi à la main dans le formulaire (champ « Groupe ») passe avant ces règles.
        </p>
      </details>
      <div className="grille-tri">
        {GROUPES.map((g) => (
          <section key={g.id} className={`colonne-tri groupe-${g.id}`} aria-labelledby={`titre-tri-${g.id}`}>
            <h3 id={`titre-tri-${g.id}`}>
              <IconeGroupe groupe={g.id} /> {g.libelle} <span className="compte-groupe">{groupes[g.id].length}</span>
            </h3>
            <p className="regle-groupe">{g.regle}</p>
            <div className="liste-taches">
              {groupes[g.id].length === 0 && <p className="vide">{VIDE_TRI[g.id]}</p>}
              {groupes[g.id].map((t) => <CarteTache key={t.id} tache={t} actions={actions} avecDate colonneTri={g.id} />)}
            </div>
          </section>
        ))}
      </div>
      {autres.length > 0 && (
        <section className="colonne-tri groupe-autres" aria-labelledby="titre-tri-autres">
          <h3 id="titre-tri-autres">Autres tâches à faire <span className="compte-groupe">{autres.length}</span></h3>
          <p className="regle-groupe">Ni urgentes, ni prioritaires, ni rapides.</p>
          <div className="liste-taches">
            {autres.map((t) => <CarteTache key={t.id} tache={t} actions={actions} avecDate />)}
          </div>
        </section>
      )}
    </section>
  );
}

/* ---------- Vue Checklist : TOUTES les tâches à cocher ----------
   Trois parties, dans cet ordre :
   1. « Sans date » : les tâches à faire quand tu peux (celles que le planificateur peut placer) ;
   2. « Planifiées » : les tâches à faire qui ont une date (et souvent une heure), triées
      chronologiquement — la liste reçue est déjà triée par date puis heure (comparer()) ;
      chaque ligne affiche sa date dans sa ligne d'infos, et l'heure dans sa colonne ;
   3. « Cochées » : tout ce qui est terminé, daté ou non.
   Les tâches datées restent bien sûr AUSSI dans Jour, Semaine et Mois. */
/* La même Checklist est aussi affichée sous le calendrier (Jour/Semaine/Mois) : voir Agenda.tsx.
   Chaque titre de rubrique porte sa règle en une ligne : plus de paragraphe d'explication. */
/* ---------- Checklist ----------
   À gauche (au-dessus sur téléphone), un menu de catégories :
   - « Tâches » : les tâches à cocher (sans date, planifiées, cochées) ;
   - « Projets » : des projets, chacun avec sa liste d'idées.
   La catégorie et le projet choisis sont retenus dans le navigateur. */
type CategorieChecklist = "taches" | "idees";
const CLE_CATEGORIE = "agendia-checklist-categorie";
const CLE_PROJET = "agendia-checklist-projet";

function lire(cle: string): string | null {
  try { return localStorage.getItem(cle); } catch { return null; }
}
function ecrire(cle: string, valeur: string) {
  try { localStorage.setItem(cle, valeur); } catch { /* navigateur privé : non retenu */ }
}

export function VueChecklist({ liste, actions, idees }: Props & { idees?: DonneesIdees }) {
  const [categorie, setCategorie] = useState<CategorieChecklist>("taches");
  const [projetChoisi, setProjetChoisi] = useState<string | null>(null);
  useEffect(() => {
    if (lire(CLE_CATEGORIE) === "idees") setCategorie("idees");
    setProjetChoisi(lire(CLE_PROJET));
  }, []);
  function changerCategorie(c: CategorieChecklist) { setCategorie(c); ecrire(CLE_CATEGORIE, c); }
  function choisirProjet(id: string) { setProjetChoisi(id); ecrire(CLE_PROJET, id); }

  if (!idees) return <ChecklistTaches liste={liste} actions={actions} />;

  // Projet affiché : celui choisi s'il existe encore, sinon le premier de la liste.
  const projet = idees.projets.find((p) => p.id === projetChoisi) ?? idees.projets[0] ?? null;
  const nbAFaire = liste.filter((t) => !t.faite).length;

  return (
    <div className="checklist-categories">
      <nav className="menu-checklist" aria-label="Catégories de la checklist">
        <button type="button" className={`categorie-checklist${categorie === "taches" ? " actif" : ""}`}
          aria-current={categorie === "taches" ? "true" : undefined} onClick={() => changerCategorie("taches")}>
          <IconeChecklist /> <span>Tâches</span> <span className="compte-groupe">{nbAFaire}</span>
        </button>
        <button type="button" className={`categorie-checklist${categorie === "idees" ? " actif" : ""}`}
          aria-current={categorie === "idees" ? "true" : undefined} onClick={() => changerCategorie("idees")}>
          <IconeIdee /> <span>Projets</span> <span className="compte-groupe">{idees.projets.length}</span>
        </button>
        {categorie === "idees" && <MenuProjets donnees={idees} projetActif={projet?.id ?? null} choisir={choisirProjet} />}
      </nav>
      <div className="contenu-checklist">
        {categorie === "taches"
          ? <ChecklistTaches liste={liste} actions={actions} />
          : <PanneauProjet key={projet?.id ?? "aucun"} donnees={idees} projet={projet} />}
      </div>
    </div>
  );
}

function ChecklistTaches({ liste, actions }: Omit<Props, "dateRef">) {
  const aFaire = liste.filter((t) => !t.faite);
  const sansDate = aFaire.filter(estSansDate);
  const planifiees = aFaire.filter((t) => !estSansDate(t));
  const faites = liste.filter((t) => t.faite);
  return (
    <section className="checklist">
      {/* Rubrique « Sans date » : ses cartes se glissent sur l'agenda, et une tâche de
          l'agenda déposée ici perd sa date (elle redevient « à faire quand tu peux »). */}
      <ZoneDepot id="sans-date" cible={{ date: "", heure: "" }} libelle="Sans date (checklist)" className="zone-sans-date">
        <h3 className="titre-section-checklist">Sans date <span className="compte-groupe">{sansDate.length}</span></h3>
        <p className="regle-groupe">À faire quand tu peux.</p>
        <OrigineGlisser.Provider value="chk">
          <ListeTaches taches={sansDate} actions={actions} messageVide="Aucune tâche sans date." />
        </OrigineGlisser.Provider>
      </ZoneDepot>
      <div className="actions-checklist">
        <button type="button" className="btn-ajouter" onClick={() => actions.ajouterLe("")}>
          <IconeAjouter /> Ajouter une tâche sans date
        </button>
        {/* Bouton secondaire (et non plus bleu plein sur toute la largeur) : utile, mais ce
            n'est pas l'action principale de l'écran. */}
        {sansDate.length > 0 && actions.planifier && (
          <button type="button" className="btn btn-planifier" onClick={actions.planifier}>
            <IconePlanifier /> Placer ces tâches dans ma semaine
          </button>
        )}
      </div>

      <h3 className="titre-section-checklist">Planifiées <span className="compte-groupe">{planifiees.length}</span></h3>
      <p className="regle-groupe">De la plus proche à la plus lointaine. Elles sont aussi dans Jour, Semaine et Mois.</p>
      {planifiees.length === 0
        ? <p className="vide">Aucune tâche planifiée à faire.</p>
        : <div className="liste-taches">
            {planifiees.map((t) => <CarteTache key={t.id} tache={t} actions={actions} avecDate />)}
          </div>}

      {faites.length > 0 && (
        <>
          <h3 className="titre-section-checklist titre-faites">Cochées <span className="compte-groupe">{faites.length}</span></h3>
          <div className="liste-taches">
            {faites.map((t) => <CarteTache key={t.id} tache={t} actions={actions} avecDate={!estSansDate(t)} />)}
          </div>
        </>
      )}
    </section>
  );
}
