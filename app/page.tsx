/* Page d'accueil ("/"). Le fichier app/page.tsx correspond à l'URL "/" :
   avec l'App Router, l'arborescence des dossiers définit les URL.
   Toute l'application est interactive et dépend de l'utilisateur connecté,
   elle est donc dans un composant client (<App />).                       */

import { App } from "@/components/App";
import { ApercuPalettes } from "@/components/ApercuPalettes";

export default function Page() {
  return (
    <>
      <App />
      <ApercuPalettes />
    </>
  );
}
