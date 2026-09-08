-- Run this ONCE in Supabase SQL Editor to enable synced habit ordering.

alter table public.habits
add column if not exists sort_order integer not null default 0;

with numbered as (
  select id, row_number() over (partition by user_id order by created_at, id) - 1 as new_order
  from public.habits
)
update public.habits h
set sort_order = numbered.new_order
from numbered
where h.id = numbered.id;

-- Realtime is needed for instant order changes on other open devices.
alter publication supabase_realtime add table public.habits;
alter publication supabase_realtime add table public.habit_completions;
