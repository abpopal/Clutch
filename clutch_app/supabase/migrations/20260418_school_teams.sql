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
  member_role text not null check (member_role in ('athlete', 'coach')),
  created_at timestamp not null default now()
);

create unique index if not exists uq_school_team_members_unique
on school_team_members (team_id, user_id, member_role);

create index if not exists idx_school_team_members_team_role
on school_team_members (team_id, member_role, created_at desc);
