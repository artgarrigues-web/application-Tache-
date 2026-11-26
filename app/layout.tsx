/* Mise en page racine (App Router de Next.js) : entoure toutes les pages.
   C'est un "Server Component" (pas de "use client") : il est rendu sur le serveur. */

import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { NOM_APP, SLOGAN } from "@/lib/marque";

/* Polices (refonte « Carnet », 26/11/2026). Deux familles libres (licence SIL OFL),
   installées avec npm (@fontsource-variable/…) puis servies par le site lui-même :
   aucune requête vers Google Fonts, rien n'est envoyé à un tiers.
   - IBM Plex Sans : tout le texte de l'interface. Dessinée par IBM (2017) pour des
     ingénieurs, très lisible à petite taille, chiffres « tabulaires » pour aligner les
     heures. Fichier « standard » = graisse (wght) ET largeur (wdth) réglables : la vue
     Semaine utilise une largeur un peu condensée pour faire tenir les titres.
   - Fraunces : les dates et les titres (« Jeudi 26 novembre »), comme dans un agenda
     papier. Axe « opsz » : le dessin s'affine tout seul quand le texte est grand.
   next/font les précharge et calcule une police de secours aux mêmes dimensions :
   la page ne « saute » pas quand la vraie police arrive. Sous-ensemble « latin » :
   il couvre tout le français (é, è, à, ç, œ, «  », €…). */
const texte = localFont({
  src: [{ path: "../node_modules/@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-standard-normal.woff2", style: "normal" }],
  weight: "100 700",
  declarations: [{ prop: "font-stretch", value: "85% 100%" }],
  variable: "--police-texte",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
  adjustFontFallback: "Arial",
});
const titres = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-normal.woff2", style: "normal" },
    { path: "../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-opsz-italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  variable: "--police-titre",
  display: "swap",
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: NOM_APP,
  description: SLOGAN,
  applicationName: NOM_APP,
};

/* Couleur de la barre du navigateur (Android, Safari) : celle du papier de la page,
   claire ou sombre selon le réglage du téléphone, pour qu'elle se fonde dans l'en-tête. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#141311" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${texte.variable} ${titres.variable}`}>
      <body>{children}</body>
    </html>
  );
}
