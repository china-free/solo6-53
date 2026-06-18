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

function classifyError(error) {
  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
    return 'timeout';
  }
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'EAI_AGAIN') {
    return 'network';
  }
  if (error.response) {
    return 'http';
  }
  return 'unknown';
}

function truncate(str, max = 500) {
  if (!str) return null;
  const s = typeof str === 'string' ? str : JSON.stringify(str);
  return s.length > max ? s.substring(0, max) + '...[truncated]' : s;
}

async function forwardWebhook(webhookRow, eventType, originalBody, headers) {
  const logId = uuidv4();
  const overallStartTime = Date.now();

  const transformationConfig = parseOptionalJSON(webhookRow.transformation_config);
  const transformedBody = transformBody(originalBody, transformationConfig);

  let attemptCount = 0;
  let finalError = null;
  let finalResponse = null;
  let overallSuccess = false;
  const attemptDetails = [];

  const filteredHeaders = {};
  const skipHeaders = ['host', 'connection', 'content-length'];
  for (const [key, value] of Object.entries(headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      filteredHeaders[key] = value;
    }
  }
  filteredHeaders['content-type'] = filteredHeaders['content-type'] || 'application/json';

  while (attemptCount < MAX_RETRIES) {
    attemptCount++;
    const attemptNum = attemptCount;
    const attemptStart = Date.now();
    const attemptRecord = {
      attempt_number: attemptNum,
      started_at: attemptStart,
      completed_at: null,
      duration_ms: null,
      success: false,
      status_code: null,
      error_type: null,
      error_message: null,
      response_snippet: null
    };

    try {
      const response = await axios({
        method: 'POST',
        url: webhookRow.target_url,
        data: transformedBody,
        headers: filteredHeaders,
        timeout: 30000,
        validateStatus: (status) => status < 500
      });

      finalResponse = {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      };

      const isSuccess = response.status >= 200 && response.status < 300;
      const isClientError = response.status >= 400 && response.status < 500;
      attemptRecord.success = isSuccess;
      attemptRecord.status_code = response.status;
      attemptRecord.response_snippet = truncate(finalResponse.data);
      attemptRecord.completed_at = Date.now();
      attemptRecord.duration_ms = attemptRecord.completed_at - attemptStart;

      if (isSuccess) {
        overallSuccess = true;
        finalError = null;
        attemptDetails.push(attemptRecord);
        break;
      } else if (isClientError) {
        finalError = `Target returned status ${response.status} (client error, will not retry)`;
        attemptRecord.error_type = 'http';
        attemptRecord.error_message = finalError;
        attemptDetails.push(attemptRecord);
        break;
      } else {
        finalError = `Target returned status ${response.status}`;
        attemptRecord.error_type = 'http';
        attemptRecord.error_message = finalError;
        attemptDetails.push(attemptRecord);
        if (attemptCount < MAX_RETRIES) {
          await sleep(RETRY_INTERVALS[attemptCount - 1]);
        }
      }
    } catch (error) {
      const attemptEnd = Date.now();
      attemptRecord.completed_at = attemptEnd;
      attemptRecord.duration_ms = attemptEnd - attemptStart;
      attemptRecord.success = false;
      attemptRecord.error_type = classifyError(error);
      attemptRecord.error_message = error.message;

      if (error.response) {
        attemptRecord.status_code = error.response.status;
        finalResponse = {
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)
        };
        attemptRecord.response_snippet = truncate(finalResponse.data);
        if (!attemptRecord.error_type || attemptRecord.error_type === 'unknown') {
          attemptRecord.error_type = 'http';
        }
        if (error.response.status >= 400 && error.response.status < 500) {
          finalError = error.message + ' (client error, will not retry)';
          attemptRecord.error_message = finalError;
          attemptDetails.push(attemptRecord);
          break;
        }
      } else {
        attemptRecord.status_code = null;
        finalResponse = null;
      }

      finalError = error.message;
      attemptRecord.error_message = finalError;
      attemptDetails.push(attemptRecord);

      if (attemptCount < MAX_RETRIES) {
        await sleep(RETRY_INTERVALS[attemptCount - 1]);
      }
    }
  }

  const overallDuration = Date.now() - overallStartTime;

  db.run(
    `INSERT INTO logs (id, webhook_id, event_type, original_request, transformed_request, target_response, attempt_details, status, attempts, duration_ms, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      logId,
      webhookRow.id,
      eventType,
      JSON.stringify({ body: originalBody, headers: filteredHeaders }),
      JSON.stringify(transformedBody),
      finalResponse ? JSON.stringify(finalResponse) : null,
      JSON.stringify(attemptDetails),
      overallSuccess ? 'success' : 'failed',
      attemptCount,
      overallDuration,
      finalError,
      Date.now()
    ]
  );

  return {
    log_id: logId,
    success: overallSuccess,
    attempts: attemptCount,
    duration_ms: overallDuration,
    error: finalError,
    response: finalResponse,
    attempt_details: attemptDetails
  };
}

module.exports = {
  forwardWebhook
};
