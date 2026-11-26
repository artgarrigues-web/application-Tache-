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

-- 6. Mise à jour du 21/11/2026 (abonnement calendrier Google / Outlook) ---
-- Chaque utilisateur peut obtenir une adresse secrète du type
--   https://<site>/api/calendrier/<jeton>.ics
-- à laquelle Google Agenda, Outlook, Apple Calendrier… s'abonnent.
-- Le jeton (UUID aléatoire, 122 bits de hasard) fait office de mot de passe :
-- qui le connaît peut LIRE les tâches datées de cet utilisateur, rien d'autre.
create table if not exists public.calendrier_jetons (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  jeton   uuid not null unique default gen_random_uuid(),
  cree_le timestamptz not null default now()
);
alter table public.calendrier_jetons enable row level security;

drop policy if exists "Lire son jeton" on public.calendrier_jetons;
create policy "Lire son jeton" on public.calendrier_jetons
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Créer son jeton" on public.calendrier_jetons;
create policy "Créer son jeton" on public.calendrier_jetons
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Changer son jeton" on public.calendrier_jetons;
create policy "Changer son jeton" on public.calendrier_jetons
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Supprimer son jeton" on public.calendrier_jetons;
create policy "Supprimer son jeton" on public.calendrier_jetons
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Renvoie le jeton de l'utilisateur connecté (le crée s'il n'existe pas).
-- nouveau = true : remplace l'ancien jeton (l'ancienne adresse cesse de marcher).
-- "security invoker" : la fonction s'exécute avec les droits de l'appelant,
-- donc les règles RLS ci-dessus s'appliquent.
create or replace function public.jeton_calendrier(nouveau boolean default false)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.calendrier_jetons (user_id) values (auth.uid())
  on conflict (user_id) do update
    set jeton = case when nouveau then gen_random_uuid() else public.calendrier_jetons.jeton end,
        cree_le = case when nouveau then now() else public.calendrier_jetons.cree_le end
  returning jeton;
$$;
revoke execute on function public.jeton_calendrier(boolean) from public, anon;
grant execute on function public.jeton_calendrier(boolean) to authenticated;

-- Utilisée par le serveur Next.js (route /api/calendrier) qui n'a PAS de
-- session utilisateur : elle doit donc contourner RLS ("security definer"),
-- mais ne renvoie que les tâches DATÉES du propriétaire du jeton, des 90
-- derniers jours et à venir, et jamais l'identifiant de l'utilisateur.
create or replace function public.taches_du_calendrier(p_jeton uuid)
returns table (
  id uuid, titre text, description text, date date, heure time,
  duree_minutes integer, lieu text, materiel text,
  categorie text, priorite text, faite boolean, cree_le timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.titre, t.description, t.date, t.heure,
         t.duree_minutes, t.lieu, t.materiel,
         t.categorie, t.priorite, t.faite, t.cree_le
  from public.taches t
  join public.calendrier_jetons j on j.user_id = t.user_id
  where j.jeton = p_jeton
    and t.date is not null
    and t.date >= current_date - 90
  order by t.date, t.heure nulls first;
$$;
revoke execute on function public.taches_du_calendrier(uuid) from public;
grant execute on function public.taches_du_calendrier(uuid) to anon, authenticated;

-- Permet à la route de distinguer "jeton valide mais aucune tâche" (calendrier
-- vide) de "jeton inconnu ou révoqué" (réponse 404).
create or replace function public.calendrier_existe(p_jeton uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.calendrier_jetons where jeton = p_jeton);
$$;
revoke execute on function public.calendrier_existe(uuid) from public;
grant execute on function public.calendrier_existe(uuid) to anon, authenticated;

-- 7. Mise à jour du 21/11/2026 (planification automatique) ------------
-- 1. Échéance (date limite) d'une tâche. null = pas d'échéance.
alter table public.taches add column if not exists echeance date;

-- 2. Plages de disponibilité hebdomadaires : une ligne par utilisateur,
--    la liste des plages est rangée en JSON, ex. :
--    [{"jour":0,"debut":"08:00","fin":"12:00"}, ...]   (jour 0 = lundi)
create table if not exists public.disponibilites (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  plages     jsonb not null default '[]'::jsonb,
  modifie_le timestamptz not null default now()
);
alter table public.disponibilites enable row level security;

drop policy if exists "Lire ses disponibilites" on public.disponibilites;
create policy "Lire ses disponibilites" on public.disponibilites
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Creer ses disponibilites" on public.disponibilites;
create policy "Creer ses disponibilites" on public.disponibilites
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Modifier ses disponibilites" on public.disponibilites;
create policy "Modifier ses disponibilites" on public.disponibilites
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Supprimer ses disponibilites" on public.disponibilites;
create policy "Supprimer ses disponibilites" on public.disponibilites
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Mise à jour du 24/11/2026 (couleur choisie dans la palette du formulaire) --
-- Détails et vérification : supabase/migration-couleur.sql
alter table public.taches
  add column if not exists couleur text;
alter table public.taches drop constraint if exists taches_couleur_check;
alter table public.taches
  add constraint taches_couleur_check
  check (couleur is null or couleur in ('bleu', 'turquoise', 'sauge', 'violet', 'rose', 'orange', 'jaune', 'ardoise'));

-- Mise à jour du 24/11/2026 (répétition des tâches) -------------------
-- Détails et vérification : supabase/migration-recurrence.sql
alter table public.taches
  add column if not exists recurrence jsonb;

alter table public.taches drop constraint if exists taches_recurrence_check;
alter table public.taches
  add constraint taches_recurrence_check
  check (recurrence is null or (
    jsonb_typeof(recurrence) = 'object'
    and recurrence->>'frequence' in ('jour', 'semaine', 'mois', 'annee')
  ));

-- 2. Synchro calendrier (.ics) : NOUVELLE fonction (_v2) qui renvoie aussi la règle,
--    et garde les séries commencées il y a plus de 90 jours (elles continuent !).
--    On ne touche pas à l'ancienne taches_du_calendrier (changer ses colonnes obligerait
--    à la supprimer) : la route essaie _v2, puis l'ancienne si _v2 n'existe pas.
create or replace function public.taches_du_calendrier_v2(p_jeton uuid)
returns table (
  id uuid, titre text, description text, date date, heure time,
  duree_minutes integer, lieu text, materiel text,
  categorie text, priorite text, faite boolean, cree_le timestamptz,
  recurrence jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.titre, t.description, t.date, t.heure,
         t.duree_minutes, t.lieu, t.materiel,
         t.categorie, t.priorite, t.faite, t.cree_le,
         t.recurrence
  from public.taches t
  join public.calendrier_jetons j on j.user_id = t.user_id
  where j.jeton = p_jeton
    and t.date is not null
    and (t.date >= current_date - 90 or t.recurrence is not null)
  order by t.date, t.heure nulls first;
$$;
revoke execute on function public.taches_du_calendrier_v2(uuid) from public;
grant execute on function public.taches_du_calendrier_v2(uuid) to anon, authenticated;

-- Étapes et matériel cochables (26/11/2026, voir supabase/migration-etapes.sql).
alter table public.taches
  add column if not exists etapes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(etapes) = 'array' and jsonb_array_length(etapes) <= 50),
  add column if not exists materiel_pris jsonb not null default '[]'::jsonb
    check (jsonb_typeof(materiel_pris) = 'array');
