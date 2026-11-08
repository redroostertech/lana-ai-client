/**
 * task-priority.js
 * One look for a task or subtask priority everywhere it shows: the task
 * drawer, My Tasks, and the matter Board cards. A priority is a lex-badge:
 * High (and urgent / critical) is red, Medium and Normal are yellow, Low and
 * anything else is gray. No priority reads as Normal.
 *
 * Public API (window.LanaTaskPriority, or module.exports in Node):
 *   - label(priority)     -> "High", "Normal", ...
 *   - color(priority)     -> the lex-badge color
 *   - badgeHtml(priority) -> '<lex-badge label=".." color=".."></lex-badge>'
 */

(function (global) {
  'use strict';

  function normalized(priority) {
    return String(priority || 'normal').trim().toLowerCase() || 'normal';
  }

  function label(priority) {
    var p = normalized(priority);
    return p.charAt(0).toUpperCase() + p.slice(1);
  }

  function color(priority) {
    var p = normalized(priority);
    if (p === 'high' || p === 'urgent' || p === 'critical') return 'red';
    if (p === 'medium' || p === 'normal') return 'yellow';
    return 'gray';
  }

  function escapeAttr(value) {
    return String(value)
      .split('&').join('&amp;')
      .split('"').join('&quot;')
      .split('<').join('&lt;')
      .split('>').join('&gt;');
  }

  function badgeHtml(priority) {
    return '<lex-badge label="' + escapeAttr(label(priority)) + '" color="' + color(priority) + '"></lex-badge>';
  }

  var moduleApi = { label: label, color: color, badgeHtml: badgeHtml };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaTaskPriority = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
