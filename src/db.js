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

async function initDatabase() {
  ensureDataDir();
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
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
