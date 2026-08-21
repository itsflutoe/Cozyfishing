# GitHub, Vercel, and Supabase Deployment

## 1. Create the Supabase project

Create a free Supabase project, then run `supabase/migrations/20260821_neon_tides.sql` in the SQL Editor. In **Authentication**, enable the sign-in providers you want to use and set the site URL to the eventual Vercel domain. Add local and production redirect URLs as needed. The migration creates profiles, item and fish content, inventory and storage tables, security policies, trusted functions, starter rewards, and the daily world-update function.

After creating an account, promote the first game administrator with the following statement, replacing the UUID with the user ID from the Supabase Authentication screen:

```sql
update public.profiles set role = 'admin' where id = 'YOUR-USER-UUID';
```

## 2. Configure GitHub and Vercel

Create a GitHub repository and push this project. Import it into Vercel as a Vite project. Vercel reads `vercel.json`, generates the static application with `pnpm build:vercel`, and schedules one daily secure request to `/api/cron/daily-world-update`.

Set the following environment variables in Vercel. The first two are visible to the browser; the service-role key and cron secret must remain server-only.

| Variable | Location | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel environment | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Vercel environment | Browser-authenticated Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel environment | Daily world update only; never expose to the client |
| `CRON_SECRET` | Vercel environment | Authorizes the daily scheduled request |

## 3. Free-tier operational rules

The project uses Supabase Realtime per zone and does not require an always-on Vercel server. Keep zone messages compact, do not broadcast private fishing minigame data, and monitor the Supabase Realtime message count during playtests. Vercel Hobby runs scheduled jobs only once per day with an approximate delivery time, so seasonal events and fish rotations are reconciled daily rather than at minute precision.

## 4. Required completion step

To activate live sign-in, persistent saves, realtime channels, and the daily scheduled job, provide the Supabase URL and publishable key. The service-role key and cron secret should be entered directly into Vercel rather than sent in chat.
