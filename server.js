const fastify = require('fastify')({ logger: true });
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '.data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o777 });
  console.log('Created .data directory with 777 permissions');
} else {
  fs.chmodSync(dataDir, 0o777);
  console.log('Updated .data directory permissions to 777');
}

fastify.register(require('@fastify/cors'), {
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'PUT']
});

const DB_PATH = path.join(dataDir, 'database.sqlite');
console.log(`Using database at: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
  initializeDatabase();
});

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function initializeDatabase() {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS lobbies (
      id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL UNIQUE,
      discord_name TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS lobby_players (
      lobby_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      team TEXT CHECK(team IN ('light', 'dark')) NOT NULL,
      role TEXT CHECK(role IN ('carry', 'mid', 'offlane', 'support', 'hardsupport')) NOT NULL,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lobby_id, player_id),
      FOREIGN KEY (lobby_id) REFERENCES lobbies(id) ON DELETE CASCADE,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
      UNIQUE (lobby_id, team, role)
    )`);

    console.log('Database tables initialized');
  });
}

fastify.addHook('onRequest', (request, reply, done) => {
  console.log(`Incoming request: ${request.method} ${request.url}`);
  done();
});

fastify.post('/api/lobbies', async (request, reply) => {
  const { guildId, name } = request.body;
  
  if (!guildId || !name) {
    return reply.code(400).send({ error: 'Guild ID and name are required' });
  }

  const id = generateId();
  
  return new Promise((resolve) => {
    db.run(
      'INSERT INTO lobbies (id, guild_id, name) VALUES (?, ?, ?)',
      [id, guildId, name],
      function(err) {
        if (err) {
          console.error('Create lobby error:', err);
          reply.code(500).send({ error: 'Failed to create lobby' });
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

  return new Promise((resolve) => {
    db.all(
      'SELECT id, name, is_active, created_at FROM lobbies WHERE guild_id = ?',
      [guildId],
      (err, rows) => {
        if (err) {
          console.error('List lobbies error:', err);
          reply.code(500).send({ error: 'Failed to list lobbies' });
        } else {
          resolve(rows);
        }
      }
    );
  });
});

fastify.get('/api/lobbies/:lobbyId', async (request, reply) => {
  const { lobbyId } = request.params;

  return new Promise((resolve) => {
    db.get(
      'SELECT id, guild_id, name, is_active, created_at FROM lobbies WHERE id = ?',
      [lobbyId],
      (err, lobby) => {
        if (err) {
          console.error('Get lobby error:', err);
          return reply.code(500).send({ error: 'Failed to get lobby' });
        }

        if (!lobby) {
          return reply.code(404).send({ error: 'Lobby not found' });
        }

        db.all(
          `SELECT p.discord_id, p.discord_name, lp.team, lp.role 
           FROM lobby_players lp
           JOIN players p ON lp.player_id = p.id
           WHERE lp.lobby_id = ?`,
          [lobbyId],
          (err, players) => {
            if (err) {
              console.error('Get players error:', err);
              return reply.code(500).send({ error: 'Failed to get players' });
            }

            const teams = {
              light: ['carry', 'mid', 'offlane', 'support', 'hardsupport'].map(role => ({
                role,
                player: players.find(p => p.team === 'light' && p.role === role) || null
              })),
              dark: ['carry', 'mid', 'offlane', 'support', 'hardsupport'].map(role => ({
                role,
                player: players.find(p => p.team === 'dark' && p.role === role) || null
              }))
            };

            resolve({
              ...lobby,
              players,
              teams
            });
          }
        );
      }
    );
  });
});

fastify.post('/api/lobbies/:lobbyId/join', async (request, reply) => {
  const { lobbyId } = request.params;
  const { discordId, discordName, team, role } = request.body;
  
  console.log(`Join request: lobby=${lobbyId}, user=${discordId}, team=${team}, role=${role}`);

  if (!discordId || !team || !role) {
    return reply.code(400).send({ error: 'Discord ID, team and role are required' });
  }

  if (!['light', 'dark'].includes(team)) {
    return reply.code(400).send({ error: 'Invalid team value' });
  }

  if (!['carry', 'mid', 'offlane', 'support', 'hardsupport'].includes(role)) {
    return reply.code(400).send({ error: 'Invalid role value' });
  }

  try {
    const lobbyExists = await new Promise((resolve) => {
      db.get('SELECT 1 FROM lobbies WHERE id = ?', [lobbyId], (err, row) => {
        if (err) {
          console.error('Lobby check error:', err);
          reply.code(500).send({ error: 'Database error' });
          resolve(false);
        } else {
          resolve(!!row);
        }
      });
    });

    if (!lobbyExists) {
      return reply.code(404).send({ error: 'Lobby not found' });
    }

    const roleTaken = await new Promise((resolve) => {
      db.get(
        `SELECT 1 FROM lobby_players WHERE lobby_id = ? AND team = ? AND role = ?`,
        [lobbyId, team, role],
        (err, row) => {
          if (err) {
            console.error('Role check error:', err);
            reply.code(500).send({ error: 'Database error' });
            resolve(false);
          } else {
            resolve(!!row);
          }
        }
      );
    });

    if (roleTaken) {
      return reply.code(400).send({ error: 'This role in the team is already taken' });
    }

    const playerId = await new Promise((resolve) => {
      db.get(
        'SELECT id FROM players WHERE discord_id = ?',
        [discordId],
        (err, row) => {
          if (err) {
            console.error('Player lookup error:', err);
            reply.code(500).send({ error: 'Database error' });
            resolve(null);
          } else if (row) {
            resolve(row.id);
          } else {
            const newId = generateId();
            db.run(
              'INSERT INTO players (id, discord_id, discord_name) VALUES (?, ?, ?)',
              [newId, discordId, discordName],
              (err) => {
                if (err) {
                  console.error('Player creation error:', err);
                  reply.code(500).send({ error: 'Failed to create player' });
                  resolve(null);
                } else {
                  resolve(newId);
                }
              }
            );
          }
        }
      );
    });

    if (!playerId) return;

    const result = await new Promise((resolve) => {
      db.run(
        `INSERT INTO lobby_players (lobby_id, player_id, team, role) VALUES (?, ?, ?, ?)`,
        [lobbyId, playerId, team, role],
        function(err) {
          if (err) {
            console.error('Join lobby error:', err);
            reply.code(500).send({ error: 'Failed to join lobby' });
            resolve({ success: false });
          } else {
            resolve({ success: true, lobbyId, playerId, team, role });
          }
        }
      );
    });

    return result;
  } catch (error) {
    console.error('Join lobby processing error:', error);
    return reply.code(500).send({ error: 'Internal server error' });
  }
});

fastify.delete('/api/lobbies/:lobbyId/leave', async (request, reply) => {
  const { lobbyId } = request.params;
  const { discordId } = request.body;
  
  if (!discordId) {
    return reply.code(400).send({ error: 'Discord ID is required' });
  }

  return new Promise((resolve) => {
    db.run(
      `DELETE FROM lobby_players 
       WHERE lobby_id = ? AND player_id = (
         SELECT id FROM players WHERE discord_id = ?
       )`,
      [lobbyId, discordId],
      function(err) {
        if (err) {
          console.error('Leave lobby error:', err);
          reply.code(500).send({ error: 'Failed to leave lobby' });
          resolve({ success: false });
        } else if (this.changes === 0) {
          resolve({ success: false, message: 'Player not found in lobby' });
        } else {
          resolve({ success: true });
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

  return new Promise((resolve) => {
    db.run(
      `DELETE FROM lobby_players 
       WHERE lobby_id = ? AND team = ? AND role = ?`,
      [lobbyId, team, role],
      function(err) {
        if (err) {
          console.error('Kick player error:', err);
          reply.code(500).send({ error: 'Failed to kick player' });
          resolve({ success: false });
        } else if (this.changes === 0) {
          resolve({ success: false, message: 'No player found in this position' });
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

fastify.post('/api/lobbies/:lobbyId/close', async (request, reply) => {
  const { lobbyId } = request.params;

  return new Promise((resolve) => {
    db.run(
      'UPDATE lobbies SET is_active = 0 WHERE id = ?',
      [lobbyId],
      function(err) {
        if (err) {
          console.error('Close lobby error:', err);
          reply.code(500).send({ error: 'Failed to close lobby' });
          resolve({ success: false });
        } else if (this.changes === 0) {
          resolve({ success: false, message: 'Lobby not found' });
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

fastify.get('/api/lobbies/:lobbyId/player-count', async (request, reply) => {
  const { lobbyId } = request.params;

  return new Promise((resolve) => {
    db.get(
      `SELECT COUNT(*) as count FROM lobby_players WHERE lobby_id = ?`,
      [lobbyId],
      (err, row) => {
        if (err) {
          console.error('Player count error:', err);
          reply.code(500).send({ error: 'Failed to get player count' });
        } else {
          resolve({ count: row.count });
        }
      }
    );
  });
});

fastify.delete('/api/lobbies/:lobbyId', async (request, reply) => {
  const { lobbyId } = request.params;

  return new Promise((resolve) => {
    db.run(
      'DELETE FROM lobbies WHERE id = ?',
      [lobbyId],
      function(err) {
        if (err) {
          console.error('Delete lobby error:', err);
          reply.code(500).send({ error: 'Failed to delete lobby' });
          resolve({ success: false });
        } else if (this.changes === 0) {
          resolve({ success: false, message: 'Lobby not found' });
        } else {
          resolve({ success: true });
        }
      }
    );
  });
});

fastify.get('/api/ping', async () => {
  return { status: 'alive', time: new Date() };
});

fastify.setErrorHandler((error, request, reply) => {
  console.error('Global error handler:', error);
  reply.status(500).send({ error: 'Internal server error' });
});

fastify.listen({ 
  port: process.env.PORT || 3000, 
  host: '0.0.0.0' 
}, (err) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Server running on http://localhost:${fastify.server.address().port}`);
});