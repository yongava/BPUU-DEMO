create table if not exists public.workflow_tickets (
  ticket_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_tickets_updated_at_idx
  on public.workflow_tickets (updated_at desc);

comment on table public.workflow_tickets is 'Workflow tickets for BPUU overnight and related service flows';

alter table public.workflow_tickets enable row level security;
