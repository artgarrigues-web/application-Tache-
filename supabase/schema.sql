-- =====================================================================
-- Agenda de tâches : création de la table et des règles de sécurité.
-- À exécuter UNE fois dans Supabase : menu "SQL Editor" → "New query"
-- → coller tout ce fichier → "Run".
-- =====================================================================

-- 1. La table des tâches -------------------------------------------------
create table if not exists public.taches (
  id          uuid primary key default gen_random_uuid(),
  -- Propriétaire de la tâche. "default auth.uid()" : Supabase remplit
  -- automatiquement ce champ avec l'identifiant de l'utilisateur connecté.
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titre       text not null check (char_length(titre) between 1 and 120),
  description text not null default '',
  date        date,                                   -- null = tâche sans date (checklist)
  heure       time,                                   -- null = pas d'heure
  duree_minutes integer check (duree_minutes is null or (duree_minutes > 0 and duree_minutes <= 10080)),
  materiel    text not null default '' check (char_length(materiel) <= 2000), -- un élément par ligne
  lieu        text not null default '' check (char_length(lieu) <= 200),
  categorie   text not null default 'perso'   check (categorie in ('perso', 'travail', 'projets')),
  priorite    text not null default 'moyenne' check (priorite in ('haute', 'moyenne', 'basse')),
  faite       boolean not null default false,
  cree_le     timestamptz not null default now()
);

-- Index : accélère la requête la plus fréquente ("mes tâches, triées par date").
create index if not exists taches_user_date_idx on public.taches (user_id, date);

-- 2. Sécurité au niveau des lignes (Row Level Security, RLS) -------------
-- La clé publique de Supabase est visible dans le code du site : n'importe
-- qui peut donc envoyer des requêtes à la base. RLS est ce qui empêche un
-- visiteur de lire ou modifier les tâches des autres : chaque requête ne
-- "voit" que les lignes dont user_id = l'utilisateur connecté.
alter table public.taches enable row level security;

drop policy if exists "Lire ses propres tâches" on public.taches;
create policy "Lire ses propres tâches" on public.taches
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Créer ses propres tâches" on public.taches;
create policy "Créer ses propres tâches" on public.taches
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Modifier ses propres tâches" on public.taches;
create policy "Modifier ses propres tâches" on public.taches
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Supprimer ses propres tâches" on public.taches;
create policy "Supprimer ses propres tâches" on public.taches
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 3. Mise à jour du 20/11/2026 (durée, matériel, lieu) --------------------
-- Pour une base créée AVANT cette date. Sans effet si les colonnes existent déjà.
alter table public.taches
  add column if not exists duree_minutes integer check (duree_minutes is null or (duree_minutes > 0 and duree_minutes <= 10080)),
  add column if not exists materiel text not null default '' check (char_length(materiel) <= 2000),
  add column if not exists lieu text not null default '' check (char_length(lieu) <= 200);

-- 4. Mise à jour du 21/11/2026 (groupe choisi à la main) -----------------
-- null = groupe calculé automatiquement par l'application.
alter table public.taches
  add column if not exists groupe text check (groupe is null or groupe in ('urgent', 'important', 'rapide'));

-- 5. Mise à jour du 21/11/2026 (tâches sans date = checklist) -------------
alter table public.taches alter column date drop not null;
