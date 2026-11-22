"use client";

/* Catégorie « Idées de projets » de la Checklist.

   Deux morceaux, affichés à deux endroits de la Checklist :
   - <MenuProjets>   : la liste des projets, dans la colonne de gauche (sous la catégorie) ;
   - <PanneauProjet> : à droite, les idées du projet choisi (ajouter, modifier, cocher, supprimer).
   Les données viennent du hook useIdees (appelé une seule fois dans Agenda).

   Modifier un texte « sur place » : un clic sur le texte le remplace par un champ.
   Entrée (ou clic ailleurs) = enregistrer, Échap = annuler. Un champ vidé = pas de changement. */

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { DonneesIdees } from "@/hooks/useIdees";
import type { Idee, ProjetIdees } from "@/lib/types";
import { IconeAjouter, IconeAlerte, IconeFermer, IconeIdee, IconeModifier, IconeProjet, IconeSupprimer, IconeValide } from "./Icones";

const LONGUEUR_TITRE = 200;  // mêmes limites que dans la base (check … between 1 and …)
const LONGUEUR_IDEE = 2000;

/* ---------- Petit champ « une ligne + bouton Ajouter » ---------- */
function ChampAjout({ placeholder, libelle, max, onAjouter }: {
  placeholder: string; libelle: string; max: number; onAjouter: (texte: string) => Promise<unknown>;
}) {
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  async function valider(e: FormEvent) {
    e.preventDefault();
    const propre = texte.trim();
    if (!propre || envoi) return;
    setEnvoi(true);
    const ok = await onAjouter(propre);
    setEnvoi(false);
    if (ok) setTexte(""); // en cas d'échec on garde le texte, pour ne rien perdre
  }
  return (
    <form className="champ-ajout" onSubmit={valider}>
      <input type="text" value={texte} maxLength={max} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => setTexte(e.target.value)} />
      <button type="submit" className="btn btn-principal" disabled={!texte.trim() || envoi} aria-label={libelle} title={libelle}>
        <IconeAjouter /><span className="texte-bouton">{libelle}</span>
      </button>
    </form>
  );
}

/* ---------- Texte modifiable sur place ---------- */
function TexteModifiable({ valeur, max, libelle, enEdition, setEnEdition, onEnregistrer, multiligne = false }: {
  valeur: string; max: number; libelle: string; enEdition: boolean; setEnEdition: (v: boolean) => void;
  onEnregistrer: (v: string) => Promise<unknown>; multiligne?: boolean;
}) {
  const [brouillon, setBrouillon] = useState(valeur);
  const fini = useRef(false); // évite un double enregistrement (Entrée puis perte du focus)
  async function terminer(garder: boolean) {
    if (fini.current) return;
    fini.current = true;
    const propre = brouillon.trim();
    setEnEdition(false);
    if (garder && propre && propre !== valeur) await onEnregistrer(propre);
    else setBrouillon(valeur);
  }
  function touche(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Escape") { e.preventDefault(); terminer(false); }
    // Entrée enregistre ; Maj+Entrée fait un retour à la ligne dans une idée.
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); terminer(true); }
  }
  if (!enEdition) return null;
  const commun = {
    value: brouillon, maxLength: max, autoFocus: true, "aria-label": libelle,
    onChange: (e: { target: { value: string } }) => setBrouillon(e.target.value),
    onKeyDown: touche, onBlur: () => terminer(true),
  };
  return multiligne
    ? <textarea className="champ-sur-place" rows={Math.min(6, brouillon.split("\n").length + 1)} {...commun} />
    : <input type="text" className="champ-sur-place" {...commun} />;
}

/* ---------- Colonne de gauche : la liste des projets ---------- */
export function MenuProjets({ donnees, projetActif, choisir }: {
  donnees: DonneesIdees; projetActif: string | null; choisir: (id: string) => void;
}) {
  const { projets, idees, migrationManquante } = donnees;
  return (
    <div className="menu-projets">
      {projets.length > 0 && (
        <ul>
          {projets.map((p) => {
            const n = idees.filter((i) => i.projetId === p.id).length;
            return (
              <li key={p.id}>
                <button type="button" className={`projet-menu${p.id === projetActif ? " actif" : ""}`}
                  aria-current={p.id === projetActif ? "true" : undefined} onClick={() => choisir(p.id)}>
                  <IconeProjet /><span className="projet-menu-titre">{p.titre}</span>
                  <span className="compte-groupe">{n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!migrationManquante && (
        <ChampAjout placeholder="Nouveau projet…" libelle="Créer" max={LONGUEUR_TITRE}
          onAjouter={async (titre) => {
            const cree = await donnees.ajouterProjet(titre);
            if (cree) choisir(cree.id);
            return cree;
          }} />
      )}
    </div>
  );
}

/* ---------- Une idée ---------- */
function LigneIdee({ idee, donnees }: { idee: Idee; donnees: DonneesIdees }) {
  const [edition, setEdition] = useState(false);
  return (
    <li className={`idee${idee.faite ? " faite" : ""}`}>
      <input type="checkbox" checked={idee.faite} onChange={() => donnees.basculerIdee(idee.id)}
        aria-label={`Marquer l'idée « ${idee.texte} » comme ${idee.faite ? "à creuser" : "réalisée"}`} />
      {edition
        ? <TexteModifiable valeur={idee.texte} max={LONGUEUR_IDEE} libelle="Modifier l'idée" multiligne
            enEdition={edition} setEnEdition={setEdition} onEnregistrer={(t) => donnees.modifierIdee(idee.id, t)} />
        : <span className="idee-texte" role="button" tabIndex={0} title="Cliquer pour modifier"
            onClick={() => setEdition(true)} onKeyDown={(e) => { if (e.key === "Enter") setEdition(true); }}>
            {idee.texte}
          </span>}
      <span className="tache-actions">
        {!edition && <button type="button" className="btn-icone" aria-label="Modifier" title="Modifier" onClick={() => setEdition(true)}><IconeModifier /></button>}
        <button type="button" className="btn-icone" aria-label="Supprimer" title="Supprimer"
          onClick={() => { if (confirm(`Supprimer l'idée « ${idee.texte} » ?`)) donnees.supprimerIdee(idee.id); }}>
          <IconeSupprimer />
        </button>
      </span>
    </li>
  );
}

/* ---------- Partie droite : les idées du projet choisi ---------- */
export function PanneauProjet({ donnees, projet }: { donnees: DonneesIdees; projet: ProjetIdees | null }) {
  const [renommage, setRenommage] = useState(false);
  const { charge, erreur, migrationManquante } = donnees;

  if (migrationManquante) {
    return (
      <div className="bandeau-erreur" role="alert">
        <span><IconeAlerte /> Les idées de projets ne sont pas encore activées : la mise à jour de la base
          (fichier <code>supabase/migration-idees.sql</code>) doit être collée une fois dans Supabase → SQL Editor.</span>
      </div>
    );
  }
  if (!charge) return <p className="vide">Chargement des idées…</p>;

  const bandeau = erreur && (
    <div className="bandeau-erreur" role="alert">
      <span>Problème de connexion à la base : {erreur}</span>
      <button type="button" className="btn-icone" aria-label="Fermer" onClick={donnees.effacerErreur}><IconeFermer /></button>
    </div>
  );

  if (!projet) {
    return (
      <div className="panneau-projet">
        {bandeau}
        <p className="aide-tri">
          Note ici tes idées, rangées par projet. Crée un projet dans la colonne de gauche
          (sur téléphone : juste au-dessus), puis ajoute-lui autant d&apos;idées que tu veux.
          Une idée peut être modifiée d&apos;un clic, cochée quand elle est réalisée, ou supprimée.
        </p>
        <p className="vide"><IconeIdee /> Aucun projet pour l&apos;instant.</p>
      </div>
    );
  }

  const liste = donnees.idees.filter((i) => i.projetId === projet.id);
  const aCreuser = liste.filter((i) => !i.faite);
  const realisees = liste.filter((i) => i.faite);

  function supprimer() {
    if (!projet) return;
    const n = liste.length;
    if (confirm(`Supprimer le projet « ${projet.titre} »${n ? ` et ses ${n} idée(s)` : ""} ?`)) donnees.supprimerProjet(projet.id);
  }

  return (
    <div className="panneau-projet">
      {bandeau}
      <div className="entete-projet">
        {renommage
          ? <TexteModifiable key={projet.id} valeur={projet.titre} max={LONGUEUR_TITRE} libelle="Renommer le projet"
              enEdition={renommage} setEnEdition={setRenommage} onEnregistrer={(t) => donnees.renommerProjet(projet.id, t)} />
          : <h3><IconeProjet /> {projet.titre}</h3>}
        <span className="tache-actions">
          {!renommage && <button type="button" className="btn-icone" aria-label="Renommer le projet" title="Renommer le projet" onClick={() => setRenommage(true)}><IconeModifier /></button>}
          <button type="button" className="btn-icone" aria-label="Supprimer le projet" title="Supprimer le projet" onClick={supprimer}><IconeSupprimer /></button>
        </span>
      </div>
      <p className="resume-projet">
        {liste.length === 0 ? "Pas encore d'idée." : `${aCreuser.length} à creuser · ${realisees.length} réalisée(s)`}
      </p>

      <ChampAjout key={projet.id} placeholder="Nouvelle idée…" libelle="Ajouter" max={LONGUEUR_IDEE}
        onAjouter={(t) => donnees.ajouterIdee(projet.id, t)} />

      {aCreuser.length > 0 && (
        <ul className="liste-idees">{aCreuser.map((i) => <LigneIdee key={i.id} idee={i} donnees={donnees} />)}</ul>
      )}
      {realisees.length > 0 && (
        <>
          <h4 className="titre-faites"><IconeValide /> Réalisées ({realisees.length})</h4>
          <ul className="liste-idees">{realisees.map((i) => <LigneIdee key={i.id} idee={i} donnees={donnees} />)}</ul>
        </>
      )}
    </div>
  );
}
