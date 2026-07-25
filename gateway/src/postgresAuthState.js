import pg from 'pg';
import { initAuthCreds, BufferJSON, proto } from '@whiskeysockets/baileys';

const { Pool } = pg;

let pool;
function getPool() {
  if (!pool) {
    // Recent pg-connection-string versions treat a `sslmode=require` query
    // param as an alias for strict `verify-full` cert validation, which
    // overrides the explicit `ssl` option below and fails against hosted
    // providers (Aiven, Neon, ...) whose certs aren't in Node's default CA
    // bundle. Strip it so only our explicit config applies.
    const connectionString = (process.env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]+/, '');
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

// Lives in its own Postgres schema, deliberately separate from `public` --
// the web app's Prisma migrations manage `public` and will try to drop any
// table there it doesn't recognize, which would otherwise wipe live
// WhatsApp session credentials on the next `prisma db push`/`migrate`.
let tableReady;
function ensureAuthTable() {
  if (!tableReady) {
    tableReady = getPool().query(`
      CREATE SCHEMA IF NOT EXISTS gateway;
      CREATE TABLE IF NOT EXISTS gateway.gateway_auth_state (
        session_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (session_id, key)
      )
    `);
  }
  return tableReady;
}

async function readData(sessionId, key) {
  const { rows } = await getPool().query(
    'SELECT value FROM gateway.gateway_auth_state WHERE session_id = $1 AND key = $2',
    [sessionId, key],
  );
  if (!rows.length) return null;
  return JSON.parse(rows[0].value, BufferJSON.reviver);
}

async function writeData(sessionId, key, data) {
  const value = JSON.stringify(data, BufferJSON.replacer);
  await getPool().query(
    `INSERT INTO gateway.gateway_auth_state (session_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (session_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [sessionId, key, value],
  );
}

async function removeData(sessionId, key) {
  await getPool().query(
    'DELETE FROM gateway.gateway_auth_state WHERE session_id = $1 AND key = $2',
    [sessionId, key],
  );
}

// Used by reconnectSession() to decide whether there are credentials worth
// trying before falling back to a fresh pairing code.
export async function hasStoredCreds(sessionId) {
  await ensureAuthTable();
  const creds = await readData(sessionId, 'creds');
  return Boolean(creds);
}

// Used by logoutSession() and reconnectSession()'s last-resort fallback --
// wipes everything stored for this session (equivalent to the old
// fs.rmSync(sessionDir) when auth state lived in local files).
export async function clearAuthState(sessionId) {
  await ensureAuthTable();
  await getPool().query('DELETE FROM gateway.gateway_auth_state WHERE session_id = $1', [
    sessionId,
  ]);
}

// Postgres-backed equivalent of Baileys' own useMultiFileAuthState -- same
// shape and same BufferJSON serialization, just a DB table instead of a
// local folder, so session credentials survive the gateway process (and
// its local disk) being thrown away and restarted.
export async function usePostgresAuthState(sessionId) {
  await ensureAuthTable();

  const creds = (await readData(sessionId, 'creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(sessionId, `${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(sessionId, key, value) : removeData(sessionId, key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      return writeData(sessionId, 'creds', creds);
    },
  };
}
