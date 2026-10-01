-- Large, reviewed EPUBs can exceed PostgREST's default eight-second write
-- deadline. Give only this backend-owned immutable freeze a bounded timeout;
-- do not change role/global limits or return megabytes through the API again.
create or replace function public.freeze_delivery_payload(p_job_id uuid,p_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_catalog set statement_timeout='30s' as $$
declare frozen public.delivery_outbox%rowtype;
begin
 perform 1 from public.digest_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found then raise exception 'Delivery job not found'; end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Invalid delivery payload'; end if;
 insert into public.delivery_outbox(job_id,payload) values(p_job_id,p_payload) on conflict(job_id) do nothing;
 select * into frozen from public.delivery_outbox where job_id=p_job_id;
 if frozen.payload is distinct from p_payload then raise exception 'Frozen delivery payload cannot be replaced'; end if;
 return jsonb_build_object('first_send_at',frozen.first_send_at,'provider_email_id',frozen.provider_email_id);
end $$;
revoke all on function public.freeze_delivery_payload(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.freeze_delivery_payload(uuid,uuid,jsonb) to service_role;
