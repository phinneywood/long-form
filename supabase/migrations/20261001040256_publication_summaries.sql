-- Lists and editorial context must not load every frozen article image/body.
-- The complete immutable manifest remains available only on article reads.
alter table public.publication_editions add column summary jsonb;
update public.publication_editions e set summary=(e.manifest-'items')||jsonb_build_object('items',coalesce((select jsonb_agg(item-'body'-'assets') from jsonb_array_elements(e.manifest->'items') item),'[]'::jsonb));

create or replace function public.publication_job_status(p_user_id uuid,p_job_id uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_catalog as $$
 select jsonb_build_object('job',jsonb_build_object('id',j.id,'status',j.status,'error',j.error,'finished_at',j.finished_at,'result',jsonb_build_object('articles',j.result->'articles','issues',j.result->'issues','publication_id',j.result->'publication_id')),'edition_id',(select e.id from public.publication_editions e where e.user_id=p_user_id and e.job_id=j.id))
 from public.digest_jobs j where j.id=p_job_id and j.user_id=p_user_id;
$$;
revoke all on function public.publication_job_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.publication_job_status(uuid,uuid) to service_role;
