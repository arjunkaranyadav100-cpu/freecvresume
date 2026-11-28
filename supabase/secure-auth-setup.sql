-- FreeCVResume secure creator authentication foundation
-- Creates profiles linked to Supabase Auth. Existing creator_wallets / study_notes data is untouched.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'creator' check (role in ('creator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- SECURITY DEFINER avoids recursive RLS evaluation when checking admin role.
create or replace function public.is_profile_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_profile_admin() from public, anon;
grant execute on function public.is_profile_admin() to authenticated;

drop policy if exists "Profiles: read own or admin" on public.profiles;
create policy "Profiles: read own or admin"
on public.profiles for select
to authenticated
using (auth.uid() = id or public.is_profile_admin());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists "Profiles: update own display name" on public.profiles;
create policy "Profiles: update own display name"
on public.profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

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

-- After creating your own Supabase Auth account, replace YOUR_ADMIN_EMAIL
-- with its exact verified email and run this statement separately:
-- update public.profiles
-- set role = 'admin', updated_at = now()
-- where id = (select id from auth.users where email = 'YOUR_ADMIN_EMAIL');
-- Never expose the service_role key in browser code.
