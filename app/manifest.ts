/* Manifeste web : nom et icônes utilisés quand on « ajoute à l'écran d'accueil »
   sur téléphone. Next.js le sert automatiquement à /manifest.webmanifest. */

import type { MetadataRoute } from "next";
import { NOM_APP, SLOGAN } from "@/lib/marque";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NOM_APP,
    short_name: NOM_APP,
    description: SLOGAN,
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6fb",
    theme_color: "#3b5bdb",
    lang: "fr",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
