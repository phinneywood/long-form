create or replace function public.queue_resend_issue(
  p_user_id uuid,
  p_source_job_id uuid,
  p_email text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
declare
  source_job public.digest_jobs%rowtype;
  queued_id uuid;
begin
  if p_user_id is null
     or not exists (select 1 from public.app_users where id = p_user_id) then
    raise exception 'Long Form user not found';
  end if;

  if p_email is null or btrim(p_email) = '' then
    raise exception 'Send-to-Kindle email is not configured';
  end if;

  if p_source_job_id is null then
    raise exception 'Source delivery is required';
  end if;

  if p_idempotency_key is null
     or char_length(p_idempotency_key) > 240
     or p_idempotency_key not like ('resend:' || p_user_id::text || ':' || p_source_job_id::text || ':%') then
    raise exception 'Invalid resend idempotency key';
  end if;

  select *
    into source_job
    from public.digest_jobs
   where id = p_source_job_id
     and user_id = p_user_id;

  if source_job.id is null then
    raise exception 'Source delivery not found';
  end if;

  if source_job.status not in ('sent','partial')
     or source_job.reason not in ('scheduled','manual') then
    raise exception 'Source delivery is not eligible for exact resend';
  end if;

  if not exists (
    select 1
      from public.delivery_outbox
     where job_id = source_job.id
       and payload is not null
       and first_send_at is not null
       and provider_email_id is not null
  ) then
    raise exception 'Frozen issue is no longer available for exact resend';
  end if;

  insert into public.digest_jobs (
    user_id,
    reason,
    status,
    lookback_hours,
    idempotency_key,
    run_after,
    result
  )
  values (
    p_user_id,
    'manual',
    'queued',
    source_job.lookback_hours,
    p_idempotency_key,
    now(),
    jsonb_build_object(
      'resend_of_job_id', source_job.id,
      'resend_of_created_at', source_job.created_at,
      'resend_of_title', source_job.result->>'edition_title'
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into queued_id;

  if queued_id is null then
    select id
      into queued_id
      from public.digest_jobs
     where idempotency_key = p_idempotency_key
       and user_id = p_user_id
       and result->>'resend_of_job_id' = p_source_job_id::text;

    if queued_id is null then
      raise exception 'Idempotency key is already used by a different delivery';
    end if;
  end if;

  insert into public.delivery_outbox (job_id, payload)
  select queued_id,
         jsonb_set(
           source.payload,
           '{email,to}',
           to_jsonb(array[p_email]::text[]),
           true
         )
    from public.delivery_outbox source
   where source.job_id = source_job.id
     and source.payload is not null
  on conflict (job_id) do nothing;

  if not exists (
    select 1
      from public.delivery_outbox
     where job_id = queued_id
       and payload is not null
       and first_send_at is null
       and provider_email_id is null
  ) then
    raise exception 'Frozen issue is no longer available for exact resend';
  end if;

  return queued_id;
end;
$$;

revoke all on function public.queue_resend_issue(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.queue_resend_issue(uuid, uuid, text, text)
  to service_role;
