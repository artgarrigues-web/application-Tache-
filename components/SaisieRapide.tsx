"use client";

/* Ajout d'une tâche EN UNE PHRASE (« Réviser maths chaque lundi 14h 1 h à la bibliothèque
   important »). L'analyse elle-même est dans lib/saisie-rapide.ts (fonction pure, testée).
   Ici, l'affichage :
   - une PASTILLE par élément compris (date, heure, durée, répétition, priorité, lieu),
     mise à jour à chaque frappe. Toucher le « × » d'une pastille dit « ce n'était pas
     ça » : les mots retournent dans le titre ;
   - « Plus de détails » ouvre le formulaire complet DÉJÀ REMPLI avec tout ce qui a été
     compris, pour corriger une valeur (ex. : 1 h → 1 h 30) avant d'enregistrer.

   Deux présentations du même contenu :
   - téléphone : feuille qui monte du bas (bouton « + ») ;
   - ordinateur : barre toujours visible sous l'en-tête (touche A pour y aller).        */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Clock, Flag, Send, X } from "lucide-react";
import { ajouterJours, aujourdhui, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import { decrireRecurrence } from "@/lib/recurrence";
import { analyserSaisie, libelleDuree, type ChampSaisie, type SaisieAnalysee } from "@/lib/saisie-rapide";
import { PRIORITES, type DonneesTache, type Recurrence } from "@/lib/types";
import { IconeDuree, IconeLieu, IconeRepeter } from "./Icones";
import { FeuilleBas } from "./Mobile";

/* Ce que la saisie transmet pour créer la tâche (ou pré-remplir le formulaire). */
export type BrouillonSaisie = Pick<DonneesTache, "titre" | "date" | "heure" | "dureeMinutes" | "lieu" | "recurrence"> &
  Partial<Pick<DonneesTache, "priorite">>;

type ChoixDate = "auj" | "demain" | "jour" | "sans";
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const COURTS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/* Libellé COURT d'une répétition pour la pastille (« Chaque lundi » plutôt que
   « Toutes les semaines le lundi ») ; repli sur la phrase complète du formulaire. */
export function libelleRepetition(r: Recurrence, debut: string): string {
  const j = [...r.joursSemaine].sort();
  if (r.frequence === "semaine") {
    if (j.join() === "0,1,2,3,4" && r.intervalle === 1) return "En semaine";
    if (j.join() === "5,6" && r.intervalle === 1) return "Le week-end";
    if (j.length === 1) return r.intervalle === 1 ? `Chaque ${NOMS_JOURS[j[0]]}` : `Un ${NOMS_JOURS[j[0]]} sur ${r.intervalle}`;
    const liste = majuscule(j.map((x) => COURTS[x]).join(" "));
    return r.intervalle === 1 ? liste : `${liste}, 1 sem. sur ${r.intervalle}`;
  }
  if (r.frequence === "jour") return r.intervalle === 1 ? "Chaque jour" : `Tous les ${r.intervalle} jours`;
  return decrireRecurrence(r, debut).replace(/ \(.*\)$/, "");
}

// "09:30" → « 9 h 30 », "14:00" → « 14 h » (écriture française).
const libelleHeure = (h: string) => { const [hh, mm] = h.split(":"); return `${Number(hh)} h${mm === "00" ? "" : ` ${mm}`}`; };

/* ---------- Le cœur commun : état + analyse + pastilles ---------- */
function useSaisie(jourAffiche: string | undefined, dateDefaut: string | undefined) {
  const auj = aujourdhui();
  const isoAuj = versISO(auj), isoDemain = versISO(ajouterJours(auj, 1));
  // Jour proposé par défaut : celui affiché dans l'agenda s'il n'est ni aujourd'hui ni demain.
  const autreJour = jourAffiche && jourAffiche !== isoAuj && jourAffiche !== isoDemain ? jourAffiche : null;
  const [texte, setTexte] = useState("");
  const [ignores, setIgnores] = useState<ChampSaisie[]>([]);
  const [choix, setChoix] = useState<ChoixDate>(
    dateDefaut === "" ? "sans" : autreJour ? "jour" : jourAffiche === isoDemain ? "demain" : "auj");
  const a: SaisieAnalysee = useMemo(() => analyserSaisie(texte, auj, ignores), [texte, ignores, isoAuj]); // eslint-disable-line react-hooks/exhaustive-deps
  const dateChip = choix === "auj" ? isoAuj : choix === "demain" ? isoDemain : choix === "jour" && autreJour ? autreJour : "";
  const date = a.date ?? dateChip;

  // Un « × » ignore un champ. Si on vide le champ de saisie, on repart de zéro.
  useEffect(() => { if (!texte.trim()) setIgnores([]); }, [texte]);

  const brouillon: BrouillonSaisie = {
    titre: a.titre, date, heure: date ? a.heure : "", dureeMinutes: a.dureeMinutes, lieu: a.lieu,
    recurrence: date ? a.recurrence : null, ...(a.priorite ? { priorite: a.priorite } : {}),
  };
  return {
    texte, setTexte, a, date, brouillon, choix, setChoix, autreJour,
    // Une plage « de 14h à 16h » donne l'heure ET la durée : la refuser retire les deux.
    ignorer: (c: ChampSaisie) => setIgnores((l) => [...l, c,
      ...((c === "heure" || c === "duree") && a.extraits.heure === a.extraits.duree ? ["heure", "duree"] as ChampSaisie[] : [])]),
    vider: () => { setTexte(""); setIgnores([]); },
  };
}
type EtatSaisie = ReturnType<typeof useSaisie>;

/* Pastilles « ce que j'ai compris ». */
function Pastilles({ s }: { s: EtatSaisie }) {
  const { a, date } = s;
  const liste: { champ: ChampSaisie; icone: ReactNode; texte: string; classe?: string }[] = [];
  const x = a.extraits;
  if (x.date !== undefined) {
    liste.push({ champ: "date", icone: <CalendarDays aria-hidden="true" />,
      texte: date ? majuscule(formater(depuisISO(date), { weekday: "short", day: "numeric", month: "short" })) : "Sans date" });
  }
  if (x.recurrence && a.recurrence && date) {
    liste.push({ champ: "recurrence", icone: <IconeRepeter />, texte: libelleRepetition(a.recurrence, date) });
    // La date de début n'a pas été écrite : on la montre quand même (« dès lun. 30 nov. »).
    if (x.date === undefined) {
      liste.push({ champ: "recurrence", icone: <CalendarDays aria-hidden="true" />, classe: "pastille-deduite",
        texte: `Dès ${formater(depuisISO(date), { weekday: "short", day: "numeric", month: "short" })}` });
    }
  }
  if (x.heure && a.heure && date) liste.push({ champ: "heure", icone: <Clock aria-hidden="true" />, texte: libelleHeure(a.heure) });
  if (x.duree && a.dureeMinutes) liste.push({ champ: "duree", icone: <IconeDuree />, texte: libelleDuree(a.dureeMinutes) });
  if (x.priorite && a.priorite) {
    liste.push({ champ: "priorite", icone: <Flag aria-hidden="true" />, texte: `Priorité ${PRIORITES[a.priorite].toLowerCase()}`,
      classe: `pastille-priorite-${a.priorite}` });
  }
  if (x.lieu && a.lieu) liste.push({ champ: "lieu", icone: <IconeLieu />, texte: a.lieu });
  if (!liste.length) return null;
  return (
    <ul className="pastilles-saisie" aria-label="Ce qui a été compris">
      {liste.map((p, i) => (
        <li key={`${p.champ}-${i}`} className={`pastille-saisie pastille-${p.champ} ${p.classe ?? ""}`} title={`Compris dans « ${x[p.champ]} »`}>
          {p.icone}<span>{p.texte}</span>
          {!p.classe?.includes("deduite") && (
            <button type="button" aria-label={`Ne pas interpréter « ${x[p.champ]} » (le remettre dans le titre)`}
              onClick={() => s.ignorer(p.champ)}><X aria-hidden="true" /></button>
          )}
        </li>
      ))}
    </ul>
  );
}

/* Boutons radio de date (utilisés seulement si la phrase ne contient pas de date). */
function ChoixDeDate({ s }: { s: EtatSaisie }) {
  if (s.a.date !== null) return null;
  const options: [ChoixDate, string][] = [
    ...(s.autreJour ? [["jour", majuscule(formater(depuisISO(s.autreJour), { weekday: "short", day: "numeric", month: "short" }))] as [ChoixDate, string]] : []),
    ["auj", "Aujourd'hui"], ["demain", "Demain"], ["sans", "Sans date"],
  ];
  return (
    <div className="puces-date" role="radiogroup" aria-label="Date (aucune date dans la phrase)">
      {options.map(([id, lib]) => (
        <button key={id} type="button" role="radio" aria-checked={s.choix === id}
          className={s.choix === id ? "actif" : ""} onClick={() => s.setChoix(id)}>{lib}</button>
      ))}
    </div>
  );
}

const AIDE = <>Essaie : <em>demain 14h</em>, <em>chaque lundi</em>, <em>1 h</em>, <em>important</em>, <em>à la bibliothèque</em></>;
const EXEMPLE = "Ex. : Réviser maths chaque lundi 14h 1 h à la BU";

/* Titre retenu, ou aide quand le champ est vide. */
function Apercu({ s }: { s: EtatSaisie }) {
  if (!s.texte.trim()) return <p className="apercu-saisie">{AIDE}</p>;
  if (!s.a.titre) return <p className="apercu-saisie avertissement-saisie">Il manque le titre de la tâche.</p>;
  return (
    <p className="apercu-saisie">
      Titre : <strong>{s.a.titre}</strong>{!s.date && " · va dans la Checklist"}
    </p>
  );
}

/* ---------- Téléphone : feuille du bas ---------- */
export function SaisieRapide({ onCreer, onDetails, onFermer, jourAffiche }: {
  onCreer: (b: BrouillonSaisie) => Promise<boolean>;
  onDetails: (b: BrouillonSaisie | null) => void; // ouvre le formulaire complet, pré-rempli si une phrase a été tapée
  onFermer: () => void;
  jourAffiche?: string; // "AAAA-MM-JJ" : jour affiché dans l'agenda, proposé par défaut s'il n'est ni aujourd'hui ni demain
}) {
  const s = useSaisie(jourAffiche, undefined);
  const [envoi, setEnvoi] = useState(false);

  async function valider() {
    if (!s.a.titre || envoi) return;
    setEnvoi(true);
    const ok = await onCreer(s.brouillon);
    setEnvoi(false);
    if (ok) s.vider();
  }

  return (
    <FeuilleBas titre="Ajout rapide" onFermer={onFermer} className="feuille-saisie">
      <form className="saisie-rapide" onSubmit={(e) => { e.preventDefault(); valider(); }}>
        <div className="ligne-saisie">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={s.texte} onChange={(e) => s.setTexte(e.target.value)} placeholder={EXEMPLE}
            aria-label="Nouvelle tâche, en une phrase" enterKeyHint="send" autoComplete="off" />
          <button type="submit" className="btn btn-principal" aria-label="Ajouter" disabled={!s.a.titre || envoi}><Send aria-hidden="true" /></button>
        </div>
        <Pastilles s={s} />
        <ChoixDeDate s={s} />
        <Apercu s={s} />
        <button type="button" className="lien" onClick={() => { onFermer(); onDetails(s.a.titre ? s.brouillon : null); }}>
          {s.a.titre ? "Corriger ou compléter dans le formulaire" : "Plus de détails (durée, lieu, couleur…)"}
        </button>
      </form>
    </FeuilleBas>
  );
}

/* ---------- Ordinateur : barre sous l'en-tête ---------- */
export function BarreSaisieRapide({ onCreer, onDetails, dateDefaut }: {
  onCreer: (b: BrouillonSaisie) => Promise<boolean>;
  onDetails: (b: BrouillonSaisie | null) => void;
  dateDefaut: string; // date proposée si la phrase n'en contient pas ("" = Checklist)
}) {
  const s = useSaisie(dateDefaut || undefined, dateDefaut);
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const tape = s.texte.trim() !== "";

  // Touche A (hors champ de saisie) : aller dans la barre. Échap : la vider.
  useEffect(() => {
    function auClavier(e: KeyboardEvent) {
      const cible = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName) || document.querySelector("dialog[open]")) return;
      if (e.key === "a" || e.key === "A") { e.preventDefault(); champ.current?.focus(); }
    }
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, []);

  async function valider() {
    if (!s.a.titre || envoi) return;
    setEnvoi(true);
    const ok = await onCreer(s.brouillon);
    setEnvoi(false);
    if (ok) s.vider();
  }

  return (
    <form className={`barre-saisie${tape ? " active" : ""}`} onSubmit={(e) => { e.preventDefault(); valider(); }}>
      <div className="ligne-saisie">
        <input ref={champ} value={s.texte} onChange={(e) => s.setTexte(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { s.vider(); e.currentTarget.blur(); } }}
          placeholder={`Ajout rapide : ${EXEMPLE.replace("Ex. : ", "")}   (touche A)`}
          aria-label="Ajout rapide d'une tâche, en une phrase" autoComplete="off" />
        <button type="submit" className="btn btn-principal" disabled={!s.a.titre || envoi}><Send aria-hidden="true" /> Ajouter</button>
      </div>
      {tape && (
        <div className="details-saisie">
          <Pastilles s={s} />
          <ChoixDeDate s={s} />
          <Apercu s={s} />
          <button type="button" className="lien" disabled={!s.a.titre} onClick={() => { onDetails(s.brouillon); s.vider(); }}>
            Corriger ou compléter dans le formulaire
          </button>
        </div>
      )}
    </form>
  );
}
