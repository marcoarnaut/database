DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS teams;

CREATE TABLE IF NOT EXISTS teams (
    team_id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    name TEXT NOT NULL,
    leader_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
    role_id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('leader', 'carry', 'mid', 'offlane', 'support', 'hardsupport')),
    user_id TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE,
    UNIQUE(team_id, type)
);

CREATE INDEX IF NOT EXISTS idx_teams_server ON teams(server_id);
CREATE INDEX IF NOT EXISTS idx_roles_team ON roles(team_id);