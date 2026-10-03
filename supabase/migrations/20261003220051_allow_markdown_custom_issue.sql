-- Keep database validation aligned with the API/worker document formats.
create or replace function public.queue_custom_issue(p_user_id uuid, p_issue jsonb, p_idempotency_key text)
returns table(job_id uuid, job_status text, created boolean, worker_request_id bigint)
language plpgsql security invoker set search_path = '' as $$
declare
  j public.digest_jobs%rowtype;
  was_created boolean := false;
  worker_id bigint := null;
begin
  if p_user_id is null or not exists(select 1 from public.app_users where id=p_user_id) then
    raise exception 'Long Form user not found';
  end if;
  if not exists(select 1 from public.user_settings where user_id=p_user_id and kindle_email is not null and btrim(kindle_email::text)<>'') then
    raise exception 'Send-to-Kindle email is not configured';
  end if;
  if p_issue is null or jsonb_typeof(p_issue)<>'object' or jsonb_typeof(p_issue->'title') is distinct from 'string'
     or char_length(btrim(p_issue->>'title')) not between 1 and 80
     or jsonb_typeof(p_issue->'sections') is distinct from 'array'
     or jsonb_array_length(p_issue->'sections') not between 1 and 20
     or octet_length(p_issue::text)>2000000 then
    raise exception 'Invalid custom issue';
  end if;
  if exists(select 1 from jsonb_array_elements(p_issue->'sections') as s
    where jsonb_typeof(s->'title') is distinct from 'string' or char_length(btrim(s->>'title')) not between 1 and 200
      or jsonb_typeof(s->'content') is distinct from 'string' or char_length(btrim(s->>'content')) not between 1 and 250000
      or coalesce(s->>'format','text') not in ('text','html','markdown')) then
    raise exception 'Invalid custom issue section';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ ('^custom-issue:'||p_user_id::text||':[A-Za-z0-9._:-]{1,120}$') then
    raise exception 'Invalid custom issue idempotency key';
  end if;
  insert into public.digest_jobs(user_id,reason,status,lookback_hours,idempotency_key,run_after,packet_name,custom_issue)
  values(p_user_id,'one_time','queued',168,p_idempotency_key,now(),btrim(p_issue->>'title'),p_issue)
  on conflict(idempotency_key) do nothing returning * into j;
  if j.id is not null then was_created:=true;
  else
    select * into j from public.digest_jobs where idempotency_key=p_idempotency_key;
    if j.id is null then raise exception 'Custom issue could not be queued'; end if;
    if j.user_id<>p_user_id or j.reason<>'one_time' or j.custom_issue is distinct from p_issue then
      raise exception 'Idempotency key is already used by a different issue';
    end if;
  end if;
  if was_created or j.status='queued' then worker_id:=public.kick_digest_worker(); end if;
  return query select j.id,j.status,was_created,worker_id;
end;
$$;
revoke all on function public.queue_custom_issue(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.queue_custom_issue(uuid,jsonb,text) to service_role;
