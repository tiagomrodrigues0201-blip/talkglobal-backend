-- TalkGlobal Cartas IA MVP
-- Apply in Supabase before enabling /cartas generation and tutorial battle.

create extension if not exists pgcrypto;

create table if not exists public.player_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
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
  check (hp between 1 and 520),
  check (current_hp between 0 and 520),
  check ((is_initial = true and initial_slot is not null and rarity = 'comum') or (is_initial = false and initial_slot is null))
);

create table if not exists public.player_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  card_id uuid not null references public.player_cards(id) on delete cascade,
  slot integer not null check (slot between 1 and 3),
  updated_at timestamptz not null default now(),
  unique (user_id, slot),
  unique (user_id, card_id)
);

create table if not exists public.card_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  generation_date date not null,
  kind text not null default 'initial',
  quantity integer not null default 3,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, generation_date, kind)
);

create table if not exists public.player_progression (
  user_id uuid primary key references public.users(id) on delete cascade,
  level_unlocked integer not null default 1,
  tutorial_completed boolean not null default false,
  victories integer not null default 0,
  battles integer not null default 0,
  resources integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.battles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mode text not null default 'tutorial',
  status text not null default 'active',
  winner text,
  state jsonb not null default '{}'::jsonb,
  rewards jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists player_cards_user_id_idx on public.player_cards(user_id);
create unique index if not exists player_cards_initial_slot_uidx
on public.player_cards(user_id, initial_slot)
where is_initial = true;
create index if not exists player_decks_user_id_idx on public.player_decks(user_id);
create index if not exists card_generations_user_date_idx on public.card_generations(user_id, generation_date);
create index if not exists battles_user_status_idx on public.battles(user_id, status);

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
using (exists (
  select 1 from public.users u
  where u.id = player_cards.user_id
  and u.auth_user_id = auth.uid()
));

drop policy if exists "Players can read own decks" on public.player_decks;
create policy "Players can read own decks" on public.player_decks
for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = player_decks.user_id
  and u.auth_user_id = auth.uid()
));

drop policy if exists "Players can read own progression" on public.player_progression;
create policy "Players can read own progression" on public.player_progression
for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = player_progression.user_id
  and u.auth_user_id = auth.uid()
));

drop policy if exists "Players can read own battles" on public.battles;
create policy "Players can read own battles" on public.battles
for select to authenticated
using (exists (
  select 1 from public.users u
  where u.id = battles.user_id
  and u.auth_user_id = auth.uid()
));

-- No insert/update/delete policies are granted to anon/authenticated users.
-- Validated writes must go through the official server using the service-role key.
