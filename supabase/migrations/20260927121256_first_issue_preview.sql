-- Prepare a first issue without sending. The outbox is frozen at review time.
alter table public.digest_jobs drop constraint digest_jobs_reason_check;
alter table public.digest_jobs add constraint digest_jobs_reason_check
  check (reason in ('scheduled','manual','test','one_time','first_run_preview'));
alter table public.digest_jobs drop constraint digest_jobs_status_check;
alter table public.digest_jobs add constraint digest_jobs_status_check
  check (status in ('queued','running','ready','sent','empty','partial','failed','expired'));

-- Called only by the authenticated API's service-role client. Both the
-- recipient selection and queue transition occur under one row lock.
create or replace function public.queue_first_issue(
  p_user_id uuid, p_job_id uuid, p_email text, p_idempotency_key text
) returns uuid language plpgsql security definer
set search_path = public, pg_catalog as $$
declare v_job public.digest_jobs%rowtype;
begin
  select * into v_job from public.digest_jobs
    where id = p_job_id and user_id = p_user_id for update;
  if not found then raise exception 'First issue not found'; end if;
  if v_job.reason = 'manual' and v_job.status in ('queued','running','sent','partial','empty') then
    return v_job.id;
  end if;
  if v_job.reason <> 'first_run_preview' or v_job.status <> 'ready' then
    raise exception 'First issue is not ready for sending';
  end if;
  if exists (select 1 from public.digest_jobs newer
    where newer.user_id = p_user_id and newer.reason = 'first_run_preview'
      and (newer.created_at, newer.id) > (v_job.created_at, v_job.id)) then
    raise exception 'A newer first issue is being prepared';
  end if;
  if not exists (select 1 from public.delivery_outbox
    where job_id = p_job_id and payload is not null and first_send_at is null
      and provider_email_id is null for update) then
    raise exception 'Prepared issue has expired; prepare it again';
  end if;
  update public.delivery_outbox
    set payload = jsonb_set(payload, '{email,to}', to_jsonb(array[p_email]), true)
    where job_id = p_job_id;
  update public.digest_jobs
    set reason = 'manual', status = 'queued', idempotency_key = p_idempotency_key,
      run_after = now(), error = null
    where id = p_job_id;
  return p_job_id;
end $$;
revoke all on function public.queue_first_issue(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.queue_first_issue(uuid,uuid,text,text) to service_role;

-- Abandoned drafts retain original article text and an EPUB attachment.
select cron.schedule('expire-first-issue-previews', '40 3 * * *', $$
  update public.delivery_outbox o set payload = null
  from public.digest_jobs j
  where o.job_id = j.id and j.reason = 'first_run_preview'
    and j.created_at < now() - interval '14 days' and o.payload is not null;
  update public.digest_jobs set status = 'expired',
    result = result - 'preparation_manifest', finished_at = now()
  where reason = 'first_run_preview' and status = 'ready'
    and created_at < now() - interval '14 days';
$$);
