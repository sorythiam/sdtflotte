# Yoon Fleet

Logiciel SaaS de gestion de flotte et de location de véhicules pour l'Afrique (Tabibou Business Group).
Successeur de Flotte365, reconstruit en React + TypeScript avec un schéma Supabase multi-entreprise.

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # règles métier et services
npm run build
```

Sans variables d'environnement, l'application tourne en **mode démo** : données fictives
stockées dans le navigateur. À la connexion, le mot de passe choisit le profil
(`direction`, `agent`, `comptable`, `mecanicien`).

## Brancher Supabase

1. Dans l'éditeur SQL du projet Supabase, exécuter `supabase/reset.sql` puis `supabase/schema.sql`.
   `reset.sql` efface tout le schéma public (ex-tables Flotte365 comprises) ; les comptes et fichiers restent.
   Les deux scripts peuvent être relancés sans erreur.
2. Dans Authentication › URL Configuration, mettre `https://yoonfleet.vercel.app` comme Site URL.
3. Définir dans Vercel (ou `.env.local`) :
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. Chaque inscription crée une organisation isolée (RLS) avec 30 jours d'essai, formule Pro,
   quota de 10 véhicules et une grille de tarifs par défaut.

Garanties en base : isolation par organisation (RLS), aucune réservation active qui se chevauche
sur un même véhicule (contrainte d'exclusion), quota de véhicules, formule et quota non modifiables
par le client.

## Organisation du code

| Dossier | Contenu |
| --- | --- |
| `src/domain` | Types métier, règles (tarifs, chevauchements, retards, frais de retour, alertes) et formats FR |
| `src/data` | Interface `Store`, mode démo, adaptateur Supabase, services (création de réservation) |
| `src/state` | Contexte React : session, données, droits par profil |
| `src/pages` | Écrans : tableau de bord, planning, réservations et contrats, véhicules, clients, maintenance, tarifs |
| `supabase/schema.sql` | Schéma multi-entreprise et règles RLS |

## Charte

Couleurs, typographies (Sora, Inter), espacements et arrondis du design system Yoon Fleet
dans `src/styles/app.css`.

## Prochaines étapes (spécification produit)

- Couche de paiement multi-agrégateur (InTouch, PayDunya, Bictorys) et liens de paiement
- État des lieux mobile avec photos, signature et mode hors-ligne
- Import Excel des véhicules et clients, export SYSCOHADA
- Notifications WhatsApp, console Yoon Fleet, gestion des utilisateurs
