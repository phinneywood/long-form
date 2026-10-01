create table if not exists private.plugin_review_accounts (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  email text not null unique,
  password_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on private.plugin_review_accounts from public, anon, authenticated;
grant all on private.plugin_review_accounts to service_role;

create or replace function public.plugin_review_authenticate(
  p_email text,
  p_password_hash text
)
returns table(user_id uuid, email text)
language sql
security definer
set search_path = ''
as $$
  select r.user_id, r.email
  from private.plugin_review_accounts r
  where lower(r.email)=lower(p_email)
    and r.password_hash=p_password_hash
    and r.enabled=true
  limit 1
$$;

revoke all on function public.plugin_review_authenticate(text,text) from public, anon, authenticated;
grant execute on function public.plugin_review_authenticate(text,text) to service_role;
