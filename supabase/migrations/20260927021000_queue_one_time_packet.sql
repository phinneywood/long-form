create or replace function public.queue_one_time_packet(
  p_user_id uuid,
  p_packet_name text,
  p_article_urls jsonb,
  p_idempotency_key text
)
returns table (
  job_id uuid,
  job_status text,
  created boolean,
  worker_request_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued_job public.digest_jobs%rowtype;
  was_created boolean := false;
  worker_id bigint := null;
begin
  if p_user_id is null
     or not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'Long Form user not found';
  end if;

  if not exists (
    select 1
    from public.user_settings
    where user_id = p_user_id
      and kindle_email is not null
      and btrim(kindle_email::text) <> ''
  ) then
    raise exception 'Send-to-Kindle email is not configured';
  end if;

  if p_packet_name is null
     or char_length(btrim(p_packet_name)) < 1
     or char_length(btrim(p_packet_name)) > 80 then
    raise exception 'Packet name must be 1-80 characters';
  end if;

  if p_article_urls is null
     or jsonb_typeof(p_article_urls) <> 'array'
     or jsonb_array_length(p_article_urls) < 1
     or jsonb_array_length(p_article_urls) > 20 then
    raise exception 'Article URLs must be an array containing 1-20 URLs';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_article_urls) as item
    where jsonb_typeof(item) <> 'string'
       or (item #>> '{}') !~ '^https?://'
  ) then
    raise exception 'Every article URL must be an http(s) URL';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key) > 240
     or p_idempotency_key not like ('one-time:' || p_user_id::text || ':%') then
    raise exception 'Invalid one-time packet idempotency key';
  end if;

  insert into public.digest_jobs (
    user_id,
    reason,
    status,
    lookback_hours,
    idempotency_key,
    run_after,
    packet_name,
    article_urls
  )
  values (
    p_user_id,
    'one_time',
    'queued',
    168,
    p_idempotency_key,
    now(),
    btrim(p_packet_name),
    p_article_urls
  )
  on conflict (idempotency_key) do nothing
  returning * into queued_job;

  if queued_job.id is not null then
    was_created := true;
  else
    select *
    into queued_job
    from public.digest_jobs
    where idempotency_key = p_idempotency_key;

    if queued_job.id is null then
      raise exception 'One-time packet could not be queued';
    end if;

    if queued_job.user_id <> p_user_id
       or queued_job.reason <> 'one_time'
       or queued_job.packet_name <> btrim(p_packet_name)
       or queued_job.article_urls <> p_article_urls then
      raise exception 'Idempotency key is already used by a different packet';
    end if;
  end if;

  if was_created or queued_job.status = 'queued' then
    worker_id := public.kick_digest_worker();
  end if;

  return query
  select queued_job.id, queued_job.status, was_created, worker_id;
end;
$$;

revoke all on function public.queue_one_time_packet(uuid, text, jsonb, text)
  from public, anon, authenticated;

grant execute on function public.queue_one_time_packet(uuid, text, jsonb, text)
  to service_role;
