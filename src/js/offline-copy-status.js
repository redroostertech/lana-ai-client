/**
 * Offline copy view models (local AI engine plan, phase 10).
 *
 * The engine on this computer keeps the signed-in person's offline copy and
 * answers GET /api/engine/v1/offline/status. This module only turns that
 * answer into words and tones for the UI: the Settings "Offline copy" card,
 * the conflict list, the offline banner text and the "From your offline copy
 * as of" label on answers. No rule about what the copy may hold lives here;
 * the organization's server decides that.
 */
(function (global) {
  'use strict';

  var STATES = {
    off: { label: 'Off', tone: 'gray' },
    empty: { label: 'Not synced yet', tone: 'gray' },
    syncing: { label: 'Syncing', tone: 'blue' },
    ready: { label: 'Ready', tone: 'green' },
    locked: { label: 'Locked', tone: 'red' }
  };

  var KIND_LABELS = { 'task.create': 'New task', 'task.update': 'Task change', 'note.create': 'New note', 'note.update': 'Note change', 'chat.exchange': 'Offline chat' };

  function formatAsOf(iso, locale) {
    if (!iso) return '';
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(locale || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /** "From your offline copy as of Nov 2, 3:04 PM" */
  function asOfLabel(iso, locale) {
    var when = formatAsOf(iso, locale);
    return when ? 'From your offline copy as of ' + when : 'From your offline copy';
  }

  function plural(count, one, many) {
    return count + ' ' + (count === 1 ? one : many);
  }

  function countsLine(counts) {
    var c = counts || {};
    var parts = [];
    if (c.matter) parts.push(plural(c.matter, 'matter', 'matters'));
    if (c.task) parts.push(plural(c.task, 'task', 'tasks'));
    if (c.note) parts.push(plural(c.note, 'note', 'notes'));
    if (c.contact) parts.push(plural(c.contact, 'contact', 'contacts'));
    if (c.document) parts.push(plural(c.document, 'document', 'documents'));
    if (c.thread) parts.push(plural(c.thread, 'chat', 'chats'));
    return parts.length ? parts.join(', ') : 'Nothing yet';
  }

  var FIELD_LABELS = { status: 'Status', priority: 'Priority', due_date: 'Due date', content: 'Text', description: 'Description' };

  function fieldValue(field, value) {
    if (value === null || value === undefined || value === '') return 'none';
    if (field === 'due_date') return formatAsOf(value) || String(value);
    if (field === 'status' || field === 'priority') return String(value).split('_').join(' ');
    return String(value);
  }

  /**
   * Each side of a conflict in the person's own words: the title when they
   * changed it, otherwise the first field they changed (Status: in progress)
   * and the server's value of the same field.
   */
  function conflictSides(conflict) {
    var fields = conflict.fields || {};
    var current = conflict.current || {};
    if (fields.title) return { mine: fields.title, theirs: current.title || 'The server\'s version' };
    var field = Object.keys(fields).filter(function (f) { return FIELD_LABELS[f]; })[0];
    if (!field) return { mine: 'Your offline change', theirs: current.title || 'The server\'s version' };
    return { mine: FIELD_LABELS[field] + ': ' + fieldValue(field, fields[field]), theirs: FIELD_LABELS[field] + ': ' + fieldValue(field, current[field]) + (current.title ? ' (' + current.title + ')' : '') };
  }

  function conflictTitle(conflict) {
    var fields = conflict.fields || {};
    var current = conflict.current || {};
    return fields.title || current.title || KIND_LABELS[conflict.kind] || 'Change';
  }

  /**
   * The Settings card.
   * @param {Object|null} status - the engine's offline status, or null when the engine has none
   */
  function settingsView(status, locale) {
    if (!status) {
      return { available: false, badge: STATES.off.label, tone: STATES.off.tone, message: 'An offline copy needs the local AI service on this computer.', rows: [], conflicts: [], refused: [] };
    }
    var state = STATES[status.state] ? status.state : 'off';
    var message = '';
    if (state === 'locked') message = status.locked_message || 'Your offline copy is locked. Connect to the internet to unlock it.';
    else if (state === 'empty') message = 'LANA makes your offline copy the next time this computer reaches your organization\'s server.';
    else if (state === 'off') message = status.signed_in ? 'Your offline copy is off on this computer.' : 'Sign in to keep an offline copy on this computer.';
    else if (status.last_error && status.last_error.code === 'OFFLINE_COPIES_DISABLED') message = 'Your organization has turned off offline copies.';
    var rows = [
      { label: 'Up to date as of', value: formatAsOf(status.as_of, locale) || 'Not yet' },
      { label: 'On this computer', value: countsLine(status.counts) },
      { label: 'Changes waiting to sync', value: String(status.queued || 0) },
      { label: 'Locks after', value: (status.lock_after_days || 14) + ' days without a sync' }
    ];
    return {
      available: true,
      state: state,
      badge: STATES[state].label,
      tone: STATES[state].tone,
      message: message,
      rows: rows,
      conflicts: (status.conflicts || []).map(function (c) {
        return {
          opId: c.op_id,
          title: conflictTitle(c),
          detail: (KIND_LABELS[c.kind] || 'Change') + ': someone changed this on your organization\'s server while you were offline.',
          mine: conflictSides(c).mine,
          theirs: conflictSides(c).theirs
        };
      }),
      refused: (status.refused || []).map(function (r) {
        return { opId: r.op_id, title: KIND_LABELS[r.kind] || 'Change', detail: r.message || 'Your organization\'s server did not accept this change.' };
      })
    };
  }

  /** The offline banner sentence, when the organization's server cannot be reached. */
  function bannerMessage(status, locale) {
    if (!status) return null;
    if (status.state === 'locked') return 'You\'re offline, and your offline copy is locked because it has not synced for 14 days.';
    if (status.state === 'ready' || status.state === 'syncing') {
      return 'You\'re offline. LANA answers from your offline copy as of ' + (formatAsOf(status.as_of, locale) || 'its last sync') + '. Changes you make sync when you are back online.';
    }
    return null;
  }

  /** The organization card (admins): the switch, from GET /api/v1/offline-copies. */
  function adminView(overview) {
    var enabled = !overview || overview.enabled !== false;
    return {
      enabled: enabled,
      description: enabled
        ? 'People in your organization can keep an encrypted offline copy of their own work on their computers. It locks after 14 days without a sync.'
        : 'Offline copies are off. Computers remove their copies the next time they sync.'
    };
  }

  /**
   * The "Waiting to sync" badge for a task or note the person changed while
   * offline (the engine marks it pending_offline until the organization's
   * server has it). Empty for anything else.
   */
  function waitingBadgeHtml(item) {
    return item && item.pending_offline === true
      ? '<lex-badge class="lana-offline-waiting" label="Waiting to sync" color="blue" size="sm"></lex-badge>'
      : '';
  }

  var api = { STATES: STATES, asOfLabel: asOfLabel, waitingBadgeHtml: waitingBadgeHtml, formatAsOf: formatAsOf, settingsView: settingsView, bannerMessage: bannerMessage, adminView: adminView, countsLine: countsLine, lastStatus: null };

  global.LanaOfflineCopy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
