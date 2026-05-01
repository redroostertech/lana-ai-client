/**
 * step-humanizer.js
 * Converts raw action/trigger config objects into human-readable descriptions
 * for the automation library detail Steps tab.
 *
 * Exports: describeStep, humanizeTrigger, humanizeWhen, humanizeActionType, humanizeConnectorId
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(str, maxLen) {
  const s = String(str || '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) + '\u2026' : s;
}

/**
 * Converts a connector_id (UUID or template var) to a friendly display name.
 * `{{user.connectors.google-calendar.id}}` → `Google Calendar`
 * UUID → `Connected connector`
 */
export function humanizeConnectorId(connectorId) {
  if (!connectorId) return 'connector';
  const s = String(connectorId);
  // Template var: {{user.connectors.<slug>.id}}
  const match = s.match(/\{\{[^}]*\.connectors\.([^.}]+)/);
  if (match) {
    return match[1]
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  // Looks like a UUID
  if (/^[0-9a-f-]{32,}$/i.test(s)) return 'Connected connector';
  return truncate(s, 40);
}

/**
 * Maps a dot-notation action_type slug to a friendly label.
 */
export function humanizeActionType(actionType) {
  const map = {
    'ai.chat': 'Ask AI',
    'ai.generateText': 'Generate Text',
    'ai.extractEntities': 'Extract Entities',
    'ai.analyze': 'Analyze',
    'database.query': 'Read from Database',
    'database.insert': 'Create Record',
    'database.update': 'Update Record',
    'database.delete': 'Delete Record',
    'notification.send': 'Send Notification',
    'notification.sendEmail': 'Send Email',
    'notification.logActivity': 'Log Activity',
    'notification.createTask': 'Create Task',
    'connector.push': 'Call Connector',
    'artifact.create': 'Save Artifact',
    'artifact.store': 'Store File',
    'iterate.forEach': 'Loop',
    'document.generateFromTemplate': 'Generate Document',
    'text.generate': 'Format Text',
  };
  return map[actionType] || String(actionType || 'Action');
}

/**
 * Maps an action_type to a Lucide icon name for <lex-icon>.
 */
function iconForType(actionType) {
  const map = {
    'ai.chat': 'brain',
    'ai.generateText': 'sparkles',
    'ai.extractEntities': 'scan-text',
    'ai.analyze': 'brain',
    'database.query': 'database',
    'database.insert': 'database',
    'database.update': 'database',
    'database.delete': 'database',
    'notification.send': 'bell',
    'notification.sendEmail': 'mail',
    'notification.logActivity': 'list',
    'notification.createTask': 'list',
    'connector.push': 'plug',
    'artifact.create': 'file-text',
    'artifact.store': 'file-text',
    'iterate.forEach': 'repeat',
    'document.generateFromTemplate': 'file-text',
    'text.generate': 'type',
  };
  return map[actionType] || 'zap';
}

/**
 * Turns a WHERE clause object/string into a short readable string.
 * { status: 'active', matter_id: '{{matterId}}' } → `status = 'active', matter_id = '{{matterId}}'`
 */
function summarizeWhere(where) {
  if (!where) return '';
  if (typeof where === 'string') return truncate(where, 80);
  if (typeof where === 'object') {
    return Object.entries(where)
      .slice(0, 3)
      .map(([k, v]) => `${k} = '${String(v)}'`)
      .join(', ');
  }
  return '';
}

/**
 * Builds a details array for connector.push, surfacing the most useful
 * fields from config.data (to/subject for email, summary/start for calendar, etc.)
 */
function connectorPushDetails(config) {
  const details = [];
  if (config.connector_id) {
    details.push({ label: 'Connector', value: humanizeConnectorId(config.connector_id) });
  }
  if (config.endpoint) {
    details.push({ label: 'Endpoint', value: config.endpoint });
  }
  const data = config.data || {};
  // Prioritised interesting keys
  const interesting = ['to', 'subject', 'summary', 'start', 'title', 'name', 'body', 'message'];
  for (const key of interesting) {
    if (data[key] !== undefined) {
      details.push({ label: key.charAt(0).toUpperCase() + key.slice(1), value: truncate(String(data[key]), 80) });
    }
  }
  return details;
}

// ---------------------------------------------------------------------------
// When-clause humanizer
// ---------------------------------------------------------------------------

const OP_LABELS = {
  equals: 'is',
  not_equals: 'is not',
  exists: 'exists',
  not_exists: 'does not exist',
  gt: '>',
  lt: '<',
  contains: 'contains',
  matches: 'matches'
};

/**
 * Formats a single leaf condition `{ path, op, value }` as a short phrase.
 * e.g. `action.find-intake-slot.is_fallback equals false`
 *      → "`action.find-intake-slot.is_fallback` is false"
 *
 * @param {{ path: string, op: string, value?: * }} cond
 * @returns {string}
 */
function humanizeLeafCondition(cond) {
  const pathDisplay = '`' + String(cond.path || '?') + '`';
  const opLabel = OP_LABELS[cond.op] || String(cond.op || '');
  const needsValue = cond.op !== 'exists' && cond.op !== 'not_exists';
  if (!needsValue) return `${pathDisplay} ${opLabel}`;
  const val = cond.value === undefined ? '' : String(cond.value);
  return `${pathDisplay} ${opLabel} ${val}`;
}

/**
 * Recursively converts a when-clause into a human-readable sentence fragment.
 * Handles leaf `{ path, op, value }`, `{ all }`, `{ any }`, `{ not }`.
 *
 * @param {object} clause  - the when clause (may be deeply nested)
 * @param {number} [depth] - recursion depth (used to parenthesise sub-clauses)
 * @returns {string}
 */
function humanizeWhenClause(clause, depth = 0) {
  if (!clause || typeof clause !== 'object') return '';

  if ('not' in clause) {
    const inner = humanizeWhenClause(clause.not, depth + 1);
    return inner ? `NOT (${inner})` : 'NOT (...)';
  }

  if ('all' in clause && Array.isArray(clause.all)) {
    const parts = clause.all.map((c) => humanizeWhenClause(c, depth + 1)).filter(Boolean);
    if (!parts.length) return '';
    const joined = parts.join(' AND ');
    return depth > 0 ? `(${joined})` : joined;
  }

  if ('any' in clause && Array.isArray(clause.any)) {
    const parts = clause.any.map((c) => humanizeWhenClause(c, depth + 1)).filter(Boolean);
    if (!parts.length) return '';
    const joined = parts.join(' OR ');
    return depth > 0 ? `(${joined})` : joined;
  }

  // Leaf condition
  if ('path' in clause && 'op' in clause) {
    return humanizeLeafCondition(clause);
  }

  return '';
}

/**
 * Converts a `when` clause from a automation action into a complete display sentence.
 * Returns an empty string when there is no when clause.
 *
 * Examples:
 *   humanizeWhen({ all: [{ path: 'action.x.is_fallback', op: 'equals', value: false }] })
 *   → "Runs only if `action.x.is_fallback` is false"
 *
 *   humanizeWhen(null)  → ""
 *
 * @param {object|null|undefined} whenClause
 * @returns {string}
 */
export function humanizeWhen(whenClause) {
  if (!whenClause) return '';
  const fragment = humanizeWhenClause(whenClause, 0);
  if (!fragment) return '';
  return `Runs only if ${fragment}`;
}

// ---------------------------------------------------------------------------
// Main step descriptor
// ---------------------------------------------------------------------------

/**
 * @param {object} action  - { action_id, action_type, config, dependsOn, when? }
 * @returns {{ icon, typeLabel, summary, details, whenSentence }}
 */
export function describeStep(action) {
  const type = String(action.action_type || action.type || '');
  const config = action.config || {};
  const typeLabel = humanizeActionType(type);
  const icon = iconForType(type);
  let summary = '';
  let details = [];

  switch (type) {
    case 'ai.chat':
      summary = config.message
        ? `Asks LANA: \u201c${truncate(config.message, 140)}\u201d`
        : 'Sends a message to LANA AI';
      if (config.model) details.push({ label: 'Model', value: config.model });
      break;

    case 'ai.generateText':
      summary = config.prompt
        ? `Generates text: \u201c${truncate(config.prompt, 140)}\u201d`
        : 'Generates text using AI';
      if (config.model) details.push({ label: 'Model', value: config.model });
      break;

    case 'ai.extractEntities':
      summary = config.text_source
        ? `Extracts entities from: ${config.text_source}`
        : config.text
          ? `Extracts entities from: ${truncate(config.text, 80)}`
          : 'Extracts named entities using AI';
      if (config.entity_types) details.push({ label: 'Entity types', value: [].concat(config.entity_types).join(', ') });
      break;

    case 'ai.analyze':
      summary = config.prompt
        ? `Analyzes: \u201c${truncate(config.prompt, 140)}\u201d`
        : 'Analyzes content using AI';
      if (config.model) details.push({ label: 'Model', value: config.model });
      break;

    case 'database.query':
      summary = config.table
        ? `Reads from \`${config.table}\`${config.where ? ' where ' + summarizeWhere(config.where) : ''}`
        : 'Queries the database';
      if (config.table) details.push({ label: 'Table', value: config.table });
      if (config.limit) details.push({ label: 'Limit', value: String(config.limit) });
      break;

    case 'database.insert': {
      const titleHint = config.data?.title || config.data?.name || '';
      summary = config.table
        ? `Creates a \`${config.table}\` record${titleHint ? ` \u2014 \u201c${truncate(titleHint, 60)}\u201d` : ''}`
        : 'Inserts a record into the database';
      if (config.table) details.push({ label: 'Table', value: config.table });
      if (config.data && Object.keys(config.data).length) {
        details.push({ label: 'Fields', value: Object.keys(config.data).join(', ') });
      }
      break;
    }

    case 'database.update': {
      const fieldCount = Object.keys(config.data || {}).length;
      summary = config.table
        ? `Updates \`${config.table}\` \u2014 ${fieldCount} field${fieldCount !== 1 ? 's' : ''}`
        : 'Updates a database record';
      if (config.table) details.push({ label: 'Table', value: config.table });
      if (config.where) details.push({ label: 'Where', value: summarizeWhere(config.where) });
      break;
    }

    case 'database.delete':
      summary = config.table
        ? `Deletes from \`${config.table}\``
        : 'Deletes a database record';
      if (config.table) details.push({ label: 'Table', value: config.table });
      if (config.where) details.push({ label: 'Where', value: summarizeWhere(config.where) });
      break;

    case 'notification.send':
      summary = config.title || config.message
        ? `Sends notification: \u201c${truncate(config.title || config.message, 120)}\u201d`
        : 'Sends a system notification';
      if (config.channel) details.push({ label: 'Channel', value: config.channel });
      break;

    case 'notification.sendEmail': {
      const recipients = Array.isArray(config.recipients)
        ? config.recipients.join(', ')
        : String(config.recipients || config.to || 'recipients');
      summary = `Emails ${truncate(recipients, 60)} \u2014 subject: \u201c${truncate(config.subject || '', 80)}\u201d`;
      if (config.subject) details.push({ label: 'Subject', value: config.subject });
      if (config.template) details.push({ label: 'Template', value: config.template });
      break;
    }

    case 'notification.logActivity':
      summary = config.event_type
        ? `Logs activity: \`${config.event_type}\``
        : 'Logs an activity event';
      if (config.event_type) details.push({ label: 'Event type', value: config.event_type });
      break;

    case 'notification.createTask':
      summary = config.title
        ? `Creates task: \u201c${truncate(config.title, 120)}\u201d`
        : 'Creates a task';
      if (config.due_date) details.push({ label: 'Due', value: config.due_date });
      if (config.assignee) details.push({ label: 'Assignee', value: config.assignee });
      break;

    case 'connector.push':
      summary = `Calls ${humanizeConnectorId(config.connector_id)} \u00b7 ${config.endpoint || 'endpoint'}`;
      details = connectorPushDetails(config);
      break;

    case 'artifact.create':
      summary = config.artifact_name
        ? `Saves artifact: \u201c${truncate(config.artifact_name, 100)}\u201d (${config.artifact_type || 'output'})`
        : 'Creates and saves an artifact';
      if (config.artifact_type) details.push({ label: 'Type', value: config.artifact_type });
      break;

    case 'artifact.store':
      summary = config.artifact_name
        ? `Stores file as \u201c${truncate(config.artifact_name, 100)}\u201d`
        : 'Stores a file artifact';
      if (config.artifact_type) details.push({ label: 'Type', value: config.artifact_type });
      break;

    case 'iterate.forEach':
      summary = config.items
        ? `For each item in \`${config.items}\`, runs ${humanizeActionType(config.action_type || '')}`
        : 'Iterates over a collection';
      if (config.items) details.push({ label: 'Items', value: config.items });
      break;

    case 'document.generateFromTemplate':
      summary = config.templateDocumentId
        ? `Generates document from template ${truncate(config.templateDocumentId, 60)}`
        : 'Generates a document from a template';
      if (config.templateDocumentId) details.push({ label: 'Template ID', value: config.templateDocumentId });
      if (config.output_name) details.push({ label: 'Output', value: config.output_name });
      break;

    case 'text.generate':
      summary = 'Formats text using template';
      if (config.template) details.push({ label: 'Template', value: truncate(config.template, 80) });
      break;

    default:
      summary = type ? `Runs ${type}` : 'Executes step';
      // Surface a few config keys if available
      if (config && Object.keys(config).length) {
        Object.entries(config)
          .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
          .slice(0, 3)
          .forEach(([k, v]) => details.push({ label: k, value: truncate(String(v), 60) }));
      }
  }

  const whenSentence = humanizeWhen(action.when);

  return { icon, typeLabel, summary, details, whenSentence };
}

// ---------------------------------------------------------------------------
// Trigger humanizer
// ---------------------------------------------------------------------------

const TRIGGER_EVENT_LABELS = {
  'email.received': 'Fires when a new email arrives',
  'email.sent': 'Fires when an email is sent',
  'document.uploaded': 'Fires when a document is uploaded',
  'document.processed': 'Fires when a document finishes processing',
  'matter.created': 'Fires when a new matter is created',
  'matter.updated': 'Fires when a matter is updated',
  'matter.closed': 'Fires when a matter is closed',
  'contact.created': 'Fires when a new contact is created',
  'contact.linked_to_matter': 'Fires when a contact is linked to a matter',
  'approval.requested': 'Fires when an approval is requested',
  'approval.approved': 'Fires when an approval is granted',
  'approval.rejected': 'Fires when an approval is rejected',
  'task.created': 'Fires when a task is created',
  'task.completed': 'Fires when a task is marked complete',
  'connector.sync_completed': 'Fires when a connector sync finishes',
  'manual': 'Triggered manually',
  'trigger': 'Triggered on demand',
};

function humanizeSchedule(schedule) {
  if (!schedule) return null;
  const type = schedule.type || schedule.trigger_type || '';

  if (type === 'schedule.hourly' || type === 'hourly') {
    const n = schedule.every_n_hours;
    return n && Number(n) > 1 ? `Runs every ${n} hours` : 'Runs every hour';
  }
  if (type === 'schedule.daily' || type === 'daily') {
    const t = schedule.time || schedule.at;
    return t ? `Runs daily at ${t}` : 'Runs daily';
  }
  if (type === 'schedule.weekly' || type === 'weekly') {
    const day = schedule.day_of_week
      ? schedule.day_of_week.charAt(0).toUpperCase() + schedule.day_of_week.slice(1)
      : null;
    const t = schedule.time || schedule.at;
    if (day && t) return `Runs every ${day} at ${t}`;
    if (day) return `Runs every ${day}`;
    return 'Runs weekly';
  }
  if (type === 'schedule.monthly' || type === 'monthly') {
    const d = schedule.day_of_month;
    const t = schedule.time || schedule.at;
    if (d && t) return `Runs monthly on day ${d} at ${t}`;
    if (d) return `Runs monthly on day ${d}`;
    return 'Runs monthly';
  }
  if (type === 'schedule.minutes' || type === 'minutes') {
    const n = schedule.every_n_minutes;
    return n ? `Runs every ${n} minute${n !== 1 ? 's' : ''}` : 'Runs on a minute interval';
  }
  // Fallback: cron expression
  if (schedule.cron) return `Runs on schedule: ${schedule.cron}`;
  return null;
}

/**
 * @param {object} trigger  - { trigger_type|type, event_type, schedule, conditions }
 * @returns {{ summary, conditionChips }}
 */
export function humanizeTrigger(trigger) {
  if (!trigger) return { summary: 'No trigger configured', conditionChips: [] };

  const rawType = trigger.trigger_type || trigger.type || '';

  // Schedule triggers
  if (rawType.startsWith('schedule') || trigger.schedule) {
    const schedObj = trigger.schedule
      ? trigger.schedule
      : { type: rawType, ...trigger };
    const text = humanizeSchedule(schedObj);
    return { summary: text || 'Runs on a schedule', conditionChips: [] };
  }

  // Event triggers
  const eventType = trigger.event_type || rawType;
  const base = TRIGGER_EVENT_LABELS[eventType]
    || (eventType ? `Fires on \u201c${eventType}\u201d` : 'Triggered on demand');

  // Condition chips
  const conditions = Array.isArray(trigger.conditions) ? trigger.conditions : [];
  const chips = conditions
    .filter(Boolean)
    .map((c) => {
      const field = c.field || c.key || '?';
      const op = c.operator || c.op || 'equals';
      const val = c.value !== undefined ? String(c.value) : '';
      return `${field} ${op.replace(/_/g, ' ')} "${truncate(val, 40)}"`;
    });

  return { summary: base, conditionChips: chips };
}
