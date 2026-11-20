-- Yoon Fleet — remise à zéro du schéma public avant installation.
-- ATTENTION : supprime DÉFINITIVEMENT toutes les tables, vues, fonctions et types
-- du schéma public (données du POC Flotte365 comprises). Exportez d'abord ce que
-- vous voulez garder. Les comptes (auth.users) et les fichiers (storage) ne sont pas touchés.

do $$
declare r record;
begin
  -- Vues
  for r in select viewname from pg_views where schemaname = 'public' loop
    execute format('drop view if exists public.%I cascade', r.viewname);
  end loop;
  -- Tables (et leurs déclencheurs, politiques RLS, index)
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;
  -- Fonctions, sauf celles qui appartiennent à une extension
  for r in
    select p.oid::regprocedure as f
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop routine if exists %s cascade', r.f);
  end loop;
  -- Types (enums de l'ancienne application), sauf ceux des extensions
  for r in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typtype in ('e', 'c', 'd')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
      and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;
end $$;
