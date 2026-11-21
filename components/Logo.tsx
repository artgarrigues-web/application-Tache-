/* Logo d'AgandIA : un calendrier coché (les tâches) et une petite étincelle
   jaune (l'IA à venir). Même dessin que le favicon app/icon.svg, en SVG
   intégré pour rester net à toutes les tailles. "aria-hidden" : le nom écrit
   juste à côté suffit aux lecteurs d'écran. */

export function Logo({ taille = 32 }: { taille?: number }) {
  return (
    <svg className="logo" width={taille} height={taille} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="logo-degrade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b5bdb" />
          <stop offset="1" stopColor="#7048e8" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#logo-degrade)" />
      <rect x="13" y="17" width="34" height="32" rx="6" fill="none" stroke="#fff" strokeWidth="4" />
      <path d="M13 27h34" stroke="#fff" strokeWidth="4" />
      <path d="M22 12v9M38 12v9" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M21.5 37.5l5 5 9-10" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M51 6c.9 4.3 2.7 6.1 7 7-4.3.9-6.1 2.7-7 7-.9-4.3-2.7-6.1-7-7 4.3-.9 6.1-2.7 7-7z" fill="#ffd43b" />
    </svg>
  );
}

/* Le nom avec « IA » mis en valeur (couleur d'accent). */
export function NomApp() {
  return (
    <span className="nom-app">Agand<span className="nom-app-ia">IA</span></span>
  );
}
