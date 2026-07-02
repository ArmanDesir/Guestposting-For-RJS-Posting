create table if not exists public.scheduled_posts (
  id text primary key,
  date timestamptz not null,
  slug text not null,
  platform text not null,
  action text not null default 'manual',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  result jsonb,
  constraint scheduled_posts_status_check check (status in ('pending', 'completed', 'failed')),
  constraint scheduled_posts_action_check check (action in ('manual', 'draft', 'publish'))
);

create index if not exists scheduled_posts_due_idx
  on public.scheduled_posts (status, date);

alter table public.scheduled_posts enable row level security;

drop policy if exists "service role can manage scheduled posts" on public.scheduled_posts;
create policy "service role can manage scheduled posts"
  on public.scheduled_posts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
