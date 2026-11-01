/**
 * note-actions.js
 * What a person can do from a note (design 8, step 5 of the folded page).
 *
 * The matter's makeup view declares them as `note_actions` (backend
 * tab-content.models.js noteActionSchema):
 *   { id, label, form, subject: 'matter_note:{note_id}',
 *     applies_to: { labels: [note label], about_kinds: [link target kind] } }
 * An action applies to a note with one of the labels and an `about` link to
 * one of the kinds. The note id goes into the subject and the form opens for
 * it. When the server needs the person to narrow the subject (a note about
 * more than one record) it refuses with 422 and `error.details.candidates`
 * ([{ subject, label }]); only those are offered.
 *
 * Public API (window.LanaNoteActions, or module.exports in Node):
 *   - actionsFor(note, noteActions)   -> the actions that apply to this note
 *   - subjectFor(action, noteId)      -> the action's subject for this note
 *   - candidateChoice(error)          -> server-form chooseSubject answer, or null
 *   - MESSAGES
 */

(function (global) {
  'use strict';

  var NOTE_ID = '{note_id}';

  var MESSAGES = {
    choose: 'This note is about more than one record. Choose the one this is for.'
  };

  function list(value) { return Array.isArray(value) ? value : []; }

  function noteId(note) { return note && (note.note_id || note.id); }

  // The far ends of the note's about links.
  function aboutKinds(note) {
    var self = { kind: 'matter_note', id: String(noteId(note)) };
    return list(note && note.links).filter(function (link) { return link && link.link_type === 'about'; })
      .map(function (link) {
        var source = link.source || {};
        var end = source.kind === self.kind && String(source.id) === self.id ? link.target : source;
        return end && end.kind;
      })
      .filter(Boolean);
  }

  function actionsFor(note, noteActions) {
    if (!note) return [];
    var kinds = aboutKinds(note);
    return list(noteActions).filter(function (action) {
      var applies = (action && action.applies_to) || {};
      return Boolean(action.form) && typeof action.subject === 'string' &&
        list(applies.labels).indexOf(note.label) !== -1 &&
        list(applies.about_kinds).some(function (kind) { return kinds.indexOf(kind) !== -1; });
    });
  }

  function subjectFor(action, id) {
    return String(action.subject).split(NOTE_ID).join(String(id));
  }

  function candidatesOf(error) {
    var body = error && error.data && error.data.error;
    return list(body && body.details && body.details.candidates).filter(function (item) {
      return item && typeof item.subject === 'string' && item.subject;
    });
  }

  function candidateChoice(error) {
    if (!error || error.status !== 422) return null;
    var candidates = candidatesOf(error);
    if (!candidates.length) return null;
    return {
      heading: 'Choose one',
      message: MESSAGES.choose,
      label: 'For',
      choices: candidates.map(function (item) { return { value: item.subject, label: item.label || item.subject }; })
    };
  }

  var moduleApi = {
    MESSAGES: MESSAGES,
    actionsFor: actionsFor,
    subjectFor: subjectFor,
    candidateChoice: candidateChoice
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = moduleApi;
  if (global) global.LanaNoteActions = moduleApi;
})(typeof window !== 'undefined' ? window : globalThis);
