


-- =====================================================================
-- Mise à jour du 24/11/2026 : répétition des tâches (récurrence)
-- À coller dans Supabase → SQL Editor → New query → Run.
-- Sans danger : ajoute UNE colonne vide (null = tâche non répétée) ; aucune
-- tâche existante n'est modifiée. Peut être relancé sans effet de bord.
-- =====================================================================

-- 1. La règle de répétition, rangée en JSON. Exemple :
--    {"frequence":"semaine","intervalle":1,"joursSemaine":[0,3],"modeMois":"jour",
--     "fin":{"type":"jamais"},"exceptions":[],"faites":["2026-11-24"]}
--    Les occurrences ne sont PAS des lignes : l'application les calcule à l'affichage.
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

-- Demande à l'API de Supabase de relire la structure tout de suite.
notify pgrst, 'reload schema';

-- Vérification : doit afficher une ligne "recurrence | jsonb".
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'taches' and column_name = 'recurrence';
