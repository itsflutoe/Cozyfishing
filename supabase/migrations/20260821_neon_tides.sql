-- Neon Tides Fishing: Supabase schema, access controls, and trusted game mutations.
-- Apply this file in the Supabase SQL Editor or through the Supabase CLI.

create extension if not exists pgcrypto;

create type public.player_role as enum ('player', 'admin');
create type public.item_category as enum ('rod', 'food', 'bait', 'fish', 'boost', 'misc');
create type public.rarity_tier as enum ('common', 'uncommon', 'rare', 'legendary');
create type public.event_status as enum ('scheduled', 'active', 'ended', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 18),
  role public.player_role not null default 'player',
  coins integer not null default 80 check (coins >= 0),
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  stamina integer not null default 100 check (stamina >= 0),
  max_stamina integer not null default 100 check (max_stamina > 0),
  current_zone_id text not null default 'harbor-hub',
  tutorial_complete boolean not null default false,
  suspended_at timestamptz,
  banned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.zones (
  id text primary key,
  name text not null,
  description text not null,
  required_level integer not null default 1 check (required_level > 0),
  active boolean not null default true,
  capacity integer not null default 200 check (capacity > 0),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.item_definitions (
  id text primary key,
  name text not null,
  description text not null default '',
  category public.item_category not null,
  icon_key text not null default 'item',
  stack_limit integer not null default 99 check (stack_limit > 0),
  sell_price integer not null default 0 check (sell_price >= 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.fish_species (
  id text primary key references public.item_definitions(id) on delete restrict,
  rarity public.rarity_tier not null,
  difficulty numeric(5,2) not null default 1 check (difficulty > 0),
  movement_behavior jsonb not null default '{"speed": 1}'::jsonb,
  catch_weight numeric(10,3) not null check (catch_weight > 0),
  minimum_level integer not null default 1 check (minimum_level > 0),
  active boolean not null default true,
  future_conditions jsonb not null default '{}'::jsonb
);

create table public.zone_fish_pools (
  zone_id text not null references public.zones(id) on delete cascade,
  fish_id text not null references public.fish_species(id) on delete cascade,
  weight_multiplier numeric(10,3) not null default 1 check (weight_multiplier > 0),
  active boolean not null default true,
  primary key (zone_id, fish_id)
);

create table public.shops (
  id text primary key,
  zone_id text not null references public.zones(id) on delete restrict,
  name text not null,
  active boolean not null default true
);

create table public.shop_offers (
  id uuid primary key default gen_random_uuid(),
  shop_id text not null references public.shops(id) on delete cascade,
  item_id text not null references public.item_definitions(id) on delete restrict,
  buy_price integer not null check (buy_price >= 0),
  required_level integer not null default 1 check (required_level > 0),
  active boolean not null default true,
  unique (shop_id, item_id)
);

create table public.inventory_stacks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.item_definitions(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (player_id, item_id, metadata)
);

create table public.storage_stacks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.item_definitions(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (player_id, item_id, metadata)
);

create table public.player_rods (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.item_definitions(id) on delete restrict,
  durability integer not null check (durability >= 0),
  max_durability integer not null check (max_durability > 0),
  equipped boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_equipped_rod_per_player on public.player_rods(player_id) where equipped;

create table public.fishing_attempts (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  zone_id text not null references public.zones(id) on delete restrict,
  equipped_rod_id uuid references public.player_rods(id) on delete set null,
  request_id uuid not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  settled_at timestamptz,
  outcome_fish_id text references public.fish_species(id) on delete set null,
  unique (player_id, request_id)
);

create table public.game_transactions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  kind text not null,
  coin_delta integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_id, request_id, kind)
);

create table public.trade_sessions (
  id uuid primary key default gen_random_uuid(),
  proposer_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'open', 'confirmed', 'cancelled', 'expired')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now(),
  check (proposer_id <> recipient_id)
);

create table public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trade_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.item_definitions(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  unique (trade_id, player_id, item_id)
);

create table public.game_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.seasonal_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status public.event_status not null default 'scheduled',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  zones text[] not null default '{}',
  modifiers jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.world_update_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null unique,
  ran_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);

create table public.admin_activity_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target text not null,
  previous_value jsonb,
  next_value jsonb,
  created_at timestamptz not null default now()
);

create index profiles_zone_idx on public.profiles(current_zone_id);
create index inventory_owner_idx on public.inventory_stacks(player_id);
create index storage_owner_idx on public.storage_stacks(player_id);
create index attempts_owner_idx on public.fishing_attempts(player_id, expires_at desc);
create index transactions_owner_idx on public.game_transactions(player_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.zones enable row level security;
alter table public.item_definitions enable row level security;
alter table public.fish_species enable row level security;
alter table public.zone_fish_pools enable row level security;
alter table public.shops enable row level security;
alter table public.shop_offers enable row level security;
alter table public.inventory_stacks enable row level security;
alter table public.storage_stacks enable row level security;
alter table public.player_rods enable row level security;
alter table public.fishing_attempts enable row level security;
alter table public.game_transactions enable row level security;
alter table public.trade_sessions enable row level security;
alter table public.trade_offers enable row level security;
alter table public.game_settings enable row level security;
alter table public.seasonal_events enable row level security;
alter table public.world_update_runs enable row level security;
alter table public.admin_activity_log enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and banned_at is null);
$$;

create policy "profiles own read" on public.profiles for select using (id = auth.uid());
create policy "profiles own update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid() and role = 'player');
create policy "active zones readable" on public.zones for select using (active or public.is_admin());
create policy "active items readable" on public.item_definitions for select using (active or public.is_admin());
create policy "active fish readable" on public.fish_species for select using (active or public.is_admin());
create policy "active zone fish readable" on public.zone_fish_pools for select using (active or public.is_admin());
create policy "active shops readable" on public.shops for select using (active or public.is_admin());
create policy "active offers readable" on public.shop_offers for select using (active or public.is_admin());
create policy "own inventory read" on public.inventory_stacks for select using (player_id = auth.uid());
create policy "own storage read" on public.storage_stacks for select using (player_id = auth.uid());
create policy "own rods read" on public.player_rods for select using (player_id = auth.uid());
create policy "own attempts read" on public.fishing_attempts for select using (player_id = auth.uid());
create policy "own transaction read" on public.game_transactions for select using (player_id = auth.uid());
create policy "trades participant read" on public.trade_sessions for select using (proposer_id = auth.uid() or recipient_id = auth.uid());
create policy "trade offers participant read" on public.trade_offers for select using (exists (select 1 from public.trade_sessions t where t.id = trade_id and (t.proposer_id = auth.uid() or t.recipient_id = auth.uid())));
create policy "settings readable" on public.game_settings for select using (true);
create policy "events readable" on public.seasonal_events for select using (status in ('scheduled', 'active') or public.is_admin());
create policy "admin logs admin read" on public.admin_activity_log for select using (public.is_admin());
create policy "world updates admin read" on public.world_update_runs for select using (public.is_admin());
-- There are intentionally no direct client write policies for money, inventory, rods, attempts, events, or content.

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger zones_touch before update on public.zones for each row execute function public.touch_updated_at();
create trigger item_definitions_touch before update on public.item_definitions for each row execute function public.touch_updated_at();
create trigger game_settings_touch before update on public.game_settings for each row execute function public.touch_updated_at();
create trigger seasonal_events_touch before update on public.seasonal_events for each row execute function public.touch_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare generated_name text;
begin
  generated_name := coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), 'angler_' || substr(new.id::text, 1, 6));
  insert into public.profiles (id, username) values (new.id, generated_name);
  insert into public.inventory_stacks (player_id, item_id, quantity) values
    (new.id, 'fish-bait', 10), (new.id, 'lunch', 5)
  on conflict do nothing;
  insert into public.player_rods (player_id, item_id, durability, max_durability, equipped)
    values (new.id, 'basic-rod', 100, 100, true);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

create or replace function public.begin_fishing_attempt(p_zone_id text, p_request_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare attempt_id uuid; profile_row public.profiles; rod_row public.player_rods;
begin
  select * into profile_row from public.profiles where id = auth.uid() for update;
  if profile_row.id is null or profile_row.banned_at is not null or profile_row.suspended_at is not null then raise exception 'profile unavailable'; end if;
  if profile_row.stamina < 7 then raise exception 'not enough stamina'; end if;
  if not exists (select 1 from public.zones where id = p_zone_id and active and required_level <= profile_row.level) then raise exception 'zone unavailable'; end if;
  select * into rod_row from public.player_rods where player_id = auth.uid() and equipped for update;
  if rod_row.id is null or rod_row.durability < 1 then raise exception 'equipped rod is unavailable'; end if;
  update public.profiles set stamina = stamina - 7, current_zone_id = p_zone_id where id = auth.uid();
  update public.player_rods set durability = durability - 1 where id = rod_row.id;
  insert into public.fishing_attempts (player_id, zone_id, equipped_rod_id, request_id) values (auth.uid(), p_zone_id, rod_row.id, p_request_id)
    on conflict (player_id, request_id) do update set request_id = excluded.request_id returning id into attempt_id;
  return attempt_id;
end; $$;

create or replace function public.apply_daily_world_update()
returns jsonb language plpgsql security definer set search_path = public as $$
declare today date := current_date; changed integer := 0; result jsonb;
begin
  insert into public.world_update_runs (run_date, summary) values (today, '{}'::jsonb) on conflict (run_date) do nothing;
  if not found then return jsonb_build_object('ok', true, 'skipped', 'already-ran', 'date', today); end if;
  update public.seasonal_events set status = 'active' where status = 'scheduled' and starts_at <= now() and ends_at > now(); get diagnostics changed = row_count;
  update public.seasonal_events set status = 'ended' where status in ('scheduled', 'active') and ends_at <= now();
  result := jsonb_build_object('ok', true, 'date', today, 'activated_events', changed, 'rotation_seed', extract(doy from current_date));
  update public.world_update_runs set summary = result where run_date = today;
  return result;
end; $$;

revoke all on function public.begin_fishing_attempt(text, uuid) from public;
grant execute on function public.begin_fishing_attempt(text, uuid) to authenticated;
revoke all on function public.apply_daily_world_update() from public;

insert into public.zones (id, name, description, required_level, settings) values
  ('harbor-hub', 'Harbor Hub', 'Shared spawn, shop, chest, and docks.', 1, '{"map":"harbor"}'),
  ('glasswater-lake', 'Glasswater Lake', 'Starter fishing lake.', 1, '{"map":"glasswater"}'),
  ('moonlit-inlet', 'Moonlit Inlet', 'A difficult glowing inlet.', 3, '{"map":"moonlit"}')
on conflict (id) do nothing;

insert into public.item_definitions (id, name, description, category, icon_key, stack_limit, sell_price, metadata) values
  ('basic-rod', 'Basic Rod', 'A reliable starter rod.', 'rod', 'rod', 1, 0, '{"max_durability":100,"durability_cost":1}'),
  ('tide-rod', 'Tide Rod', 'A better rod for future unlocks.', 'rod', 'rod', 1, 50, '{"max_durability":180,"durability_cost":1,"luck_bonus":0.04}'),
  ('fish-bait', 'Fish Bait', 'Improves bite conditions.', 'bait', 'bait', 99, 2, '{"bite_bonus":0.12,"rare_bonus":0.03,"duration_seconds":90}'),
  ('lunch', 'Lunch', 'Restores energy.', 'food', 'lunch', 20, 4, '{"stamina_restore":30}'),
  ('lucky-charm', 'Lucky Charm', 'A temporary luck boost.', 'boost', 'charm', 10, 12, '{"rare_bonus":0.08,"duration_seconds":120}'),
  ('carp', 'Carp', 'A gentle common catch.', 'fish', 'fish-carp', 99, 14, '{}'),
  ('bluegill', 'Bluegill', 'A quick lake fish.', 'fish', 'fish-bluegill', 99, 25, '{}'),
  ('catfish', 'Catfish', 'A powerful bottom feeder.', 'fish', 'fish-catfish', 99, 55, '{}'),
  ('golden-carp', 'Golden Carp', 'A legendary flash of gold.', 'fish', 'fish-golden', 99, 180, '{}'),
  ('neon-koi', 'Neon Koi', 'A radiant inlet koi.', 'fish', 'fish-koi', 99, 82, '{}'),
  ('moon-eel', 'Moon Eel', 'A rare deepwater visitor.', 'fish', 'fish-eel', 99, 220, '{}')
on conflict (id) do nothing;

insert into public.fish_species (id, rarity, difficulty, catch_weight, minimum_level) values
  ('carp', 'common', 1, 55, 1), ('bluegill', 'uncommon', 1.4, 30, 1), ('catfish', 'rare', 2.1, 12, 1),
  ('golden-carp', 'legendary', 3.5, 3, 1), ('neon-koi', 'rare', 2.5, 14, 3), ('moon-eel', 'legendary', 4, 2, 3)
on conflict (id) do nothing;

insert into public.zone_fish_pools (zone_id, fish_id) values
  ('harbor-hub', 'carp'), ('harbor-hub', 'bluegill'), ('glasswater-lake', 'carp'), ('glasswater-lake', 'bluegill'),
  ('glasswater-lake', 'catfish'), ('glasswater-lake', 'golden-carp'), ('moonlit-inlet', 'catfish'),
  ('moonlit-inlet', 'golden-carp'), ('moonlit-inlet', 'neon-koi'), ('moonlit-inlet', 'moon-eel')
on conflict do nothing;

insert into public.shops (id, zone_id, name) values ('harbor-tackle', 'harbor-hub', 'Neon Tackle Shop') on conflict do nothing;
insert into public.shop_offers (shop_id, item_id, buy_price, required_level) values
  ('harbor-tackle', 'fish-bait', 8, 1), ('harbor-tackle', 'lunch', 18, 1), ('harbor-tackle', 'tide-rod', 120, 2), ('harbor-tackle', 'lucky-charm', 40, 2)
on conflict do nothing;

insert into public.game_settings (key, value, description) values
  ('fishing', '{"base_bite_chance":0.65,"wait_min_ms":1500,"wait_max_ms":3300,"cast_stamina_cost":7,"rod_durability_cost":1,"catch_gain_per_second":28,"catch_loss_per_second":18}', 'Core fishing controls displayed in the admin panel.'),
  ('starter_rewards', '{"coins":80,"rod":"basic-rod","bait_quantity":10,"lunch_quantity":5,"storage_slots":12}', 'Rewards automatically granted to a newly registered angler.'),
  ('world_schedule', '{"timezone":"UTC","daily_world_update":"0 5 * * *"}', 'Daily Vercel cron reconciliation schedule. Hobby timing is approximate.')
on conflict (key) do nothing;
