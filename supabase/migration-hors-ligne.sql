-- =====================================================================
-- Hors connexion (26/11/2026) : heure de dernière modification de chaque tâche.
-- Sert à la règle « la modification la plus récente gagne » quand une même tâche
-- a été changée hors connexion (téléphone) ET sur un autre appareil (ordinateur).
-- Sans risque : ajoute une colonne et un déclencheur, ne modifie aucune donnée existante.
-- =====================================================================

alter table public.taches add column if not exists modifie_le timestamptz not null default now();

-- Remplie automatiquement par la base à chaque modification (l'application n'a rien à envoyer,
-- et l'heure est celle du serveur : elle ne dépend pas de l'horloge d'un appareil).
create or replace function public.taches_noter_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

drop trigger if exists taches_noter_modification on public.taches;
create trigger taches_noter_modification
  before update on public.taches
  for each row execute function public.taches_noter_modification();
