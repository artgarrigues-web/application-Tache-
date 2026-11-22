"use client";

/* APERÇU DES PALETTES (temporaire, pour choisir les couleurs).
   Ajouter ?palette=bleu (ou indigo, nuit) à l'adresse du site affiche une petite
   barre en bas de l'écran pour passer d'une palette à l'autre. Le choix est posé
   sur <html data-palette="..."> : les règles de app/palettes.css ne s'appliquent
   que dans ce cas. Sans ?palette=, rien n'est affiché et l'app garde ses couleurs.
   Quand Arthur aura choisi, on recopiera la palette dans globals.css et on
   supprimera ce fichier et palettes.css.                                   */

import { useEffect, useState } from "react";

const PALETTES = [
  { id: "", libelle: "Actuelle" },
  { id: "bleu", libelle: "1 · Bleu" },
  { id: "indigo", libelle: "2 · Indigo" },
  { id: "nuit", libelle: "3 · Nuit" },
] as const;

const CLE = "agandia-palette-apercu";

export function ApercuPalettes() {
  const [visible, setVisible] = useState(false);
  const [palette, setPalette] = useState("");

  useEffect(() => {
    const demandee = new URLSearchParams(window.location.search).get("palette");
    let memorisee: string | null = null;
    try { memorisee = localStorage.getItem(CLE); } catch { /* navigation privée */ }
    const choix = demandee ?? memorisee;
    if (choix === null) return;           // pas d'aperçu demandé : on ne fait rien
    setVisible(true);
    appliquer(PALETTES.some((p) => p.id === choix) ? choix : "");
  }, []);

  function appliquer(id: string) {
    setPalette(id);
    if (id) document.documentElement.dataset.palette = id;
    else delete document.documentElement.dataset.palette;
    try { localStorage.setItem(CLE, id); } catch { /* ignoré */ }
  }

  function quitter() {
    appliquer("");
    try { localStorage.removeItem(CLE); } catch { /* ignoré */ }
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <div className="apercu-palettes" role="toolbar" aria-label="Aperçu des palettes">
      <span>Palette :</span>
      {PALETTES.map((p) => (
        <button key={p.id || "actuelle"} type="button" className={palette === p.id ? "actif" : ""}
          aria-pressed={palette === p.id} onClick={() => appliquer(p.id)}>{p.libelle}</button>
      ))}
      <button type="button" title="Fermer l'aperçu" aria-label="Fermer l'aperçu" onClick={quitter}>✕</button>
    </div>
  );
}
