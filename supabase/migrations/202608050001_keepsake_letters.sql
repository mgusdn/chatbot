begin;

create table if not exists pume.keepsake_letters (
    id text primary key,
    share_token_hash text not null unique,
    recipient_name text not null,
    recipient_modifier text not null,
    recipient_label text not null,
    phrase_id text not null,
    phrase_text text not null,
    hashtags text[] not null check (cardinality(hashtags) = 3),
    sender_name text not null default '푸바오',
    sender_label text not null default '푸바오가.',
    template_id text not null default 'red_flower_v1',
    template_version integer not null default 1,
    orientation text not null default 'landscape'
        check (orientation in ('landscape')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    downloaded_at timestamptz
);

create index if not exists keepsake_letters_expiry_idx
    on pume.keepsake_letters(expires_at);

-- Tokens are resolved only by FastAPI. No counseling-derived letter content is
-- exposed through Supabase's browser-readable schemas or roles.
revoke all on table pume.keepsake_letters from public, anon, authenticated;

commit;
