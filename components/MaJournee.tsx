"use client";

/* Parcours « Ma journée » : préparer sa journée en 1 minute, en 3 étapes.
     1. En retard   : pour chaque tâche en retard, Aujourd'hui / Demain / Fait / Plus tard.
     2. Choisir     : ce qui est déjà prévu aujourd'hui + des suggestions de la Checklist
                      (échéance proche, rapides, priorité haute), à cocher.
     3. Mon planning : AgendIA place les tâches choisies dans les trous de la journée
                      (en évitant les tâches à heure fixe ET les événements Google / Outlook),
                      on regarde la frise, puis « Valider ma journée ».
   Rien n'est modifié à l'étape 3 avant le clic sur « Valider » (et « Annuler » reste
   proposé ensuite). Les choix de l'étape 1 s'appliquent tout de suite, chacun annulable
   par son propre bouton. Le calcul réutilise la planification automatique
   (lib/planification.ts), limitée à aujourd'hui.                                       */

import { useEffect, useMemo, useRef, useState } from "react";
import { Sun, Sunrise } from "lucide-react";
import { aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import * as depot from "@/lib/depot";
import type { ChangementHoraire } from "@/lib/depot";
import type { EvenementExterne } from "@/lib/ics-lecture";
import { analyserId, decalerJours, developper, jourSemaine } from "@/lib/recurrence";
import { dureeDe, planifier, validerPlages, versHHMM, versMinutes, type Placement } from "@/lib/planification";
import { comparer, formaterDuree, groupesDe, heureFin } from "@/lib/taches";
import type { Tache } from "@/lib/types";
import {
  IconeAlerte, IconeBravo, IconeChecklist, IconeContinuer, IconeDuree, IconeEcheance, IconeFermer, IconeGroupe, IconeRetour, IconeSucces, IconeValide,
} from "./Icones";

type Annuler = () => Promise<boolean>;

interface Props {
  taches: Tache[];        // toutes les tâches (séries comprises)
  enRetard: Tache[];      // entrées en retard (une par série)
  evenements: EvenementExterne[]; // événements des agendas externes d'aujourd'hui
  deplacer: (id: string, date: string, heure: string) => Promise<Annuler | null>;
  cocher: (id: string) => Promise<boolean>;
  appliquer: (changements: ChangementHoraire[]) => Promise<boolean>;
  onTermine: (texte: string, annuler: Annuler | null) => void;
  onFermer: () => void;
}

type Etape = "retard" | "choix" | "planning";
type Choix = "auj" | "demain" | "fait" | "plustard";
const LIBELLES_CHOIX: Record<Choix, string> = { auj: "→ aujourd'hui", demain: "→ demain", fait: "✓ faite", plustard: "→ Checklist" };

const CLE_JOUR = "agendia-ma-journee"; // jour où la journée a été préparée (masque l'invitation)
export function journeePrepareeAujourdhui(): boolean {
  try { return localStorage.getItem(CLE_JOUR) === versISO(aujourdhui()); } catch { return false; }
}
export function masquerInvitationAujourdhui() {
  try { localStorage.setItem(CLE_JOUR, versISO(aujourdhui())); } catch { /* navigateur privé */ }
}

export function MaJournee({ taches, enRetard, evenements, deplacer, cocher, appliquer, onTermine, onFermer }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const iso = versISO(aujourdhui());
  const demain = decalerJours(iso, 1);
  const [etape, setEtape] = useState<Etape>(enRetard.length > 0 ? "retard" : "choix");
  const [traitees, setTraitees] = useState<Map<string, { choix: Choix; annuler: Annuler | null }>>(new Map());
  const [enCours, setEnCours] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
  }, []);

  /* ---------- Étape 1 : en retard ---------- */
  const retardFige = useRef(enRetard); // la liste ne bouge pas pendant qu'on la traite
  async function traiter(t: Tache, choix: Choix) {
    setEnCours(t.id);
    let annuler: Annuler | null = null;
    let ok = false;
    if (choix === "fait") ok = await cocher(t.id);
    else {
      annuler = await deplacer(t.id, choix === "auj" ? iso : choix === "demain" ? demain : "", choix === "plustard" ? "" : t.heure);
      ok = annuler !== null;
    }
    if (ok) setTraitees((m) => new Map(m).set(t.id, { choix, annuler: choix === "fait" ? () => cocher(t.id) : annuler }));
    setEnCours(null);
  }
  async function defaire(id: string) {
    const a = traitees.get(id)?.annuler;
    if (!a) return;
    setEnCours(id);
    if (await a()) setTraitees((m) => { const n = new Map(m); n.delete(id); return n; });
    setEnCours(null);
  }

  /* ---------- Étape 2 : choisir ---------- */
  const duJour = useMemo(() => developper(taches, iso, iso).filter((t) => t.date === iso).sort(comparer), [taches, iso]);
  const suggestions = useMemo(() => {
    const sansDate = taches.filter((t) => !t.faite && t.date === "");
    const score = (t: Tache) => (t.echeance && t.echeance <= demain ? 0 : t.priorite === "haute" ? 1 : groupesDe(t).includes("rapide") ? 2 : 3);
    return sansDate.sort((a, b) => score(a) - score(b) || (a.echeance || "9").localeCompare(b.echeance || "9") || a.titre.localeCompare(b.titre)).slice(0, 12);
  }, [taches, demain]);
  const [choisies, setChoisies] = useState<Set<string>>(() => new Set(
    taches.filter((t) => !t.faite && t.date === "" && t.echeance && t.echeance <= demain).map((t) => t.id)));
  const basculer = (id: string) => setChoisies((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const raison = (t: Tache) => (t.echeance && t.echeance <= demain ? { texte: t.echeance < iso ? "Échéance dépassée" : t.echeance === iso ? "À rendre aujourd'hui" : "À rendre demain", classe: "urgent" }
    : t.priorite === "haute" ? { texte: "Priorité haute", classe: "important" }
    : groupesDe(t).includes("rapide") ? { texte: "Rapide", classe: "rapide" } : null);

  /* ---------- Étape 3 : planning ---------- */
  const [plagesJour, setPlagesJour] = useState<{ debut: string; fin: string }>({ debut: "08:00", fin: "20:00" });
  const [heuresAuxSansHeure, setHeuresAuxSansHeure] = useState(true);
  useEffect(() => {
    depot.lirePlages().then((brutes) => {
      const p = (validerPlages(brutes) ?? []).filter((x) => x.jour === jourSemaine(iso));
      if (p.length) setPlagesJour({ debut: p.map((x) => x.debut).sort()[0], fin: p.map((x) => x.fin).sort().slice(-1)[0] });
    }).catch(() => undefined);
  }, [iso]);

  // Tâches d'aujourd'hui sans heure qu'on peut placer (pas les occurrences de série : elles suivent leur série).
  const sansHeureDuJour = duJour.filter((t) => !t.faite && !t.heure && !t.occurrence && !analyserId(t.id));
  const occupe = evenements.filter((e) => !e.journee && !e.libre).map((e) => ({ date: e.date, debut: e.heure, fin: e.fin }));
  const calcul = useMemo(() => {
    if (etape !== "planning") return null;
    const aPlacer = [
      ...taches.filter((t) => choisies.has(t.id) && t.date === ""),
      ...(heuresAuxSansHeure ? sansHeureDuJour : []),
    ].map((t) => ({ ...t, date: "", heure: "" }));
    const fixes = duJour.filter((t) => t.heure);
    if (versMinutes(plagesJour.fin) <= versMinutes(plagesJour.debut)) return { placements: [] as Placement[], nonPlaces: aPlacer.map((t) => ({ tacheId: t.id, titre: t.titre, raison: "plage horaire invalide" })) };
    return planifier({
      taches: [...fixes, ...aPlacer], lundi: versISO(debutSemaine(aujourdhui())),
      plages: [{ jour: jourSemaine(iso), debut: plagesJour.debut, fin: plagesJour.fin }],
      maintenant: new Date(), occupe,
    }, "echeances");
  }, [etape, taches, choisies, heuresAuxSansHeure, duJour, plagesJour, iso]); // eslint-disable-line react-hooks/exhaustive-deps

  // Frise de la journée : tâches à heure fixe, événements, et placements proposés.
  const frise = useMemo(() => {
    if (!calcul) return [];
    const lignes: { cle: string; debut: string; fin: string; titre: string; type: "tache" | "evenement" | "nouvelle" | "faite" }[] = [
      ...duJour.filter((t) => t.heure).map((t) => ({ cle: t.id, debut: t.heure, fin: heureFin(t.heure, dureeDe(t)), titre: t.titre, type: t.faite ? "faite" as const : "tache" as const })),
      ...evenements.filter((e) => !e.journee).map((e) => ({ cle: e.id, debut: e.heure, fin: e.fin, titre: e.titre, type: "evenement" as const })),
      ...calcul.placements.map((p) => ({ cle: p.tacheId, debut: p.heure, fin: versHHMM(versMinutes(p.heure) + p.dureeMinutes), titre: p.titre, type: "nouvelle" as const })),
    ];
    return lignes.sort((a, b) => a.debut.localeCompare(b.debut));
  }, [calcul, duJour, evenements]);

  async function valider() {
    if (!calcul) return;
    setEnCours("valider");
    const nonPlacesChoisies = calcul.nonPlaces.filter((n) => choisies.has(n.tacheId));
    const apres: ChangementHoraire[] = [
      ...calcul.placements.map((p) => ({ id: p.tacheId, date: iso, heure: p.heure })),
      ...nonPlacesChoisies.map((n) => ({ id: n.tacheId, date: iso, heure: "" })), // choisies sans place : aujourd'hui, sans heure
    ];
    const avant = apres.map((a) => {
      const t = taches.find((x) => x.id === a.id);
      return { id: a.id, date: t?.date ?? "", heure: t?.heure ?? "" };
    });
    const ok = apres.length === 0 || await appliquer(apres);
    setEnCours(null);
    if (!ok) return;
    masquerInvitationAujourdhui();
    const minutes = calcul.placements.reduce((s, p) => s + p.dureeMinutes, 0);
    const derniere = frise.filter((l) => l.type !== "evenement").map((l) => l.fin).sort().slice(-1)[0];
    onTermine(
      apres.length === 0 ? "Journée prête : rien à ajouter." :
      `Journée prête : ${calcul.placements.length} tâche${calcul.placements.length > 1 ? "s" : ""} planifiée${calcul.placements.length > 1 ? "s" : ""}${minutes ? ` (${formaterDuree(minutes)})` : ""}${derniere ? `, fin prévue vers ${derniere}` : ""}.`,
      apres.length ? () => appliquer(avant) : null,
    );
    dialogue.current?.close();
  }

  const etapes: { id: Etape; libelle: string }[] = [
    ...(retardFige.current.length > 0 ? [{ id: "retard" as const, libelle: "En retard" }] : []),
    { id: "choix", libelle: "Choisir" },
    { id: "planning", libelle: "Planning" },
  ];
  const rang = etapes.findIndex((e) => e.id === etape);
  const heure = new Date().getHours();

  return (
    <dialog ref={dialogue} aria-labelledby="titre-journee" onClose={onFermer} className="dialogue-journee">
      <div className="formulaire">
        <div className="titre-dialogue-ligne">
          <h2 id="titre-journee">{heure < 12 ? <Sunrise aria-hidden="true" /> : <Sun aria-hidden="true" />} Ma journée</h2>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => dialogue.current?.close()}><IconeFermer /></button>
        </div>
        <p className="sous-titre-journee">{majuscule(formater(aujourdhui(), { weekday: "long", day: "numeric", month: "long" }))}</p>

        <ol className="etapes" aria-label="Étapes">
          {etapes.map((e, i) => (
            <li key={e.id} className={i < rang ? "faite" : i === rang ? "active" : ""} aria-current={i === rang ? "step" : undefined}>
              <span className="pastille-etape">{i < rang ? <IconeValide /> : i + 1}</span>
              <span>{e.libelle}</span>
            </li>
          ))}
        </ol>

        {etape === "retard" && (
          <section className="etape-journee">
            <h3><IconeAlerte /> {retardFige.current.length} tâche{retardFige.current.length > 1 ? "s" : ""} en retard</h3>
            <p className="indice">Décide vite pour chacune. Tout reste annulable.</p>
            <ul className="liste-journee">
              {retardFige.current.map((t) => {
                const fait = traitees.get(t.id);
                return (
                  <li key={t.id} className={`ligne-journee${fait ? " traitee" : ""}`}>
                    <div className="ligne-journee-texte">
                      <strong>{t.titre}</strong>
                      <span className="indice">prévue {formater(depuisISO(t.date), { weekday: "short", day: "numeric", month: "short" })}{t.heure ? ` à ${t.heure}` : ""}</span>
                    </div>
                    {fait ? (
                      <div className="resultat-choix">
                        <span><IconeSucces /> {LIBELLES_CHOIX[fait.choix]}</span>
                        {fait.annuler && <button type="button" className="lien" disabled={enCours !== null} onClick={() => defaire(t.id)}>Annuler</button>}
                      </div>
                    ) : (
                      <div className="choix-retard" role="group" aria-label={`Que faire de « ${t.titre} » ?`}>
                        <button type="button" className="btn btn-principal" disabled={enCours !== null} onClick={() => traiter(t, "auj")}>Aujourd&apos;hui</button>
                        <button type="button" className="btn" disabled={enCours !== null} onClick={() => traiter(t, "demain")}>Demain</button>
                        <button type="button" className="btn btn-fait" disabled={enCours !== null} onClick={() => traiter(t, "fait")}><IconeValide /> Fait</button>
                        <button type="button" className="btn" disabled={enCours !== null} title="La remettre dans la Checklist, sans date" onClick={() => traiter(t, "plustard")}>Plus tard</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {etape === "choix" && (
          <section className="etape-journee">
            <h3>Déjà prévu aujourd&apos;hui <span className="compte-groupe">{duJour.length + evenements.length}</span></h3>
            {duJour.length + evenements.length === 0 ? <p className="indice">Rien pour l&apos;instant : choisis ci-dessous quoi faire.</p> : (
              <ul className="resume-prevu">
                {[...evenements.map((e) => ({ cle: e.id, heure: e.journee ? "" : e.heure, titre: e.titre, evt: true, faite: false })),
                  ...duJour.map((t) => ({ cle: t.id, heure: t.heure, titre: t.titre, evt: false, faite: t.faite }))]
                  .sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99"))
                  .map((x) => (
                    <li key={x.cle} className={`${x.evt ? "prevu-evt" : ""}${x.faite ? " prevu-fait" : ""}`}>
                      <span className="tache-heure">{x.heure || "—"}</span> {x.titre}{x.evt && <span className="indice"> · agenda</span>}
                    </li>
                  ))}
              </ul>
            )}

            <h3><IconeChecklist /> À ajouter depuis la Checklist</h3>
            {suggestions.length === 0 ? <p className="vide"><IconeBravo /> Ta Checklist est vide.</p> : (
              <ul className="liste-suggestions">
                {suggestions.map((t) => {
                  const r = raison(t);
                  const coche = choisies.has(t.id);
                  return (
                    <li key={t.id}>
                      <label className={`suggestion${coche ? " choisie" : ""}`}>
                        <input type="checkbox" checked={coche} onChange={() => basculer(t.id)} />
                        <span className="suggestion-texte">
                          <strong>{t.titre}</strong>
                          <span className="suggestion-infos">
                            {r && <span className={`badge badge-groupe groupe-${r.classe}`}><IconeGroupe groupe={r.classe as "urgent" | "important" | "rapide"} /> {r.texte}</span>}
                            <span className="badge badge-info"><IconeDuree /> {t.dureeMinutes ? formaterDuree(t.dureeMinutes) : "1 h (estimée)"}</span>
                            {t.echeance && <span className="badge badge-info"><IconeEcheance /> {formater(depuisISO(t.echeance), { day: "numeric", month: "short" })}</span>}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {etape === "planning" && calcul && (
          <section className="etape-journee">
            <div className="ligne-dispo">
              <span>Disponible aujourd&apos;hui de</span>
              <input type="time" aria-label="Début de disponibilité" value={plagesJour.debut} onChange={(e) => e.target.value && setPlagesJour((p) => ({ ...p, debut: e.target.value }))} />
              <span>à</span>
              <input type="time" aria-label="Fin de disponibilité" value={plagesJour.fin} onChange={(e) => e.target.value && setPlagesJour((p) => ({ ...p, fin: e.target.value }))} />
            </div>
            {sansHeureDuJour.length > 0 && (
              <label className="case-option">
                <input type="checkbox" checked={heuresAuxSansHeure} onChange={(e) => setHeuresAuxSansHeure(e.target.checked)} />
                {sansHeureDuJour.length > 1 ? `Donner aussi une heure aux ${sansHeureDuJour.length} tâches d'aujourd'hui sans heure` : "Donner aussi une heure à la tâche d'aujourd'hui sans heure"}
              </label>
            )}
            {frise.length === 0 ? <p className="vide">Rien à placer : la journée est libre.</p> : (
              <ol className="frise-journee">
                {frise.map((l) => (
                  <li key={l.cle} className={`frise-${l.type}`}>
                    <span className="frise-heure">{l.debut}<small>{l.fin === "24:00" ? "0:00" : l.fin}</small></span>
                    <span className="frise-bloc">
                      {l.titre}
                      {l.type === "nouvelle" && <span className="etiquette-nouvelle">ajoutée</span>}
                      {l.type === "evenement" && <span className="etiquette-evt">agenda</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {calcul.nonPlaces.length > 0 && (
              <p className="avertissement-encart">
                <IconeAlerte /> Pas de place pour : {calcul.nonPlaces.map((n) => n.titre).join(", ")}.
                {calcul.nonPlaces.some((n) => choisies.has(n.tacheId)) && " Les tâches choisies iront aujourd'hui, sans heure."}
              </p>
            )}
          </section>
        )}

        <div className="boutons-dialogue">
          {rang > 0 && <button type="button" className="btn" disabled={enCours !== null} onClick={() => setEtape(etapes[rang - 1].id)}><IconeRetour /> Retour</button>}
          {etape !== "planning"
            ? <button type="button" className="btn btn-principal" disabled={enCours !== null} onClick={() => setEtape(etapes[rang + 1].id)}>
                {etape === "choix" ? `Voir mon planning${choisies.size ? ` (${choisies.size})` : ""}` : "Continuer"} <IconeContinuer />
              </button>
            : <button type="button" className="btn btn-principal" disabled={enCours !== null} onClick={valider}>
                <IconeValide /> {enCours === "valider" ? "Enregistrement…" : "Valider ma journée"}
              </button>}
        </div>
      </div>
    </dialog>
  );
}
