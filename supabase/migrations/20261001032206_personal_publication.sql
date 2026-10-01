-- Backend-owned publication and editor records. Browser/MCP identity is always
-- validated by the existing session layer; no direct client database access.
create table public.publication_editions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_users(id) on delete cascade,
 job_id uuid unique references public.digest_jobs(id) on delete set null,
 kind text not null check(kind in ('daily','tonight','packet')),
 title text not null,
 target_minutes integer not null default 30 check(target_minutes between 10 and 120),
 manifest jsonb not null,
 created_at timestamptz not null default now()
);
create index publication_editions_user_created_idx on public.publication_editions(user_id,created_at desc);
create table public.reader_articles (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_users(id) on delete cascade,
 url text not null,
 article jsonb not null,
 created_at timestamptz not null default now(),
 unique(user_id,url)
);
create table public.reading_states (
 user_id uuid not null references public.app_users(id) on delete cascade,
 article_key text not null,
 progress real not null default 0 check(progress between 0 and 1),
 paragraph integer not null default 0 check(paragraph >= 0),
 saved boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(user_id,article_key)
);
create table public.editor_conversations (
 user_id uuid primary key references public.app_users(id) on delete cascade,
 temporary_guidance text not null default '',
 updated_at timestamptz not null default now()
);
create table public.editor_messages (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.app_users(id) on delete cascade,
 request_key text not null,
 question text not null,
 response jsonb not null,
 proposed_guidance text,
 confirmed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(user_id,request_key)
);
create index editor_messages_user_created_idx on public.editor_messages(user_id,created_at desc);
alter table public.user_settings add column evening_editorial_instructions text not null default '';
alter table public.publication_editions enable row level security;
alter table public.reader_articles enable row level security;
alter table public.reading_states enable row level security;
alter table public.editor_conversations enable row level security;
alter table public.editor_messages enable row level security;
revoke all on public.publication_editions,public.reader_articles,public.reading_states,public.editor_conversations,public.editor_messages from anon,authenticated;
grant all on public.publication_editions,public.reader_articles,public.reading_states,public.editor_conversations,public.editor_messages to service_role;
alter table public.digest_jobs drop constraint digest_jobs_reason_check;
alter table public.digest_jobs add constraint digest_jobs_reason_check check(reason in ('scheduled','manual','test','one_time','first_run_preview','publication_preview'));
create unique index publication_preview_active_user_key on public.digest_jobs(user_id) where reason='publication_preview' and status in ('queued','running');

-- Clone the exact reviewed payload atomically. No refetch, no alternate user,
-- no mutation of the publication, and no automatic send on composition.
create or replace function public.queue_publication_delivery(p_user_id uuid,p_edition_id uuid,p_request_key text)
returns uuid language plpgsql security invoker set search_path=public,pg_catalog as $$
declare edition public.publication_editions%rowtype; recipient text; queued_id uuid; key text;
begin
 select * into edition from public.publication_editions where id=p_edition_id and user_id=p_user_id;
 if edition.id is null then raise exception 'Publication not found'; end if;
 select kindle_email::text into recipient from public.user_settings where user_id=p_user_id;
 if coalesce(recipient,'')='' then raise exception 'Add your Send-to-Kindle address first'; end if;
 if p_request_key is null or char_length(p_request_key) not between 8 and 120 then raise exception 'Invalid delivery request key'; end if;
 key:='publication:'||p_user_id::text||':'||p_edition_id::text||':'||p_request_key;
 select id into queued_id from public.digest_jobs where idempotency_key=key and user_id=p_user_id;
 if queued_id is not null then return queued_id; end if;
 if not exists(select 1 from public.delivery_outbox where job_id=edition.job_id and payload is not null) then raise exception 'Frozen edition expired; cannot send exact edition'; end if;
 insert into public.digest_jobs(user_id,reason,status,idempotency_key,run_after,result)
 values(p_user_id,'manual','queued',key,now(),jsonb_build_object('publication_id',edition.id,'publication_kind',edition.kind))
 on conflict(idempotency_key) do nothing returning id into queued_id;
 if queued_id is null then select id into queued_id from public.digest_jobs where idempotency_key=key and user_id=p_user_id; end if;
 insert into public.delivery_outbox(job_id,payload)
 select queued_id,jsonb_set(payload,'{email,to}',to_jsonb(array[recipient]),true) from public.delivery_outbox where job_id=edition.job_id and payload is not null
 on conflict(job_id) do nothing;
 if not exists(select 1 from public.delivery_outbox where job_id=queued_id and payload is not null) then raise exception 'Frozen edition expired'; end if;
 return queued_id;
end $$;
revoke all on function public.queue_publication_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.queue_publication_delivery(uuid,uuid,text) to service_role;

create or replace function public.confirm_editor_guidance(p_user_id uuid,p_message_id uuid)
returns boolean language plpgsql security invoker set search_path=public,pg_catalog as $$
declare message public.editor_messages%rowtype;
begin
 select * into message from public.editor_messages where id=p_message_id and user_id=p_user_id for update;
 if message.id is null or message.proposed_guidance is null then raise exception 'Preference proposal not found'; end if;
 if message.confirmed_at is not null then return true; end if;
 update public.user_settings set evening_editorial_instructions=message.proposed_guidance where user_id=p_user_id and evening_editorial_instructions=coalesce(message.response->>'base_guidance','');
 if not found then raise exception 'Nighttime preferences changed; ask the editor for a new proposal'; end if;
 update public.editor_messages set confirmed_at=now() where id=message.id and user_id=p_user_id;
 return true;
end $$;
revoke all on function public.confirm_editor_guidance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.confirm_editor_guidance(uuid,uuid) to service_role;

-- The publication exists even when Kindle delivery is paused. Reuse the
-- worker's existing cadence; no second scheduler or new infrastructure.
create or replace function public.queue_due_web_publications(p_now timestamptz default now())
returns integer language plpgsql security invoker set search_path=public,pg_catalog as $$
declare account record; day_key date; queued integer:=0;
begin
 for account in select u.* from public.user_settings u where u.onboarding_complete
 and (p_now at time zone u.timezone)::time >= u.delivery_time
 and exists(select 1 from public.feeds f where f.user_id=u.user_id and f.enabled and f.archived_at is null)
 and (u.paused or u.kindle_email is null) order by u.user_id limit 50
 loop
  day_key:=(p_now at time zone account.timezone)::date;
  if exists(select 1 from public.digest_jobs j where j.user_id=account.user_id and j.reason='publication_preview' and j.status in ('queued','running')) then continue; end if;
  insert into public.digest_jobs(user_id,reason,lookback_hours,idempotency_key,run_after,result)
  values(account.user_id,'publication_preview',48,format('web-daily:%s:%s',account.user_id,day_key),p_now,jsonb_build_object('publication_kind','daily','target_minutes',30))
  on conflict do nothing;
  if found then queued:=queued+1; end if;
 end loop;
 return queued;
end $$;
revoke all on function public.queue_due_web_publications(timestamptz) from public,anon,authenticated;
grant execute on function public.queue_due_web_publications(timestamptz) to service_role;

-- Partial updates preserve saved state and reading position atomically.
create or replace function public.update_reading_state(p_user_id uuid,p_article_key text,p_progress real default null,p_paragraph integer default null,p_saved boolean default null)
returns boolean language sql security invoker set search_path=public,pg_catalog as $$
 insert into public.reading_states(user_id,article_key,progress,paragraph,saved)
 values(p_user_id,p_article_key,coalesce(p_progress,0),coalesce(p_paragraph,0),coalesce(p_saved,false))
 on conflict(user_id,article_key) do update set
 progress=coalesce(p_progress,reading_states.progress),paragraph=coalesce(p_paragraph,reading_states.paragraph),
 saved=coalesce(p_saved,reading_states.saved),updated_at=now() returning true;
$$;
revoke all on function public.update_reading_state(uuid,text,real,integer,boolean) from public,anon,authenticated;
grant execute on function public.update_reading_state(uuid,text,real,integer,boolean) to service_role;
