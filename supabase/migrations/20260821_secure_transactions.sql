-- Neon Tides Fishing: authoritative transactional game mutations.
-- Apply after 20260821_neon_tides.sql.

create or replace function public.add_inventory_stack(p_player_id uuid, p_item_id text, p_quantity integer, p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  insert into public.inventory_stacks (player_id, item_id, quantity, metadata)
  values (p_player_id, p_item_id, p_quantity, p_metadata)
  on conflict (player_id, item_id, metadata) do update set quantity = public.inventory_stacks.quantity + excluded.quantity, updated_at = now();
end; $$;

create or replace function public.settle_fishing_attempt(p_attempt_id uuid, p_request_id uuid, p_client_score integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  attempt public.fishing_attempts;
  total_weight numeric;
  random_value numeric;
  cumulative_weight numeric := 0;
  fish_row record;
  selected_fish_id text;
  selected_fish_name text;
  selected_rarity public.rarity_tier;
  selected_value integer;
  selected_difficulty numeric;
  xp_gain integer;
  result jsonb;
begin
  if p_client_score < 75 or p_client_score > 100 then raise exception 'invalid catch score'; end if;
  select * into attempt from public.fishing_attempts where id = p_attempt_id and player_id = auth.uid() for update;
  if attempt.id is null then raise exception 'attempt not found'; end if;
  if attempt.settled_at is not null then
    select payload into result from public.game_transactions where player_id = auth.uid() and kind = 'fish_catch' and payload ->> 'attempt_id' = p_attempt_id::text order by created_at desc limit 1;
    if result is null then raise exception 'settled attempt record is unavailable'; end if;
    return result;
  end if;
  if attempt.expires_at < now() then raise exception 'attempt expired'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid() and banned_at is null and suspended_at is null) then raise exception 'profile unavailable'; end if;
  select coalesce(sum(fs.catch_weight * pool.weight_multiplier), 0) into total_weight
  from public.zone_fish_pools pool join public.fish_species fs on fs.id = pool.fish_id
  join public.profiles p on p.id = auth.uid()
  where pool.zone_id = attempt.zone_id and pool.active and fs.active and fs.minimum_level <= p.level;
  if total_weight <= 0 then raise exception 'no fish are currently available'; end if;
  random_value := random() * total_weight;
  for fish_row in
    select fs.id, fs.rarity, fs.difficulty, item.name, item.sell_price, fs.catch_weight * pool.weight_multiplier as weighted_catch_weight
    from public.zone_fish_pools pool join public.fish_species fs on fs.id = pool.fish_id
    join public.item_definitions item on item.id = fs.id
    join public.profiles p on p.id = auth.uid()
    where pool.zone_id = attempt.zone_id and pool.active and fs.active and item.active and fs.minimum_level <= p.level
    order by fs.id
  loop
    cumulative_weight := cumulative_weight + fish_row.weighted_catch_weight;
    if cumulative_weight >= random_value then
      selected_fish_id := fish_row.id;
      selected_fish_name := fish_row.name;
      selected_rarity := fish_row.rarity;
      selected_value := fish_row.sell_price;
      selected_difficulty := fish_row.difficulty;
      exit;
    end if;
  end loop;
  if selected_fish_id is null then raise exception 'fish selection failed'; end if;
  xp_gain := greatest(8, round(selected_difficulty * 12));
  perform public.add_inventory_stack(auth.uid(), selected_fish_id, 1);
  update public.profiles set xp = xp + xp_gain, level = greatest(level, 1 + floor((xp + xp_gain) / 100)) where id = auth.uid();
  update public.fishing_attempts set settled_at = now(), outcome_fish_id = selected_fish_id where id = attempt.id;
  result := jsonb_build_object('attempt_id', p_attempt_id, 'id', selected_fish_id, 'name', selected_fish_name, 'rarity', selected_rarity, 'value', selected_value, 'xp', xp_gain);
  insert into public.game_transactions (player_id, request_id, kind, payload)
  values (auth.uid(), p_request_id, 'fish_catch', result)
  on conflict (player_id, request_id, kind) do nothing;
  return result;
end; $$;

create or replace function public.purchase_shop_item(p_offer_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare offer public.shop_offers; item public.item_definitions; buyer public.profiles;
begin
  select * into offer from public.shop_offers where id = p_offer_id and active for update;
  if offer.id is null then raise exception 'offer unavailable'; end if;
  select * into item from public.item_definitions where id = offer.item_id and active;
  select * into buyer from public.profiles where id = auth.uid() for update;
  if buyer.id is null or buyer.coins < offer.buy_price or buyer.level < offer.required_level then raise exception 'purchase requirements not met'; end if;
  if exists (select 1 from public.game_transactions where player_id = auth.uid() and request_id = p_request_id and kind = 'shop_purchase') then
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  update public.profiles set coins = coins - offer.buy_price where id = auth.uid();
  perform public.add_inventory_stack(auth.uid(), item.id, 1);
  insert into public.game_transactions (player_id, request_id, kind, coin_delta, payload) values (auth.uid(), p_request_id, 'shop_purchase', -offer.buy_price, jsonb_build_object('item_id', item.id, 'name', item.name));
  return jsonb_build_object('ok', true, 'item_id', item.id, 'coins_spent', offer.buy_price);
end; $$;

create or replace function public.sell_inventory_fish(p_stack_id uuid, p_quantity integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare stack public.inventory_stacks; item public.item_definitions; sale_value integer;
begin
  if p_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  select * into stack from public.inventory_stacks where id = p_stack_id and player_id = auth.uid() for update;
  if stack.id is null or stack.quantity < p_quantity then raise exception 'inventory stack unavailable'; end if;
  select * into item from public.item_definitions where id = stack.item_id and category = 'fish';
  if item.id is null then raise exception 'only fish can be sold'; end if;
  if exists (select 1 from public.game_transactions where player_id = auth.uid() and request_id = p_request_id and kind = 'fish_sale') then return jsonb_build_object('ok', true, 'idempotent', true); end if;
  sale_value := item.sell_price * p_quantity;
  if stack.quantity = p_quantity then delete from public.inventory_stacks where id = stack.id; else update public.inventory_stacks set quantity = quantity - p_quantity, updated_at = now() where id = stack.id; end if;
  update public.profiles set coins = coins + sale_value where id = auth.uid();
  insert into public.game_transactions (player_id, request_id, kind, coin_delta, payload) values (auth.uid(), p_request_id, 'fish_sale', sale_value, jsonb_build_object('item_id', item.id, 'quantity', p_quantity));
  return jsonb_build_object('ok', true, 'coins_earned', sale_value);
end; $$;

create or replace function public.use_consumable(p_stack_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare stack public.inventory_stacks; item public.item_definitions; recovery integer;
begin
  select * into stack from public.inventory_stacks where id = p_stack_id and player_id = auth.uid() for update;
  if stack.id is null or stack.quantity < 1 then raise exception 'item unavailable'; end if;
  select * into item from public.item_definitions where id = stack.item_id and category in ('food', 'bait', 'boost');
  if item.id is null then raise exception 'item cannot be used'; end if;
  if exists (select 1 from public.game_transactions where player_id = auth.uid() and request_id = p_request_id and kind = 'consumable_use') then return jsonb_build_object('ok', true, 'idempotent', true); end if;
  recovery := coalesce((item.metadata ->> 'stamina_restore')::integer, 0);
  if stack.quantity = 1 then delete from public.inventory_stacks where id = stack.id; else update public.inventory_stacks set quantity = quantity - 1, updated_at = now() where id = stack.id; end if;
  update public.profiles set stamina = least(max_stamina, stamina + recovery) where id = auth.uid();
  insert into public.game_transactions (player_id, request_id, kind, payload) values (auth.uid(), p_request_id, 'consumable_use', jsonb_build_object('item_id', item.id, 'stamina_restored', recovery));
  return jsonb_build_object('ok', true, 'stamina_restored', recovery);
end; $$;

create or replace function public.move_inventory_to_storage(p_stack_id uuid, p_quantity integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare stack public.inventory_stacks; slots integer;
begin
  if p_quantity <= 0 then raise exception 'quantity must be positive'; end if;
  select * into stack from public.inventory_stacks where id = p_stack_id and player_id = auth.uid() for update;
  if stack.id is null or stack.quantity < p_quantity then raise exception 'inventory stack unavailable'; end if;
  select count(*) into slots from public.storage_stacks where player_id = auth.uid();
  if slots >= coalesce((select (value ->> 'storage_slots')::integer from public.game_settings where key = 'starter_rewards'), 12) and not exists (select 1 from public.storage_stacks where player_id = auth.uid() and item_id = stack.item_id and metadata = stack.metadata) then raise exception 'storage capacity reached'; end if;
  if exists (select 1 from public.game_transactions where player_id = auth.uid() and request_id = p_request_id and kind = 'storage_transfer') then return jsonb_build_object('ok', true, 'idempotent', true); end if;
  insert into public.storage_stacks (player_id, item_id, quantity, metadata) values (auth.uid(), stack.item_id, p_quantity, stack.metadata) on conflict (player_id, item_id, metadata) do update set quantity = public.storage_stacks.quantity + excluded.quantity, updated_at = now();
  if stack.quantity = p_quantity then delete from public.inventory_stacks where id = stack.id; else update public.inventory_stacks set quantity = quantity - p_quantity, updated_at = now() where id = stack.id; end if;
  insert into public.game_transactions (player_id, request_id, kind, payload) values (auth.uid(), p_request_id, 'storage_transfer', jsonb_build_object('item_id', stack.item_id, 'quantity', p_quantity));
  return jsonb_build_object('ok', true);
end; $$;

revoke all on function public.add_inventory_stack(uuid, text, integer, jsonb) from public;
revoke all on function public.settle_fishing_attempt(uuid, uuid, integer) from public;
revoke all on function public.purchase_shop_item(uuid, uuid) from public;
revoke all on function public.sell_inventory_fish(uuid, integer, uuid) from public;
revoke all on function public.use_consumable(uuid, uuid) from public;
revoke all on function public.move_inventory_to_storage(uuid, integer, uuid) from public;
grant execute on function public.settle_fishing_attempt(uuid, uuid, integer) to authenticated;
grant execute on function public.purchase_shop_item(uuid, uuid) to authenticated;
grant execute on function public.sell_inventory_fish(uuid, integer, uuid) to authenticated;
grant execute on function public.use_consumable(uuid, uuid) to authenticated;
grant execute on function public.move_inventory_to_storage(uuid, integer, uuid) to authenticated;
