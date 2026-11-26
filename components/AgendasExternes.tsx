"use client";

/* Fenêtre « Mes agendas » : brancher son agenda Google, Outlook ou Apple dans AgendIA.

   On colle UNE fois l'« adresse secrète au format iCal » que donne Google (ou le lien
   ICS publié par Outlook). AgendIA lit alors cet agenda (lecture seule) :
   - ses événements s'affichent en rayé dans les vues Jour et Semaine ;
   - la planification automatique et « Ma journée » évitent ces créneaux.

   C'est le sens inverse de « Synchroniser mon calendrier » (qui envoie les tâches
   d'AgendIA vers Google). Les deux peuvent être utilisés ensemble.                  */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import { normaliserAdresse } from "@/lib/ics-lecture";
import { COULEURS, type Couleur } from "@/lib/types";
import type { DonneesAgendas } from "@/hooks/useAgendasExternes";
import { IconeAjouter, IconeAlerte, IconeFermer, IconeSucces, IconeSupprimer, IconeValide } from "./Icones";

const MAX_AGENDAS = 5;

export function AgendasExternes({ donnees, onFermer }: { donnees: DonneesAgendas; onFermer: () => void }) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [nom, setNom] = useState("");
  const [url, setUrl] = useState("");
  const [couleur, setCouleur] = useState<Couleur>("ardoise");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => { if (donnees.charge && donnees.agendas.length === 0) setFormulaireOuvert(true); }, [donnees.charge, donnees.agendas.length]);

  async function ajouter(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    const adresse = normaliserAdresse(url);
    if ("erreur" in adresse) return setErreur(adresse.erreur);
    setEnCours(true);
    const message = await donnees.ajouter({ nom: nom.trim() || "Mon agenda", url: adresse.url, couleur });
    setEnCours(false);
    if (message) return setErreur(message.includes("agendas_externes") ? "La base n'est pas encore prête pour les agendas externes (mise à jour Supabase à appliquer)." : message);
    setNom(""); setUrl(""); setFormulaireOuvert(false);
  }

  async function retirer(id: string, n: string) {
    if (!confirm(`Retirer l'agenda « ${n} » d'AgendIA ? (Rien n'est supprimé dans ton agenda d'origine.)`)) return;
    await donnees.retirer(id);
  }

  const plein = donnees.agendas.length >= MAX_AGENDAS;

  return (
    <dialog ref={dialogue} aria-labelledby="titre-agendas" onClose={onFermer} className="dialogue-agendas">
      <div className="formulaire">
        <div className="titre-dialogue-ligne">
          <h2 id="titre-agendas"><CalendarDays aria-hidden="true" /> Mes agendas (Google, Outlook)</h2>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => dialogue.current?.close()}><IconeFermer /></button>
        </div>
        <p className="indice">
          Affiche tes cours et rendez-vous dans AgendIA, et la planification automatique <strong>évitera ces créneaux</strong>.
          Lecture seule : AgendIA ne modifie jamais ton agenda d&apos;origine.
        </p>

        {donnees.indisponible && <p className="avertissement-encart"><IconeAlerte /> La base n&apos;est pas encore prête pour les agendas externes (mise à jour Supabase à appliquer).</p>}

        {donnees.agendas.length > 0 && (
          <ul className="liste-agendas">
            {donnees.agendas.map((a) => {
              const etat = donnees.etats.get(a.id);
              return (
                <li key={a.id} className={`ligne-agenda couleur-${a.couleur ?? "ardoise"}`}>
                  <span className="rond-agenda" aria-hidden="true" />
                  <div className="ligne-agenda-texte">
                    <strong>{a.nom}</strong>
                    <span className={`indice${etat && !etat.ok ? " texte-erreur" : ""}`}>
                      {!etat ? (donnees.enCours ? "Lecture…" : "Pas encore lu")
                        : etat.ok ? <><IconeSucces /> {etat.nombre} événement{etat.nombre > 1 ? "s" : ""} sur les prochaines semaines</>
                        : <><IconeAlerte /> {etat.erreur}</>}
                    </span>
                  </div>
                  <select aria-label={`Couleur de l'agenda ${a.nom}`} value={a.couleur ?? "ardoise"} className="choix-couleur-agenda"
                    onChange={(e) => donnees.changerCouleur(a.id, e.target.value as Couleur)}>
                    {COULEURS.map((c) => <option key={c.id} value={c.id}>{c.libelle}</option>)}
                  </select>
                  <button type="button" className="btn-icone" aria-label={`Retirer l'agenda ${a.nom}`} title="Retirer cet agenda"
                    onClick={() => retirer(a.id, a.nom)}><IconeSupprimer /></button>
                </li>
              );
            })}
          </ul>
        )}

        {formulaireOuvert && !plein ? (
          <form className="ajout-agenda" onSubmit={ajouter}>
            <div className="champ">
              <label htmlFor="agenda-url">Adresse secrète iCal (.ics)</label>
              <input id="agenda-url" type="url" inputMode="url" required autoComplete="off" spellCheck={false}
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="ligne-champs">
              <div className="champ">
                <label htmlFor="agenda-nom">Nom affiché</label>
                <input id="agenda-nom" type="text" maxLength={60} placeholder="Ex. : Cours, Perso" value={nom} onChange={(e) => setNom(e.target.value)} />
              </div>
              <fieldset className="palette palette-agenda">
                <legend>Couleur</legend>
                <div className="palette-pastilles">
                  {COULEURS.map((c) => (
                    <label key={c.id} className={`pastille-couleur couleur-${c.id}`} title={c.libelle}>
                      <input type="radio" name="couleur-agenda" checked={couleur === c.id} onChange={() => setCouleur(c.id)} />
                      <span className="rond" aria-hidden="true"><IconeValide /></span>
                      <span className="visuellement-cache">{c.libelle}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {erreur && <p className="message-erreur" role="alert">{erreur}</p>}
            <div className="boutons-dialogue">
              {donnees.agendas.length > 0 && <button type="button" className="btn" onClick={() => setFormulaireOuvert(false)}>Annuler</button>}
              <button type="submit" className="btn btn-principal" disabled={enCours || !url.trim() || donnees.indisponible}>
                {enCours ? "Ajout…" : "Ajouter cet agenda"}
              </button>
            </div>
          </form>
        ) : (
          <div className="boutons-dialogue">
            <button type="button" className="btn" disabled={donnees.enCours} onClick={donnees.actualiser}><RefreshCw aria-hidden="true" /> Actualiser</button>
            {!plein && <button type="button" className="btn btn-principal" onClick={() => setFormulaireOuvert(true)}><IconeAjouter /> Ajouter un agenda</button>}
          </div>
        )}

        <details className="mode-emploi">
          <summary>Où trouver l&apos;adresse dans Google Agenda ?</summary>
          <ol>
            <li>Sur un <strong>ordinateur</strong>, ouvre calendar.google.com (l&apos;application du téléphone ne la montre pas).</li>
            <li>À gauche, survole ton agenda → <strong>⋮</strong> → <strong>Paramètres et partage</strong>.</li>
            <li>Tout en bas, section « Intégrer l&apos;agenda » : copie <strong>Adresse secrète au format iCal</strong>.</li>
          </ol>
        </details>
        <details className="mode-emploi">
          <summary>Où le trouver dans Outlook (Hotmail, compte de l&apos;école) ?</summary>
          <ol>
            <li>Sur outlook.com ou outlook.office.com : <strong>Paramètres</strong> (roue dentée) → <strong>Calendrier</strong> → <strong>Calendriers partagés</strong>.</li>
            <li>Dans « Publier un calendrier », choisis ton calendrier et <strong>Peut afficher tous les détails</strong>, puis <strong>Publier</strong>.</li>
            <li>Copie le lien <strong>ICS</strong> (pas le lien HTML). Si l&apos;option manque sur un compte d&apos;école, c&apos;est que l&apos;établissement l&apos;a désactivée.</li>
          </ol>
        </details>
        <details className="mode-emploi">
          <summary>Et Apple (iCloud) ?</summary>
          <ol>
            <li>Dans l&apos;app Calendrier : touche <strong>Calendriers</strong> → <strong>ⓘ</strong> à côté de l&apos;agenda → active <strong>Calendrier public</strong>.</li>
            <li>Touche <strong>Partager le lien</strong> → Copier, et colle-le ici (une adresse webcal:// est acceptée).</li>
          </ol>
        </details>
        <p className="indice petite-note">
          Cette adresse donne accès à tout le contenu de l&apos;agenda : ne la partage pas. Elle est rangée dans ton compte AgendIA, visible de toi seul.
          Les changements faits dans Google ou Outlook apparaissent ici en 5 minutes environ.
        </p>
      </div>
    </dialog>
  );
}
