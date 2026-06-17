const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

function parseOptionalJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function formatWebhook(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    target_url: row.target_url,
    event_types: parseOptionalJSON(row.event_types),
    filter_conditions: parseOptionalJSON(row.filter_conditions),
    transformation_config: parseOptionalJSON(row.transformation_config),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

router.post('/', (req, res) => {
  const { name, target_url, event_types, filter_conditions, transformation_config } = req.body;

  if (!name || !target_url || !event_types) {
    return res.status(400).json({ error: 'name, target_url, event_types are required' });
  }

  if (!Array.isArray(event_types) || event_types.length === 0) {
    return res.status(400).json({ error: 'event_types must be a non-empty array' });
  }

  const id = uuidv4();
  const now = Date.now();

  db.run(
    `INSERT INTO webhooks (id, name, target_url, event_types, filter_conditions, transformation_config, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [
      id,
      name,
      target_url,
      JSON.stringify(event_types),
      filter_conditions ? JSON.stringify(filter_conditions) : null,
      transformation_config ? JSON.stringify(transformation_config) : null,
      now,
      now
    ]
  );

  const row = db.get('SELECT * FROM webhooks WHERE id = ?', [id]);
  res.status(201).json(formatWebhook(row));
});

router.get('/', (req, res) => {
  const { status, limit = 100, offset = 0 } = req.query;
  let query = 'SELECT * FROM webhooks WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.all(query, params);
  res.json(rows.map(formatWebhook));
});

router.get('/:id', (req, res) => {
  const row = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  if (!row) {
    return res.status(404).json({ error: 'WebHook not found' });
  }
  res.json(formatWebhook(row));
});

router.put('/:id', (req, res) => {
  const { name, target_url, event_types, filter_conditions, transformation_config } = req.body;
  const now = Date.now();

  const existing = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  if (!existing) {
    return res.status(404).json({ error: 'WebHook not found' });
  }

  const updates = [];
  const params = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }
  if (target_url !== undefined) {
    updates.push('target_url = ?');
    params.push(target_url);
  }
  if (event_types !== undefined) {
    if (!Array.isArray(event_types) || event_types.length === 0) {
      return res.status(400).json({ error: 'event_types must be a non-empty array' });
    }
    updates.push('event_types = ?');
    params.push(JSON.stringify(event_types));
  }
  if (filter_conditions !== undefined) {
    updates.push('filter_conditions = ?');
    params.push(filter_conditions ? JSON.stringify(filter_conditions) : null);
  }
  if (transformation_config !== undefined) {
    updates.push('transformation_config = ?');
    params.push(transformation_config ? JSON.stringify(transformation_config) : null);
  }

  updates.push('updated_at = ?');
  params.push(now, req.params.id);

  db.run(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, params);

  const row = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  res.json(formatWebhook(row));
});

router.post('/:id/status', (req, res) => {
  const { status } = req.body;

  if (!['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'status must be active or paused' });
  }

  const existing = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  if (!existing) {
    return res.status(404).json({ error: 'WebHook not found' });
  }

  db.run('UPDATE webhooks SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), req.params.id]);

  const row = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  res.json(formatWebhook(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.id]);
  if (!existing) {
    return res.status(404).json({ error: 'WebHook not found' });
  }

  db.run('DELETE FROM logs WHERE webhook_id = ?', [req.params.id]);
  db.run('DELETE FROM webhooks WHERE id = ?', [req.params.id]);
  res.json({ message: 'WebHook deleted successfully' });
});

module.exports = router;
