/* Logo d'AgendIA : un calendrier coché (les tâches) et une petite étincelle
   ambre (l'IA à venir), sur un carré arrondi du bleu principal du site.
   Même dessin que le favicon app/icon.svg, en SVG intégré pour rester net à
   toutes les tailles. "aria-hidden" : le nom écrit juste à côté suffit aux
   lecteurs d'écran. */

import { COULEUR_ETINCELLE, COULEUR_LOGO, NOM_APP } from "@/lib/marque";

export function Logo({ taille = 32 }: { taille?: number }) {
  return (
    <svg className="logo" width={taille} height={taille} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill={COULEUR_LOGO} />
      <rect x="13" y="17" width="34" height="32" rx="6" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M13 27h34" stroke="#fff" strokeWidth="4" />
      <path d="M22 12v9M38 12v9" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M21.5 37.5l5 5 9-10" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M51 6c.9 4.3 2.7 6.1 7 7-4.3.9-6.1 2.7-7 7-.9-4.3-2.7-6.1-7-7 4.3-.9 6.1-2.7 7-7z" fill={COULEUR_ETINCELLE} />
    </svg>
  );
}

/* Le nom avec « IA » mis en valeur (couleur d'accent du site).
   Calculé à partir de NOM_APP : si le nom finit par « IA », ces deux lettres
   sont colorées ; sinon le nom est affiché tel quel. */
export function NomApp() {
  const avecIA = NOM_APP.endsWith("IA");
  return (
    <span className="nom-app">
      {avecIA ? <>{NOM_APP.slice(0, -2)}<span className="nom-app-ia">IA</span></> : NOM_APP}
    </span>
  );
}
