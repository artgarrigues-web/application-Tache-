"use client";

/* Agendas externes (Google, Outlook, Apple) : liste des agendas branchés + leurs
   événements, demandés au serveur (/api/agendas-externes) pour une « fenêtre » de dates.

   Pour ne pas interroger Google à chaque clic sur ‹ ›, on demande une fenêtre large
   (de 2 semaines avant à 10 semaines après la période vue) et on ne redemande que si
   la période affichée en sort, si un agenda change, ou au retour sur l'onglet
   après plus de 5 minutes.                                                          */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as depot from "@/lib/depot";
import { supabase } from "@/lib/supabase";
import { decalerJours } from "@/lib/recurrence";
import type { EvenementExterne } from "@/lib/ics-lecture";

export interface EtatAgenda { id: string; ok: boolean; erreur: string; nombre: number }
export interface DonneesAgendas {
  agendas: depot.AgendaExterne[];
  etats: Map<string, EtatAgenda>;
  evenements: EvenementExterne[];
  parDate: Map<string, EvenementExterne[]>;
  charge: boolean;
  enCours: boolean;
  indisponible: boolean; // table absente (migration pas encore appliquée)
  ajouter: (a: Omit<depot.AgendaExterne, "id">) => Promise<string | null>; // renvoie un message d'erreur, ou null
  retirer: (id: string) => Promise<void>;
  changerCouleur: (id: string, couleur: depot.AgendaExterne["couleur"]) => Promise<void>;
  actualiser: () => void;
}

const RAFRAICHIR_MS = 5 * 60 * 1000;

export function useAgendasExternes(userId: string, debutVu: string, finVu: string): DonneesAgendas {
  const [agendas, setAgendas] = useState<depot.AgendaExterne[]>([]);
  const [etats, setEtats] = useState<Map<string, EtatAgenda>>(new Map());
  const [evenements, setEvenements] = useState<EvenementExterne[]>([]);
  const [charge, setCharge] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [indisponible, setIndisponible] = useState(false);
  const fenetre = useRef<{ debut: string; fin: string; lu: number } | null>(null);
  const [version, setVersion] = useState(0); // +1 = forcer une nouvelle lecture

  useEffect(() => {
    depot.listerAgendas().then((a) => { setAgendas(a); setIndisponible(false); })
      .catch(() => setIndisponible(true))
      .finally(() => setCharge(true));
  }, [userId, version]);

  const lire = useCallback(async (debut: string, fin: string) => {
    const { data } = await supabase().auth.getSession();
    const jeton = data.session?.access_token;
    if (!jeton) return;
    setEnCours(true);
    try {
      const rep = await fetch(`/api/agendas-externes?debut=${debut}&fin=${fin}`, { headers: { Authorization: `Bearer ${jeton}` } });
      const json = await rep.json() as { agendas?: EtatAgenda[]; evenements?: EvenementExterne[] };
      setEtats(new Map((json.agendas ?? []).map((e) => [e.id, e])));
      setEvenements(json.evenements ?? []);
      fenetre.current = { debut, fin, lu: Date.now() };
    } catch {
      /* réseau coupé : on garde ce qu'on avait */
    } finally {
      setEnCours(false);
    }
  }, []);

  // Relecture quand la période affichée sort de la fenêtre déjà lue (ou qu'un agenda a changé).
  useEffect(() => {
    if (!charge) return;
    if (agendas.length === 0) { setEvenements([]); setEtats(new Map()); fenetre.current = null; return; }
    const f = fenetre.current;
    if (f && debutVu >= f.debut && finVu <= f.fin && Date.now() - f.lu < RAFRAICHIR_MS) return;
    const auj = new Date();
    const isoAuj = `${auj.getFullYear()}-${String(auj.getMonth() + 1).padStart(2, "0")}-${String(auj.getDate()).padStart(2, "0")}`;
    const debut = [decalerJours(debutVu, -14), decalerJours(isoAuj, -7)].sort()[0];
    const fin = [decalerJours(finVu, 70), decalerJours(isoAuj, 70)].sort()[1];
    lire(debut, decalerJours(debut, 140) < fin ? decalerJours(debut, 140) : fin);
  }, [charge, agendas, debutVu, finVu, lire]);

  // Au retour sur l'onglet après 5 minutes : on relit (un cours a pu être ajouté entre-temps).
  useEffect(() => {
    const auRetour = () => {
      const f = fenetre.current;
      if (document.visibilityState === "visible" && f && Date.now() - f.lu > RAFRAICHIR_MS) lire(f.debut, f.fin);
    };
    document.addEventListener("visibilitychange", auRetour);
    return () => document.removeEventListener("visibilitychange", auRetour);
  }, [lire]);

  const parDate = useMemo(() => {
    const m = new Map<string, EvenementExterne[]>();
    for (const e of evenements) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [evenements]);

  const forcer = () => { fenetre.current = null; setVersion((v) => v + 1); };

  return {
    agendas, etats, evenements, parDate, charge, enCours, indisponible,
    ajouter: async (a) => {
      try {
        await depot.ajouterAgenda(a);
        forcer();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    retirer: async (id) => { await depot.retirerAgenda(id); forcer(); },
    changerCouleur: async (id, couleur) => {
      setAgendas((liste) => liste.map((a) => (a.id === id ? { ...a, couleur } : a)));
      await depot.modifierAgenda(id, { couleur });
    },
    actualiser: forcer,
  };
}
