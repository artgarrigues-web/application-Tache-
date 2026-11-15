/* Mise en page racine (App Router de Next.js) : entoure toutes les pages.
   C'est un "Server Component" (pas de "use client") : il est rendu sur le serveur. */

import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mon agenda de tâches",
  description: "Organiser ses tâches personnelles et professionnelles sous forme d'agenda.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
