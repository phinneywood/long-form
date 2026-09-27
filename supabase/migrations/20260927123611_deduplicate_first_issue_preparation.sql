-- Concurrent clicks or tabs must share one active preparation for a reader.
create unique index digest_jobs_one_active_first_preview
on public.digest_jobs(user_id)
where reason='first_run_preview' and status in ('queued','running');
