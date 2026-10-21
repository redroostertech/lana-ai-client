/**
 * brainchild-table.js
 * The Brainchild "My" notes table (docs/TABLE-STANDARD.md). Notes come from
 * the local vault over the Electron bridge (list_notes) as one whole list, so
 * the table is client-side. The Organization scope uses
 * doc-studio-library-table.js.
 *
 * Public API (window.BrainchildTable, or module.exports in Node):
 *   - mapNote(note)            -> raw row { id, name, folder, created_at, updated_at, _vaultPath, _source }
 *   - mapNotes(notes)          -> rows, de-duplicated by vault path
 *   - noteFolder(path)         -> the note's folder within the vault ('' at the root)
 *   - renderers()              -> lex-table cell renderers
 *   - filterOptions()          -> column filter config (name text, date ranges)
 *   - emptyText(filtered)
 *   - countLabel(total)
 *   - SORT_OPTIONS
 */

(function (global) {
  'use strict';

  var SORT_OPTIONS = [
    { value: 'updated_at', label: 'Last edited' },
    { value: 'created_at', label: 'Created' },
    { value: 'name', label: 'Name' },
    { value: 'folder', label: 'Folder' }
  ];

  var MUTED = '<span class="bc-cell-muted">\u2014</span>';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function utils() {
    return global && global.Lex && global.Lex.Utils ? global.Lex.Utils : null;
  }

  function vaultPath(note) {
    var n = note || {};
    return String(n.path || n.vault_path || n.relativePath || '');
  }

  function noteFolder(path) {
    var clean = String(path || '').split('\\').join('/');
    var slash = clean.lastIndexOf('/');
    return slash > 0 ? clean.slice(0, slash) : '';
  }

  function mapNote(note) {
    var n = note || {};
    var path = vaultPath(n);
    var name = n.title || n.name || path || 'Untitled note';
    return {
      id: 'brainchild:' + (path || name),
      name: name,
      folder: noteFolder(path),
      created_at: n.created_at || n.created || '',
      updated_at: n.updated_at || n.modified || n.created_at || n.created || '',
      _kind: 'brainchild',
      _vaultPath: path,
      _source: n
    };
  }

  function mapNotes(notes) {
    var seen = {};
    return (Array.isArray(notes) ? notes : []).filter(function (note) {
      var key = vaultPath(note);
      if (key && seen[key]) return false;
      if (key) seen[key] = true;
      return true;
    }).map(mapNote);
  }

  function dateTime(value) {
    var u = utils();
    if (!value || !u) return '';
    var text = u.formatDateTime(value);
    return text === 'Never' ? '' : text;
  }

  function renderers() {
    return {
      name: function (value) {
        return '<span class="bc-name-cell"><span class="bc-name" title="' + esc(value) + '">' + esc(value) + '</span></span>';
      },
      folder: function (value) {
        return value ? '<span class="bc-cell-muted" title="' + esc(value) + '">' + esc(value) + '</span>' : MUTED;
      },
      created_at: function (value) {
        var text = dateTime(value);
        return text ? '<time class="bc-time" datetime="' + esc(value) + '">' + esc(text) + '</time>' : MUTED;
      },
      updated_at: function (value) {
        var u = utils();
        var text = value && u ? u.timeAgo(value) : '';
        if (!text || text === '-') return MUTED;
        return '<time class="bc-time" datetime="' + esc(value) + '" title="' + esc(dateTime(value)) + '">' + esc(text) + '</time>';
      }
    };
  }

  // Name filters by text; Folder keeps the values lex-table derives from the
  // rows; the dates use the library ranges.
  function filterOptions() {
    var map = { name: { text: true, placeholder: 'Note name contains...' } };
    var shared = global && global.LanaLibraryColumnFilters;
    if (shared) {
      ['created_at', 'updated_at'].forEach(function (col) {
        map[col] = {
          single: true,
          options: shared.EDITED_RANGE_OPTIONS,
          match: function (cell, values) { return shared.inEditedRange(cell, values[0]); }
        };
      });
    }
    return map;
  }

  function emptyText(filtered) {
    return filtered ? 'No matching notes. Try a different search or clear the filters.' : 'No personal notes found.';
  }

  function countLabel(total) {
    var n = Number(total || 0);
    return n + (n === 1 ? ' note' : ' notes');
  }

  var moduleApi = {
    SORT_OPTIONS: SORT_OPTIONS,
    noteFolder: noteFolder,
    mapNote: mapNote,
    mapNotes: mapNotes,
    renderers: renderers,
    filterOptions: filterOptions,
    emptyText: emptyText,
    countLabel: countLabel
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.BrainchildTable = moduleApi;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
