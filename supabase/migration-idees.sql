


-- =====================================================================
-- Mise à jour du 22/11/2026 : catégorie « Idées de projets » (Checklist)
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Sans danger : n'ajoute que deux tables neuves ; ne touche pas aux tâches.
-- Peut être relancé plusieurs fois sans effet de bord ("if not exists").
-- =====================================================================

-- 1. Les projets : un titre par projet, plusieurs projets par utilisateur.
create table if not exists public.projets_idees (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titre   text not null check (char_length(titre) between 1 and 200),
  cree_le timestamptz not null default now()
);

-- 2. Les idées d'un projet. Supprimer un projet supprime ses idées (on delete cascade).
create table if not exists public.idees (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  projet_id uuid not null references public.projets_idees (id) on delete cascade,
  texte     text not null check (char_length(texte) between 1 and 2000),
  faite     boolean not null default false,
  cree_le   timestamptz not null default now()
);
create index if not exists idees_projet_idx on public.idees (projet_id);
create index if not exists projets_idees_user_idx on public.projets_idees (user_id);
create index if not exists idees_user_idx on public.idees (user_id);

-- 3. Sécurité (RLS) : chacun ne voit et ne modifie que SES projets et SES idées.
alter table public.projets_idees enable row level security;
alter table public.idees enable row level security;

drop policy if exists "Lire ses projets" on public.projets_idees;
create policy "Lire ses projets" on public.projets_idees
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Creer ses projets" on public.projets_idees;
create policy "Creer ses projets" on public.projets_idees
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Modifier ses projets" on public.projets_idees;
create policy "Modifier ses projets" on public.projets_idees
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Supprimer ses projets" on public.projets_idees;
create policy "Supprimer ses projets" on public.projets_idees
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Pour une idée, on vérifie en plus que le projet visé appartient bien à l'utilisateur.
drop policy if exists "Lire ses idees" on public.idees;
create policy "Lire ses idees" on public.idees
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Creer ses idees" on public.idees;
create policy "Creer ses idees" on public.idees
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projets_idees p where p.id = projet_id and p.user_id = (select auth.uid())));
drop policy if exists "Modifier ses idees" on public.idees;
create policy "Modifier ses idees" on public.idees
  for update to authenticated using ((select auth.uid()) = user_id) with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.projets_idees p where p.id = projet_id and p.user_id = (select auth.uid())));
drop policy if exists "Supprimer ses idees" on public.idees;
create policy "Supprimer ses idees" on public.idees
  for delete to authenticated using ((select auth.uid()) = user_id);
