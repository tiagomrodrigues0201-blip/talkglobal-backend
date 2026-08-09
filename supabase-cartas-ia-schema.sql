-- TalkGlobal Cartas IA MVP
-- Safe to apply in a new Supabase project before enabling /cartas.
-- User ownership uses Supabase Auth directly: public.*.user_id -> auth.users(id).

create extension if not exists pgcrypto;

create table if not exists public.player_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_name text not null,
  image_url text,
  description text not null,
  archetype_id text not null,
  archetype_name text not null,
  element_id text not null,
  element_name text not null,
  power_id text not null,
  power_name text not null,
  weapon_id text not null,
  weapon_name text not null,
  weapon_family text not null,
  ability_id text not null,
  ability_name text not null,
  rarity text not null check (rarity in ('comum', 'rara', 'lendaria', 'mitica')),
  rarity_label text not null,
  atk integer not null,
  def integer not null,
  spd integer not null,
  eng integer not null,
  hp integer not null,
  current_hp integer not null,
  level integer not null default 1,
  experience integer not null default 0,
  origin text not null default 'initial',
  source_type text not null default 'initial',
  is_initial boolean not null default false,
  initial_slot integer check (initial_slot is null or initial_slot between 1 and 3),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (atk between 1 and 180),
  check (def between 1 and 180),
  check (spd between 1 and 180),
  check (eng between 0 and 14),
  check (hp >= 1),
  check (hp <= 520),
  check (current_hp >= 0),
  check (current_hp <= hp),
  check (level >= 1),
  check (experience >= 0),
  check ((is_initial = true and initial_slot is not null and rarity = 'comum') or (is_initial = false and initial_slot is null)),
  constraint player_cards_user_id_id_key unique (user_id, id)
);

create table if not exists public.player_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null,
  slot integer not null check (slot between 1 and 3),
  updated_at timestamptz not null default now(),
  constraint player_decks_user_card_owner_fkey foreign key (user_id, card_id)
    references public.player_cards(user_id, id) on delete cascade,
  unique (user_id, slot),
  unique (user_id, card_id)
);

create table if not exists public.card_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_date date not null,
  kind text not null default 'initial',
  quantity integer not null default 3,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (quantity > 0),
  check (kind <> 'initial' or quantity = 3),
  unique (user_id, generation_date, kind)
);

create table if not exists public.player_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level_unlocked integer not null default 1,
  tutorial_completed boolean not null default false,
  victories integer not null default 0,
  battles integer not null default 0,
  resources integer not null default 0,
  updated_at timestamptz not null default now(),
  check (level_unlocked >= 1),
  check (victories >= 0),
  check (battles >= 0),
  check (resources >= 0)
);

create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'tutorial',
  status text not null default 'active',
  winner text,
  state jsonb not null default '{}'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_cards_user_id_id_key'
      and conrelid = 'public.player_cards'::regclass
  ) then
    alter table public.player_cards
      add constraint player_cards_user_id_id_key unique (user_id, id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'player_decks_user_card_owner_fkey'
      and conrelid = 'public.player_decks'::regclass
  ) then
    alter table public.player_decks
      add constraint player_decks_user_card_owner_fkey
      foreign key (user_id, card_id)
      references public.player_cards(user_id, id)
      on delete cascade;
  end if;
end $$;

create index if not exists player_cards_user_id_idx on public.player_cards(user_id);
create unique index if not exists player_cards_initial_slot_uidx
on public.player_cards(user_id, initial_slot)
where is_initial = true;
create index if not exists player_decks_user_id_idx on public.player_decks(user_id);
create index if not exists card_generations_user_date_idx on public.card_generations(user_id, generation_date);
create unique index if not exists card_generations_initial_once_uidx
on public.card_generations(user_id, kind)
where kind = 'initial';
create index if not exists player_progression_user_id_idx on public.player_progression(user_id);
create index if not exists battles_user_status_idx on public.battles(user_id, status);

create or replace function public.create_initial_card_set(
  p_user_id uuid,
  p_generation_date date,
  p_photo_profile jsonb,
  p_cards jsonb
)
returns table (
  created boolean,
  reason text,
  card jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cards_count integer;
  v_slots integer[];
  v_existing_count integer;
  v_deck_count integer;
  v_existing_cards jsonb;
  v_created_cards jsonb;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  if p_generation_date is null then
    raise exception 'p_generation_date is required';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'auth user % does not exist', p_user_id;
  end if;

  if pg_catalog.jsonb_typeof(p_cards) is distinct from 'array' then
    raise exception 'p_cards must be a JSON array';
  end if;

  select count(*)
  into v_cards_count
  from pg_catalog.jsonb_array_elements(p_cards);

  if v_cards_count <> 3 then
    raise exception 'initial card set must contain exactly 3 cards';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_cards) as item(card_data)
    where coalesce(item.card_data->>'rarity', '') <> 'comum'
      or coalesce((item.card_data->>'is_initial')::boolean, false) is not true
      or coalesce(item.card_data->>'initial_slot', '') !~ '^[1-3]$'
  ) then
    raise exception 'initial cards must be common, initial, and assigned to slots 1, 2 and 3';
  end if;

  select array_agg((item.card_data->>'initial_slot')::integer order by (item.card_data->>'initial_slot')::integer)
  into v_slots
  from pg_catalog.jsonb_array_elements(p_cards) as item(card_data);

  if v_slots <> array[1, 2, 3] then
    raise exception 'initial card slots must be exactly 1, 2 and 3';
  end if;

  if exists (
    select 1
    from public.card_generations
    where user_id = p_user_id
      and kind = 'initial'
  ) then
    select count(*), jsonb_agg(to_jsonb(cards.*) order by cards.initial_slot)
    into v_existing_count, v_existing_cards
    from public.player_cards as cards
    where cards.user_id = p_user_id
      and cards.is_initial = true;

    if v_existing_count <> 3 then
      raise exception 'initial generation already exists but initial card set is incomplete';
    end if;

    insert into public.player_decks (
      user_id,
      card_id,
      slot,
      updated_at
    )
    select
      p_user_id,
      cards.id,
      cards.initial_slot,
      now()
    from public.player_cards as cards
    where cards.user_id = p_user_id
      and cards.is_initial = true
    on conflict do nothing;

    select count(*)
    into v_deck_count
    from public.player_decks as decks
    join public.player_cards as cards
      on cards.user_id = decks.user_id
     and cards.id = decks.card_id
     and cards.initial_slot = decks.slot
    where decks.user_id = p_user_id
      and cards.is_initial = true;

    if v_deck_count <> 3 then
      raise exception 'initial generation already exists but initial deck is incomplete';
    end if;

    insert into public.player_progression (
      user_id,
      level_unlocked,
      tutorial_completed,
      victories,
      battles,
      resources,
      updated_at
    )
    values (
      p_user_id,
      1,
      false,
      0,
      0,
      0,
      now()
    )
    on conflict (user_id) do nothing;

    return query
    select false, 'initial_cards_already_created', item.card_data
    from pg_catalog.jsonb_array_elements(v_existing_cards) as item(card_data);
    return;
  end if;

  if exists (
    select 1
    from public.player_cards
    where user_id = p_user_id
      and is_initial = true
  ) then
    raise exception 'initial cards already exist without a generation record';
  end if;

  insert into public.card_generations (
    user_id,
    generation_date,
    kind,
    quantity,
    metadata,
    created_at
  )
  values (
    p_user_id,
    p_generation_date,
    'initial',
    3,
    jsonb_build_object('photoProfile', coalesce(p_photo_profile, '{}'::jsonb)),
    now()
  );

  with inserted_cards as (
    insert into public.player_cards (
      user_id,
      character_name,
      image_url,
      description,
      archetype_id,
      archetype_name,
      element_id,
      element_name,
      power_id,
      power_name,
      weapon_id,
      weapon_name,
      weapon_family,
      ability_id,
      ability_name,
      rarity,
      rarity_label,
      atk,
      def,
      spd,
      eng,
      hp,
      current_hp,
      level,
      experience,
      origin,
      source_type,
      is_initial,
      initial_slot,
      metadata,
      created_at,
      updated_at
    )
    select
      p_user_id,
      card_data->>'character_name',
      nullif(card_data->>'image_url', ''),
      card_data->>'description',
      card_data->>'archetype_id',
      card_data->>'archetype_name',
      card_data->>'element_id',
      card_data->>'element_name',
      card_data->>'power_id',
      card_data->>'power_name',
      card_data->>'weapon_id',
      card_data->>'weapon_name',
      card_data->>'weapon_family',
      card_data->>'ability_id',
      card_data->>'ability_name',
      card_data->>'rarity',
      card_data->>'rarity_label',
      (card_data->>'atk')::integer,
      (card_data->>'def')::integer,
      (card_data->>'spd')::integer,
      (card_data->>'eng')::integer,
      (card_data->>'hp')::integer,
      (card_data->>'current_hp')::integer,
      coalesce((card_data->>'level')::integer, 1),
      coalesce((card_data->>'experience')::integer, 0),
      coalesce(card_data->>'origin', 'initial'),
      coalesce(card_data->>'source_type', 'initial'),
      true,
      (card_data->>'initial_slot')::integer,
      coalesce(card_data->'metadata', '{}'::jsonb),
      now(),
      now()
    from pg_catalog.jsonb_array_elements(p_cards) as input(card_data)
    returning *
  )
  select jsonb_agg(to_jsonb(inserted_cards.*) order by inserted_cards.initial_slot)
  into v_created_cards
  from inserted_cards;

  if coalesce(pg_catalog.jsonb_array_length(v_created_cards), 0) <> 3 then
    raise exception 'initial card insert did not create exactly 3 cards';
  end if;

  insert into public.player_decks (
    user_id,
    card_id,
    slot,
    updated_at
  )
  select
    p_user_id,
    (item.card_data->>'id')::uuid,
    (item.card_data->>'initial_slot')::integer,
    now()
  from pg_catalog.jsonb_array_elements(v_created_cards) as item(card_data);

  insert into public.player_progression (
    user_id,
    level_unlocked,
    tutorial_completed,
    victories,
    battles,
    resources,
    updated_at
  )
  values (
    p_user_id,
    1,
    false,
    0,
    0,
    0,
    now()
  )
  on conflict (user_id) do nothing;

  return query
  select true, 'initial_cards_created', item.card_data
  from pg_catalog.jsonb_array_elements(v_created_cards) as item(card_data);
end;
$$;

revoke all on function public.create_initial_card_set(uuid, date, jsonb, jsonb) from public;
revoke all on function public.create_initial_card_set(uuid, date, jsonb, jsonb) from anon;
revoke all on function public.create_initial_card_set(uuid, date, jsonb, jsonb) from authenticated;
grant execute on function public.create_initial_card_set(uuid, date, jsonb, jsonb) to service_role;

alter table public.player_cards enable row level security;
alter table public.player_decks enable row level security;
alter table public.card_generations enable row level security;
alter table public.player_progression enable row level security;
alter table public.battles enable row level security;

-- The Express/Vercel APIs use the service-role key for validated actions.
-- Read policies allow future direct authenticated clients to inspect only their own game data.
drop policy if exists "Players can read own cards" on public.player_cards;
create policy "Players can read own cards" on public.player_cards
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players can read own decks" on public.player_decks;
create policy "Players can read own decks" on public.player_decks
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players can read own progression" on public.player_progression;
create policy "Players can read own progression" on public.player_progression
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players can read own battles" on public.battles;
create policy "Players can read own battles" on public.battles
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Players can read own generations" on public.card_generations;
create policy "Players can read own generations" on public.card_generations
for select to authenticated
using (auth.uid() = user_id);

-- No insert/update/delete policies are granted to anon/authenticated users.
-- Validated writes must go through the official server using the service-role key.
revoke all on public.player_cards from anon, authenticated;
revoke all on public.player_decks from anon, authenticated;
revoke all on public.card_generations from anon, authenticated;
revoke all on public.player_progression from anon, authenticated;
revoke all on public.battles from anon, authenticated;

grant select on public.player_cards to authenticated;
grant select on public.player_decks to authenticated;
grant select on public.card_generations to authenticated;
grant select on public.player_progression to authenticated;
grant select on public.battles to authenticated;

-- The backend uses the server-side Supabase client with the service_role key.
grant select on public.player_cards to service_role;
grant select, insert, delete on public.player_decks to service_role;
grant select, insert, update on public.player_progression to service_role;
grant select, insert, update on public.battles to service_role;
