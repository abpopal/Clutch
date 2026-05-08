update users
set role = case
  when role = 'school' then 'school_admin'
  when role = 'viewer' then 'user'
  else role
end
where role in ('school', 'viewer');

alter table users
drop constraint if exists users_role_check;

alter table users
add constraint users_role_check
check (role in ('school_admin', 'coach', 'athlete', 'scout', 'user'));

update post
set author_role = 'school_admin'
where author_role = 'school';

alter table post
drop constraint if exists post_author_role_check;

alter table post
add constraint post_author_role_check
check (author_role in ('school_admin', 'coach', 'athlete'));

create table if not exists school_join_requests (
  request_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  school_id uuid not null references schools(school_id) on delete cascade,
  requester_role text not null check (requester_role in ('athlete', 'coach')),
  display_name text,
  email text,
  school_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamp not null default now(),
  reviewed_at timestamp,
  reviewed_by_user_id uuid references users(user_id) on delete set null
);

create index if not exists idx_school_join_requests_school_status
on school_join_requests (school_id, status, requester_role, requested_at desc);

create index if not exists idx_school_join_requests_user
on school_join_requests (user_id, requested_at desc);

create unique index if not exists uq_school_join_requests_pending
on school_join_requests (user_id, school_id, requester_role)
where status = 'pending';
