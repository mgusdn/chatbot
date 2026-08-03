begin;

create schema if not exists pume;
revoke all on schema pume from public;
revoke all on schema pume from anon;
revoke all on schema pume from authenticated;

create table if not exists pume.memory_schema_migrations (
    version integer primary key,
    applied_at double precision not null
);

create table if not exists pume.memory_rooms (
    id text primary key,
    slug text not null unique,
    title text not null,
    scene_version integer not null default 1,
    theme_id text not null default 'prometheus-coast',
    visibility text not null default 'public'
        check (visibility in ('public', 'private')),
    revision bigint not null default 0,
    created_at double precision not null,
    updated_at double precision not null
);

create table if not exists pume.memory_entries (
    id text primary key,
    room_id text not null references pume.memory_rooms(id) on delete cascade,
    kind text not null check (kind in ('note', 'mood', 'story')),
    body_plaintext text not null,
    emotion text,
    card_style text not null,
    author_alias text not null,
    ownership_token_hash text not null,
    visibility text not null default 'public'
        check (visibility in ('public', 'private')),
    moderation_status text not null default 'visible'
        check (moderation_status in ('visible', 'pending', 'hidden', 'deleted')),
    moderation_reason text,
    reaction_count integer not null default 0,
    report_count integer not null default 0,
    version integer not null default 1,
    created_at double precision not null,
    updated_at double precision not null,
    deleted_at double precision,
    design_json text,
    design_version integer,
    client_request_id text,
    creator_hash text,
    request_fingerprint text
);

create index if not exists memory_entries_room_feed_idx
    on pume.memory_entries(room_id, moderation_status, created_at desc, id desc);
create unique index if not exists memory_entries_idempotency_idx
    on pume.memory_entries(room_id, creator_hash, client_request_id)
    where creator_hash is not null and client_request_id is not null;

create table if not exists pume.memory_placements (
    entry_id text primary key references pume.memory_entries(id) on delete cascade,
    surface_id text not null,
    u double precision not null check (u >= 0 and u <= 1),
    v double precision not null check (v >= 0 and v <= 1),
    rotation_deg double precision not null check (rotation_deg >= -180 and rotation_deg <= 180),
    scale double precision not null check (scale >= 0.75 and scale <= 1.35),
    z_index integer not null check (z_index >= 0 and z_index <= 1000),
    version integer not null default 1,
    updated_at double precision not null
);

create index if not exists memory_placements_surface_idx
    on pume.memory_placements(surface_id, z_index, entry_id);

create table if not exists pume.memory_reactions (
    entry_id text not null references pume.memory_entries(id) on delete cascade,
    reactor_hash text not null,
    created_at double precision not null,
    primary key (entry_id, reactor_hash)
);

create table if not exists pume.memory_reports (
    id text primary key,
    entry_id text not null references pume.memory_entries(id) on delete cascade,
    reporter_hash text not null,
    category text not null,
    created_at double precision not null,
    unique (entry_id, reporter_hash)
);

create index if not exists memory_reports_entry_idx
    on pume.memory_reports(entry_id, created_at);

create table if not exists pume.memory_rate_events (
    id text primary key,
    actor_hash text not null,
    action text not null,
    created_at double precision not null
);

create index if not exists memory_rate_events_actor_idx
    on pume.memory_rate_events(actor_hash, action, created_at);
create index if not exists memory_rate_events_created_idx
    on pume.memory_rate_events(created_at);

create table if not exists pume.memory_relocation_requests (
    entry_id text not null references pume.memory_entries(id) on delete cascade,
    client_request_id text not null,
    request_fingerprint text not null,
    expected_version integer not null check (expected_version >= 1),
    result_version integer not null check (result_version >= 1),
    actor_hash text not null,
    created_at double precision not null,
    primary key (entry_id, client_request_id)
);

create index if not exists memory_relocation_requests_created_idx
    on pume.memory_relocation_requests(created_at);

insert into pume.memory_schema_migrations(version, applied_at)
values (100, extract(epoch from now()))
on conflict (version) do nothing;

-- This is the only browser-readable database object. It deliberately carries
-- no guestbook content, ownership hashes, visitor hashes, or moderation data.
create table if not exists public.memory_room_revisions (
    slug text primary key,
    revision bigint not null,
    updated_at timestamptz not null default now()
);

alter table public.memory_room_revisions enable row level security;
revoke all on table public.memory_room_revisions from anon, authenticated;
grant select on table public.memory_room_revisions to anon, authenticated;

drop policy if exists "public memory room revisions are readable" on public.memory_room_revisions;
create policy "public memory room revisions are readable"
    on public.memory_room_revisions
    for select
    to anon, authenticated
    using (true);

create or replace function public.sync_memory_room_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.memory_room_revisions(slug, revision, updated_at)
    values (new.slug, new.revision, to_timestamp(new.updated_at))
    on conflict (slug) do update
    set revision = excluded.revision,
        updated_at = excluded.updated_at;
    return new;
end;
$$;

revoke all on function public.sync_memory_room_revision() from public;

drop trigger if exists memory_room_revision_signal on pume.memory_rooms;
create trigger memory_room_revision_signal
after insert or update of revision on pume.memory_rooms
for each row execute function public.sync_memory_room_revision();

insert into public.memory_room_revisions(slug, revision, updated_at)
select slug, revision, to_timestamp(updated_at)
from pume.memory_rooms
on conflict (slug) do update
set revision = excluded.revision,
    updated_at = excluded.updated_at;

do $$
begin
    if exists (
        select 1 from pg_publication where pubname = 'supabase_realtime'
    ) and not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'memory_room_revisions'
    ) then
        execute 'alter publication supabase_realtime add table public.memory_room_revisions';
    end if;
end;
$$;

commit;
