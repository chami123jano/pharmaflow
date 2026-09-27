-- Adds the shop's own identity to the cloud mirror.
--
-- Run this once in the SQL editor if you set the database up before this table
-- existed. It is already included in schema.sql for a fresh project.
--
-- Why it exists: the website used to take its name and logo from build
-- settings, so changing either meant remembering a variable in Cloudflare and
-- redeploying. Reading it from here means the till is the only place any of it
-- is ever typed, and the site follows the next time the till syncs.

create table if not exists shop (
  id         int primary key default 1,
  name       text,
  address    text,
  phone      text,
  regno      text,
  footer     text,
  logo       text,
  updated_at timestamptz not null default now(),
  constraint shop_is_one_row check (id = 1)
);

alter table shop enable row level security;

-- Deliberately readable by anyone, signed in or not: the login screen has to
-- show the shop's name before there is a session, and everything in this row
-- is already on the shop's signboard and on every receipt. There is no write
-- policy at all, so only the till — which connects with the service key and
-- bypasses these rules — can change it.
drop policy if exists shop_is_public on shop;
create policy shop_is_public on shop for select using (true);

grant select on shop to anon, authenticated;

-- Check it worked. Empty until the till next syncs.
select * from shop;
