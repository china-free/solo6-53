function getNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
  return obj;
}

function transformBody(originalBody, config) {
  if (!config) return originalBody;

  let result = {};

  if (config.field_mapping && typeof config.field_mapping === 'object') {
    for (const [sourcePath, targetPath] of Object.entries(config.field_mapping)) {
      const value = getNestedValue(originalBody, sourcePath);
      if (value !== undefined) {
        setNestedValue(result, targetPath, value);
      }
    }
  } else {
    result = JSON.parse(JSON.stringify(originalBody));
  }

  if (config.add_fields && typeof config.add_fields === 'object') {
    for (const [key, value] of Object.entries(config.add_fields)) {
      setNestedValue(result, key, value);
    }
  }

  if (config.include_original === true) {
    result._original = originalBody;
  }

  return result;
}

function matchFilterConditions(body, headers, conditions) {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  if (conditions.event_type) {
    const allowedTypes = Array.isArray(conditions.event_type) ? conditions.event_type : [conditions.event_type];
    const headerEvent = headers['x-event-type'] || headers['X-Event-Type'];
    if (headerEvent && !allowedTypes.includes(headerEvent)) return false;
    if (body.event_type && !allowedTypes.includes(body.event_type)) return false;
  }

  if (conditions.body_fields && typeof conditions.body_fields === 'object') {
    for (const [path, expectedValue] of Object.entries(conditions.body_fields)) {
      const actualValue = getNestedValue(body, path);
      if (Array.isArray(expectedValue)) {
        if (!expectedValue.includes(actualValue)) return false;
      } else {
        if (actualValue !== expectedValue) return false;
      }
    }
  }

  if (conditions.header_fields && typeof conditions.header_fields === 'object') {
    for (const [name, expectedValue] of Object.entries(conditions.header_fields)) {
      const actualValue = headers[name.toLowerCase()];
      if (Array.isArray(expectedValue)) {
        if (!expectedValue.includes(actualValue)) return false;
      } else {
        if (actualValue !== expectedValue) return false;
      }
    }
  }

  return true;
}

module.exports = {
  transformBody,
  matchFilterConditions,
  getNestedValue,
  setNestedValue
};
