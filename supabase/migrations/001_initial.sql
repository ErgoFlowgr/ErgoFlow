-- Enable pgvector
create extension if not exists vector;

-- Settings
create table if not exists settings (
  id text primary key default 'main',
  owner_id uuid references auth.users(id) on delete cascade,
  company_name text,
  owner_name text,
  phone text,
  work_type text,
  ai_provider text default 'claude',
  ollama_url text default 'http://localhost:11434',
  language text default 'el',
  onboarding_complete boolean default false,
  briefing_time text default '08:00',
  briefing_enabled boolean default false,
  updated_at timestamptz default now()
);

alter table settings enable row level security;
create policy "owner only" on settings using (auth.uid() = owner_id);

-- Categories
create table if not exists categories (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name_el text not null,
  name_en text not null,
  color text default '#4f6ef7',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table categories enable row level security;
create policy "owner only" on categories using (auth.uid() = owner_id);

-- Customers
create table if not exists customers (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table customers enable row level security;
create policy "owner only" on customers using (auth.uid() = owner_id);

-- Calls
create table if not exists calls (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  vapi_call_id text unique,
  customer_id text references customers(id),
  customer_phone text,
  customer_name text,
  direction text default 'inbound',
  status text default 'completed',
  category_id text references categories(id),
  duration_seconds integer,
  transcript text,
  summary text,
  recording_url text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table calls enable row level security;
create policy "owner only" on calls using (auth.uid() = owner_id);

-- Webhook calls table (written by Edge Function — no RLS, uses service role)
create table if not exists vapi_webhook_calls (
  id text primary key,
  vapi_call_id text unique,
  payload jsonb,
  processed boolean default false,
  received_at timestamptz default now()
);

-- Documents
create table if not exists documents (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null,
  file_size integer,
  page_count integer,
  uploaded_at timestamptz default now()
);

alter table documents enable row level security;
create policy "owner only" on documents using (auth.uid() = owner_id);

-- Document chunks with pgvector
create table if not exists document_chunks (
  id text primary key,
  document_id text references documents(id) on delete cascade,
  content text not null,
  embedding vector(384),
  chunk_index integer,
  page_number integer
);

create index if not exists document_chunks_embedding_idx
  on document_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RLS: chunk access via document ownership
alter table document_chunks enable row level security;
create policy "owner only via document" on document_chunks
  using (
    exists (
      select 1 from documents d
      where d.id = document_id and d.owner_id = auth.uid()
    )
  );

-- Match chunks function for RAG
create or replace function match_document_chunks(
  query_embedding vector(384),
  match_count int default 5,
  p_owner_id uuid default null
)
returns table (content text, similarity float, chunk_index int)
language sql stable
as $$
  select
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity,
    dc.chunk_index
  from document_chunks dc
  join documents d on d.id = dc.document_id
  where d.owner_id = coalesce(p_owner_id, auth.uid())
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- Overseer log
create table if not exists overseer_log (
  id bigserial primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  checked_at timestamptz default now(),
  status text not null,
  checks jsonb not null,
  briefing text,
  errors jsonb
);

alter table overseer_log enable row level security;
create policy "owner only" on overseer_log using (auth.uid() = owner_id);

-- Indexes
create index if not exists calls_started_at_idx on calls(started_at desc);
create index if not exists customers_phone_idx on customers(phone);
create index if not exists overseer_log_date_idx on overseer_log(checked_at desc);
