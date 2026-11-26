"use client";

/* Fenêtre « Rappels et notifications ».
   1. Cet appareil : activer / désactiver les notifications (une fois par appareil :
      téléphone, ordinateur…), avec un guide pas à pas pour l'iPhone.
   2. Réglages du compte (valables sur tous les appareils) : rappel proposé par défaut
      pour les nouvelles tâches avec heure, et résumé du matin « Ma journée ».
   3. Un bouton de test, pour vérifier sans attendre.                               */

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, BellRing, Share, SquarePlus, Smartphone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ReglagesRappels } from "@/lib/depot";
import { CHOIX_RAPPEL } from "@/lib/rappels";
import { activerNotifications, desactiverNotifications, estIOS, etatNotifications, type EtatNotifications } from "@/lib/notifications";
import { IconeAlerte, IconeFermer, IconeSucces } from "./Icones";

interface Props {
  reglages: ReglagesRappels;
  disponibles: boolean; // la base a les tables des rappels (migration appliquée)
  onReglages: (r: ReglagesRappels) => Promise<boolean>;
  onEtat: (e: EtatNotifications) => void;
  onFermer: () => void;
}

const TEXTES: Record<EtatNotifications, { titre: string; texte: string }> = {
  actives: { titre: "Rappels activés sur cet appareil", texte: "Tu seras prévenu même quand AgendIA est fermé." },
  inactives: { titre: "Rappels désactivés sur cet appareil", texte: "Active-les pour être prévenu avant tes tâches, même quand AgendIA est fermé." },
  bloquees: { titre: "Notifications bloquées", texte: "Tu les as refusées pour ce site. Réautorise-les dans les réglages du navigateur (icône à gauche de l'adresse → Notifications → Autoriser), puis reviens ici." },
  "ios-ecran": { titre: "Sur iPhone : une étape avant", texte: "Apple n'autorise les notifications que pour les applications ajoutées à l'écran d'accueil." },
  indisponible: { titre: "Non pris en charge", texte: "Ce navigateur ne sait pas recevoir de notifications web. Essaie Chrome, Edge, Firefox, ou Safari à jour." },
};

export function Rappels({ reglages, disponibles, onReglages, onEtat, onFermer }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const [etat, setEtat] = useState<EtatNotifications | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ texte: string; erreur?: boolean } | null>(null);
  const [valeurs, setValeurs] = useState(reglages);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
    etatNotifications().then(setEtat);
  }, []);

  async function changerEtat(activer: boolean) {
    setEnCours(true);
    setMessage(null);
    try {
      if (activer) {
        const e = await activerNotifications();
        setEtat(e);
        onEtat(e);
        if (e === "actives") setMessage({ texte: "C'est activé. Touche « Envoyer un test » pour vérifier." });
      } else {
        await desactiverNotifications();
        setEtat("inactives");
        onEtat("inactives");
      }
    } catch (e) {
      setMessage({ texte: `Impossible d'activer les rappels : ${e instanceof Error ? e.message : e}`, erreur: true });
    }
    setEnCours(false);
  }

  async function tester() {
    setEnCours(true);
    setMessage(null);
    try {
      const { data } = await supabase().auth.getSession();
      const rep = await fetch("/api/rappels/test", { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
      const json = await rep.json();
      setMessage(rep.ok
        ? { texte: `Notification envoyée à ${json.envoyes} appareil${json.envoyes > 1 ? "s" : ""}. Elle arrive en quelques secondes.` }
        : { texte: json.erreur ?? "L'envoi a échoué.", erreur: true });
    } catch {
      setMessage({ texte: "Pas de connexion : réessaie dans un instant.", erreur: true });
    }
    setEnCours(false);
  }

  async function enregistrer(r: ReglagesRappels) {
    setValeurs(r);
    await onReglages(r);
  }

  const t = etat ? TEXTES[etat] : null;
  const IconeEtat = etat === "actives" ? BellRing : etat === "inactives" ? Bell : BellOff;

  return (
    <dialog ref={dialogue} aria-labelledby="titre-rappels" onClose={onFermer} className="dialogue-rappels">
      <div className="formulaire">
        <div className="titre-dialogue-ligne">
          <h2 id="titre-rappels"><Bell aria-hidden="true" /> Rappels et notifications</h2>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => dialogue.current?.close()}><IconeFermer /></button>
        </div>

        {!disponibles && (
          <p className="avertissement-encart"><IconeAlerte /> Les rappels ne sont pas encore activés dans la base de données : ils fonctionneront dès que la mise à jour Supabase sera appliquée.</p>
        )}

        <section className={`encart-etat etat-${etat ?? "chargement"}`} aria-live="polite">
          <span className="pastille-etat"><IconeEtat aria-hidden="true" /></span>
          <div>
            <strong>{t?.titre ?? "Vérification…"}</strong>
            {t && <p>{t.texte}</p>}
          </div>
        </section>

        {etat === "ios-ecran" && (
          <ol className="guide-ios">
            <li><span className="numero-etape">1</span><span>Dans Safari, touche <Share aria-label="Partager" /> <strong>Partager</strong> (en bas de l&apos;écran).</span></li>
            <li><span className="numero-etape">2</span><span>Choisis <SquarePlus aria-hidden="true" /> <strong>Sur l&apos;écran d&apos;accueil</strong>, puis <strong>Ajouter</strong>.</span></li>
            <li><span className="numero-etape">3</span><span>Ouvre AgendIA <strong>depuis sa nouvelle icône</strong> <Smartphone aria-hidden="true" /> et reviens ici : le bouton « Activer » apparaîtra (iOS 16.4 ou plus récent).</span></li>
          </ol>
        )}

        <div className="boutons-etat">
          {etat === "inactives" && (
            <button type="button" className="btn btn-principal btn-grand" disabled={enCours || !disponibles} onClick={() => changerEtat(true)}>
              <BellRing aria-hidden="true" /> {enCours ? "Activation…" : "Activer les rappels sur cet appareil"}
            </button>
          )}
          {etat === "actives" && (
            <>
              <button type="button" className="btn btn-principal btn-grand" disabled={enCours} onClick={tester}>
                <BellRing aria-hidden="true" /> {enCours ? "Envoi…" : "Envoyer un test"}
              </button>
              <button type="button" className="btn btn-grand" disabled={enCours} onClick={() => changerEtat(false)}>
                <BellOff aria-hidden="true" /> Désactiver sur cet appareil
              </button>
            </>
          )}
        </div>
        {message && <p className={message.erreur ? "message-erreur" : "message-info"} role="status">{!message.erreur && <IconeSucces />} {message.texte}</p>}

        <h3 className="feuille-sous-titre">Réglages (tous tes appareils)</h3>
        <div className="champ">
          <label htmlFor="rappel-defaut">Rappel proposé pour une nouvelle tâche avec heure</label>
          <select id="rappel-defaut" value={valeurs.rappelDefaut ?? ""} disabled={!disponibles}
            onChange={(e) => enregistrer({ ...valeurs, rappelDefaut: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">Aucun (je le choisis tâche par tâche)</option>
            {CHOIX_RAPPEL.map((c) => <option key={c.minutes} value={c.minutes}>{c.libelle}</option>)}
          </select>
        </div>

        <div className="ligne-resume">
          <label className="interrupteur">
            <input type="checkbox" role="switch" checked={Boolean(valeurs.resumeMatin)} disabled={!disponibles}
              onChange={(e) => enregistrer({ ...valeurs, resumeMatin: e.target.checked ? "08:00" : "" })} />
            <span className="interrupteur-piste" aria-hidden="true"><span /></span>
            <span><strong>Résumé du matin</strong><br /><small>Une notification « Ma journée » : tâches du jour et en retard. La toucher ouvre la préparation de la journée.</small></span>
          </label>
          {valeurs.resumeMatin && (
            <input type="time" aria-label="Heure du résumé du matin" value={valeurs.resumeMatin} step={900}
              onChange={(e) => e.target.value && enregistrer({ ...valeurs, resumeMatin: e.target.value })} />
          )}
        </div>

        <details className="mode-emploi">
          <summary>Comment ça marche ?</summary>
          <ul>
            <li>Chaque minute, le serveur regarde quels rappels sont dus et les envoie à <strong>tous</strong> tes appareils où les rappels sont activés.</li>
            <li>Le délai se règle dans chaque tâche (champ « Rappel »). Une tâche sans heure est rappelée par rapport à 9 h.</li>
            <li>Un rappel peut arriver avec une minute de retard ; s&apos;il est manqué (téléphone éteint), il est rattrapé pendant 15 minutes, puis abandonné.</li>
            <li>{estIOSSur() ? "Sur iPhone, il faut iOS 16.4 ou plus et AgendIA ajouté à l'écran d'accueil." : "Sur iPhone, il faudra iOS 16.4 ou plus et AgendIA ajouté à l'écran d'accueil."}</li>
            <li>Tout est gratuit : les notifications web ne passent par aucun service payant.</li>
          </ul>
        </details>
      </div>
    </dialog>
  );
}

function estIOSSur(): boolean {
  try { return estIOS(); } catch { return false; }
}
