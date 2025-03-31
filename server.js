const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const dataDir = path.join(__dirname, '.data');
try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { 
      recursive: true,
      mode: 0o777
      
    });
    console.log('Папка .data создана с правами 777');
  } else {
    fs.chmodSync(dataDir, 0o777);
    console.log('Права .data обновлены до 777');
  }
} catch (err) {
  console.error('Ошибка настройки прав:', err);
}

fastify.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE']
});

const DB_PATH = path.join(__dirname, '.data', 'database.sqlite');
console.log(`Используется база данных по пути: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Database error:', err);
  } else {
    console.log('Connected to SQLite database');
    initDatabase();
  }
});

setInterval(() => {
  fetch(`https://fate-striped-yam.glitch.me/api/ping`)
    .then(() => console.log('Auto ping successfully (database)'))
    .catch(e => console.error('Ping error:', e));
  fetch(`https://irradiated-closed-gear.glitch.me/ping`)
    .then(() => console.log('Auto ping successfully (discord bot)'))
    .catch(e => console.error('Ping error:', e));
}, 120000);


function initDatabase() {
  return new Promise((resolve, reject) => {
    //
    db.get("SELECT name FROM sqlite_master WHERE type='table'", (err) => {
      if (err) {
        console.error('Database connection error:', err);
        return reject(err);
      }

      db.serialize(() => {
        db.run(`DROP TABLE IF EXISTS roles`);
        db.run(`DROP TABLE IF EXISTS teams`);
        
        db.run(`CREATE TABLE teams (
          team_id TEXT PRIMARY KEY,
          server_id TEXT NOT NULL,
          name TEXT NOT NULL,
          leader_id TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE roles (
          role_id TEXT PRIMARY KEY,
          team_id TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('leader', 'carry', 'mid', 'offlane', 'support', 'hardsupport')),
          user_id TEXT NOT NULL,
          FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE,
          UNIQUE(team_id, type)
        )`);
        
        console.log('Database tables created successfully');
        resolve();
      });
    });
  });
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

fastify.post('/api/teams', async (request) => {
  const { server_id, name, leader_id } = request.body;
  
  if (!server_id || !name || !leader_id) {
    return { success: false, error: 'Missing required fields' };
  }

  const team_id = `team_${generateId()}`;
  
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO teams (team_id, server_id, name, leader_id) 
       VALUES (?, ?, ?, ?)`,
      [team_id, server_id, name, leader_id],
      function(err) {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          db.run(
            `INSERT INTO roles (role_id, team_id, type, user_id)
             VALUES (?, ?, ?, ?)`,
            [`role_${generateId()}`, team_id, 'leader', leader_id],
            (err) => {
              if (err) {
                resolve({ success: false, error: 'Failed to assign leader role' });
              } else {
                resolve({ success: true, team_id });
              }
            }
          );
        }
      }
    );
  });
});

fastify.get('/api/teams/:server_id', async (request) => {
  return new Promise((resolve) => {
    db.all(
      `SELECT t.*, 
       (SELECT COUNT(*) FROM roles WHERE team_id = t.team_id) as members_count
       FROM teams t WHERE server_id = ?`,
      [request.params.server_id],
      (err, rows) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, data: rows });
        }
      }
    );
  });
});

fastify.get('/api/teams/:team_id/roster', async (request) => {
  return new Promise((resolve) => {
    db.all(
      `SELECT r.type, r.user_id 
       FROM roles r
       JOIN teams t ON r.team_id = t.team_id
       WHERE r.team_id = ?`,
      [request.params.team_id],
      (err, rows) => {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, data: rows });
        }
      }
    );
  });
});

fastify.post('/api/teams/:team_id/roles', async (request) => {
  const { type, user_id } = request.body;
  
  if (type === 'leader') {
    return { success: false, error: 'Leader can only be assigned during team creation' };
  }

  const role_id = `role_${generateId()}`;
  
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO roles (role_id, team_id, type, user_id)
       VALUES (?, ?, ?, ?)`,
      [role_id, request.params.team_id, type, user_id],
      function(err) {
        if (err) {
          resolve({ success: false, error: err.message });
        } else {
          resolve({ success: true, role_id });
        }
      }
    );
  });
});

fastify.get('/api/ping', async () => {
  return { status: 'alive', time: new Date() };
});

fastify.listen({ 
  port: process.env.PORT || 3000, 
  host: '0.0.0.0' 
}, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server ready on http://localhost:${fastify.server.address().port}`);
});