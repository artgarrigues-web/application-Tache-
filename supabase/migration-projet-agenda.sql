


-- =====================================================================
-- Mise à jour du 25/11/2026 : placer un projet sur l'agenda (glisser-déposer)
-- À coller dans Supabase → SQL Editor → New query → Run (si ce n'est pas déjà fait).
-- Sans danger : ajoute UNE colonne facultative ; ne modifie aucune donnée.
-- Peut être relancé plusieurs fois ("if not exists").
-- =====================================================================

-- Une tâche peut être liée à un projet de la Checklist (celui dont elle vient).
-- Supprimer le projet ne supprime PAS la tâche : le lien est simplement effacé (on delete set null).
alter table public.taches
  add column if not exists projet_id uuid references public.projets_idees (id) on delete set null;

create index if not exists taches_projet_idx on public.taches (projet_id);
