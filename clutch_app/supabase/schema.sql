create extension if not exists "pgcrypto";

create table if not exists users (
  user_id uuid primary key default gen_random_uuid(),
  firebase_uid text unique not null,
  role text check (role in ('school','coach','athlete','scout','viewer')) not null,
  created_at timestamp default now()
);

create table if not exists schools (
  school_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete cascade,
  name text,
  description text,
  location text,
  created_at timestamp default now()
);

create table if not exists coaches (
  coach_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete cascade,
  bio text,
  years_experience int
);

create table if not exists athletes (
  athlete_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete cascade,
  school_id uuid references schools(school_id),
  position text,
  graduation_year int
);

create table if not exists scouts (
  scout_id uuid primary key default gen_random_uuid(),
  user_id uuid references users(user_id) on delete cascade,
  organization text,
  title text
);

create table if not exists post (
  post_id uuid primary key default gen_random_uuid(),
  author_user_id uuid references users(user_id) on delete cascade,
  author_role text check (author_role in ('school','coach','athlete')) not null,
  caption text,
  post_type text check (post_type in ('image','video','text')) not null,
  interactions_count int default 0,
  created_at timestamp default now(),
  visibility text check (visibility in ('public','followers','private')) not null
);

create table if not exists post_media (
  media_id uuid primary key default gen_random_uuid(),
  post_id uuid references post(post_id) on delete cascade,
  media_url text not null,
  media_type text check (media_type in ('image','video')) not null,
  duration_seconds int
);

create table if not exists follow (
  follower_user_id uuid references users(user_id) on delete cascade,
  followed_user_id uuid references users(user_id) on delete cascade,
  created_at timestamp default now(),
  primary key (follower_user_id, followed_user_id)
);

create table if not exists user_directory (
  user_id uuid primary key references users(user_id) on delete cascade,
  display_name text,
  email text unique,
  updated_at timestamp default now()
);

create table if not exists conversation (
  conversation_id uuid primary key default gen_random_uuid(),
  created_at timestamp default now()
);

create table if not exists message (
  message_id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversation(conversation_id) on delete cascade,
  sender_user_id uuid references users(user_id) on delete cascade,
  body text,
  sent_at timestamp default now()
);

create table if not exists athlete_highlight (
  highlight_id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(athlete_id) on delete cascade,
  video_url text,
  title text,
  created_at timestamp default now()
);

create table if not exists athlete_stat (
  stat_id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(athlete_id) on delete cascade,
  sport text,
  stat_key text,
  stat_value text,
  source text check (source in ('coach','school')) not null
);

create table if not exists profile_share (
  share_id uuid primary key default gen_random_uuid(),
  athlete_id uuid references athletes(athlete_id) on delete cascade,
  scout_id uuid references scouts(scout_id) on delete cascade,
  message text,
  shared_at timestamp default now()
);

create table if not exists offer (
  offer_id uuid primary key default gen_random_uuid(),
  scout_id uuid references scouts(scout_id) on delete cascade,
  athlete_id uuid references athletes(athlete_id) on delete cascade,
  offer_type text check (offer_type in ('tryout','scholarship','visit')) not null,
  description text,
  status text check (status in ('sent','accepted','declined')) not null,
  created_at timestamp default now()
);

create table if not exists post_interaction (
  interaction_id uuid primary key default gen_random_uuid(),
  post_id uuid references post(post_id) on delete cascade,
  user_id uuid references users(user_id) on delete cascade,
  created_at timestamp default now(),
  unique (post_id, user_id)
);
