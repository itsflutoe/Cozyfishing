# Implementation Memory

- The user requested a GitHub, Vercel, and Supabase deployment path that remains free for a small prototype.
- The existing initial full-stack scaffold uses a different authentication/database stack, so the repository will be converted to a Vercel-compatible React/Vite client with Supabase environment variables and migration SQL.
- Supabase Free is appropriate for a limited playtest with location-scoped realtime, but it is not a high-volume public game backend. Compact messages and throttled movement are mandatory.
- Vercel Hobby cron is limited to one execution per day with non-exact hourly timing. The seasonal/fish update system is therefore designed as a single daily idempotent reconciliation task; high-frequency timed events are out of free-tier scope.
- Generated art is hosted outside the project tree through project storage and referenced by its immutable storage URL.
- User requirements override the generic game pipeline engine preference: Phaser, rather than Babylon, is the rendering engine for this project.
