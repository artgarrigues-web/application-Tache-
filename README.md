# AgendIA (Next.js + Supabase)

<img src="app/icon.svg" alt="Logo AgendIA" width="64" height="64">

**AgendIA** (agenda + IA) : application web pour organiser ses tâches personnelles et professionnelles sous forme d'agenda (jour, semaine, mois, liste). Elle permet d'ajouter, modifier, supprimer et cocher des tâches, affiche le nombre de tâches restantes et propose catégories, priorités, recherche et filtres. Chaque tâche peut aussi avoir une **durée estimée** (avec l'heure de fin calculée et le temps total prévu par jour), un **lieu** (cliquable vers Google Maps) et une **liste de matériel**. Les tâches sont stockées dans **Supabase**, chacun a son compte, et le site s'héberge sur **Vercel**.

> Le nom annonce la suite : l'**IA** sera intégrée plus tard. La planification automatique actuelle (« Planifier ma semaine ») n'utilise pas d'IA, c'est un algorithme déterministe.
>
> Le nom est défini à un seul endroit, `lib/marque.ts`. Le logo est `app/icon.svg` (favicon) et `components/Logo.tsx` (en-tête) ; les icônes PNG pour l'écran d'accueil du téléphone sont dans `public/`.

---

## 1. Mise en ligne, pas à pas

### Étape 1 : Supabase (la base de données)

1. Sur [supabase.com](https://supabase.com), crée un projet (offre gratuite). Choisis une région en Europe (ex. Paris ou Francfort) et note le mot de passe de la base.
2. Menu **SQL Editor** → **New query** → colle **tout** le contenu de [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Cela crée la table `taches` et ses règles de sécurité.
3. Récupère les deux valeurs de connexion : bouton **Connect** en haut du projet (ou **Project Settings → API Keys**) :
   - l'**URL du projet** : `https://xxxx.supabase.co` ;
   - la **clé publishable** (`sb_publishable_…`). Sur un ancien projet, c'est la clé **anon public** (elle commence par `eyJ…`) : elle marche aussi.
   - ⚠️ **N'utilise jamais** la clé `secret` / `service_role` dans cette application : elle contourne toutes les règles de sécurité.

### Étape 2 : lancer en local (facultatif mais conseillé)

Il faut [Node.js](https://nodejs.org) 20.9 ou plus récent.

```bash
npm install                 # télécharge Next.js, React, Supabase… dans node_modules/
cp .env.example .env.local  # puis colle l'URL et la clé dans .env.local
npm run dev                 # lance le site sur http://localhost:3000
```

Crée un compte depuis l'écran de connexion. Par défaut, Supabase envoie un **e-mail de confirmation** : clique sur le lien, puis connecte-toi.

### Étape 3 : GitHub (le code)

Le code est poussé sur ton dépôt GitHub. Le fichier `.gitignore` exclut `node_modules/`, `.next/` et surtout `.env.local` : **tes clés ne partent pas sur GitHub**.

### Étape 4 : Vercel (l'hébergement)

1. Sur [vercel.com](https://vercel.com), connecte-toi avec GitHub → **Add New… → Project** → importe le dépôt.
2. Vercel détecte Next.js tout seul. Avant de cliquer **Deploy**, ouvre **Environment Variables** et ajoute :
   - `NEXT_PUBLIC_SUPABASE_URL` = l'URL du projet ;
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = la clé publishable.
3. **Deploy**. Tu obtiens une adresse du type `https://agenda-taches-xxx.vercel.app`.

   Adresse actuelle du site : **https://agendia-taches.vercel.app**. L'ancienne adresse `https://application-tache-cyan.vercel.app` reste active (même site, pas de redirection) pour que les liens d'abonnement calendrier (.ics) déjà ajoutés dans Google Agenda / Outlook continuent de fonctionner.
4. Retourne dans Supabase → **Authentication → URL Configuration** :
   - **Site URL** : ton adresse Vercel ;
   - **Redirect URLs** : ajoute aussi `http://localhost:3000` pour le développement.
   Sans ça, le lien de l'e-mail de confirmation renverrait vers `localhost`.

Ensuite, **chaque `git push` sur la branche principale redéploie automatiquement** le site.

> Si tu modifies une variable d'environnement sur Vercel, il faut **redéployer** (Deployments → ⋯ → Redeploy) : les variables `NEXT_PUBLIC_` sont recopiées dans le code au moment du build.

---

## 2. Organisation du code

```
app/
  layout.tsx        Mise en page racine (balise <html>, titre, CSS global)
  page.tsx          La page "/" : affiche <App />
  globals.css       Tous les styles (variables de couleurs, mode sombre, grilles)
components/
  App.tsx           Aiguillage : config manquante / écran de connexion / agenda
  Connexion.tsx     Formulaire de connexion et de création de compte
  Agenda.tsx        Composant principal : état de l'interface, barre d'outils, filtres
  Compteurs.tsx     Tâches restantes, en retard, avancement de la période
  VuesAgenda.tsx    Les vues Jour, Semaine, Mois et Liste
  CarteTache.tsx    L'affichage d'une tâche (et d'une liste de tâches)
  FormulaireTache.tsx  Fenêtre d'ajout / modification
hooks/
  useSession.ts     Suit l'utilisateur connecté
  useTaches.ts      Liste des tâches + opérations (ajouter, modifier, cocher…)
lib/
  types.ts          Types TypeScript et constantes
  dates.ts          Calculs de dates (début de semaine, titres…)
  taches.ts         Filtres, tri, validation : la logique "métier"
  supabase.ts       Création du client Supabase
  depot.ts          SEUL fichier qui lit/écrit dans la base
supabase/
  schema.sql        Table + règles de sécurité à exécuter dans Supabase
```

Le découpage suit le principe **une responsabilité par fichier**. Il y a trois couches : l'affichage (`components/`), l'état et la synchronisation (`hooks/`), et la logique pure et l'accès aux données (`lib/`). Une couche ne dépend que de celle du dessous.

---

## 3. Les notions importantes, expliquées

### Next.js, React et TypeScript : qui fait quoi ?
- **React** construit l'interface à partir de **composants**, des fonctions qui renvoient du JSX (du HTML dans du code). Quand l'**état** (`useState`) change, React recalcule l'affichage et ne met à jour que ce qui a changé dans la page.
- **Next.js** est un framework autour de React. Il apporte le routage par dossiers (`app/page.tsx` = URL `/`), le build optimisé, le rendu côté serveur et le déploiement simple sur Vercel (Vercel est l'entreprise qui développe Next.js).
- **TypeScript** est du JavaScript avec des **types** vérifiés avant l'exécution. Si tu écris `categorie: "boulot"`, la compilation échoue, car seuls `"perso" | "travail" | "projets"` sont autorisés. Ça attrape beaucoup d'erreurs avant même de lancer le site.

### `"use client"` : composants serveur et composants client
Dans l'App Router, les composants sont **par défaut exécutés sur le serveur** (Server Components). Ils ne peuvent ni utiliser `useState`, ni réagir aux clics, ni accéder à `window` ou `localStorage`. La directive `"use client"` en haut d'un fichier indique que ce composant (et ceux qu'il importe) tourne **aussi dans le navigateur**. Ici, `layout.tsx` et `page.tsx` sont des composants serveur, et tout le reste est client, car l'application est entièrement interactive.

### Le flux de données à sens unique
```
état (useState) ─► props ─► affichage
clic ─► fonction reçue en prop ─► nouvel état ─► React réaffiche
```
`Agenda` possède l'état (vue, date, filtres) et le transmet aux enfants via leurs **props**. Les enfants ne modifient jamais l'état directement : ils appellent les fonctions reçues (`actions.cocher(id)`…). C'est la même idée que `afficher()` dans la version HTML, mais automatisée par React.

### Ne jamais modifier l'état en place
`tache.faite = true` ou `taches.push(…)` **ne déclenchent pas** de réaffichage, car React compare les références d'objets. On crée toujours une nouvelle version :
```ts
setTaches(prec => prec.map(t => t.id === id ? { ...t, faite: !t.faite } : t));
```
`{ ...t, faite: … }` copie l'objet en remplaçant un champ (« spread operator »).

### `useEffect` : les effets de bord
Le rendu d'un composant doit être « pur » : il calcule l'affichage, rien d'autre. Tout ce qui touche au monde extérieur (requête réseau, `localStorage`, écouteur clavier, titre de l'onglet) va dans `useEffect`. Cette fonction s'exécute **après** l'affichage, et **uniquement dans le navigateur**. La fonction renvoyée par un `useEffect` sert au **nettoyage** (retirer un écouteur) quand le composant disparaît.

### Hooks personnalisés (`useTaches`, `useSession`)
Une fonction qui commence par `use` et utilise d'autres hooks. `useTaches` cache toute la mécanique Supabase : `Agenda` reçoit juste `taches`, `ajouter`, `supprimer`… Pour changer de base de données, on ne toucherait qu'à `useTaches` et `depot.ts`.

### Mise à jour optimiste
Quand tu coches une tâche, elle est barrée **immédiatement**, puis la requête part vers Supabase. Si la requête échoue, le changement est annulé et un bandeau rouge s'affiche. Résultat : l'interface paraît instantanée même avec un réseau lent. Pour l'ajout et la modification, on attend au contraire la réponse de la base, car c'est elle qui fournit l'`id` définitif.

### La sécurité : pourquoi RLS est indispensable
La clé publishable est **visible par n'importe qui** dans le code du site, et c'est normal. N'importe qui peut donc envoyer des requêtes à ta base. Ce qui protège les données, ce sont les règles **Row Level Security** de `schema.sql` : chaque requête ne « voit » que les lignes où `user_id = auth.uid()` (l'utilisateur connecté). Sans ces règles, n'importe quel visiteur pourrait lire ou effacer toutes les tâches. C'est aussi pour ça que `depot.ts` ne filtre jamais par utilisateur : la base le fait elle-même, et de façon infalsifiable.

### Conversion base ↔ application (`depot.ts`)
SQL utilise le `snake_case` (`cree_le`) et un type `time` (`"14:00:00"`). Le code TypeScript utilise le `camelCase` (`creeLe`) et `"14:00"`. Les fonctions `depuisLigne` / `versLigne` convertissent dans les deux sens. Ce « dépôt » (*repository pattern*) isole la base du reste du code.

### Sécurité de l'affichage (XSS)
React **échappe automatiquement** le texte inséré avec `{tache.titre}`. Un titre contenant `<script>` s'affiche donc comme du texte, sans être exécuté. C'est l'équivalent du `textContent` de la version HTML. Le seul moyen de contourner cette protection serait `dangerouslySetInnerHTML`, qui n'est jamais utilisé ici.

---

### Les groupes Urgent / Important / Rapide (vue « Tri »)
Ces trois groupes ne sont **pas stockés** dans la base : ils sont **calculés** à chaque affichage (`groupesDe()` dans `lib/taches.ts`) à partir de champs qui existent déjà. Aucune migration n'a donc été nécessaire, et un groupe ne peut jamais être « faux » (pas de valeur à tenir à jour).
- 🔥 **Urgent** : tâche non faite dont la date est aujourd'hui, demain, ou passée (seuil `JOURS_URGENCE` dans `lib/types.ts`).
- ⭐ **Important** : priorité « haute ».
- ⚡ **Rapide** : durée estimée ≤ 30 min (seuil `DUREE_RAPIDE_MAX`).
Le champ **Groupe** du formulaire permet de forcer un groupe à la main (colonne `groupe` en base) : il remplace alors complètement le calcul automatique. « Automatique » (valeur `null`) garde les règles ci-dessus.
Une tâche peut appartenir à plusieurs groupes (badges sur la carte). Dans la vue Tri, elle n'est rangée qu'une fois, dans le premier groupe qui s'applique (Urgent > Important > Rapide). Les tâches déjà faites n'apparaissent pas dans cette vue.

### Les tâches sans date (onglet « Checklist »)
La colonne `date` accepte `null` : une tâche sans date ni heure est une simple ligne de checklist. Côté application, elle a `date = ""`. Elle n'est jamais « en retard » ni « urgente » automatiquement, n'apparaît pas dans Jour / Semaine / Mois, mais apparaît dans Liste (groupe « Sans date », à la fin), dans Tri et dans l'onglet Checklist.

## Planification automatique (sans IA)

Bouton « 🪄 Planifier ma semaine » : place les tâches de la Checklist (sans date) dans la semaine choisie.

- **Réglages** : plages de disponibilité par jour (plusieurs plages possibles, ex. 8 h–12 h et 14 h–18 h), gardées dans la table `disponibilites` (ou dans le navigateur si la table n'existe pas).
- **3 propositions**, calculées par `lib/planification.ts` (algorithme glouton déterministe, testé par `npm test`) :
  - *Échéances d'abord* : tri par échéance, puis priorité, puis durée décroissante ; premier créneau libre.
  - *Regroupé par lieu* : les tâches d'un même lieu sont enchaînées dans un seul créneau quand c'est possible.
  - *Charge équilibrée* : chaque tâche va le jour le moins chargé.
- Les créneaux des tâches datées **avec heure** sont évités ; pas de placement dans le passé ; durée par défaut 1 h.
- Une tâche qui ne tient pas avant son échéance est placée après avec un ⚠ ; une tâche qui ne tient nulle part reste dans la Checklist avec la raison.
- Rien n'est écrit avant « Appliquer » ; un bandeau permet ensuite d'**annuler** (seules les tâches non modifiées depuis sont remises en Checklist).
- Migration à coller dans Supabase : `supabase/migration-planification.sql`.

### Idées de projets (Checklist)

- La Checklist a un **menu de catégories à gauche** (au-dessus sur téléphone) : *Tâches* et *Idées de projets*.
- *Idées de projets* : autant de projets que tu veux (créer, renommer, supprimer) ; chaque projet a sa liste d'idées (ajouter, modifier d'un clic, cocher quand elle est réalisée, supprimer). Pas de date : ce ne sont pas des tâches.
- Code : `components/IdeesProjets.tsx`, `hooks/useIdees.ts`, fonctions « Idées » de `lib/depot.ts`.
- Données : tables `projets_idees` et `idees` (RLS par utilisateur ; supprimer un projet supprime ses idées). Migration à coller dans Supabase : `supabase/migration-idees.sql`. Tant qu'elle n'est pas appliquée, la catégorie affiche un message au lieu d'une erreur.

### Couleur d'une tâche

- Dans le formulaire (dès le mode simple), une **palette de 8 couleurs** + « aucune » : Bleu, Turquoise, Sauge, Violet, Rose, Orange, Jaune, Ardoise. Pas de rouge (réservé au retard) ni de vert vif (réservé aux tâches faites).
- La couleur remplace la bande de catégorie à gauche de la carte et teinte légèrement son fond, dans toutes les vues. Une tâche faite reste verte et une tâche en retard reste rouge.
- On stocke le nom (`bleu`…) dans la colonne `taches.couleur` ; les teintes claires et sombres sont dans `app/globals.css` (`--c-bleu`…). Liste dans `COULEURS` (`lib/types.ts`).
- Migration à coller dans Supabase : `supabase/migration-couleur.sql`. Tant qu'elle n'est pas appliquée, tout fonctionne mais la couleur n'est pas enregistrée.

## 4. Limites, en toute honnêteté

- **Synchronisation entre appareils** : les tâches sont rechargées à l'ouverture et chaque fois que tu reviens sur l'onglet. Ce n'est pas du temps réel : si deux appareils sont ouverts en même temps, l'un ne voit les changements de l'autre qu'en revenant sur l'onglet. Supabase Realtime permettrait le vrai temps réel.
- **Toute la logique tourne dans le navigateur** (le serveur Next.js ne sert que la page). C'est sûr grâce à RLS, mais on n'exploite pas les fonctions serveur de Next.js (Server Actions, `@supabase/ssr`). C'est un choix de simplicité pour apprendre, et une bonne évolution possible.
- **Pas de « mot de passe oublié »** ni de connexion Google pour l'instant.
- **Offre gratuite Supabase** : un projet inactif pendant une semaine est mis en pause. Il suffit de le réactiver depuis le tableau de bord.
- **E-mails d'authentification** : le service d'e-mail intégré de Supabase est limité à quelques e-mails par heure. Ça suffit pour un usage personnel, mais pas pour beaucoup d'utilisateurs (il faudrait alors configurer un SMTP).
- **Pas de tests automatisés livrés** : l'application a été testée de bout en bout dans un navigateur, contre une imitation locale de l'API Supabase (connexion, mauvais mot de passe, ajout, modification, coche, suppression, recherche, rechargement, déconnexion). Elle n'a **pas** été testée contre un vrai projet Supabase, que je n'avais pas.
- `confirm()` / `alert()` du navigateur pour les confirmations : fonctionnel, mais pas très joli.

## 5. Idées d'évolution
1. Temps réel avec Supabase Realtime (`supabase.channel(...).on("postgres_changes", …)`).
2. « Mot de passe oublié » (`auth.resetPasswordForEmail`) et connexion Google.
3. Tâches récurrentes et sous-tâches (nouvelle colonne ou nouvelle table liée).
4. Glisser-déposer d'une tâche d'un jour à l'autre.
5. Passer l'authentification côté serveur avec `@supabase/ssr` et les Server Actions de Next.js.
