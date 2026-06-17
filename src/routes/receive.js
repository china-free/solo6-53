const express = require('express');
const db = require('../db');
const { matchFilterConditions } = require('../utils/transform');
const { forwardWebhook } = require('../utils/forwarder');

const router = express.Router();

function parseOptionalJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

router.post('/receive', async (req, res) => {
  const eventType = req.headers['x-event-type'] || req.body?.event_type || 'default';

  const activeWebhooks = db.all(
    `SELECT * FROM webhooks WHERE status = 'active'`,
    []
  );

  const matchedWebhooks = [];
  for (const wh of activeWebhooks) {
    const eventTypes = parseOptionalJSON(wh.event_types) || [];
    if (eventTypes.length > 0 && !eventTypes.includes(eventType) && !eventTypes.includes('*')) {
      continue;
    }

    const filterConditions = parseOptionalJSON(wh.filter_conditions);
    if (!matchFilterConditions(req.body, req.headers, filterConditions)) {
      continue;
    }

    matchedWebhooks.push(wh);
  }

  if (matchedWebhooks.length === 0) {
    return res.json({
      message: 'No matching webhooks found',
      event_type: eventType,
      matched_count: 0
    });
  }

  const results = [];
  for (const wh of matchedWebhooks) {
    try {
      const result = await forwardWebhook(wh, eventType, req.body, req.headers);
      results.push({
        webhook_id: wh.id,
        webhook_name: wh.name,
        ...result
      });
    } catch (err) {
      results.push({
        webhook_id: wh.id,
        webhook_name: wh.name,
        success: false,
        error: err.message
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  res.status(failedCount === results.length ? 500 : 200).json({
    message: `Processed ${results.length} webhook(s): ${successCount} succeeded, ${failedCount} failed`,
    event_type: eventType,
    matched_count: matchedWebhooks.length,
    results
  });
});

router.post('/receive/:webhookId', async (req, res) => {
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ?', [req.params.webhookId]);

  if (!webhook) {
    return res.status(404).json({ error: 'WebHook not found' });
  }

  if (webhook.status !== 'active') {
    return res.status(400).json({ error: `WebHook is ${webhook.status}` });
  }

  const eventType = req.headers['x-event-type'] || req.body?.event_type || 'default';

  const eventTypes = parseOptionalJSON(webhook.event_types) || [];
  if (eventTypes.length > 0 && !eventTypes.includes(eventType) && !eventTypes.includes('*')) {
    return res.json({
      message: 'Event type not configured for this webhook',
      event_type: eventType,
      configured_events: eventTypes
    });
  }

  const filterConditions = parseOptionalJSON(webhook.filter_conditions);
  if (!matchFilterConditions(req.body, req.headers, filterConditions)) {
    return res.json({
      message: 'Request does not match filter conditions',
      event_type: eventType
    });
  }

  try {
    const result = await forwardWebhook(webhook, eventType, req.body, req.headers);
    res.status(result.success ? 200 : 500).json({
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      ...result
    });
  } catch (err) {
    res.status(500).json({
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      success: false,
      error: err.message
    });
  }
});

module.exports = router;
