create extension if not exists "pgcrypto";

create table if not exists users (
  user_id uuid primary key default gen_random_uuid(),
  firebase_uid text unique not null,
  role text check (role in ('school_admin','coach','athlete','scout','user')) not null,
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
  author_role text check (author_role in ('school_admin','coach','athlete')) not null,
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

create table if not exists school_join_requests (
  request_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(user_id) on delete cascade,
  school_id uuid not null references schools(school_id) on delete cascade,
  requester_role text check (requester_role in ('athlete','coach')) not null,
  display_name text,
  email text,
  school_name text,
  status text check (status in ('pending','approved','rejected')) not null default 'pending',
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

create table if not exists school_teams (
  team_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(school_id) on delete cascade,
  name text not null,
  sport text not null,
  season text,
  created_at timestamp not null default now()
);

create unique index if not exists uq_school_teams_name_per_school
on school_teams (school_id, lower(name), lower(sport), coalesce(lower(season), ''));

create index if not exists idx_school_teams_school
on school_teams (school_id, created_at desc);

create table if not exists school_team_members (
  team_member_id uuid primary key default gen_random_uuid(),
  team_id uuid not null references school_teams(team_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  member_role text check (member_role in ('athlete','coach')) not null,
  created_at timestamp not null default now()
);

create unique index if not exists uq_school_team_members_unique
on school_team_members (team_id, user_id, member_role);

create index if not exists idx_school_team_members_team_role
on school_team_members (team_id, member_role, created_at desc);

create table if not exists school_leagues (
  league_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(school_id) on delete cascade,
  name text not null,
  sport text not null,
  season text,
  created_at timestamp not null default now()
);

create unique index if not exists uq_school_leagues_name_per_school
on school_leagues (school_id, lower(name), lower(sport), coalesce(lower(season), ''));

create index if not exists idx_school_leagues_school
on school_leagues (school_id, created_at desc);

create table if not exists school_league_teams (
  league_team_id uuid primary key default gen_random_uuid(),
  league_id uuid not null references school_leagues(league_id) on delete cascade,
  team_id uuid not null references school_teams(team_id) on delete cascade,
  created_at timestamp not null default now()
);

create unique index if not exists uq_school_league_teams_unique
on school_league_teams (league_id, team_id);

create index if not exists idx_school_league_teams_league
on school_league_teams (league_id, created_at desc);

create table if not exists school_matches (
  match_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(school_id) on delete cascade,
  home_team_id uuid not null references school_teams(team_id) on delete cascade,
  away_team_id uuid not null references school_teams(team_id) on delete cascade,
  league_id uuid references school_leagues(league_id) on delete set null,
  scheduled_at timestamp not null,
  home_score int,
  away_score int,
  status text check (status in ('scheduled','completed','cancelled')) not null default 'scheduled',
  created_at timestamp not null default now(),
  completed_at timestamp,
  check (home_team_id <> away_team_id)
);

create index if not exists idx_school_matches_school_schedule
on school_matches (school_id, scheduled_at desc);

create index if not exists idx_school_matches_league_schedule
on school_matches (league_id, scheduled_at desc);

create table if not exists school_match_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  match_id uuid not null references school_matches(match_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  team_id uuid not null references school_teams(team_id) on delete cascade,
  member_role text check (member_role in ('athlete','coach')) not null,
  created_at timestamp not null default now(),
  read_at timestamp
);

create index if not exists idx_school_match_notifications_user
on school_match_notifications (user_id, created_at desc);

create unique index if not exists uq_school_match_notifications_unique
on school_match_notifications (match_id, user_id, team_id, member_role);
