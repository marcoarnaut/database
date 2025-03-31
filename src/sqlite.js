const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../.data/database.sqlite');

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH));
}

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  const schemaPath = path.join(__dirname, '../schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  db.exec(schemaSql, (err) => {
    if (err) {
      console.error('Error initializing database:', err);
    } else {
      console.log('Database initialized successfully');
    }
  });
});

function generateId() {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
}

module.exports = {
  createServer: (name, description = '') => {
    const serverId = generateId();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO servers (server_id, name, description) 
        VALUES (?, ?, ?)`,
        [serverId, name, description],
        function(err) {
          err ? reject(err) : resolve(serverId);
        }
      );
    });
  },

  getServer: (serverId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM servers WHERE server_id = ?',
        [serverId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
  },

  getAllServers: () => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM servers ORDER BY name',
        [],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
  },

  updateServer: (serverId, { name, description }) => {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE servers SET 
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        updated_at = CURRENT_TIMESTAMP
        WHERE server_id = ?`,
        [name, description, serverId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  deleteServer: (serverId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM servers WHERE server_id = ?',
        [serverId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  createTeam: (serverId, name, description = '') => {
    const teamId = generateId();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO teams (team_id, server_id, name, description)
        VALUES (?, ?, ?, ?)`,
        [teamId, serverId, name, description],
        (err) => err ? reject(err) : resolve(teamId)
      );
    });
  },

  getTeam: (teamId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM teams WHERE team_id = ?',
        [teamId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
  },

  getServerTeams: (serverId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM teams WHERE server_id = ? ORDER BY name',
        [serverId],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
  },

  updateTeam: (teamId, { name, description }) => {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE teams SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        updated_at = CURRENT_TIMESTAMP
        WHERE team_id = ?`,
        [name, description, teamId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  deleteTeam: (teamId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM teams WHERE team_id = ?',
        [teamId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  assignRole: (teamId, roleType, userId) => {
    const roleId = generateId();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO roles (role_id, team_id, role_type, user_id)
        VALUES (?, ?, ?, ?)`,
        [roleId, teamId, roleType, userId],
        (err) => err ? reject(err) : resolve(roleId)
      );
    });
  },

  getTeamRoles: (teamId) => {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM roles WHERE team_id = ? ORDER BY role_type',
        [teamId],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
  },

  updateRole: (roleId, userId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE roles SET user_id = ? WHERE role_id = ?',
        [userId, roleId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  deleteRole: (roleId) => {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM roles WHERE role_id = ?',
        [roleId],
        (err) => err ? reject(err) : resolve()
      );
    });
  },

  getFullServerData: async (serverId) => {
    try {
      const server = await this.getServer(serverId);
      if (!server) return null;

      const teams = await this.getServerTeams(serverId);
      const teamsWithRoles = await Promise.all(
        teams.map(async team => ({
          ...team,
          roles: await this.getTeamRoles(team.team_id)
        }))
      );

      return {
        ...server,
        teams: teamsWithRoles
      };
    } catch (err) {
      throw err;
    }
  }
};