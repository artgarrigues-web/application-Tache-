"use client";

/* Bloc « Répétition » du formulaire (dans « Plus de détails »).
   Il édite une règle Recurrence (lib/types.ts) ; null = la tâche ne se répète pas.
   Disposition, de haut en bas :
   1. le rythme : Jamais / Chaque jour / semaine / mois / année (pastilles = boutons radio) ;
   2. l'intervalle « tous les N … » ;
   3. selon le rythme : les jours de la semaine, ou la façon de compter dans le mois ;
   4. la fin : jamais, à une date, ou après N fois ;
   5. une phrase de résumé (« Toutes les 2 semaines le lundi et jeudi »).          */

import { decrireRecurrence, infosMois, ordinal, premiereOccurrence, recurrenceParDefaut, dateLongue } from "@/lib/recurrence";
import { FREQUENCES, type Frequence, type ModeMois, type Recurrence } from "@/lib/types";
import { IconeRepeter } from "./Icones";

const LETTRES_JOURS = ["L", "M", "M", "J", "V", "S", "D"];
const NOMS_JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const COURTS: Record<Frequence, string> = { jour: "Chaque jour", semaine: "Chaque semaine", mois: "Chaque mois", annee: "Chaque année" };

interface Props {
  valeur: Recurrence | null;
  date: string;            // date de début (ou de l'occurrence) choisie dans le formulaire
  onChange: (r: Recurrence | null) => void;
  indisponible?: boolean;  // colonne absente de la base : on prévient que ce ne sera pas gardé
}

export function ChampRepetition({ valeur: r, date, onChange, indisponible }: Props) {
  const im = date ? infosMois(date) : null;
  const unite = r ? FREQUENCES.find((f) => f.id === r.frequence)!.unite : ["", ""];
  const feminin = r?.frequence === "semaine";

  function choisirFrequence(f: Frequence | null) {
    if (!f) return onChange(null);
    onChange(r ? { ...r, frequence: f } : recurrenceParDefaut(date, f));
  }
  function basculerJour(j: number) {
    if (!r) return;
    const jours = r.joursSemaine.includes(j) ? r.joursSemaine.filter((x) => x !== j) : [...r.joursSemaine, j].sort();
    if (jours.length) onChange({ ...r, joursSemaine: jours }); // au moins un jour reste choisi
  }

  // Si les jours choisis ne contiennent pas celui de la date, la série commence plus tard : on le dit.
  const debutReel = r && date ? premiereOccurrence(date, r) : date;

  return (
    <fieldset className="repetition">
      <legend><IconeRepeter /> Répétition</legend>

      <div className="choix-pastilles" role="radiogroup" aria-label="Rythme de répétition">
        <label className="choix-pastille">
          <input type="radio" name="frequence" checked={r === null} onChange={() => choisirFrequence(null)} />
          <span>Jamais</span>
        </label>
        {FREQUENCES.map((f) => (
          <label key={f.id} className="choix-pastille">
            <input type="radio" name="frequence" checked={r?.frequence === f.id} onChange={() => choisirFrequence(f.id)} />
            <span>{COURTS[f.id]}</span>
          </label>
        ))}
      </div>

      {r && (
        <div className="repetition-details">
          <div className="ligne-repetition">
            <label htmlFor="champ-intervalle">{feminin ? "Toutes les" : "Tous les"}</label>
            <input id="champ-intervalle" type="number" min={1} max={99} inputMode="numeric" className="petit-nombre"
              value={r.intervalle}
              onChange={(e) => onChange({ ...r, intervalle: Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))) })} />
            <span>{r.intervalle > 1 ? unite[1] : unite[0]}</span>
          </div>

          {r.frequence === "semaine" && (
            <div className="ligne-repetition">
              <span className="etiquette">Le</span>
              <div className="jours-semaine" role="group" aria-label="Jours de la semaine">
                {LETTRES_JOURS.map((l, j) => (
                  <button key={j} type="button" className={`jour-pastille${r.joursSemaine.includes(j) ? " actif" : ""}`}
                    aria-pressed={r.joursSemaine.includes(j)} aria-label={NOMS_JOURS[j]} title={NOMS_JOURS[j]}
                    onClick={() => basculerJour(j)}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {r.frequence === "mois" && im && (
            <div className="ligne-repetition">
              <label htmlFor="champ-mode-mois" className="visuellement-cache">Jour du mois</label>
              <select id="champ-mode-mois" value={r.modeMois === "rang" && im.rang === 5 ? "dernier" : r.modeMois}
                onChange={(e) => onChange({ ...r, modeMois: e.target.value as ModeMois })}>
                <option value="jour">Le {im.jour === 1 ? "1er" : im.jour} de chaque mois{im.jour >= 29 ? " (ou le dernier jour)" : ""}</option>
                {im.rang <= 4 && <option value="rang">Le {ordinal(im.rang)} {NOMS_JOURS[im.jourSemaine]} de chaque mois</option>}
                {im.estDernier && <option value="dernier">Le dernier {NOMS_JOURS[im.jourSemaine]} de chaque mois</option>}
              </select>
            </div>
          )}

          <div className="ligne-repetition fin-repetition">
            <span className="etiquette">Fin</span>
            <div className="choix-pastilles" role="radiogroup" aria-label="Fin de la répétition">
              <label className="choix-pastille">
                <input type="radio" name="fin" checked={r.fin.type === "jamais"} onChange={() => onChange({ ...r, fin: { type: "jamais" } })} />
                <span>Jamais</span>
              </label>
              <label className="choix-pastille">
                <input type="radio" name="fin" checked={r.fin.type === "date"}
                  onChange={() => onChange({ ...r, fin: { type: "date", date: date || "" } })} />
                <span>Le…</span>
              </label>
              <label className="choix-pastille">
                <input type="radio" name="fin" checked={r.fin.type === "nombre"}
                  onChange={() => onChange({ ...r, fin: { type: "nombre", nombre: 10 } })} />
                <span>Après…</span>
              </label>
            </div>
            {r.fin.type === "date" && (
              <input type="date" aria-label="Dernier jour de la répétition" min={date} value={r.fin.date}
                onChange={(e) => onChange({ ...r, fin: { type: "date", date: e.target.value } })} />
            )}
            {r.fin.type === "nombre" && (
              <span className="ligne-repetition">
                <input type="number" min={1} max={999} inputMode="numeric" className="petit-nombre" aria-label="Nombre de fois"
                  value={r.fin.nombre}
                  onChange={(e) => onChange({ ...r, fin: { type: "nombre", nombre: Math.max(1, Math.min(999, Math.round(Number(e.target.value) || 1))) } })} />
                <span>fois</span>
              </span>
            )}
          </div>

          <p className="resume-repetition" aria-live="polite">
            <IconeRepeter /> <span>{decrireRecurrence(r, debutReel)}.
              {debutReel && debutReel !== date && <> Première fois le {NOMS_JOURS[infosMois(debutReel).jourSemaine]} {dateLongue(debutReel)}.</>}</span>
          </p>
        </div>
      )}
      {indisponible && r && (
        <p className="indice avertissement">La répétition n&apos;est pas encore activée dans la base : elle ne sera pas enregistrée.</p>
      )}
    </fieldset>
  );
}
