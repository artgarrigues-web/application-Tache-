

-- AgendIA : étapes (sous-tâches) et matériel cochables (26/11/2026).
-- À coller dans Supabase > SQL Editor (sans risque si on le relance : « if not exists »).
-- - etapes        : [{ "id": "...", "texte": "...", "faite": true|false }]
-- - materiel_pris : clés (texte en minuscules sans accents) des éléments du matériel cochés.
-- Pour une tâche RÉPÉTÉE, ce qui est coché chaque jour est rangé dans recurrence.cases
-- (aucune colonne en plus). Les règles RLS existantes de la table taches s'appliquent.
alter table public.taches
  add column if not exists etapes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(etapes) = 'array' and jsonb_array_length(etapes) <= 50),
  add column if not exists materiel_pris jsonb not null default '[]'::jsonb
    check (jsonb_typeof(materiel_pris) = 'array');
