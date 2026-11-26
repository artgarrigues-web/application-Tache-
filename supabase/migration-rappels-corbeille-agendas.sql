


-- =====================================================================
-- Mise à jour du 26/11/2026 : rappels, corbeille, agendas externes
-- (appliquée directement par Claude via le connecteur Supabase ; ce fichier
-- garde la trace exacte de ce qui a été fait et peut être relancé sans danger).
--
-- Aucune donnée existante n'est modifiée ni supprimée : on AJOUTE deux colonnes
-- vides à la table des tâches et quatre petites tables.
--
-- La partie 7 (tâches planifiées pg_cron) contient un secret : elle n'est PAS
-- dans ce fichier sous sa forme réelle (voir la note en bas).
-- =====================================================================

-- 1. Corbeille ----------------------------------------------------------
-- Supprimer une tâche ne l'efface plus : on note la date de suppression.
-- null = tâche normale ; une date = tâche dans la corbeille (récupérable 30 jours).
alter table public.taches add column if not exists supprimee_le timestamptz;
create index if not exists taches_corbeille_idx on public.taches (user_id, supprimee_le) where supprimee_le is not null;

-- 2. Rappel d'une tâche -------------------------------------------------
-- Nombre de minutes AVANT l'heure de la tâche (0 = à l'heure pile, 1440 = la veille).
-- null = pas de rappel. Une tâche sans heure est rappelée par rapport à 9 h.
alter table public.taches add column if not exists rappel_minutes integer
  check (rappel_minutes is null or rappel_minutes between 0 and 10080);

-- 3. Appareils abonnés aux notifications (« web push ») ------------------
-- Un navigateur (téléphone, ordinateur) qui a accepté les notifications donne
-- une adresse d'envoi (endpoint) et deux clés de chiffrement. Elles ne permettent
-- QUE d'envoyer une notification à cet appareil, chiffrée avec la clé VAPID d'AgendIA.
create table if not exists public.abonnements_push (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint  text not null unique check (char_length(endpoint) <= 1000 and endpoint like 'https://%'),
  p256dh    text not null check (char_length(p256dh) <= 200),
  auth      text not null check (char_length(auth) <= 100),
  appareil  text not null default '' check (char_length(appareil) <= 80),
  cree_le   timestamptz not null default now()
);
alter table public.abonnements_push enable row level security;
drop policy if exists "Lire ses appareils" on public.abonnements_push;
create policy "Lire ses appareils" on public.abonnements_push
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Retirer ses appareils" on public.abonnements_push;
create policy "Retirer ses appareils" on public.abonnements_push
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Enregistre l'appareil pour l'utilisateur connecté. Passe par une fonction car le même
-- navigateur peut avoir servi à un autre compte : on remplace alors l'ancienne ligne
-- (invisible pour nous à cause de RLS). L'endpoint est une adresse impossible à deviner.
create or replace function public.enregistrer_abonnement_push(p_endpoint text, p_p256dh text, p_auth text, p_appareil text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  delete from public.abonnements_push where endpoint = p_endpoint;
  insert into public.abonnements_push (user_id, endpoint, p256dh, auth, appareil)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_appareil, ''), 80));
end;
$$;
revoke execute on function public.enregistrer_abonnement_push(text, text, text, text) from public, anon;
grant execute on function public.enregistrer_abonnement_push(text, text, text, text) to authenticated;

-- 4. Réglages des rappels (un par compte, suivent l'utilisateur sur tous ses appareils)
create table if not exists public.reglages_rappels (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rappel_defaut integer check (rappel_defaut is null or rappel_defaut between 0 and 10080), -- null = aucun
  resume_matin  time,  -- heure du résumé « Ma journée » ; null = pas de résumé
  modifie_le    timestamptz not null default now()
);
alter table public.reglages_rappels enable row level security;
drop policy if exists "Lire ses réglages" on public.reglages_rappels;
create policy "Lire ses réglages" on public.reglages_rappels
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Créer ses réglages" on public.reglages_rappels;
create policy "Créer ses réglages" on public.reglages_rappels
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Changer ses réglages" on public.reglages_rappels;
create policy "Changer ses réglages" on public.reglages_rappels
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 5. Journal des rappels envoyés (empêche d'envoyer deux fois le même rappel).
-- Aucune règle RLS : personne ne peut la lire par l'API, seules les fonctions ci-dessous y touchent.
create table if not exists public.rappels_envoyes (
  cle       text primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  envoye_le timestamptz not null default now()
);
alter table public.rappels_envoyes enable row level security;

-- Fonctions appelées par le serveur Vercel (route /api/rappels), qui n'a pas de session :
-- elles contournent RLS (security definer) mais exigent le secret partagé, rangé dans
-- le coffre chiffré de Supabase (Vault) sous le nom « agendia_rappels ».
create or replace function public.rappels_verifier_secret(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret is distinct from
     (select decrypted_secret from vault.decrypted_secrets where name = 'agendia_rappels' limit 1) then
    raise exception 'Accès refusé';
  end if;
end;
$$;
revoke execute on function public.rappels_verifier_secret(text) from public, anon, authenticated;

-- Tout ce qu'il faut pour calculer les rappels de la minute : appareils, réglages, tâches
-- à venir (et en retard récent, pour le résumé du matin) des comptes qui ont un appareil.
create or replace function public.rappels_donnees(p_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resultat jsonb;
begin
  perform public.rappels_verifier_secret(p_secret);
  with comptes as (select distinct user_id from public.abonnements_push)
  select jsonb_build_object(
    'abonnements', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'endpoint', a.endpoint, 'p256dh', a.p256dh, 'auth', a.auth))
                             from public.abonnements_push a), '[]'::jsonb),
    'reglages', coalesce((select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'resume_matin', r.resume_matin))
                          from public.reglages_rappels r join comptes c using (user_id)
                          where r.resume_matin is not null), '[]'::jsonb),
    'taches', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', t.id, 'user_id', t.user_id, 'titre', t.titre, 'date', t.date, 'heure', t.heure,
                          'lieu', t.lieu, 'rappel_minutes', t.rappel_minutes, 'recurrence', t.recurrence))
                        from public.taches t join comptes c using (user_id)
                        where t.supprimee_le is null and t.faite = false and t.date is not null
                          and (t.recurrence is not null or t.date between current_date - 31 and current_date + 8)), '[]'::jsonb)
  ) into resultat;
  return resultat;
end;
$$;
revoke execute on function public.rappels_donnees(text) from public;
grant execute on function public.rappels_donnees(text) to anon, authenticated;

-- Note les rappels comme envoyés ; renvoie SEULEMENT les clés nouvelles (les autres
-- étaient déjà parties, par exemple si deux vérifications se chevauchent).
create or replace function public.rappels_marquer(p_secret text, p_cles text[], p_users uuid[])
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rappels_verifier_secret(p_secret);
  return query
    insert into public.rappels_envoyes (cle, user_id)
    select c, u from unnest(p_cles, p_users) as x(c, u)
    on conflict (cle) do nothing
    returning cle;
end;
$$;
revoke execute on function public.rappels_marquer(text, text[], uuid[]) from public;
grant execute on function public.rappels_marquer(text, text[], uuid[]) to anon, authenticated;

-- Un appareil qui a retiré l'autorisation (ou une appli désinstallée) : on l'oublie.
create or replace function public.rappels_oublier(p_secret text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rappels_verifier_secret(p_secret);
  delete from public.abonnements_push where endpoint = p_endpoint;
end;
$$;
revoke execute on function public.rappels_oublier(text, text) from public;
grant execute on function public.rappels_oublier(text, text) to anon, authenticated;

-- 6. Agendas externes (Google, Outlook, Apple…) lus par AgendIA ------------
-- L'adresse iCal « secrète » donnée par Google / Outlook. Elle agit comme un mot de
-- passe en lecture : elle est rangée ici, visible seulement par son propriétaire (RLS).
create table if not exists public.agendas_externes (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nom      text not null check (char_length(nom) between 1 and 60),
  url      text not null check (char_length(url) <= 2000 and (url like 'https://%' or url like 'webcal://%')),
  couleur  text check (couleur is null or couleur in ('bleu', 'turquoise', 'sauge', 'violet', 'rose', 'orange', 'jaune', 'ardoise')),
  cree_le  timestamptz not null default now()
);
alter table public.agendas_externes enable row level security;
drop policy if exists "Lire ses agendas" on public.agendas_externes;
create policy "Lire ses agendas" on public.agendas_externes
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Ajouter ses agendas" on public.agendas_externes;
create policy "Ajouter ses agendas" on public.agendas_externes
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Changer ses agendas" on public.agendas_externes;
create policy "Changer ses agendas" on public.agendas_externes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Retirer ses agendas" on public.agendas_externes;
create policy "Retirer ses agendas" on public.agendas_externes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 7. Les tâches de la corbeille ne partent plus vers Google / Outlook (.ics) ----
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
    and t.supprimee_le is null
    and t.date is not null
    and t.date >= current_date - 90
  order by t.date, t.heure nulls first;
$$;

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
    and t.supprimee_le is null
    and t.date is not null
    and (t.date >= current_date - 90 or t.recurrence is not null)
  order by t.date, t.heure nulls first;
$$;

notify pgrst, 'reload schema';

-- =====================================================================
-- 8. Tâches planifiées (faites à part, avec le vrai secret) :
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--   select vault.create_secret('<secret>', 'agendia_rappels', 'Secret partagé avec Vercel (RAPPELS_SECRET)');
--
--   -- Chaque minute : demande à Vercel d'envoyer les rappels dus.
--   select cron.schedule('agendia-rappels', '* * * * *', $$
--     select net.http_post(
--       url := 'https://agendia-taches.vercel.app/api/rappels',
--       headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
--         'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'agendia_rappels')),
--       body := '{}'::jsonb, timeout_milliseconds := 20000);
--   $$);
--
--   -- Chaque nuit (4 h, heure UTC) : vide les corbeilles de plus de 30 jours
--   -- et le journal des rappels de plus de 3 jours.
--   select cron.schedule('agendia-menage', '0 4 * * *', $$
--     delete from public.taches where supprimee_le < now() - interval '30 days';
--     delete from public.rappels_envoyes where envoye_le < now() - interval '3 days';
--   $$);
-- =====================================================================
