create table if not exists user_directory (
  user_id uuid primary key references users(user_id) on delete cascade,
  display_name text,
  email text unique,
  updated_at timestamp default now()
);

create index if not exists idx_user_directory_display_name on user_directory (lower(display_name));
create index if not exists idx_user_directory_email on user_directory (lower(email));
