"use client";

/* Étapes (sous-tâches) et matériel cochables.
   - CasesCarte    : ce qui s'affiche SUR la carte d'une tâche (on coche directement, sans
                     ouvrir le formulaire) ;
   - CompteurCases : le petit « 2/5 » des cartes réduites (vue Mois, repères d'heure) ;
   - EditeurListe  : la liste modifiable du formulaire (ajouter, corriger, retirer, réordonner).
   La logique (qui est coché, pour quel jour) est dans lib/etapes.ts.                       */

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { avancement, decouperLignes, elementsMateriel, estPris, type GenreCase } from "@/lib/etapes";
import type { Tache } from "@/lib/types";
import { IconeAjouter, IconeEtapes, IconeFermer, IconeMateriel, IconeValide } from "./Icones";

// Au-delà de ce nombre d'étapes, la carte n'en montre que les premières (bouton « + N autres »).
const ETAPES_VISIBLES = 5;

/* ---------- Sur la carte ---------- */

export function CasesCarte({ tache, cocher }: { tache: Tache; cocher?: (genre: GenreCase, cle: string) => void }) {
  const [deplie, setDeplie] = useState(false);
  const etapes = tache.etapes ?? [];
  const materiel = elementsMateriel(tache.materiel);
  if (etapes.length === 0 && materiel.length === 0) return null;
  const av = avancement(tache);
  const visibles = deplie || etapes.length <= ETAPES_VISIBLES ? etapes : etapes.slice(0, ETAPES_VISIBLES - 1);
  const cachees = etapes.length - visibles.length;
  const cacheesFaites = etapes.slice(visibles.length).filter((e) => e.faite).length;
  const pourJour = tache.occurrence ? " (pour ce jour)" : "";

  return (
    /* La carte entière ouvre le formulaire au clic, et peut être glissée : ici, un clic ou
       une touche doivent SEULEMENT cocher (stopPropagation, data-sans-glisser). */
    <div className="cases-carte" data-sans-glisser
      onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {etapes.length > 0 && (
        <div className="bloc-cases" role="group" aria-label={`Étapes : ${av.etapesFaites} sur ${av.etapesTotal} faites${pourJour}`}>
          <div className="cases-entete" aria-hidden="true">
            <IconeEtapes /> Étapes
            <span className={`cases-compte${av.etapesFaites === av.etapesTotal ? " complet" : ""}`}>{av.etapesFaites}/{av.etapesTotal}</span>
            <span className="mini-barre"><span style={{ width: `${(100 * av.etapesFaites) / av.etapesTotal}%` }} /></span>
          </div>
          <ul className="liste-etapes">
            {visibles.map((e) => (
              <li key={e.id}>
                <label className={`etape${e.faite ? " cochee" : ""}`}>
                  <input type="checkbox" checked={e.faite} disabled={!cocher}
                    onChange={() => cocher?.("etape", e.id)} />
                  <span className="etape-texte">{e.texte}</span>
                </label>
              </li>
            ))}
          </ul>
          {cachees > 0 && (
            <button type="button" className="voir-plus" onClick={() => setDeplie(true)}>
              + {cachees} autre{cachees > 1 ? "s" : ""} étape{cachees > 1 ? "s" : ""}{cacheesFaites ? ` (${cacheesFaites} faite${cacheesFaites > 1 ? "s" : ""})` : ""}
            </button>
          )}
        </div>
      )}
      {materiel.length > 0 && (
        <div className="bloc-cases" role="group" aria-label={`Matériel : ${av.materielPris} sur ${av.materielTotal} prêts${pourJour}`}>
          <div className="cases-entete" aria-hidden="true">
            <IconeMateriel /> Matériel
            <span className={`cases-compte${av.materielPris === av.materielTotal ? " complet" : ""}`}>
              {av.materielPris === av.materielTotal ? <><IconeValide /> tout est prêt</> : `${av.materielPris}/${av.materielTotal}`}
            </span>
          </div>
          <ul className="pastilles-materiel">
            {materiel.map((m, i) => {
              const pris = estPris(tache, m);
              return (
                <li key={i}>
                  {/* Un bouton « bascule » (aria-pressed) : il se lit « Calculatrice, bouton, activé ». */}
                  <button type="button" className={`pastille-materiel${pris ? " pris" : ""}`} aria-pressed={pris} disabled={!cocher}
                    title={pris ? "Prêt : toucher pour décocher" : "Toucher quand c'est prêt"}
                    onClick={() => cocher?.("materiel", m)}>
                    <span className="coche-pastille" aria-hidden="true">{pris && <IconeValide />}</span>
                    {m}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Carte réduite : juste le décompte des étapes, pour savoir où on en est d'un coup d'œil.
export function CompteurCases({ tache }: { tache: Tache }) {
  const av = avancement(tache);
  if (av.etapesTotal === 0) return null;
  return (
    <span className={`compteur-cases${av.etapesFaites === av.etapesTotal ? " complet" : ""}`}
      title={`Étapes : ${av.etapesFaites} sur ${av.etapesTotal} faites`}>
      <IconeEtapes /> {av.etapesFaites}/{av.etapesTotal}
    </span>
  );
}

/* ---------- Dans le formulaire ---------- */

export interface ElementListe { cle: string; texte: string; coche: boolean }

interface PropsEditeur {
  id: string;
  elements: ElementListe[];
  onChange: (elements: ElementListe[]) => void;
  creerCle: () => string;
  cochable: boolean;        // false pour une tâche répétée : on coche jour par jour, sur la carte
  placeholder: string;      // texte gris du champ d'ajout
  nomElement: string;       // « l'étape », « l'élément » (pour les libellés des boutons)
  max: number;
  /* Texte tapé dans le champ d'ajout mais pas encore validé par Entrée. Il est gardé par le
     formulaire, qui l'ajoute à l'enregistrement : on ne perd pas « Clé USB » parce qu'on a
     cliqué sur « Enregistrer » sans appuyer sur Entrée. (L'ajouter dès la sortie du champ
     décalait le bouton sous le doigt au moment du clic, qui tombait alors à côté.) */
  brouillon: string;
  onBrouillon: (texte: string) => void;
}

export function EditeurListe({ id, elements, onChange, creerCle, cochable, placeholder, nomElement, max, brouillon: nouveau, onBrouillon: setNouveau }: PropsEditeur) {
  const champs = useRef<(HTMLInputElement | null)[]>([]);
  const champAjout = useRef<HTMLInputElement>(null);
  // Index de la ligne à qui donner le focus au prochain affichage (-1 = champ d'ajout).
  const focusVoulu = useRef<number | null>(null);
  useEffect(() => {
    const i = focusVoulu.current;
    if (i === null) return;
    focusVoulu.current = null;
    (i < 0 ? champAjout.current : champs.current[i])?.focus();
  });

  const plein = elements.length >= max;

  function ajouter(textes: string[]) {
    const place = Math.max(0, max - elements.length);
    const neufs = textes.slice(0, place).map((texte) => ({ cle: creerCle(), texte, coche: false }));
    if (neufs.length) onChange([...elements, ...neufs]);
  }
  function remplacer(i: number, champsModifies: Partial<ElementListe>) {
    onChange(elements.map((e, j) => (j === i ? { ...e, ...champsModifies } : e)));
  }
  function retirer(i: number, focusApres: number | null) {
    focusVoulu.current = focusApres;
    onChange(elements.filter((_, j) => j !== i));
  }
  function deplacer(i: number, sens: -1 | 1) {
    const j = i + sens;
    if (j < 0 || j >= elements.length) return;
    const copie = [...elements];
    [copie[i], copie[j]] = [copie[j], copie[i]];
    focusVoulu.current = j;
    onChange(copie);
  }

  function toucheLigne(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      // Entrée ne doit pas envoyer le formulaire : elle passe à la ligne d'ajout (comme une liste de courses).
      e.preventDefault();
      champAjout.current?.focus();
    } else if (e.key === "Backspace" && elements[i].texte === "") {
      e.preventDefault();
      retirer(i, i > 0 ? i - 1 : elements.length > 1 ? 0 : -1);
    } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      deplacer(i, e.key === "ArrowUp" ? -1 : 1);
    }
  }
  function toucheAjout(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nouveau.trim()) { ajouter([nouveau.trim()]); setNouveau(""); }
    } else if (e.key === "Backspace" && nouveau === "" && elements.length) {
      e.preventDefault();
      champs.current[elements.length - 1]?.focus();
    }
  }
  // Coller une liste sur plusieurs lignes crée un élément par ligne (puces « - », « • », « 1. » retirées).
  function coller(e: ClipboardEvent<HTMLInputElement>) {
    const lignes = decouperLignes(e.clipboardData.getData("text"));
    if (lignes.length < 2) return;
    e.preventDefault();
    ajouter(lignes);
    setNouveau("");
  }

  return (
    <div className="editeur-liste">
      {elements.length > 0 && (
        <ul>
          {elements.map((el, i) => (
            <li key={el.cle} className={`ligne-editeur${el.coche ? " cochee" : ""}`}>
              {cochable && (
                <label className="zone-case-editeur">
                  <input type="checkbox" checked={el.coche} onChange={(e) => remplacer(i, { coche: e.target.checked })}
                    aria-label={`${el.coche ? "Décocher" : "Cocher"} ${nomElement} « ${el.texte} »`} />
                </label>
              )}
              <input type="text" ref={(n) => { champs.current[i] = n; }} value={el.texte} maxLength={200}
                aria-label={`${nomElement[0].toUpperCase()}${nomElement.slice(1)} ${i + 1}`} enterKeyHint="next"
                onChange={(e) => remplacer(i, { texte: e.target.value })} onKeyDown={(e) => toucheLigne(e, i)} />
              <button type="button" className="btn-icone" aria-label={`Retirer ${nomElement} « ${el.texte} »`} title="Retirer"
                onClick={() => retirer(i, null)}><IconeFermer /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="ajout-editeur">
        <IconeAjouter />
        <input id={id} ref={champAjout} type="text" value={nouveau} maxLength={200} disabled={plein}
          placeholder={plein ? `Maximum ${max} atteint` : placeholder} enterKeyHint="enter"
          onChange={(e) => setNouveau(e.target.value)} onKeyDown={toucheAjout} onPaste={coller} />
      </div>
    </div>
  );
}
