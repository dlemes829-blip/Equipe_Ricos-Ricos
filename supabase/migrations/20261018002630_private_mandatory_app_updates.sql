create table public.amanda_app_release (id integer primary key check (id = 1), payload jsonb not null);
alter table public.amanda_app_release enable row level security;
revoke all on public.amanda_app_release from public, anon, authenticated;
grant all on public.amanda_app_release to service_role;
create table public.amanda_update_drafts (user_id uuid primary key references public.amanda_users(id) on delete cascade, payload jsonb not null);
alter table public.amanda_update_drafts enable row level security;
revoke all on public.amanda_update_drafts from public, anon, authenticated;
grant all on public.amanda_update_drafts to service_role;
