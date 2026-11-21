


-- =====================================================================
-- Mise à jour du 21/11/2026 : planification automatique
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Sans danger : n'ajoute qu'une colonne (vide) et une table ; ne supprime rien.
-- Peut être relancé plusieurs fois sans effet de bord ("if not exists").
-- =====================================================================

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
