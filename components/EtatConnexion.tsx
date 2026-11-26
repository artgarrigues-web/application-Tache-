"use client";

/* Bandeau d'état de la connexion (hors connexion, envoi en cours, avis de conflit).

   L'état vient de lib/hors-ligne.ts. useSyncExternalStore est le moyen officiel de React
   pour lire une donnée qui vit EN DEHORS des composants (ici un petit « magasin » qui
   prévient ses abonnés à chaque changement) : React réaffiche le bandeau à chaque fois.

   Ce qui est affiché :
   - hors connexion : depuis quand la copie de l'appareil date, et combien de changements
     attendent d'être envoyés ;
   - réseau revenu : « Envoi de 3 changements… » puis « ✓ 3 changements envoyés » (4 s) ;
   - après un conflit : un avis à lire (fenêtre avec le détail), puis « Compris ».          */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, CloudOff, CloudUpload, RefreshCw, TriangleAlert } from "lucide-react";
import * as hl from "@/lib/hors-ligne";
import { IconeFermer } from "./Icones";

const ETAT_SERVEUR: hl.EtatHorsLigne = { enLigne: true, enAttente: 0, envoiEnCours: false, derniereSynchro: null, avis: [], envoyesRecemment: 0 };

function depuis(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const minutes = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const heure = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const memeJour = new Date().toDateString() === d.toDateString();
  return memeJour ? `à ${heure}` : `le ${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${heure}`;
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function EtatConnexion() {
  const e = useSyncExternalStore(hl.abonner, hl.lireEtat, () => ETAT_SERVEUR);
  const [envoyes, setEnvoyes] = useState(0); // « ✓ n changements envoyés », affiché 4 secondes
  const [, setTic] = useState(0);            // fait vieillir « il y a 5 min » sans autre changement
  const etaitEnvoi = useRef(false);
  const dialogue = useRef<HTMLDialogElement>(null);
  const [avisOuverts, setAvisOuverts] = useState(false);

  useEffect(() => {
    if (etaitEnvoi.current && !e.envoiEnCours && e.enAttente === 0 && e.envoyesRecemment > 0) {
      setEnvoyes(e.envoyesRecemment);
      const t = setTimeout(() => setEnvoyes(0), 4000);
      etaitEnvoi.current = false;
      return () => clearTimeout(t);
    }
    etaitEnvoi.current = e.envoiEnCours || e.enAttente > 0;
  }, [e.envoiEnCours, e.enAttente, e.envoyesRecemment]);

  useEffect(() => {
    if (e.enLigne) return;
    const t = setInterval(() => setTic((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [e.enLigne]);

  useEffect(() => {
    const d = dialogue.current;
    if (avisOuverts && d && !d.open) d.showModal();
  }, [avisOuverts]);

  const enAttente = e.enAttente > 0 ? pluriel(e.enAttente, "changement") + " en attente" : "";

  let bandeau: React.ReactNode = null;
  if (!e.enLigne) {
    bandeau = (
      <div className="etat-connexion hors-ligne" role="status">
        <CloudOff aria-hidden="true" className="etat-icone" />
        <span className="etat-texte">
          <strong>Hors connexion</strong>
          <span className="etat-detail">
            {hl.aDesDonnees() ? (
              <>
                <span className="libelle-long">Tâches enregistrées sur cet appareil{e.derniereSynchro ? <> · mises à jour {depuis(e.derniereSynchro)}</> : null}. Tes changements seront envoyés au retour du réseau.</span>
                <span className="libelle-court">Copie de l&apos;appareil{e.derniereSynchro ? <>, {depuis(e.derniereSynchro)}</> : null}. Envoi au retour du réseau.</span>
              </>
            ) : "Aucune copie de tes tâches sur cet appareil pour l'instant : ouvre AgendIA une fois avec du réseau."}
          </span>
        </span>
        {enAttente && <span className="pastille-attente">{enAttente}</span>}
        <button type="button" className="btn btn-petit" onClick={() => hl.envoyerFile()} title="Réessayer maintenant">
          <RefreshCw aria-hidden="true" /> <span className="libelle-long">Réessayer</span>
        </button>
      </div>
    );
  } else if (e.envoiEnCours || e.enAttente > 0) {
    bandeau = (
      <div className="etat-connexion envoi" role="status">
        <CloudUpload aria-hidden="true" className="etat-icone tourne" />
        <span className="etat-texte"><strong>Envoi de {pluriel(e.enAttente, "changement")} fait{e.enAttente > 1 ? "s" : ""} hors connexion…</strong></span>
      </div>
    );
  } else if (envoyes > 0) {
    bandeau = (
      <div className="etat-connexion envoye" role="status">
        <Check aria-hidden="true" className="etat-icone" />
        <span className="etat-texte"><strong>{pluriel(envoyes, "changement")} envoyé{envoyes > 1 ? "s" : ""}</strong> <span className="etat-detail">Tout est à jour.</span></span>
      </div>
    );
  }

  return (
    <>
      {bandeau}
      {e.avis.length > 0 && (
        <div className="etat-connexion avis" role="alert">
          <TriangleAlert aria-hidden="true" className="etat-icone" />
          <span className="etat-texte">
            <strong>{e.avis.length === 1 ? "Un changement à vérifier" : `${e.avis.length} changements à vérifier`}</strong>
            <span className="etat-detail">
              {e.avis.length === 1 ? `${e.avis[0].titre} : ${e.avis[0].texte}` : "La même tâche avait été modifiée sur deux appareils."}
            </span>
          </span>
          {e.avis.length > 1 && <button type="button" className="btn btn-petit" onClick={() => setAvisOuverts(true)}>Voir</button>}
          <button type="button" className="btn btn-petit" onClick={() => hl.retirerAvis()}>Compris</button>
        </div>
      )}
      {avisOuverts && (
        <dialog ref={dialogue} className="dialogue-avis" aria-labelledby="titre-avis" onClose={() => setAvisOuverts(false)}>
          <div className="formulaire">
            <div className="titre-dialogue-ligne">
              <h2 id="titre-avis"><TriangleAlert aria-hidden="true" /> Changements à vérifier</h2>
              <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => dialogue.current?.close()}><IconeFermer /></button>
            </div>
            <p className="indice">
              Ces tâches avaient été modifiées à la fois hors connexion et sur un autre appareil.
              Règle appliquée : pour chaque information (titre, date, heure…), <strong>la modification la plus récente gagne</strong>.
            </p>
            <ul className="liste-avis">
              {e.avis.map((a) => (
                <li key={a.cle}>
                  <strong>{a.titre}</strong>
                  <span>{a.texte}</span>
                  <small>{depuis(a.quand)}</small>
                </li>
              ))}
            </ul>
            <div className="boutons-dialogue">
              <button type="button" className="btn btn-principal" onClick={() => { hl.retirerAvis(); dialogue.current?.close(); }}>Compris</button>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

/* Téléphone : l'en-tête reste en haut de l'écran quand on fait défiler, mais le bandeau,
   lui, part avec la page. Cette pastille ronde dans l'en-tête garde l'état visible ;
   la toucher remonte en haut, sur le bandeau qui explique. */
export function IndicateurConnexion() {
  const e = useSyncExternalStore(hl.abonner, hl.lireEtat, () => ETAT_SERVEUR);
  if (e.enLigne && e.enAttente === 0) return null;
  const libelle = !e.enLigne
    ? `Hors connexion${e.enAttente ? ` : ${pluriel(e.enAttente, "changement")} en attente` : ""}`
    : `Envoi de ${pluriel(e.enAttente, "changement")}`;
  return (
    <button type="button" className={`btn-rond indicateur-connexion${e.enLigne ? " envoi" : ""}`} aria-label={libelle} title={libelle}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
      {e.enLigne ? <CloudUpload aria-hidden="true" className="tourne" /> : <CloudOff aria-hidden="true" />}
      {e.enAttente > 0 && <span className="compte-attente">{e.enAttente > 99 ? "99+" : e.enAttente}</span>}
    </button>
  );
}
