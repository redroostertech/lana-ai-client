/**
 * proposal-outline.js
 * Reads an agent artifact that proposes tasks and notes (for example a work
 * proposal: one task batch plus a summary note of labeled items) as a
 * person reviewing it needs to see it, on the Approvals detail page and in
 * the agents app. Any artifact kind whose content carries `tasks` and/or
 * `summary.items` is read the same way; nothing here looks at the kind.
 *
 *   content: { title?, tasks?: [{ title, description?, priority?, about?: [ref], resolves?: [ref] }],
 *              summary?: { title?, items: [{ label, title, text?, about?: [ref] }] } }
 *   ref: { kind, id } (a rule id, an assurance record, an asset, ...)
 *
 * The server checks every reference when the artifact is applied; this
 * module only names them (shared/entity-links.js) and the note labels
 * (shared/note-labels.js). After apply the tasks live on the matter's Board.
 *
 * Public API (window.LanaProposalOutline, or module.exports in Node):
 *   - outline(content)            -> { title, tasks, notes } | null
 *   - html(outline, escapeHtml)   -> markup (Lex badges; css/proposal-outline.css)
 *   - stateLine(artifact)         -> { state: 'pending'|'approved'|'applied'|'failed'|'other', text }
 *       failed: the apply stopped part way (failed_to_apply); the person who
 *       applies may press "Apply again" (APPLY_AGAIN), which finishes what is
 *       missing without making anything twice.
 *   - tasksHref(matterId, prefix) -> link to the matter's Board
 */

(function (global) {
  'use strict';

  var inNode = typeof module !== 'undefined' && module.exports;
  function links() { return global.LanaEntityLinks || (inNode && require('./entity-links.js')) || null; }
  function labels() { return global.LanaNoteLabels || (inNode && require('./note-labels.js')) || null; }

  var PRIORITY_TONES = { high: 'red', urgent: 'red', medium: 'yellow', normal: 'gray', low: 'gray' };

  function list(value) { return Array.isArray(value) ? value : []; }
  function text(value) { return typeof value === 'string' ? value.trim() : ''; }

  function refChip(ref, relation) {
    if (!ref || !ref.kind || ref.id === undefined || ref.id === null) return null;
    var entity = links();
    var label = entity ? entity.endLabel({ kind: ref.kind, id: ref.id }, null) : ref.kind + ' ' + ref.id;
    return { text: relation === 'resolves' ? 'Resolves ' + label : label, title: (entity ? entity.kindLabel(ref.kind) : ref.kind) + ' ' + ref.id, relation: relation };
  }

  function chips(item) {
    return list(item.about).map(function (ref) { return refChip(ref, 'about'); })
      .concat(list(item.resolves).map(function (ref) { return refChip(ref, 'resolves'); }))
      .filter(Boolean);
  }

  function outline(content) {
    var body = content && typeof content === 'object' && !Array.isArray(content) ? content : null;
    if (!body) return null;
    var tasks = list(body.tasks).filter(function (task) { return task && text(task.title); });
    var items = list(body.summary && body.summary.items).filter(function (item) { return item && text(item.title); });
    if (!tasks.length && !items.length) return null;
    var noteLabels = labels();
    return {
      title: text(body.title),
      tasks: tasks.map(function (task) {
        return { title: text(task.title), description: text(task.description), priority: text(task.priority), chips: chips(task) };
      }),
      notes: {
        title: text(body.summary && body.summary.title),
        items: items.map(function (item) {
          return {
            label: text(item.label),
            labelText: noteLabels ? noteLabels.labelText(text(item.label)) : text(item.label),
            title: text(item.title),
            text: text(item.text),
            chips: chips(item)
          };
        })
      }
    };
  }

  function chipsHtml(items, esc) {
    if (!items.length) return '';
    return '<div class="proposal-outline__chips">' + items.map(function (chip) {
      return '<lex-badge size="sm" color="' + (chip.relation === 'resolves' ? 'blue' : 'gray') + '" label="' + esc(chip.text) + '" title="' + esc(chip.title) + '"></lex-badge>';
    }).join('') + '</div>';
  }

  function html(view, esc) {
    if (!view) return '';
    var out = '<div class="proposal-outline">';
    if (view.title) out += '<p class="proposal-outline__title">' + esc(view.title) + '</p>';
    if (view.tasks.length) {
      out += '<section class="proposal-outline__section"><h4 class="proposal-outline__heading">Proposed tasks <span>' + view.tasks.length + '</span></h4><ol class="proposal-outline__list">';
      view.tasks.forEach(function (task) {
        out += '<li class="proposal-outline__item"><div class="proposal-outline__item-head"><strong>' + esc(task.title) + '</strong>' +
          (task.priority ? '<lex-badge size="sm" color="' + (PRIORITY_TONES[task.priority] || 'gray') + '" label="' + esc(task.priority.charAt(0).toUpperCase() + task.priority.slice(1)) + '"></lex-badge>' : '') + '</div>' +
          (task.description ? '<p class="proposal-outline__text">' + esc(task.description) + '</p>' : '') + chipsHtml(task.chips, esc) + '</li>';
      });
      out += '</ol></section>';
    }
    if (view.notes.items.length) {
      out += '<section class="proposal-outline__section"><h4 class="proposal-outline__heading">' + esc(view.notes.title || 'Summary notes') + ' <span>' + view.notes.items.length + '</span></h4><ul class="proposal-outline__list">';
      view.notes.items.forEach(function (item) {
        out += '<li class="proposal-outline__item"><div class="proposal-outline__item-head">' +
          (item.labelText ? '<lex-badge size="sm" color="' + (item.label === 'open_question' ? 'yellow' : 'green') + '" label="' + esc(item.labelText) + '"></lex-badge>' : '') +
          '<strong>' + esc(item.title) + '</strong></div>' +
          (item.text ? '<p class="proposal-outline__text">' + esc(item.text) + '</p>' : '') + chipsHtml(item.chips, esc) + '</li>';
      });
      out += '</ul></section>';
    }
    return out + '</div>';
  }

  function stateLine(artifact) {
    var status = String((artifact && artifact.status) || '').toLowerCase();
    if (status === 'applied') return { state: 'applied', text: 'Applied. The tasks and notes are on the matter.' };
    if (status === 'approved') return { state: 'approved', text: 'Approved. Apply it from the agent run to create the tasks and notes.' };
    if (status === 'failed_to_apply') return { state: 'failed', text: 'Applying it did not finish. Apply it again to create what is missing; nothing is made twice.' };
    if (!status || status === 'proposed' || status === 'pending' || status === 'awaiting_approval') return { state: 'pending', text: '' };
    return { state: 'other', text: '' };
  }

  function tasksHref(matterId, prefix) {
    if (!matterId) return '';
    return (prefix || '') + 'workspace-details.html?id=' + encodeURIComponent(matterId) + '&tab=tasks';
  }

  var APPLY_AGAIN = 'Apply again';

  var moduleApi = { APPLY_AGAIN: APPLY_AGAIN, outline: outline, html: html, stateLine: stateLine, tasksHref: tasksHref };
  if (inNode) module.exports = moduleApi;
  if (global) global.LanaProposalOutline = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
