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
import type { DonneesTache, Tache } from "@/lib/types";

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
     puis on envoie à la base. Si la base refuse, on annule le changement.   */
  const basculerFaite = useCallback(
    (id: string) => {
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
  };
}
