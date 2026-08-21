-- Neon Tides Fishing: administrator-only configuration functions.
-- Apply after the base and secure transaction migrations.

create or replace function public.admin_set_game_setting(p_key text, p_value jsonb, p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare previous jsonb;
begin
  if not public.is_admin() then raise exception 'administrator role required'; end if;
  select value into previous from public.game_settings where key = p_key;
  insert into public.game_settings (key, value, description, updated_by) values (p_key, p_value, p_description, auth.uid())
  on conflict (key) do update set value = excluded.value, description = excluded.description, updated_by = auth.uid(), updated_at = now();
  insert into public.admin_activity_log (admin_id, action, target, previous_value, next_value) values (auth.uid(), 'update_game_setting', p_key, previous, p_value);
  return jsonb_build_object('ok', true, 'key', p_key);
end; $$;

create or replace function public.admin_set_fish_active(p_fish_id text, p_active boolean, p_weight numeric default null, p_sell_price integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare previous jsonb;
begin
  if not public.is_admin() then raise exception 'administrator role required'; end if;
  select jsonb_build_object('active', fs.active, 'catch_weight', fs.catch_weight, 'sell_price', item.sell_price) into previous from public.fish_species fs join public.item_definitions item on item.id = fs.id where fs.id = p_fish_id;
  if previous is null then raise exception 'fish not found'; end if;
  update public.fish_species set active = p_active, catch_weight = coalesce(p_weight, catch_weight) where id = p_fish_id;
  update public.item_definitions set sell_price = coalesce(p_sell_price, sell_price) where id = p_fish_id;
  insert into public.admin_activity_log (admin_id, action, target, previous_value, next_value) values (auth.uid(), 'update_fish', p_fish_id, previous, jsonb_build_object('active', p_active, 'catch_weight', p_weight, 'sell_price', p_sell_price));
  return jsonb_build_object('ok', true, 'id', p_fish_id);
end; $$;

create or replace function public.admin_set_zone_active(p_zone_id text, p_active boolean, p_required_level integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare previous jsonb;
begin
  if not public.is_admin() then raise exception 'administrator role required'; end if;
  select jsonb_build_object('active', active, 'required_level', required_level) into previous from public.zones where id = p_zone_id;
  if previous is null then raise exception 'zone not found'; end if;
  update public.zones set active = p_active, required_level = coalesce(p_required_level, required_level) where id = p_zone_id;
  insert into public.admin_activity_log (admin_id, action, target, previous_value, next_value) values (auth.uid(), 'update_zone', p_zone_id, previous, jsonb_build_object('active', p_active, 'required_level', p_required_level));
  return jsonb_build_object('ok', true, 'id', p_zone_id);
end; $$;

create or replace function public.admin_upsert_event(p_id uuid, p_name text, p_starts_at timestamptz, p_ends_at timestamptz, p_zones text[], p_modifiers jsonb, p_status public.event_status)
returns uuid language plpgsql security definer set search_path = public as $$
declare event_id uuid;
begin
  if not public.is_admin() then raise exception 'administrator role required'; end if;
  if p_ends_at <= p_starts_at then raise exception 'event end must follow start'; end if;
  if p_id is null then
    insert into public.seasonal_events (name, starts_at, ends_at, zones, modifiers, status, created_by) values (p_name, p_starts_at, p_ends_at, p_zones, p_modifiers, p_status, auth.uid()) returning id into event_id;
  else
    update public.seasonal_events set name = p_name, starts_at = p_starts_at, ends_at = p_ends_at, zones = p_zones, modifiers = p_modifiers, status = p_status, updated_at = now() where id = p_id returning id into event_id;
  end if;
  insert into public.admin_activity_log (admin_id, action, target, next_value) values (auth.uid(), 'upsert_event', event_id::text, jsonb_build_object('name', p_name, 'status', p_status));
  return event_id;
end; $$;

revoke all on function public.admin_set_game_setting(text, jsonb, text) from public;
revoke all on function public.admin_set_fish_active(text, boolean, numeric, integer) from public;
revoke all on function public.admin_set_zone_active(text, boolean, integer) from public;
revoke all on function public.admin_upsert_event(uuid, text, timestamptz, timestamptz, text[], jsonb, public.event_status) from public;
grant execute on function public.admin_set_game_setting(text, jsonb, text) to authenticated;
grant execute on function public.admin_set_fish_active(text, boolean, numeric, integer) to authenticated;
grant execute on function public.admin_set_zone_active(text, boolean, integer) to authenticated;
grant execute on function public.admin_upsert_event(uuid, text, timestamptz, timestamptz, text[], jsonb, public.event_status) to authenticated;
