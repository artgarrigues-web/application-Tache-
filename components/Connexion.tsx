"use client";

/* Écran de connexion / création de compte (Supabase Auth, e-mail + mot de passe). */

import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

export function Connexion() {
  const [mode, setMode] = useState<"connexion" | "inscription">("connexion");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ type: "erreur" | "info"; texte: string } | null>(null);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnCours(true);
    setMessage(null);
    const auth = supabase().auth;

    if (mode === "connexion") {
      const { error } = await auth.signInWithPassword({ email, password: motDePasse });
      // En cas de succès, useSession est prévenu automatiquement et l'agenda s'affiche.
      if (error) setMessage({ type: "erreur", texte: traduire(error.message) });
    } else {
      const { data, error } = await auth.signUp({
        email,
        password: motDePasse,
        options: { emailRedirectTo: window.location.origin }, // lien du mail de confirmation
      });
      if (error) setMessage({ type: "erreur", texte: traduire(error.message) });
      else if (!data.session) {
        setMessage({ type: "info", texte: "Compte créé ! Clique sur le lien reçu par e-mail pour le confirmer, puis connecte-toi." });
        setMode("connexion");
      }
    }
    setEnCours(false);
  }

  return (
    <div className="ecran-centre">
      <form className="carte-connexion formulaire" onSubmit={soumettre}>
        <h1>📅 Mon agenda</h1>
        <h2>{mode === "connexion" ? "Connexion" : "Créer un compte"}</h2>

        <div className="champ">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="champ">
          <label htmlFor="mdp">Mot de passe {mode === "inscription" && "(6 caractères minimum)"}</label>
          <input id="mdp" type="password" required minLength={6}
            autoComplete={mode === "connexion" ? "current-password" : "new-password"}
            value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} />
        </div>

        {message && <p className={message.type === "erreur" ? "message-erreur" : "message-info"}>{message.texte}</p>}

        <button type="submit" className="btn btn-principal" disabled={enCours}>
          {enCours ? "Patiente…" : mode === "connexion" ? "Se connecter" : "Créer mon compte"}
        </button>
        <button type="button" className="lien" onClick={() => { setMode(mode === "connexion" ? "inscription" : "connexion"); setMessage(null); }}>
          {mode === "connexion" ? "Pas encore de compte ? En créer un" : "Déjà un compte ? Se connecter"}
        </button>
      </form>
    </div>
  );
}

// Traduction des messages d'erreur les plus courants de Supabase.
function traduire(message: string): string {
  if (/invalid login credentials/i.test(message)) return "E-mail ou mot de passe incorrect.";
  if (/email not confirmed/i.test(message)) return "Adresse e-mail pas encore confirmée : clique sur le lien reçu par e-mail.";
  if (/already registered/i.test(message)) return "Un compte existe déjà avec cet e-mail.";
  if (/password should be/i.test(message)) return "Mot de passe trop court (6 caractères minimum).";
  if (/rate limit/i.test(message)) return "Trop de tentatives, réessaie dans quelques minutes.";
  return message;
}
