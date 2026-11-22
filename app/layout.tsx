/* Mise en page racine (App Router de Next.js) : entoure toutes les pages.
   C'est un "Server Component" (pas de "use client") : il est rendu sur le serveur. */

import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./palettes.css"; // aperçu des palettes : inactif sans ?palette= dans l'adresse
import { NOM_APP, SLOGAN } from "@/lib/marque";

export const metadata: Metadata = {
  title: NOM_APP,
  description: SLOGAN,
  applicationName: NOM_APP,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b5bdb",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
