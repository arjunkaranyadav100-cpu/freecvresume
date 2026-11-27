-- FreeCVResume secure creator authentication foundation
-- Run this entire file in Supabase Dashboard -> SQL Editor.
-- This creates a profile linked to Supabase Auth. It does NOT change or delete
-- existing creator_wallets / study_notes data.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'creator' check (role in ('creator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile; admins can read all profiles.
drop policy if exists "Profiles: read own or admin" on public.profiles;
create policy "Profiles: read own or admin"
on public.profiles for select
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1 from public.profiles as admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.role = 'admin'
  )
);

-- Users may update only their display name. Role is deliberately not granted.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "Profiles: update own display name" on public.profiles;
create policy "Profiles: update own display name"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Create a creator profile automatically after Supabase Auth signup.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'creator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- IMPORTANT: After creating your own account with Supabase Auth, replace
-- YOUR_ADMIN_EMAIL below with that exact verified email and run this
-- statement separately in the SQL Editor. Never expose the service_role key
-- in index.html or any browser code.
-- update public.profiles
-- set role = 'admin', updated_at = now()
-- where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
