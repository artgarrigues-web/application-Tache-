"use client";

/* Fenêtre d'ajout / de modification d'une tâche (élément HTML natif <dialog>).
   Le composant n'existe que lorsque la fenêtre est ouverte : Agenda l'affiche
   ou non. À son apparition, useEffect appelle showModal() pour l'ouvrir.

   Les champs sont "contrôlés" : leur valeur vient de l'état React (valeurs),
   et chaque frappe met cet état à jour via onChange.                         */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { listeMateriel } from "@/lib/taches";
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
      ? {
          titre: tache.titre, description: tache.description, date: tache.date, heure: tache.heure,
          dureeMinutes: tache.dureeMinutes, lieu: tache.lieu, materiel: tache.materiel,
          categorie: tache.categorie, priorite: tache.priorite,
        }
      : {
          titre: "", description: "", date: dateParDefaut, heure: "",
          dureeMinutes: null, lieu: "", materiel: "",
          categorie: categorieParDefaut, priorite: "moyenne",
        },
  );

  /* La durée est stockée en minutes, mais saisie en heures + minutes (plus naturel).
     On recalcule les deux champs affichés à partir de dureeMinutes… */
  const dureeHeures = valeurs.dureeMinutes ? Math.floor(valeurs.dureeMinutes / 60) : "";
  const dureeMin = valeurs.dureeMinutes ? valeurs.dureeMinutes % 60 : "";
  // … et inversement, à chaque saisie, on recombine les deux en minutes (0 → pas de durée).
  function changerDuree(heures: number, minutes: number) {
    const total = (heures || 0) * 60 + (minutes || 0);
    changer("dureeMinutes", total > 0 ? total : null);
  }

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
    const donnees = {
      ...valeurs,
      titre: valeurs.titre.trim(),
      description: valeurs.description.trim(),
      lieu: valeurs.lieu.trim(),
      materiel: listeMateriel(valeurs.materiel).join("\n"), // retire les lignes vides
    };
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
            <label htmlFor="champ-duree-h">Durée estimée</label>
            <div className="duree-champs">
              <input id="champ-duree-h" type="number" min={0} max={168} inputMode="numeric" placeholder="0"
                aria-label="Heures" value={dureeHeures}
                onChange={(e) => changerDuree(Number(e.target.value), Number(dureeMin))} />
              <span>h</span>
              <input id="champ-duree-m" type="number" min={0} max={59} step={5} inputMode="numeric" placeholder="0"
                aria-label="Minutes" value={dureeMin}
                onChange={(e) => changerDuree(Number(dureeHeures), Math.min(59, Number(e.target.value)))} />
              <span>min</span>
            </div>
          </div>
          <div className="champ">
            <label htmlFor="champ-lieu">Lieu</label>
            <input id="champ-lieu" type="text" maxLength={200} placeholder="Ex. : Bâtiment B, salle 204"
              value={valeurs.lieu} onChange={(e) => changer("lieu", e.target.value)} />
          </div>
        </div>

        <div className="champ">
          <label htmlFor="champ-materiel">Matériel nécessaire <span className="indice">(un élément par ligne)</span></label>
          <textarea id="champ-materiel" rows={2} maxLength={2000} placeholder={"Calculatrice\nBlouse\nClé USB"}
            value={valeurs.materiel} onChange={(e) => changer("materiel", e.target.value)} />
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
