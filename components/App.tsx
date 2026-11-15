"use client";

/* Aiguillage : configuration manquante → message ; pas connecté → écran de
   connexion ; connecté → agenda.                                              */

import { useSession } from "@/hooks/useSession";
import { configurationOk } from "@/lib/supabase";
import { Agenda } from "./Agenda";
import { Connexion } from "./Connexion";

export function App() {
  const { session, pret } = useSession();

  if (!configurationOk) {
    return (
      <div className="ecran-centre">
        <div className="carte-connexion">
          <h1>Configuration manquante</h1>
          <p>
            Les variables <code>NEXT_PUBLIC_SUPABASE_URL</code> et <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> ne
            sont pas définies. En local, copie <code>.env.example</code> en <code>.env.local</code> et remplis-le ; sur
            Vercel, ajoute-les dans Settings → Environment Variables puis redéploie.
          </p>
        </div>
      </div>
    );
  }
  if (!pret) return <div className="ecran-centre"><p className="vide">Chargement…</p></div>;
  if (!session) return <Connexion />;
  // "key" : si un autre utilisateur se connecte, l'agenda est entièrement réinitialisé.
  return <Agenda key={session.user.id} utilisateur={session.user} />;
}
