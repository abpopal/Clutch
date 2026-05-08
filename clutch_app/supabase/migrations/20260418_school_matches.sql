create table if not exists school_matches (
  match_id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(school_id) on delete cascade,
  home_team_id uuid not null references school_teams(team_id) on delete cascade,
  away_team_id uuid not null references school_teams(team_id) on delete cascade,
  scheduled_at timestamp not null,
  home_score int,
  away_score int,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamp not null default now(),
  completed_at timestamp,
  check (home_team_id <> away_team_id)
);

create index if not exists idx_school_matches_school_schedule
on school_matches (school_id, scheduled_at desc);

create table if not exists school_match_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  match_id uuid not null references school_matches(match_id) on delete cascade,
  user_id uuid not null references users(user_id) on delete cascade,
  team_id uuid not null references school_teams(team_id) on delete cascade,
  member_role text not null check (member_role in ('athlete', 'coach')),
  created_at timestamp not null default now(),
  read_at timestamp
);

create index if not exists idx_school_match_notifications_user
on school_match_notifications (user_id, created_at desc);

create unique index if not exists uq_school_match_notifications_unique
on school_match_notifications (match_id, user_id, team_id, member_role);
