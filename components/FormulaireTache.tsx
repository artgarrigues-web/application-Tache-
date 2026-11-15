"use client";

/* Fenêtre d'ajout / de modification d'une tâche (élément HTML natif <dialog>).
   Le composant n'existe que lorsque la fenêtre est ouverte : Agenda l'affiche
   ou non. À son apparition, useEffect appelle showModal() pour l'ouvrir.

   Les champs sont "contrôlés" : leur valeur vient de l'état React (valeurs),
   et chaque frappe met cet état à jour via onChange.                         */

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Categorie, DonneesTache, Priorite, Tache } from "@/lib/types";

interface Props {
  tache: Tache | null;                  // null = nouvelle tâche
  dateParDefaut: string;
  categorieParDefaut: Categorie;
  onEnregistrer: (d: DonneesTache) => Promise<boolean>;
  onSupprimer: () => Promise<boolean>;
  onFermer: () => void;
}

export function FormulaireTache({ tache, dateParDefaut, categorieParDefaut, onEnregistrer, onSupprimer, onFermer }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [enCours, setEnCours] = useState(false);
  const [valeurs, setValeurs] = useState<DonneesTache>(() =>
    tache
      ? { titre: tache.titre, description: tache.description, date: tache.date, heure: tache.heure, categorie: tache.categorie, priorite: tache.priorite }
      : { titre: "", description: "", date: dateParDefaut, heure: "", categorie: categorieParDefaut, priorite: "moyenne" },
  );

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Petite fonction générique pour mettre à jour un seul champ.
  function changer<K extends keyof DonneesTache>(champ: K, valeur: DonneesTache[K]) {
    setValeurs((v) => ({ ...v, [champ]: valeur }));
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault(); // empêche le rechargement de la page
    const donnees = { ...valeurs, titre: valeurs.titre.trim(), description: valeurs.description.trim() };
    if (!donnees.titre || !donnees.date) return;
    setEnCours(true);
    const ok = await onEnregistrer(donnees);
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  async function supprimer() {
    setEnCours(true);
    const ok = await onSupprimer();
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  return (
    <dialog ref={dialogue} aria-labelledby="titre-dialogue" onClose={onFermer}>
      <form className="formulaire" onSubmit={soumettre}>
        <h2 id="titre-dialogue">{tache ? "Modifier la tâche" : "Nouvelle tâche"}</h2>

        <div className="champ">
          <label htmlFor="champ-titre">Titre *</label>
          <input id="champ-titre" type="text" required maxLength={120} autoFocus
            placeholder="Ex. : Rendre le TP de mécanique"
            value={valeurs.titre} onChange={(e) => changer("titre", e.target.value)} />
        </div>

        <div className="champ">
          <label htmlFor="champ-description">Description</label>
          <textarea id="champ-description" rows={3} placeholder="Détails, liens, sous-étapes…"
            value={valeurs.description} onChange={(e) => changer("description", e.target.value)} />
        </div>

        <div className="ligne-champs">
          <div className="champ">
            <label htmlFor="champ-date">Date *</label>
            <input id="champ-date" type="date" required
              value={valeurs.date} onChange={(e) => changer("date", e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor="champ-heure">Heure (facultative)</label>
            <input id="champ-heure" type="time"
              value={valeurs.heure} onChange={(e) => changer("heure", e.target.value)} />
          </div>
        </div>

        <div className="ligne-champs">
          <div className="champ">
            <label htmlFor="champ-categorie">Catégorie</label>
            <select id="champ-categorie" value={valeurs.categorie}
              onChange={(e) => changer("categorie", e.target.value as Categorie)}>
              <option value="perso">Personnel</option>
              <option value="travail">Travail</option>
              <option value="projets">Projets</option>
            </select>
          </div>
          <div className="champ">
            <label htmlFor="champ-priorite">Priorité</label>
            <select id="champ-priorite" value={valeurs.priorite}
              onChange={(e) => changer("priorite", e.target.value as Priorite)}>
              <option value="haute">Haute</option>
              <option value="moyenne">Moyenne</option>
              <option value="basse">Basse</option>
            </select>
          </div>
        </div>

        <div className="boutons-dialogue">
          {tache && (
            <button type="button" className="btn btn-danger" id="btn-supprimer-dialogue" disabled={enCours} onClick={supprimer}>
              Supprimer
            </button>
          )}
          <button type="button" className="btn" onClick={() => dialogue.current?.close()}>Annuler</button>
          <button type="submit" className="btn btn-principal" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
