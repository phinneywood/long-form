-- Large frozen media checkpoints and readable editions need the same bounded
-- backend write deadline as the immutable delivery outbox, not a role override.
create or replace function public.checkpoint_digest_preparation(p_job_id uuid,p_user_id uuid,p_manifest jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_catalog set statement_timeout='30s' as $$
begin
 if p_manifest is null or jsonb_typeof(p_manifest)<>'object' then raise exception 'Invalid preparation manifest'; end if;
 update public.digest_jobs set result=jsonb_set(result,'{preparation_manifest}',p_manifest,true) where id=p_job_id and user_id=p_user_id;
 if not found then raise exception 'Delivery job not found'; end if;
 return true;
end $$;
revoke all on function public.checkpoint_digest_preparation(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_digest_preparation(uuid,uuid,jsonb) to service_role;

create or replace function public.archive_publication_edition(p_job_id uuid,p_user_id uuid,p_kind text,p_title text,p_target_minutes integer,p_manifest jsonb,p_summary jsonb)
returns uuid language plpgsql security invoker set search_path=public,pg_catalog set statement_timeout='30s' as $$
declare prepared_at timestamptz; edition_id uuid;
begin
 select created_at into prepared_at from public.digest_jobs where id=p_job_id and user_id=p_user_id for update;
 if not found then raise exception 'Delivery job not found'; end if;
 if p_manifest is null or jsonb_typeof(p_manifest)<>'object' or p_summary is null or jsonb_typeof(p_summary)<>'object' then raise exception 'Invalid publication'; end if;
 insert into public.publication_editions(user_id,job_id,kind,title,target_minutes,manifest,summary,created_at)
 values(p_user_id,p_job_id,p_kind,p_title,p_target_minutes,p_manifest,p_summary,prepared_at)
 on conflict(job_id) do nothing returning id into edition_id;
 if edition_id is null then select id into edition_id from public.publication_editions where job_id=p_job_id and user_id=p_user_id; end if;
 if edition_id is null then raise exception 'Publication not found'; end if;
 return edition_id;
end $$;
revoke all on function public.archive_publication_edition(uuid,uuid,text,text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.archive_publication_edition(uuid,uuid,text,text,integer,jsonb,jsonb) to service_role;
