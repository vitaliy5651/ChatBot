-- Database schema for demo (Postgres / Supabase)
-- Apply in Supabase SQL editor.

-- Enable extensions
create extension if not exists "pgcrypto";

-- Chats
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chats_user_updated_idx on public.chats (user_id, updated_at desc);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  images jsonb,
  documents jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_chat_created_idx on public.messages (chat_id, created_at asc);

-- Anonymous usage tracking (for guest quota)
create table if not exists public.anonymous_usage (
  anonymous_id text primary key,
  count int not null default 0,
  updated_at timestamptz not null default now()
);

-- RLS (recommended). Since the demo uses a service role key on the server,
-- client access to these tables is not required. Still, we enable RLS for safety.
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.anonymous_usage enable row level security;

-- If you want direct client access later, add policies here.

