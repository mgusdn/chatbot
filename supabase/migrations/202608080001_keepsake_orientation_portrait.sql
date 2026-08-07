begin;

-- The keepsake letters were re-designed around four finished artworks: two
-- portrait screens (feature phone, BuddyBuddy) and two landscape doodle cards.
-- The original table only ever allowed 'landscape', so widen the check and move
-- the column defaults onto the current template set.
alter table pume.keepsake_letters
    drop constraint if exists keepsake_letters_orientation_check;

alter table pume.keepsake_letters
    add constraint keepsake_letters_orientation_check
    check (orientation in ('landscape', 'portrait'));

alter table pume.keepsake_letters
    alter column template_id set default 'featurephone_v1',
    alter column sender_name set default '프바오',
    alter column sender_label set default '프바오';

commit;
