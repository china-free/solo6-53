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

router.post('/:token', async (req, res) => {
  const { token } = req.params;

  let webhook = db.get('SELECT * FROM webhooks WHERE endpoint_token = ?', [token]);

  if (!webhook) {
    webhook = db.get('SELECT * FROM webhooks WHERE id = ?', [token]);
  }

  if (!webhook) {
    return res.status(404).json({ error: 'WebHook not found' });
  }

  return handleWebhookRequest(webhook, req, res);
});

async function handleWebhookRequest(webhook, req, res) {
  if (webhook.status !== 'active') {
    return res.status(400).json({
      error: `WebHook is ${webhook.status}`,
      webhook_id: webhook.id,
      webhook_name: webhook.name
    });
  }

  const eventType = req.headers['x-event-type'] || req.body?.event_type || 'default';

  const eventTypes = parseOptionalJSON(webhook.event_types) || [];
  if (eventTypes.length > 0 && !eventTypes.includes(eventType) && !eventTypes.includes('*')) {
    return res.status(200).json({
      message: 'Event type not configured for this webhook',
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      event_type: eventType,
      configured_events: eventTypes,
      forwarded: false
    });
  }

  const filterConditions = parseOptionalJSON(webhook.filter_conditions);
  if (!matchFilterConditions(req.body, req.headers, filterConditions)) {
    return res.status(200).json({
      message: 'Request does not match filter conditions',
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      event_type: eventType,
      forwarded: false
    });
  }

  try {
    const result = await forwardWebhook(webhook, eventType, req.body, req.headers);
    let summary = null;
    if (result.attempt_details && result.attempt_details.length > 0) {
      const firstSuccess = result.attempt_details.find(a => a.success);
      if (result.attempt_details.length === 1 && result.attempt_details[0].success) {
        summary = '一次成功';
      } else if (firstSuccess) {
        summary = `第${firstSuccess.attempt_number}次成功（前${firstSuccess.attempt_number - 1}次失败）`;
      } else {
        summary = `${result.attempt_details.length}次全部失败`;
      }
    }
    const response = {
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      receive_url: `${req.protocol}://${req.get('host')}/webhook/${webhook.endpoint_token}`,
      target_url: webhook.target_url,
      forwarded: true,
      log_id: result.log_id,
      success: result.success,
      attempts: result.attempts,
      attempt_summary: summary,
      attempt_details: result.attempt_details,
      duration_ms: result.duration_ms,
      error: result.error,
      response: result.response
    };
    res.status(result.success ? 200 : 500).json(response);
  } catch (err) {
    res.status(500).json({
      webhook_id: webhook.id,
      webhook_name: webhook.name,
      receive_url: `${req.protocol}://${req.get('host')}/webhook/${webhook.endpoint_token}`,
      target_url: webhook.target_url,
      forwarded: true,
      success: false,
      error: err.message
    });
  }
}

module.exports = router;
