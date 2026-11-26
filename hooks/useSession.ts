"use client";

/* Suit l'utilisateur connecté. Supabase garde la session dans le navigateur :
   en revenant sur le site, on est toujours connecté.
   onAuthStateChange nous prévient à chaque connexion / déconnexion.

   Hors connexion : le « jeton d'accès » de Supabase expire au bout d'une heure et doit être
   renouvelé auprès du serveur. Sans réseau, ce renouvellement échoue et Supabase répond
   « pas de session »… alors que la session est toujours rangée dans le navigateur (elle n'est
   effacée que si le serveur la refuse vraiment, ou à la déconnexion). On reprend donc cette
   session rangée pour afficher l'agenda ; Supabase la renouvellera tout seul au retour du réseau. */

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configurationOk, supabase } from "@/lib/supabase";
import * as hl from "@/lib/hors-ligne";

function sessionRangee(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i);
      if (!cle || !/^sb-.+-auth-token$/.test(cle)) continue;
      const s = JSON.parse(localStorage.getItem(cle) ?? "null") as Session | null;
      if (s?.user?.id && s.refresh_token) return s;
    }
  } catch { /* stockage illisible */ }
  return null;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (!configurationOk) {
      setPret(true);
      return;
    }
    const client = supabase();
    // Session nulle SANS déconnexion demandée : si une session est encore rangée, c'est
    // que le renouvellement a échoué faute de réseau → on la garde.
    const choisir = (s: Session | null, deconnexion: boolean) => s ?? (deconnexion ? null : sessionRangee());
    client.auth.getSession().then(({ data }) => {
      setSession(choisir(data.session, false));
      setPret(true);
    });
    const { data } = client.auth.onAuthStateChange((evenement, nouvelle) => {
      if (evenement === "SIGNED_OUT") hl.oublier(); // ordinateur partagé : on efface la copie locale
      setSession(choisir(nouvelle, evenement === "SIGNED_OUT"));
    });
    // Fonction de "nettoyage" : appelée quand le composant disparaît, pour ne pas laisser d'écouteur actif.
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, pret };
}
