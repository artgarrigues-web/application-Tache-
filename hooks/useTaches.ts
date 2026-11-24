"use client";

/* Hook personnalisé : il regroupe l'état "liste des tâches" et sa synchronisation
   avec Supabase. Un composant qui l'utilise reçoit les tâches + des fonctions
   pour les modifier, sans savoir où elles sont stockées.

   Règle React importante : on ne modifie jamais un tableau d'état en place
   (pas de push, pas de t.faite = true). On crée un NOUVEAU tableau avec
   map / filter / [...] : c'est en voyant une nouvelle référence que React
   sait qu'il doit réafficher.                                                 */

import { useCallback, useEffect, useState } from "react";
import * as depot from "@/lib/depot";
import * as rec from "@/lib/recurrence";
import type { DonneesTache, Portee, Tache } from "@/lib/types";

function messageErreur(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function useTaches(userId: string) {
  const [taches, setTaches] = useState<Tache[]>([]);
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

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
  useEffect(() => {
    const auRetour = () => {
      if (document.visibilityState === "visible") recharger();
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => document.removeEventListener("visibilitychange", auRetour);
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

  const supprimer = useCallback(
    (id: string) => executer(async () => {
      await depot.supprimerTache(id);
      setTaches((prec) => prec.filter((t) => t.id !== id));
    }),
    [executer],
  );

  /* Mise à jour "optimiste" : on coche tout de suite à l'écran (réactivité),
     puis on envoie à la base. Si la base refuse, on annule le changement.
     Pour une occurrence de tâche répétée (id "serie~date"), on coche/décoche la date
     dans la règle de la série (liste « faites »).                                */
  const basculerFaite = useCallback(
    (id: string) => {
      const occ = rec.analyserId(id);
      if (occ) {
        const serie = taches.find((t) => t.id === occ.serieId);
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
      const tache = taches.find((t) => t.id === id);
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
    [taches, executer],
  );

  /* ---------- Occurrence d'une tâche répétée : modifier ou supprimer ----------
     portee = "occurrence" : seulement ce jour-là ;
              "suivantes"  : ce jour-là et tous les suivants (la série est coupée en deux) ;
              "serie"      : toute la série, passé compris.                              */
  const remplacer = (maj: Tache) => setTaches((prec) => prec.map((t) => (t.id === maj.id ? maj : t)));

  const supprimerOccurrence = useCallback(
    (serieId: string, date: string, portee: Portee) => executer(async () => {
      const serie = taches.find((t) => t.id === serieId);
      if (!serie?.recurrence) throw new Error("Série introuvable.");
      if (portee === "serie" || (portee === "suivantes" && date <= serie.date)) {
        await depot.supprimerTache(serieId);
        setTaches((prec) => prec.filter((t) => t.id !== serieId));
      } else {
        const r = portee === "occurrence" ? rec.ajouterException(serie.recurrence, date) : rec.arreterAvant(serie.recurrence, date);
        remplacer(await depot.changerRecurrence(serieId, r));
      }
    }),
    [taches, executer],
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
        let unique = await depot.insererTache({ ...d, recurrence: null });
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
        regle = { ...regle, exceptions: garder(regle.exceptions), faites: garder(regle.faites) };
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

  const effacerTerminees = useCallback(
    () => executer(async () => {
      await depot.supprimerTerminees();
      setTaches((prec) => prec.filter((t) => !t.faite));
    }),
    [executer],
  );

  // Planification automatique (et son annulation) : nouvelle date + heure pour plusieurs tâches.
  const changerHoraires = useCallback(
    (changements: depot.ChangementHoraire[]) => executer(async () => {
      const majs = new Map((await depot.changerHoraires(changements)).map((t) => [t.id, t]));
      setTaches((prec) => prec.map((t) => majs.get(t.id) ?? t));
    }),
    [executer],
  );

  const importer = useCallback(
    (liste: Tache[]) => executer(async () => {
      const ajoutees = await depot.insererPlusieurs(liste);
      setTaches((prec) => [...prec, ...ajoutees]);
    }),
    [executer],
  );

  return {
    taches, charge, erreur, effacerErreur: () => setErreur(null),
    ajouter, modifier, supprimer, basculerFaite, effacerTerminees, importer, recharger, changerHoraires,
    supprimerOccurrence, modifierOccurrence,
  };
}
