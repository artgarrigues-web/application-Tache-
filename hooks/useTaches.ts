"use client";

/* Hook personnalisé : il regroupe l'état "liste des tâches" et sa synchronisation
   avec Supabase. Un composant qui l'utilise reçoit les tâches + des fonctions
   pour les modifier, sans savoir où elles sont stockées.

   Règle React importante : on ne modifie jamais un tableau d'état en place
   (pas de push, pas de t.faite = true). On crée un NOUVEAU tableau avec
   map / filter / [...] : c'est en voyant une nouvelle référence que React
   sait qu'il doit réafficher.                                                 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as depot from "@/lib/depot";
import * as rec from "@/lib/recurrence";
import { basculerCaseSerie, basculerCaseTache, casesDuJour, cleMateriel, filtrerCases, type GenreCase } from "@/lib/etapes";
import { aujourdhui, versISO } from "@/lib/dates";
import * as hl from "@/lib/hors-ligne";
import type { DonneesTache, Portee, Tache } from "@/lib/types";

function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useTaches(userId: string) {
  /* Hors connexion : on part de la copie gardée sur l'appareil (affichage immédiat, même
     sans réseau), puis on relit la base. */
  const [taches, setTaches] = useState<Tache[]>(() => { hl.initialiser(userId); return depot.tachesEnCopie(); });
  const [charge, setCharge] = useState(() => hl.aDesDonnees());
  const [erreur, setErreur] = useState<string | null>(null);
  // Copie toujours à jour de la liste, pour les « Annuler » appelés plusieurs secondes plus tard.
  const tachesRef = useRef<Tache[]>([]);
  tachesRef.current = taches;

  // Exécute une opération réseau ; en cas d'échec, mémorise le message à afficher.
  const executer = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    try {
      await operation();
      setErreur(null);
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  }, []);

  const recharger = useCallback(async () => {
    await executer(async () => setTaches(await depot.listerTaches()));
    setCharge(true);
  }, [executer]);

  // Chargement initial, et à chaque changement d'utilisateur.
  useEffect(() => {
    recharger();
  }, [userId, recharger]);

  // Synchronisation simple : quand on revient sur l'onglet, on recharge depuis la base
  // (utile si on a modifié ses tâches depuis le téléphone entre-temps).
  // « agendia-synchro » : les changements faits hors connexion viennent d'être envoyés
  // (ou le réseau est revenu) → on relit pour afficher la version gagnante des conflits.
  useEffect(() => {
    const auRetour = () => {
      if (document.visibilityState === "visible") { recharger(); hl.planifierEnvoi(0); }
    };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("agendia-synchro", recharger);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("agendia-synchro", recharger);
    };
  }, [recharger]);

  const ajouter = useCallback(
    (d: DonneesTache) => executer(async () => {
      const nouvelle = await depot.insererTache(d); // la base renvoie la tâche avec son id définitif
      setTaches((prec) => [...prec, nouvelle]);
    }),
    [executer],
  );

  const modifier = useCallback(
    (id: string, d: DonneesTache) => executer(async () => {
      const maj = await depot.modifierTache(id, d);
      setTaches((prec) => prec.map((t) => (t.id === id ? maj : t)));
    }),
    [executer],
  );

  /* ---------- Suppression = mise à la corbeille ----------
     La tâche disparaît tout de suite de l'écran ; elle reste 30 jours dans la corbeille.
     Les fonctions renvoient « Annuler » (bouton du message affiché après la suppression),
     ou null en cas d'échec. enCorbeille vaut false si la base n'a pas encore de corbeille
     (effacement définitif). */
  type Annuler = () => Promise<boolean>;
  interface ResultatSuppression { annuler: Annuler; enCorbeille: boolean }

  const mettreEnCorbeille = useCallback(async (ids: string[]): Promise<ResultatSuppression | null> => {
    const avant = tachesRef.current.filter((t) => ids.includes(t.id));
    setTaches((prec) => prec.filter((t) => !ids.includes(t.id)));
    let enCorbeille = false;
    const ok = await executer(async () => {
      try {
        enCorbeille = await depot.mettreALaCorbeille(ids);
      } catch (e) {
        setTaches((prec) => [...prec, ...avant]);
        throw e;
      }
    });
    if (!ok) return null;
    return {
      enCorbeille,
      annuler: () => executer(async () => {
        if (!enCorbeille) throw new Error("Cette tâche a été effacée définitivement (corbeille pas encore activée dans la base).");
        const remises = await depot.restaurer(ids);
        setTaches((prec) => [...prec.filter((t) => !ids.includes(t.id)), ...remises]);
      }),
    };
  }, [executer]);

  const supprimer = useCallback((id: string) => mettreEnCorbeille([id]), [mettreEnCorbeille]);

  // Corbeille : la lire, en sortir des tâches, ou les effacer pour de bon.
  const listerCorbeille = useCallback(() => depot.listerCorbeille(), []);
  const restaurer = useCallback(async (ids: string[]) => executer(async () => {
    const remises = await depot.restaurer(ids);
    setTaches((prec) => [...prec.filter((t) => !ids.includes(t.id)), ...remises]);
  }), [executer]);
  const supprimerDefinitivement = useCallback((ids: string[]) => executer(() => depot.supprimerDefinitivement(ids)), [executer]);

  /* Mise à jour "optimiste" : on coche tout de suite à l'écran (réactivité),
     puis on envoie à la base. Si la base refuse, on annule le changement.
     Pour une occurrence de tâche répétée (id "serie~date"), on coche/décoche la date
     dans la règle de la série (liste « faites »).                                */
  const basculerFaite = useCallback(
    (id: string) => {
      const occ = rec.analyserId(id);
      if (occ) {
        const serie = tachesRef.current.find((t) => t.id === occ.serieId);
        if (!serie?.recurrence) return Promise.resolve(false);
        const avant = serie.recurrence;
        const apres = rec.basculerFaite(avant, occ.date);
        const appliquer = (r: typeof avant) =>
          setTaches((prec) => prec.map((t) => (t.id === serie.id ? { ...t, recurrence: r } : t)));
        appliquer(apres);
        return executer(async () => {
          try {
            await depot.changerRecurrence(serie.id, apres);
          } catch (e) {
            appliquer(avant);
            throw e;
          }
        });
      }
      const tache = tachesRef.current.find((t) => t.id === id);
      if (!tache) return Promise.resolve(false);
      const nouvelEtat = !tache.faite;
      const appliquer = (faite: boolean) =>
        setTaches((prec) => prec.map((t) => (t.id === id ? { ...t, faite } : t)));
      appliquer(nouvelEtat);
      return executer(async () => {
        try {
          await depot.changerEtat(id, nouvelEtat);
        } catch (e) {
          appliquer(!nouvelEtat);
          throw e;
        }
      });
    },
    [executer], // tachesRef (et non taches) : toujours la version à jour, même appelée plus tard depuis un message

  );

  /* ---------- Étapes et matériel : cocher une case ----------
     Même principe que basculerFaite (optimiste, retour en arrière si la base refuse).
     - tâche unique : on change ses colonnes etapes / materiel_pris ;
     - occurrence d'une tâche répétée : on coche pour CE jour seulement, dans
       recurrence.cases de la série (voir lib/etapes.ts pour le pourquoi).
     Renvoie la tâche telle qu'elle est après le changement (null si échec), pour que
     l'écran puisse proposer de cocher la tâche quand toutes ses étapes sont faites. */
  const cocherCase = useCallback(
    async (id: string, genre: GenreCase, cle: string): Promise<Tache | null> => {
      const occ = rec.analyserId(id);
      if (occ) {
        const serie = tachesRef.current.find((t) => t.id === occ.serieId);
        if (!serie?.recurrence) return null;
        const avant = serie.recurrence;
        const apres = basculerCaseSerie(avant, occ.date, genre, cle, versISO(aujourdhui()));
        const appliquer = (r: typeof avant) =>
          setTaches((prec) => prec.map((t) => (t.id === serie.id ? { ...t, recurrence: r } : t)));
        appliquer(apres);
        const ok = await executer(async () => {
          try {
            await depot.changerRecurrence(serie.id, apres);
          } catch (e) {
            appliquer(avant);
            throw e;
          }
        });
        return ok ? { ...serie, ...casesDuJour({ ...serie, recurrence: apres }, occ.date), faite: apres.faites.includes(occ.date) } : null;
      }
      const tache = tachesRef.current.find((t) => t.id === id);
      if (!tache) return null;
      const avant = { etapes: tache.etapes ?? [], materielPris: tache.materielPris ?? [] };
      const apres = basculerCaseTache(tache, genre, cle);
      const appliquer = (c: typeof avant) => setTaches((prec) => prec.map((t) => (t.id === id ? { ...t, ...c } : t)));
      appliquer(apres);
      const ok = await executer(async () => {
        try {
          await depot.changerCases(id, apres);
        } catch (e) {
          appliquer(avant);
          throw e;
        }
      });
      return ok ? { ...tache, ...apres } : null;
    },
    [executer],
  );

  /* ---------- Occurrence d'une tâche répétée : modifier ou supprimer ----------
     portee = "occurrence" : seulement ce jour-là ;
              "suivantes"  : ce jour-là et tous les suivants (la série est coupée en deux) ;
              "serie"      : toute la série, passé compris.                              */
  const remplacer = (maj: Tache) => setTaches((prec) => prec.map((t) => (t.id === maj.id ? maj : t)));

  /* Toute la série : elle part à la corbeille. Un jour (ou les suivants) : seule la règle
     change ; « Annuler » remet la règle d'avant. */
  const supprimerOccurrence = useCallback(
    async (serieId: string, date: string, portee: Portee): Promise<ResultatSuppression | null> => {
      const serie = tachesRef.current.find((t) => t.id === serieId);
      if (!serie?.recurrence) return null;
      if (portee === "serie" || (portee === "suivantes" && date <= serie.date)) return mettreEnCorbeille([serieId]);
      const avant = serie.recurrence;
      const r = portee === "occurrence" ? rec.ajouterException(avant, date) : rec.arreterAvant(avant, date);
      const ok = await executer(async () => remplacer(await depot.changerRecurrence(serieId, r)));
      if (!ok) return null;
      return { enCorbeille: true, annuler: () => executer(async () => remplacer(await depot.changerRecurrence(serieId, avant))) };
    },
    [executer, mettreEnCorbeille],
  );

  const modifierOccurrence = useCallback(
    (serieId: string, date: string, portee: Portee, d: DonneesTache) => executer(async () => {
      const serie = taches.find((t) => t.id === serieId);
      if (!serie?.recurrence) throw new Error("Série introuvable.");
      if (portee === "serie" || (portee === "suivantes" && date <= serie.date)) {
        remplacer(await depot.modifierTache(serieId, d));
        return;
      }
      if (portee === "occurrence") {
        // L'occurrence devient une tâche unique ordinaire ; sa date est retirée de la série.
        const etaitFaite = serie.recurrence.faites.includes(date);
        let unique = await depot.insererTache({ ...d, ...casesReprises(serie, date, d), recurrence: null });
        if (etaitFaite) { await depot.changerEtat(unique.id, true); unique = { ...unique, faite: true }; }
        const majSerie = await depot.changerRecurrence(serieId, rec.ajouterException(serie.recurrence, date));
        setTaches((prec) => [...prec.map((t) => (t.id === serieId ? majSerie : t)), unique]);
        return;
      }
      // « Cette occurrence et les suivantes » : nouvelle série à partir de ce jour,
      // l'ancienne s'arrête la veille. Les dates cochées/supprimées suivent la bonne série.
      let regle = d.recurrence;
      if (regle) {
        const garder = (liste: string[]) => liste.filter((x) => x >= d.date);
        regle = filtrerCases({ ...regle, exceptions: garder(regle.exceptions), faites: garder(regle.faites) }, (x) => x >= d.date);
        const ancienne = serie.recurrence.fin;
        if (regle.fin.type === "nombre" && ancienne.type === "nombre" && regle.fin.nombre === ancienne.nombre) {
          // « 10 fois » au total : la nouvelle série reprend le compte là où on coupe.
          regle = { ...regle, fin: { type: "nombre", nombre: Math.max(1, ancienne.nombre - rec.nombreAvant(serie.date, serie.recurrence, date)) } };
        }
      }
      const nouvelle = await depot.insererTache({ ...d, recurrence: regle });
      const majSerie = await depot.changerRecurrence(serieId, rec.arreterAvant(serie.recurrence, date));
      setTaches((prec) => [...prec.map((t) => (t.id === serieId ? majSerie : t)), nouvelle]);
    }),
    [taches, executer],
  );

  // « Effacer les tâches terminées » : toutes les tâches cochées partent à la corbeille.
  const effacerTerminees = useCallback(
    () => mettreEnCorbeille(tachesRef.current.filter((t) => t.faite).map((t) => t.id)),
    [mettreEnCorbeille],
  );

  // Planification automatique (et son annulation) : nouvelle date + heure pour plusieurs tâches.
  const changerHoraires = useCallback(
    (changements: depot.ChangementHoraire[]) => executer(async () => {
      const majs = new Map((await depot.changerHoraires(changements)).map((t) => [t.id, t]));
      setTaches((prec) => prec.map((t) => majs.get(t.id) ?? t));
    }),
    [executer],
  );

  /* ---------- Glisser-déposer ----------
     Chaque fonction met l'écran à jour TOUT DE SUITE (la carte atterrit sans attendre le
     réseau, ce qui rend l'animation fluide), puis enregistre. Si la base refuse, on remet
     tout comme avant. Elles renvoient une fonction « Annuler » (bouton du message affiché
     après le dépôt), ou null en cas d'échec.                                              */
  // Changer la date et/ou l'heure d'une tâche (date "" = la remettre dans la Checklist).
  const deplacer = useCallback(async (id: string, date: string, heure: string): Promise<Annuler | null> => {
    const occ = rec.analyserId(id);
    if (occ) return deplacerOccurrence(occ.serieId, occ.date, date, heure);
    const tache = tachesRef.current.find((t) => t.id === id);
    if (!tache) return null;
    const changer = async (d: string, h: string) => {
      const avant = tachesRef.current.find((t) => t.id === id);
      setTaches((prec) => prec.map((t) => (t.id === id ? { ...t, date: d, heure: h } : t)));
      return executer(async () => {
        try {
          const [maj] = await depot.changerHoraires([{ id, date: d, heure: h }]);
          setTaches((prec) => prec.map((t) => (t.id === id ? maj : t)));
        } catch (e) {
          if (avant) setTaches((prec) => prec.map((t) => (t.id === id ? avant : t)));
          throw e;
        }
      });
    };
    const ok = await changer(date, heure);
    return ok ? () => changer(tache.date, tache.heure) : null;
  }, [executer]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Occurrence d'une tâche répétée : on ne déplace QUE ce jour-là (comme « Ce jour seulement »
     dans le formulaire) : elle devient une tâche unique à la nouvelle date, et sa date
     d'origine est retirée de la série. Le reste de la série ne bouge pas. */
  async function deplacerOccurrence(serieId: string, dateOcc: string, date: string, heure: string): Promise<Annuler | null> {
    const serie = tachesRef.current.find((t) => t.id === serieId);
    if (!serie?.recurrence) return null;
    const regleAvant = serie.recurrence;
    const faite = regleAvant.faites.includes(dateOcc);
    const { id: _id, faite: _f, creeLe: _c, occurrence: _o, ...donnees } = serie;
    const provisoire: Tache = { ...serie, ...casesDuJour(serie, dateOcc), id: `provisoire-${Date.now()}`, date, heure, recurrence: null, faite, occurrence: undefined };
    const regleApres = rec.ajouterException(regleAvant, dateOcc);
    setTaches((prec) => [...prec.map((t) => (t.id === serieId ? { ...t, recurrence: regleApres } : t)), provisoire]);
    let unique: Tache | null = null;
    const ok = await executer(async () => {
      try {
        unique = await depot.insererTache({ ...donnees, ...casesDuJour(serie, dateOcc), date, heure, recurrence: null });
        if (faite) { await depot.changerEtat(unique.id, true); unique = { ...unique, faite: true }; }
        const majSerie = await depot.changerRecurrence(serieId, regleApres);
        const u = unique;
        setTaches((prec) => prec.map((t) => (t.id === serieId ? majSerie : t.id === provisoire.id ? u : t)));
      } catch (e) {
        if (unique) await depot.supprimerTache(unique.id).catch(() => undefined); // pas de doublon à moitié créé
        setTaches((prec) => prec.filter((t) => t.id !== provisoire.id).map((t) => (t.id === serieId ? { ...t, recurrence: regleAvant } : t)));
        throw e;
      }
    });
    if (!ok || !unique) return null;
    const creee: Tache = unique;
    // Annuler : supprimer la tâche unique et rendre ce jour à la série (en gardant les jours cochés depuis).
    return () => executer(async () => {
      const s = tachesRef.current.find((t) => t.id === serieId);
      const u = tachesRef.current.find((t) => t.id === creee.id);
      if (!s?.recurrence) throw new Error("Série introuvable.");
      const r = s.recurrence;
      const remise = {
        ...r,
        exceptions: r.exceptions.filter((d) => d !== dateOcc),
        faites: u?.faite && !r.faites.includes(dateOcc) ? [...r.faites, dateOcc].sort() : r.faites,
      };
      await depot.supprimerTache(creee.id);
      const majSerie = await depot.changerRecurrence(serieId, remise);
      setTaches((prec) => prec.filter((t) => t.id !== creee.id).map((t) => (t.id === serieId ? majSerie : t)));
    });
  }

  // Projet ou idée déposé sur l'agenda : nouvelle tâche (affichée tout de suite, puis enregistrée).
  const creerDepuis = useCallback(async (d: DonneesTache): Promise<Annuler | null> => {
    const provisoire: Tache = { ...d, id: `provisoire-${Date.now()}`, faite: false, creeLe: new Date().toISOString() };
    setTaches((prec) => [...prec, provisoire]);
    let creee: Tache | null = null;
    const ok = await executer(async () => {
      try {
        creee = await depot.insererTache(d);
        const c = creee;
        setTaches((prec) => prec.map((t) => (t.id === provisoire.id ? c : t)));
      } catch (e) {
        setTaches((prec) => prec.filter((t) => t.id !== provisoire.id));
        throw e;
      }
    });
    if (!ok || !creee) return null;
    const id = (creee as Tache).id;
    return () => executer(async () => {
      await depot.supprimerTache(id);
      setTaches((prec) => prec.filter((t) => t.id !== id));
    });
  }, [executer]);

  const importer = useCallback(
    (liste: Tache[]) => executer(async () => {
      const ajoutees = await depot.insererPlusieurs(liste);
      setTaches((prec) => [...prec, ...ajoutees]);
    }),
    [executer],
  );

  return {
    taches, charge, erreur, effacerErreur: () => setErreur(null),
    ajouter, modifier, supprimer, basculerFaite, cocherCase, effacerTerminees, importer, recharger, changerHoraires,
    supprimerOccurrence, modifierOccurrence, deplacer, creerDepuis,
    listerCorbeille, restaurer, supprimerDefinitivement,
  };
}

/* « Ce jour seulement » : le jour devient une tâche unique ; il garde ce qui avait été coché
   CE jour-là, appliqué à la liste telle qu'elle vient d'être (peut-être) modifiée dans le formulaire. */
function casesReprises(serie: Tache, date: string, d: DonneesTache) {
  const jour = serie.recurrence?.cases?.[date];
  const cles = new Set((d.materiel ?? "").split("\n").map((l) => cleMateriel(l)).filter(Boolean));
  return {
    etapes: (d.etapes ?? []).map((e) => ({ ...e, faite: jour ? jour.etapes.includes(e.id) : e.faite })),
    materielPris: (jour?.materiel ?? []).filter((k) => cles.has(k)),
  };
}
