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
  fetch(`https://irradiated-closed-gear.glitch.me/ping`)
    .then(() => console.log('Auto ping successfully (discord bot)'))
    .catch(e => console.error('Ping error:', e));
}, 120000);

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function initDatabase() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS lobbies (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        discord_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS lobby_players (
        lobby_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        team TEXT CHECK(team IN ('light', 'dark')),
        role TEXT CHECK(role IN ('carry', 'mid', 'offlane', 'support', 'hardsupport')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (lobby_id, player_id),
        FOREIGN KEY (lobby_id) REFERENCES lobbies (id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
      )
    `);

    console.log('Database tables initialized');
  });
}

fastify.post('/api/lobbies', async (request, reply) => {
  const { guildId, name } = request.body;
  
  if (!guildId || !name) {
    return reply.code(400).send({ error: 'Guild ID and name are required' });
  }

  const id = generateId();
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO lobbies (id, guild_id, name) VALUES (?, ?, ?)',
      [id, guildId, name],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ id, guildId, name });
        }
      }
    );
  });
});

fastify.get('/api/lobbies', async (request, reply) => {
  const { guildId } = request.query;
  if (!guildId) {
    return reply.code(400).send({ error: 'Guild ID is required' });
  }

  return new Promise((resolve, reject) => {
    db.all(
      'SELECT id, name, is_active, created_at FROM lobbies WHERE guild_id = ?',
      [guildId],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
});

fastify.post('/api/lobbies/:lobbyId/join', async (request, reply) => {
  const { lobbyId } = request.params;
  const { discordId, discordName, team, role } = request.body;
  
  if (!discordId || !team || !role) {
    return reply.code(400).send({ error: 'Missing required fields' });
  }

  const roleTaken = await new Promise((resolve, reject) => {
    db.get(
      `SELECT 1 FROM lobby_players 
       WHERE lobby_id = ? AND team = ? AND role = ?`,
      [lobbyId, team, role],
      (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      }
    );
  });

  if (roleTaken) {
    return reply.code(400).send({ error: 'This role in the team is already taken' });
  }

  const playerId = await new Promise((resolve, reject) => {
    db.get(
      'SELECT id FROM players WHERE discord_id = ?',
      [discordId],
      (err, row) => {
        if (err) return reject(err);
        
        if (row) {
          resolve(row.id);
        } else {
          const newId = generateId();
          db.run(
            'INSERT INTO players (id, discord_id, discord_name) VALUES (?, ?, ?)',
            [newId, discordId, discordName],
            (err) => {
              if (err) reject(err);
              else resolve(newId);
            }
          );
        }
      }
    );
  });

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO lobby_players (lobby_id, player_id, team, role) 
       VALUES (?, ?, ?, ?)`,
      [lobbyId, playerId, team, role],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ success: true, lobbyId, playerId, team, role });
        }
      }
    );
  });
});

fastify.delete('/api/lobbies/:lobbyId/leave', async (request, reply) => {
  const { lobbyId } = request.params;
  const { discordId } = request.body;
  
  if (!discordId) {
    return reply.code(400).send({ error: 'Discord ID is required' });
  }

  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM lobby_players 
       WHERE lobby_id = ? AND player_id = (
         SELECT id FROM players WHERE discord_id = ?
       )`,
      [lobbyId, discordId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes === 0) {
            resolve({ success: false, message: 'Player not found in lobby' });
          } else {
            resolve({ success: true });
          }
        }
      }
    );
  });
});

fastify.get('/api/lobbies/:lobbyId', async (request) => {
  const { lobbyId } = request.params;
  
  const lobbyInfo = await new Promise((resolve, reject) => {
    db.get(
      'SELECT id, guild_id, name, is_active, created_at FROM lobbies WHERE id = ?',
      [lobbyId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });

  if (!lobbyInfo) {
    return { error: 'Lobby not found' };
  }

  const players = await new Promise((resolve, reject) => {
    db.all(
      `SELECT p.discord_id, p.discord_name, lp.team, lp.role 
       FROM lobby_players lp
       JOIN players p ON lp.player_id = p.id
       WHERE lp.lobby_id = ?`,
      [lobbyId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });

  return {
    ...lobbyInfo,
    players,
    teams: {
      light: ['carry', 'mid', 'offlane', 'support', 'hardsupport'].map(role => ({
        role,
        player: players.find(p => p.team === 'light' && p.role === role) || null
      })),
      dark: ['carry', 'mid', 'offlane', 'support', 'hardsupport'].map(role => ({
        role,
        player: players.find(p => p.team === 'dark' && p.role === role) || null
      }))
    }
  };
});

fastify.post('/api/lobbies/:lobbyId/close', async (request) => {
  const { lobbyId } = request.params;
  
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE lobbies SET is_active = 0 WHERE id = ?',
      [lobbyId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes === 0) {
            resolve({ success: false, message: 'Lobby not found' });
          } else {
            resolve({ success: true });
          }
        }
      }
    );
  });
});

fastify.post('/api/lobbies/:lobbyId/kick', async (request, reply) => {
  const { lobbyId } = request.params;
  const { team, role } = request.body;
  
  if (!team || !role) {
    return reply.code(400).send({ error: 'Team and role are required' });
  }

  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM lobby_players 
       WHERE lobby_id = ? AND team = ? AND role = ?`,
      [lobbyId, team, role],
      function(err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes === 0) {
            resolve({ success: false, message: 'No player found in this position' });
          } else {
            resolve({ success: true });
          }
        }
      }
    );
  });
});

fastify.get('/api/lobbies/:lobbyId/player-count', async (request) => {
  const { lobbyId } = request.params;
  
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as count FROM lobby_players WHERE lobby_id = ?`,
      [lobbyId],
      (err, row) => {
        if (err) reject(err);
        else resolve({ count: row.count });
      }
    );
  });
});

fastify.delete('/api/lobbies/:lobbyId', async (request, reply) => {
  const { lobbyId } = request.params;
  
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM lobbies WHERE id = ?',
      [lobbyId],
      function(err) {
        if (err) {
          reject(err);
        } else {
          if (this.changes === 0) {
            resolve({ success: false, message: 'Lobby not found' });
          } else {
            db.run(
              'DELETE FROM lobby_players WHERE lobby_id = ?',
              [lobbyId],
              () => {
                resolve({ success: true });
              }
            );
          }
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