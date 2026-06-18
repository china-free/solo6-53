const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'webhook.db');
const DATA_DIR = path.join(__dirname, '..', 'data');

let db = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function migrateDatabase() {
  const webhookColumns = db.exec("PRAGMA table_info(webhooks)");
  const webhookColNames = webhookColumns[0] ? webhookColumns[0].values.map(c => c[1]) : [];
  
  if (!webhookColNames.includes('endpoint_token')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS webhooks_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_url TEXT NOT NULL,
        endpoint_token TEXT UNIQUE NOT NULL,
        event_types TEXT NOT NULL,
        filter_conditions TEXT,
        transformation_config TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    const existingRows = db.all('SELECT * FROM webhooks', []);
    if (existingRows.length > 0) {
      const crypto = require('crypto');
      for (const row of existingRows) {
        const token = crypto.randomBytes(16).toString('hex');
        db.run(
          `INSERT INTO webhooks_new (id, name, target_url, endpoint_token, event_types, filter_conditions, transformation_config, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [row.id, row.name, row.target_url, token, row.event_types, row.filter_conditions, row.transformation_config, row.status, row.created_at, row.updated_at]
        );
      }
    }
    
    db.run('DROP TABLE IF EXISTS webhooks');
    db.run('ALTER TABLE webhooks_new RENAME TO webhooks');
    db.run('CREATE INDEX IF NOT EXISTS idx_webhooks_endpoint_token ON webhooks(endpoint_token)');
  }

  const logColumns = db.exec("PRAGMA table_info(logs)");
  const logColNames = logColumns[0] ? logColumns[0].values.map(c => c[1]) : [];
  
  if (!logColNames.includes('attempt_details')) {
    db.run(`
      CREATE TABLE IF NOT EXISTS logs_new (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        original_request TEXT NOT NULL,
        transformed_request TEXT,
        target_response TEXT,
        attempt_details TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
      )
    `);
    
    const existingLogs = db.all('SELECT * FROM logs', []);
    for (const row of existingLogs) {
      db.run(
        `INSERT INTO logs_new (id, webhook_id, event_type, original_request, transformed_request, target_response, status, attempts, duration_ms, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [row.id, row.webhook_id, row.event_type, row.original_request, row.transformed_request, row.target_response, row.status, row.attempts, row.duration_ms, row.error_message, row.created_at]
      );
    }
    
    db.run('DROP TABLE IF EXISTS logs');
    db.run('ALTER TABLE logs_new RENAME TO logs');
  }
}

async function initDatabase() {
  ensureDataDir();
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    migrateDatabase();
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      endpoint_token TEXT UNIQUE NOT NULL,
      event_types TEXT NOT NULL,
      filter_conditions TEXT,
      transformation_config TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      original_request TEXT NOT NULL,
      transformed_request TEXT,
      target_response TEXT,
      attempt_details TEXT,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id)
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_webhook_id ON logs(webhook_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_status ON webhooks(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_webhooks_endpoint_token ON webhooks(endpoint_token)`);

  saveDatabase();
  return db;
}

function saveDatabase() {
  if (!db) return;
  ensureDataDir();
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function run(query, params = []) {
  const stmt = db.prepare(query);
  stmt.run(params);
  saveDatabase();
}

function get(query, params = []) {
  const stmt = db.prepare(query);
  const result = stmt.getAsObject(params);
  return Object.keys(result).length > 0 ? result : null;
}

function all(query, params = []) {
  const stmt = db.prepare(query);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

module.exports = {
  initDatabase,
  saveDatabase,
  run,
  get,
  all
};
