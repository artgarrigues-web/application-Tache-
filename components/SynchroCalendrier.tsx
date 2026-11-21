"use client";

/* Fenêtre « Synchroniser avec mon calendrier ».
   Chaque utilisateur obtient SA propre adresse secrète :
     https://<site>/api/calendrier/<jeton>.ics
   Google Agenda, Outlook (et donc Teams pour les comptes Microsoft 365),
   Apple Calendrier… s'y abonnent et la relisent régulièrement.

   Le jeton est stocké dans la table calendrier_jetons (une ligne par
   utilisateur, protégée par RLS). On peut le régénérer (l'ancienne adresse
   cesse de marcher) ou le supprimer (synchronisation coupée).              */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { NOM_APP } from "@/lib/marque";
import { IconeMenu, IconeSynchro, IconeValide } from "./Icones";

const NOM_CALENDRIER = NOM_APP;

export function SynchroCalendrier({ onFermer }: { onFermer: () => void }) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [jeton, setJeton] = useState<string | null>(null);
  const [etat, setEtat] = useState<"chargement" | "pret" | "travail">("chargement");
  const [erreur, setErreur] = useState("");
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
    // Lecture seule : on ne crée pas de jeton tant que l'utilisateur ne l'a pas demandé.
    supabase().from("calendrier_jetons").select("jeton").maybeSingle().then(({ data, error }) => {
      if (error) setErreur(error.message);
      setJeton(data?.jeton ?? null);
      setEtat("pret");
    });
  }, []);

  async function obtenir(nouveau: boolean) {
    if (nouveau && !confirm("L'adresse actuelle cessera de fonctionner : il faudra réabonner tes calendriers avec la nouvelle. Continuer ?")) return;
    setEtat("travail");
    setErreur("");
    const { data, error } = await supabase().rpc("jeton_calendrier", { nouveau });
    if (error) setErreur(error.message);
    else setJeton(data as string);
    setEtat("pret");
  }

  async function desactiver() {
    if (!confirm("Couper la synchronisation ? Tes calendriers abonnés ne recevront plus tes tâches.")) return;
    setEtat("travail");
    setErreur("");
    const { error } = await supabase().from("calendrier_jetons").delete().not("user_id", "is", null);
    if (error) setErreur(error.message);
    else setJeton(null);
    setEtat("pret");
  }

  // Adresse https (pour copier/coller) et webcal (même adresse, protocole "abonnement").
  const adresse = jeton ? `${window.location.origin}/api/calendrier/${jeton}.ics` : "";
  const webcal = adresse.replace(/^https?:/, "webcal:");
  const enc = encodeURIComponent;
  const liens = jeton
    ? {
        google: `https://calendar.google.com/calendar/r?cid=${enc(webcal)}`,
        outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${enc(adresse)}&name=${enc(NOM_CALENDRIER)}`,
        microsoft365: `https://outlook.office.com/calendar/0/addfromweb?url=${enc(adresse)}&name=${enc(NOM_CALENDRIER)}`,
      }
    : null;

  async function copier() {
    try {
      await navigator.clipboard.writeText(adresse);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      prompt("Copie cette adresse :", adresse);
    }
  }

  const occupe = etat !== "pret";

  return (
    <dialog ref={dialogue} aria-labelledby="titre-synchro" onClose={onFermer}>
      <div className="formulaire synchro">
        <h2 id="titre-synchro"><IconeSynchro /> Synchroniser avec mon calendrier</h2>

        <p className="indice">
          Tes tâches <strong>datées</strong> apparaissent dans Google Agenda (et donc sur Android), Outlook,
          Teams ou Apple Calendrier, et s&apos;y mettent à jour toutes seules. Les tâches de la Checklist (sans date)
          ne sont pas envoyées.
        </p>

        {erreur && <p className="bandeau-erreur" role="alert">{erreur}</p>}

        {etat === "chargement" ? (
          <p className="vide">Chargement…</p>
        ) : !jeton ? (
          <button type="button" className="btn btn-principal" disabled={occupe} onClick={() => obtenir(false)}>
            Activer la synchronisation
          </button>
        ) : (
          <>
            <div className="champ">
              <label htmlFor="champ-adresse">Ton adresse d&apos;abonnement (personnelle et secrète)</label>
              <div className="ligne-copie">
                <input id="champ-adresse" type="text" readOnly value={adresse} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn" onClick={copier}>{copie ? <><IconeValide /> Copiée</> : "Copier"}</button>
              </div>
            </div>

            <div className="boutons-calendriers">
              <a className="btn" href={liens!.google} target="_blank" rel="noopener noreferrer">Google Agenda / Android</a>
              <a className="btn" href={liens!.microsoft365} target="_blank" rel="noopener noreferrer">Outlook pro ou école / Teams</a>
              <a className="btn" href={liens!.outlook} target="_blank" rel="noopener noreferrer">Outlook.com (perso)</a>
              <a className="btn" href={webcal}>Apple / autre appli</a>
            </div>

            <details className="mode-emploi">
              <summary>Mode d&apos;emploi détaillé</summary>
              <h3>Google Agenda et Android</h3>
              <ol>
                <li>Clique sur « Google Agenda / Android » (depuis un ordinateur de préférence : l&apos;appli Android ne sait pas ajouter un calendrier par adresse).</li>
                <li>Google propose « Ajouter cet agenda » : confirme. Sinon : calendar.google.com → « Autres agendas » → « + » → « À partir de l&apos;URL » → colle l&apos;adresse.</li>
                <li>Sur le téléphone : appli Google Agenda → menu <IconeMenu /> → Paramètres → « {NOM_APP} » → active « Synchronisation ». Il apparaît alors aussi dans l&apos;agenda Samsung ou tout agenda Android relié à ton compte Google.</li>
              </ol>
              <h3>Outlook et Teams</h3>
              <ol>
                <li>Compte d&apos;école ou d&apos;entreprise : « Outlook pro ou école / Teams ». Compte Hotmail/Outlook.com : « Outlook.com (perso) ».</li>
                <li>Outlook ouvre « S&apos;abonner à partir du web » avec l&apos;adresse déjà remplie : clique sur « Importer ».</li>
                <li>Teams : le calendrier de Teams affiche surtout l&apos;agenda principal d&apos;Outlook ; un agenda abonné est visible dans Outlook (web, ordinateur, téléphone), pas toujours dans Teams. Certaines écoles bloquent aussi les abonnements externes.</li>
              </ol>
              <h3>À savoir</h3>
              <ul>
                <li><strong>Lecture seule</strong> : modifier une tâche se fait dans cette appli, pas dans Google ou Outlook.</li>
                <li><strong>Délai</strong> : Google relit l&apos;adresse quand il le décide (souvent toutes les quelques heures, parfois jusqu&apos;à 24 h) ; Outlook environ toutes les 3 h. Ce délai ne dépend pas de l&apos;appli.</li>
                <li>Les tâches sans heure apparaissent « toute la journée » ; une tâche avec heure mais sans durée dure 1 h. Les tâches terminées sont précédées de ✓.</li>
                <li>Ne partage pas cette adresse : qui la connaît peut <em>lire</em> tes tâches datées. En cas de doute, génère-en une nouvelle.</li>
              </ul>
            </details>

            <div className="boutons-dialogue">
              <button type="button" className="btn btn-danger" disabled={occupe} onClick={desactiver}>Couper la synchronisation</button>
              <button type="button" className="btn" disabled={occupe} onClick={() => obtenir(true)}>Nouvelle adresse</button>
            </div>
          </>
        )}

        <div className="boutons-dialogue">
          <button type="button" className="btn" onClick={() => dialogue.current?.close()}>Fermer</button>
        </div>
      </div>
    </dialog>
  );
}
