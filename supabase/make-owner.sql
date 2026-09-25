-- Give a login its role. Run this in the SQL editor AFTER creating the person
-- under Authentication -> Users.
--
-- Until a login has a row in app_users it can sign in and see nothing at all:
-- every policy in schema.sql checks this table. That is deliberate. A new
-- account is powerless until someone says otherwise.
--
-- There is exactly one line to edit in each block, marked EDIT THIS. Change
-- only what is between the quotes, and leave the quotes alone.

-- ------------------------------------------------------------- the owner ---
-- Sees takings, reports and profit, and can edit products.
do $$
declare
  target_email text := 'CHANGE-ME@example.com';   -- EDIT THIS
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(target_email));

  -- Saying so beats inserting nothing and looking like it worked.
  if uid is null then
    raise exception
      'No login exists for "%". Create it first under Authentication -> Users, then run this again.',
      target_email;
  end if;

  insert into app_users (user_id, role) values (uid, 'owner')
  on conflict (user_id) do update set role = 'owner';

  raise notice '% is now the owner.', target_email;
end $$;

-- -------------------------------------------------------------- a helper ---
-- A cashier or family member: stock and product details only, never money.
-- Remove the /* and */ around this block to use it.
/*
do $$
declare
  target_email text := 'SOMEONE-ELSE@example.com';   -- EDIT THIS
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(target_email));
  if uid is null then
    raise exception 'No login exists for "%". Create it under Authentication -> Users first.', target_email;
  end if;
  insert into app_users (user_id, role) values (uid, 'staff')
  on conflict (user_id) do update set role = 'staff';
  raise notice '% is now staff.', target_email;
end $$;
*/

-- --------------------------------------------------------------- check -----
-- Who has what. Run this on its own any time.
select u.email, a.role, a.created_at
from app_users a
join auth.users u on u.id = a.user_id
order by a.role, u.email;
