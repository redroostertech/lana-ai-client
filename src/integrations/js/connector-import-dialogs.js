/*
 * ConnectorImportDialogs - the small dialogs the file-import connector
 * dashboards (ActionStep, Leadly) share, on lex-modal (UI standard section 11).
 *
 * Both pages used to build the same hand-made fixed-inset overlays for
 * "create folder", "setup required" and "type DELETE to remove the
 * configuration". They now call this module:
 *
 *   const name = await ConnectorImportDialogs.promptFolderName();      // null if cancelled
 *   ConnectorImportDialogs.showSetupRequired('ActionStep');
 *   ConnectorImportDialogs.confirmTypedDelete({ connectorLabel: 'ActionStep', onConfirm: async () => { ... } });
 *
 * Requires lex.core.js and lex-modal.js (lex-btn.js for the footer buttons).
 */
(function (global) {
  'use strict';

  var FOLDER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
  var DELETE_WORD = 'DELETE';

  function toastError(message) {
    var T = global.Toast || (global.Lex && global.Lex.Toast);
    if (T && typeof T.error === 'function') T.error(message);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  /** Returns an error message for an invalid folder name, or '' when valid. */
  function validateFolderName(name) {
    var value = String(name == null ? '' : name).trim();
    if (!value) return 'Please enter a folder name';
    if (!FOLDER_NAME_PATTERN.test(value)) {
      return 'Folder name can only contain letters, numbers, hyphens, and underscores';
    }
    return '';
  }

  /**
   * Ask for a new folder name. Re-asks (keeping the typed value) after an
   * invalid name, as the old dialog stayed open. Resolves the name, or null.
   */
  async function promptFolderName() {
    var value = '';
    for (;;) {
      var name = await global.Lex.Modal.prompt('Create new folder', {
        label: 'Folder name',
        value: value,
        placeholder: 'Enter folder name',
        message: 'Only letters, numbers, hyphens, and underscores allowed.',
        confirmText: 'Create',
        required: true
      });
      if (name === null) return null;
      var error = validateFolderName(name);
      if (!error) return name.trim();
      toastError(error);
      value = name;
    }
  }

  /** "Setup required" notice for a connector that has no import folder yet. */
  function showSetupRequired(connectorLabel) {
    return global.Lex.Modal.alertAsync(
      'Setup required',
      'Set up the folder where your ' + (connectorLabel || 'connector') +
        ' files will be stored and processed. This only takes a minute.',
      { confirmText: 'Got it' }
    );
  }

  var activeDeleteDialog = null;

  /**
   * Type-DELETE confirmation for removing a connector's configuration.
   * opts: connectorLabel, onConfirm() (async; throw to keep the dialog open).
   * The confirm button (#confirmDeleteBtn) stays disabled until the field
   * (#deleteConfirmInput) holds DELETE; Enter in the field confirms.
   * Returns a handle { modal, confirm(), close() }.
   */
  function confirmTypedDelete(opts) {
    opts = opts || {};
    if (activeDeleteDialog) activeDeleteDialog.close();
    var label = escapeHtml(opts.connectorLabel || 'connector');

    var content =
      '<p class="text-sm text-gray-600 mb-3">This action cannot be undone.</p>' +
      '<p class="text-sm text-gray-700 mb-3">This will delete your ' + label +
        ' configuration settings. Your synced data (matters, participants, etc.) will <strong>NOT</strong> be deleted.</p>' +
      '<label for="deleteConfirmInput" class="block text-sm text-gray-700 mb-2">To confirm, type <strong>' + DELETE_WORD + '</strong> in the box below:</label>' +
      '<input type="text" id="deleteConfirmInput" placeholder="Type ' + DELETE_WORD + '" autocomplete="off"' +
        ' class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500">' +
      '<lex-btn data-slot="footer" variant="secondary" data-delete-cancel>Cancel</lex-btn>' +
      '<lex-btn data-slot="footer" variant="danger" id="confirmDeleteBtn" disabled>Delete configuration</lex-btn>';

    var modal = global.Lex.Modal.open({ heading: 'Delete configuration', content: content, size: 'sm' });
    var root = modal.contentRoot || modal;
    var input = root.querySelector('#deleteConfirmInput');
    var confirmBtn = modal.querySelector('#confirmDeleteBtn');
    var cancelBtn = modal.querySelector('[data-delete-cancel]');
    var busy = false;

    function typed() { return !!input && input.value === DELETE_WORD; }

    var handle = {
      modal: modal,
      close: function () {
        if (activeDeleteDialog === handle) activeDeleteDialog = null;
        if (typeof modal.removeAfterClose === 'function') modal.removeAfterClose();
        else modal.open = false;
      },
      confirm: async function () {
        if (busy || !typed()) return;
        busy = true;
        if (confirmBtn) confirmBtn.loading = true;
        try {
          if (typeof opts.onConfirm === 'function') await opts.onConfirm();
          handle.close();
        } catch (_) {
          // The caller reports the error; the dialog stays open to retry.
          if (confirmBtn) confirmBtn.loading = false;
        } finally {
          busy = false;
        }
      }
    };

    if (input) {
      input.addEventListener('input', function () {
        if (confirmBtn) confirmBtn.disabled = !typed();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && typed()) {
          e.preventDefault();
          handle.confirm();
        }
      });
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(function () { input.focus(); });
      }
    }
    if (confirmBtn) confirmBtn.addEventListener('click', function () { handle.confirm(); });
    if (cancelBtn) cancelBtn.addEventListener('click', function () { handle.close(); });
    modal.addEventListener('lex-close', function () {
      if (activeDeleteDialog === handle) activeDeleteDialog = null;
    });

    activeDeleteDialog = handle;
    return handle;
  }

  /** The open type-DELETE dialog, or null. */
  function activeDelete() { return activeDeleteDialog; }

  var ConnectorImportDialogs = {
    validateFolderName: validateFolderName,
    promptFolderName: promptFolderName,
    showSetupRequired: showSetupRequired,
    confirmTypedDelete: confirmTypedDelete,
    activeDelete: activeDelete
  };

  global.ConnectorImportDialogs = ConnectorImportDialogs;
  if (typeof module !== 'undefined' && module.exports) module.exports = ConnectorImportDialogs;
})(typeof window !== 'undefined' ? window : globalThis);
