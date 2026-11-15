"use client";

/* Suit l'utilisateur connecté. Supabase garde la session dans le navigateur :
   en revenant sur le site, on est toujours connecté.
   onAuthStateChange nous prévient à chaque connexion / déconnexion.          */

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { configurationOk, supabase } from "@/lib/supabase";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [pret, setPret] = useState(false);

  useEffect(() => {
    if (!configurationOk) {
      setPret(true);
      return;
    }
    const client = supabase();
    client.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPret(true);
    });
    const { data } = client.auth.onAuthStateChange((_evenement, nouvelle) => setSession(nouvelle));
    // Fonction de "nettoyage" : appelée quand le composant disparaît, pour ne pas laisser d'écouteur actif.
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, pret };
}
