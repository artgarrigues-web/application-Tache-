


-- =====================================================================
-- Mise à jour du 24/11/2026 : couleur d'une tâche (palette du formulaire)
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Sans danger : ajoute UNE colonne vide (null) ; aucune tâche existante n'est modifiée.
-- Peut être relancé plusieurs fois sans effet de bord ("if not exists").
-- =====================================================================

alter table public.taches
  add column if not exists couleur text;

-- N'accepte que les noms de la palette (ou null = pas de couleur).
-- On supprime d'abord la règle si elle existe, pour pouvoir relancer le script.
alter table public.taches drop constraint if exists taches_couleur_check;
alter table public.taches
  add constraint taches_couleur_check
  check (couleur is null or couleur in ('bleu', 'turquoise', 'sauge', 'violet', 'rose', 'orange', 'jaune', 'ardoise'));

-- Demande à l'API de Supabase de relire la structure tout de suite
-- (sinon la nouvelle colonne peut rester invisible quelques minutes).
notify pgrst, 'reload schema';

-- Vérification : doit afficher une ligne "couleur | text".
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'taches' and column_name = 'couleur';
