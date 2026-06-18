const express = require('express');
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

function formatLog(row) {
  if (!row) return null;
  const attemptDetails = parseOptionalJSON(row.attempt_details);
  let summary = null;
  if (attemptDetails && attemptDetails.length > 0) {
    const firstSuccess = attemptDetails.find(a => a.success);
    if (attemptDetails.length === 1 && attemptDetails[0].success) {
      summary = '一次成功';
    } else if (firstSuccess) {
      summary = `第${firstSuccess.attempt_number}次成功（前${firstSuccess.attempt_number - 1}次失败）`;
    } else {
      summary = `${attemptDetails.length}次全部失败`;
    }
  }
  return {
    id: row.id,
    webhook_id: row.webhook_id,
    event_type: row.event_type,
    original_request: parseOptionalJSON(row.original_request),
    transformed_request: parseOptionalJSON(row.transformed_request),
    target_response: parseOptionalJSON(row.target_response),
    attempt_summary: summary,
    attempt_details: attemptDetails,
    status: row.status,
    attempts: row.attempts,
    duration_ms: row.duration_ms,
    error_message: row.error_message,
    created_at: row.created_at
  };
}

router.get('/', (req, res) => {
  const { webhook_id, status, event_type, limit = 100, offset = 0 } = req.query;

  let query = 'SELECT * FROM logs WHERE 1=1';
  const params = [];

  if (webhook_id) {
    query += ' AND webhook_id = ?';
    params.push(webhook_id);
  }
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (event_type) {
    query += ' AND event_type = ?';
    params.push(event_type);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.all(query, params);
  res.json(rows.map(formatLog));
});

router.get('/stats', (req, res) => {
  const { webhook_id } = req.query;

  let baseQuery = 'SELECT COUNT(*) as count, status FROM logs';
  const params = [];

  if (webhook_id) {
    baseQuery += ' WHERE webhook_id = ?';
    params.push(webhook_id);
  }

  baseQuery += ' GROUP BY status';
  const statusStats = db.all(baseQuery, params);

  const totalParams = webhook_id ? [webhook_id] : [];
  const totalRow = db.get(
    `SELECT COUNT(*) as total, AVG(duration_ms) as avg_duration FROM logs${webhook_id ? ' WHERE webhook_id = ?' : ''}`,
    totalParams
  );

  const result = {
    total: totalRow?.total || 0,
    avg_duration_ms: Math.round(totalRow?.avg_duration || 0),
    by_status: {}
  };

  for (const stat of statusStats) {
    result.by_status[stat.status] = stat.count;
  }

  res.json(result);
});

router.get('/:id', (req, res) => {
  const row = db.get('SELECT * FROM logs WHERE id = ?', [req.params.id]);
  if (!row) {
    return res.status(404).json({ error: 'Log not found' });
  }
  res.json(formatLog(row));
});

router.delete('/:id', (req, res) => {
  const existing = db.get('SELECT * FROM logs WHERE id = ?', [req.params.id]);
  if (!existing) {
    return res.status(404).json({ error: 'Log not found' });
  }
  db.run('DELETE FROM logs WHERE id = ?', [req.params.id]);
  res.json({ message: 'Log deleted successfully' });
});

module.exports = router;
