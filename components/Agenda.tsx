"use client";

/* Composant principal de l'agenda : il possède l'état de l'interface
   (vue, date affichée, filtres, formulaire ouvert) et le distribue aux
   composants enfants via leurs "props".

   Flux des données en React (à sens unique) :
     état (useState) ─► props ─► affichage
     clic ─► fonction reçue en prop ─► mise à jour de l'état ─► React réaffiche   */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { aujourdhui, deplacer, depuisISO, plageVisible, titrePeriode, versISO } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import { comparer, passeLesFiltres, validerTaches } from "@/lib/taches";
import { FILTRES_INITIAUX, VUES, type DonneesTache, type Filtres, type Vue } from "@/lib/types";
import { useTaches } from "@/hooks/useTaches";
import type { ActionsAgenda } from "./CarteTache";
import { Compteurs } from "./Compteurs";
import { FormulaireTache } from "./FormulaireTache";
import { SynchroCalendrier } from "./SynchroCalendrier";
import { VueChecklist, VueJour, VueListe, VueMois, VueSemaine, VueTri } from "./VuesAgenda";

const CLE_VUE = "agenda-taches-vue"; // simple préférence d'affichage, gardée dans le navigateur

// date : "AAAA-MM-JJ" imposée, "" = sans date (checklist), undefined = date par défaut de la vue.
interface EtatFormulaire { tacheId: string | null; date?: string }

export function Agenda({ utilisateur }: { utilisateur: User }) {
  const { taches, charge, erreur, effacerErreur, ajouter, modifier, supprimer, basculerFaite, effacerTerminees, importer } =
    useTaches(utilisateur.id);

  const [vue, setVue] = useState<Vue>("semaine");
  const [dateRef, setDateRef] = useState<Date>(() => aujourdhui());
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_INITIAUX);
  const [formulaire, setFormulaire] = useState<EtatFormulaire | null>(null);
  const [synchroOuverte, setSynchroOuverte] = useState(false);
  const champFichier = useRef<HTMLInputElement>(null);

  // Retrouve la dernière vue utilisée…
  useEffect(() => {
    const enregistree = localStorage.getItem(CLE_VUE);
    if (VUES.some((v) => v.id === enregistree)) setVue(enregistree as Vue);
  }, []);
  // … et la mémorise à chaque changement.
  useEffect(() => {
    localStorage.setItem(CLE_VUE, vue);
  }, [vue]);

  const plage = plageVisible(vue, dateRef);
  // Les vues Liste et Tri montrent toutes les dates : pas de navigation ‹ ›.
  const navigable = vue !== "liste" && vue !== "tri" && vue !== "checklist";

  // useMemo : ne refait le filtrage/tri que si les tâches ou les filtres changent.
  const liste = useMemo(
    () => taches.filter((t) => passeLesFiltres(t, filtres)).sort(comparer),
    [taches, filtres],
  );

  /* ---------- Actions ---------- */
  function dateParDefaut(): string {
    if (vue === "checklist") return ""; // depuis l'onglet Checklist, une nouvelle tâche est sans date
    const iso = versISO(aujourdhui());
    if (!plage || (iso >= plage.debut && iso <= plage.fin)) return iso;
    return plage.debut;
  }

  const actions: ActionsAgenda = {
    cocher: (id) => { basculerFaite(id); },
    modifier: (id) => setFormulaire({ tacheId: id }),
    supprimer: (id) => { confirmerSuppression(id); },
    ajouterLe: (iso) => setFormulaire({ tacheId: null, date: iso }),
    allerAuJour: (iso) => { setDateRef(depuisISO(iso)); setVue("jour"); },
  };

  async function confirmerSuppression(id: string): Promise<boolean> {
    const tache = taches.find((t) => t.id === id);
    if (!tache || !confirm(`Supprimer la tâche « ${tache.titre} » ?`)) return false;
    return supprimer(id);
  }

  async function enregistrer(d: DonneesTache): Promise<boolean> {
    const ok = formulaire?.tacheId ? await modifier(formulaire.tacheId, d) : await ajouter(d);
    // Si la date choisie n'est pas visible, on déplace l'agenda pour la montrer.
    if (ok && plage && d.date && (d.date < plage.debut || d.date > plage.fin)) setDateRef(depuisISO(d.date));
    return ok;
  }

  async function effacerFaites() {
    const n = taches.filter((t) => t.faite).length;
    if (n === 0) return alert("Aucune tâche terminée à effacer.");
    if (confirm(`Supprimer définitivement ${n} tâche(s) terminée(s) ?`)) await effacerTerminees();
  }

  function exporter() {
    const blob = new Blob([JSON.stringify(taches, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `agenda-taches-${versISO(aujourdhui())}.json`;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importerFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = ""; // permet de réimporter le même fichier plus tard
    if (!fichier) return;
    let liste;
    try {
      liste = validerTaches(JSON.parse(await fichier.text()));
    } catch {
      liste = null;
    }
    if (!liste) return alert("Ce fichier n'est pas un export valide de l'agenda.");
    if (confirm(`Ajouter ${liste.length} tâche(s) à ton agenda ?`)) await importer(liste);
  }

  /* ---------- Raccourcis clavier ---------- */
  useEffect(() => {
    function auClavier(e: KeyboardEvent) {
      if (formulaire || synchroOuverte || e.ctrlKey || e.metaKey || e.altKey) return;
      const cible = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName)) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setFormulaire({ tacheId: null }); }
      else if (e.key === "t" || e.key === "T") setDateRef(aujourdhui());
      else if (e.key === "ArrowLeft" && navigable) setDateRef((d) => deplacer(vue, d, -1));
      else if (e.key === "ArrowRight" && navigable) setDateRef((d) => deplacer(vue, d, 1));
    }
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [formulaire, synchroOuverte, vue, navigable]);

  /* ---------- Affichage ---------- */
  const propsVue = { dateRef, liste, actions };
  const tacheEnEdition = formulaire?.tacheId ? taches.find((t) => t.id === formulaire.tacheId) ?? null : null;

  return (
    <div className="page">
      <header className="entete">
        <h1>📅 Mon agenda</h1>
        <Compteurs taches={taches} plage={plage} />
        <button type="button" className="btn btn-principal" title="Raccourci : touche N"
          onClick={() => setFormulaire({ tacheId: null })}>
          + Nouvelle tâche
        </button>
      </header>

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <span>Problème de connexion à la base : {erreur}</span>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={effacerErreur}>✕</button>
        </div>
      )}

      <section className="barre-outils">
        {navigable && (
          <div className="navigation">
            <button type="button" className="btn" aria-label="Période précédente" onClick={() => setDateRef(deplacer(vue, dateRef, -1))}>‹</button>
            <button type="button" className="btn" onClick={() => setDateRef(aujourdhui())}>Aujourd&apos;hui</button>
            <button type="button" className="btn" aria-label="Période suivante" onClick={() => setDateRef(deplacer(vue, dateRef, 1))}>›</button>
          </div>
        )}
        <h2>{titrePeriode(vue, dateRef)}</h2>
        <div className="onglets" role="tablist" aria-label="Vue de l'agenda">
          {VUES.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={vue === v.id}
              className={vue === v.id ? "actif" : ""} onClick={() => setVue(v.id)}>
              {v.libelle}
            </button>
          ))}
        </div>
      </section>

      <section className="filtres">
        <input type="search" placeholder="🔍 Rechercher une tâche…" aria-label="Rechercher"
          value={filtres.recherche} onChange={(e) => setFiltres({ ...filtres, recherche: e.target.value })} />
        <select aria-label="Filtrer par catégorie" value={filtres.categorie}
          onChange={(e) => setFiltres({ ...filtres, categorie: e.target.value as Filtres["categorie"] })}>
          <option value="toutes">Toutes les catégories</option>
          <option value="perso">Personnel</option>
          <option value="travail">Travail</option>
          <option value="projets">Projets</option>
        </select>
        <select aria-label="Filtrer par priorité" value={filtres.priorite}
          onChange={(e) => setFiltres({ ...filtres, priorite: e.target.value as Filtres["priorite"] })}>
          <option value="toutes">Toutes les priorités</option>
          <option value="haute">Priorité haute</option>
          <option value="moyenne">Priorité moyenne</option>
          <option value="basse">Priorité basse</option>
        </select>
        <select aria-label="Filtrer par statut" value={filtres.statut}
          onChange={(e) => setFiltres({ ...filtres, statut: e.target.value as Filtres["statut"] })}>
          <option value="toutes">Tous les statuts</option>
          <option value="afaire">À faire</option>
          <option value="faites">Terminées</option>
          <option value="retard">En retard</option>
        </select>
      </section>

      <main className={`vue vue-${vue}`}>
        {!charge ? <p className="vide">Chargement des tâches…</p>
          : vue === "jour" ? <VueJour {...propsVue} />
          : vue === "semaine" ? <VueSemaine {...propsVue} />
          : vue === "mois" ? <VueMois {...propsVue} />
          : vue === "tri" ? <VueTri {...propsVue} />
          : vue === "checklist" ? <VueChecklist {...propsVue} />
          : <VueListe {...propsVue} />}
      </main>

      <footer className="pied">
        <button type="button" className="btn btn-principal" onClick={() => setSynchroOuverte(true)}>📆 Synchroniser mon calendrier</button>
        <button type="button" className="btn" onClick={exporter}>⬇ Exporter (JSON)</button>
        <button type="button" className="btn" onClick={() => champFichier.current?.click()}>⬆ Importer</button>
        <input ref={champFichier} type="file" accept="application/json,.json" hidden onChange={importerFichier} />
        <button type="button" className="btn btn-danger" onClick={effacerFaites}>Effacer les tâches terminées</button>
        <span className="aide">Raccourcis : <kbd>N</kbd> nouvelle tâche · <kbd>←</kbd> <kbd>→</kbd> naviguer · <kbd>T</kbd> aujourd&apos;hui</span>
        <span className="utilisateur">
          {utilisateur.email}
          <button type="button" className="lien" onClick={() => supabase().auth.signOut()}>Se déconnecter</button>
        </span>
      </footer>

      {/* Le formulaire n'existe dans la page que lorsqu'il est ouvert.
          "key" change à chaque ouverture : React recrée alors un formulaire neuf, avec des champs réinitialisés. */}
      {formulaire && (
        <FormulaireTache
          key={`${formulaire.tacheId ?? "nouvelle"}-${formulaire.date ?? "defaut"}`}
          tache={tacheEnEdition}
          dateParDefaut={formulaire.date ?? dateParDefaut()}
          categorieParDefaut={filtres.categorie !== "toutes" ? filtres.categorie : "perso"}
          onEnregistrer={enregistrer}
          onSupprimer={() => (formulaire.tacheId ? confirmerSuppression(formulaire.tacheId) : Promise.resolve(false))}
          onFermer={() => setFormulaire(null)}
        />
      )}

      {synchroOuverte && <SynchroCalendrier onFermer={() => setSynchroOuverte(false)} />}
    </div>
  );
}
