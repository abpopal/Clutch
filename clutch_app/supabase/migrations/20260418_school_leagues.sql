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

alter table school_matches
add column if not exists league_id uuid references school_leagues(league_id) on delete set null;

create index if not exists idx_school_matches_league_schedule
on school_matches (league_id, scheduled_at desc);
