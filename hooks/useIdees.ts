"use client";

/* Hook de la catégorie « Projets » : même rôle que useTaches pour les tâches.
   Il garde en mémoire les projets et leurs idées, et propose les fonctions pour
   les ajouter, modifier ou supprimer (chaque changement part aussi dans Supabase). */

import { useCallback, useEffect, useState } from "react";
import * as depot from "@/lib/depot";
import type { Idee, ProjetIdees } from "@/lib/types";

/* Si la migration SQL du 22/11 n'a pas encore été collée dans Supabase, les tables
   n'existent pas : on le détecte pour afficher un message clair plutôt qu'une erreur brute. */
function tablesAbsentes(message: string): boolean {
  return /projets_idees|idees/.test(message) && /does not exist|schema cache|not find/i.test(message);
}

export function useIdees(userId: string) {
  // Comme pour les tâches : premier affichage depuis la copie gardée sur l'appareil.
  const [projets, setProjets] = useState<ProjetIdees[]>(() => depot.projetsEtIdeesEnCopie().projets);
  const [idees, setIdees] = useState<Idee[]>(() => depot.projetsEtIdeesEnCopie().idees);
  const [charge, setCharge] = useState(() => depot.projetsEtIdeesEnCopie().projets.length > 0);
  const [erreur, setErreur] = useState<string | null>(null);
  const [migrationManquante, setMigrationManquante] = useState(false);

  const executer = useCallback(async (operation: () => Promise<void>): Promise<boolean> => {
    try {
      await operation();
      setErreur(null);
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (tablesAbsentes(message)) setMigrationManquante(true);
      else setErreur(message);
      return false;
    }
  }, []);

  const recharger = useCallback(async () => {
    const ok = await executer(async () => {
      const r = await depot.listerProjetsEtIdees();
      setProjets(r.projets);
      setIdees(r.idees);
    });
    if (ok) setMigrationManquante(false);
    setCharge(true);
  }, [executer]);

  useEffect(() => { recharger(); }, [userId, recharger]);

  // Comme pour les tâches : on recharge quand on revient sur l'onglet (modif faite sur le téléphone).
  useEffect(() => {
    const auRetour = () => { if (document.visibilityState === "visible") recharger(); };
    document.addEventListener("visibilitychange", auRetour);
    window.addEventListener("agendia-synchro", recharger);
    return () => {
      document.removeEventListener("visibilitychange", auRetour);
      window.removeEventListener("agendia-synchro", recharger);
    };
  }, [recharger]);

  // Renvoie le projet créé (pour l'ouvrir tout de suite), ou null en cas d'échec.
  const ajouterProjet = useCallback(async (titre: string): Promise<ProjetIdees | null> => {
    let cree: ProjetIdees | null = null;
    await executer(async () => {
      cree = await depot.insererProjet(titre);
      setProjets((prec) => [...prec, cree as ProjetIdees]);
    });
    return cree;
  }, [executer]);

  const renommerProjet = useCallback((id: string, titre: string) => executer(async () => {
    await depot.renommerProjet(id, titre);
    setProjets((prec) => prec.map((p) => (p.id === id ? { ...p, titre } : p)));
  }), [executer]);

  const supprimerProjet = useCallback((id: string) => executer(async () => {
    await depot.supprimerProjet(id);
    setProjets((prec) => prec.filter((p) => p.id !== id));
    setIdees((prec) => prec.filter((i) => i.projetId !== id)); // supprimées aussi en base (cascade)
  }), [executer]);

  const ajouterIdee = useCallback((projetId: string, texte: string) => executer(async () => {
    const nouvelle = await depot.insererIdee(projetId, texte);
    setIdees((prec) => [...prec, nouvelle]);
  }), [executer]);

  const modifierIdee = useCallback((id: string, texte: string) => executer(async () => {
    await depot.modifierIdee(id, { texte });
    setIdees((prec) => prec.map((i) => (i.id === id ? { ...i, texte } : i)));
  }), [executer]);

  // Mise à jour « optimiste » (coche immédiate, annulée si la base refuse), comme pour les tâches.
  const basculerIdee = useCallback((id: string) => {
    const idee = idees.find((i) => i.id === id);
    if (!idee) return Promise.resolve(false);
    const faite = !idee.faite;
    const appliquer = (v: boolean) => setIdees((prec) => prec.map((i) => (i.id === id ? { ...i, faite: v } : i)));
    appliquer(faite);
    return executer(async () => {
      try { await depot.modifierIdee(id, { faite }); } catch (e) { appliquer(!faite); throw e; }
    });
  }, [idees, executer]);

  const supprimerIdee = useCallback((id: string) => executer(async () => {
    await depot.supprimerIdee(id);
    setIdees((prec) => prec.filter((i) => i.id !== id));
  }), [executer]);

  return {
    projets, idees, charge, erreur, migrationManquante, effacerErreur: () => setErreur(null), recharger,
    ajouterProjet, renommerProjet, supprimerProjet, ajouterIdee, modifierIdee, basculerIdee, supprimerIdee,
  };
}

export type DonneesIdees = ReturnType<typeof useIdees>;
