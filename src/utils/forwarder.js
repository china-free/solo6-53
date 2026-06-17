const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { transformBody } = require('./transform');

const MAX_RETRIES = 3;
const RETRY_INTERVALS = [1000, 3000, 5000];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseOptionalJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

async function forwardWebhook(webhookRow, eventType, originalBody, headers) {
  const logId = uuidv4();
  const startTime = Date.now();

  const transformationConfig = parseOptionalJSON(webhookRow.transformation_config);
  const transformedBody = transformBody(originalBody, transformationConfig);

  let attempts = 0;
  let lastError = null;
  let targetResponse = null;
  let success = false;

  const filteredHeaders = {};
  const skipHeaders = ['host', 'connection', 'content-length'];
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      filteredHeaders[key] = value;
    }
  }
  filteredHeaders['content-type'] = filteredHeaders['content-type'] || 'application/json';

  while (attempts < MAX_RETRIES) {
    attempts++;
    try {
      const response = await axios({
        method: 'POST',
        url: webhookRow.target_url,
        data: transformedBody,
        headers: filteredHeaders,
        timeout: 30000,
        validateStatus: (status) => status < 500
      });

      targetResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      };

      success = response.status >= 200 && response.status < 300;
      if (success) {
        break;
      } else {
        lastError = `Target returned status ${response.status}`;
        if (attempts < MAX_RETRIES) {
          await sleep(RETRY_INTERVALS[attempts - 1]);
        }
      }
    } catch (error) {
      lastError = error.message;
      if (error.response) {
        targetResponse = {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)
        };
      }
      if (attempts < MAX_RETRIES) {
        await sleep(RETRY_INTERVALS[attempts - 1]);
      }
    }
  }

  const duration = Date.now() - startTime;

  db.run(
    `INSERT INTO logs (id, webhook_id, event_type, original_request, transformed_request, target_response, status, attempts, duration_ms, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      webhookRow.id,
      eventType,
      JSON.stringify({ body: originalBody, headers: filteredHeaders }),
      JSON.stringify(transformedBody),
      targetResponse ? JSON.stringify(targetResponse) : null,
      success ? 'success' : 'failed',
      attempts,
      duration,
      lastError,
      Date.now()
    ]
  );

  return {
    log_id: logId,
    success,
    attempts,
    duration_ms: duration,
    error: lastError,
    response: targetResponse
  };
}

module.exports = {
  forwardWebhook
};
