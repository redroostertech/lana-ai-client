/*
 * library/brainchild-scope.js
 *
 * Renderer-only Brainchild scope controller for the Library (drive) surface.
 *
 * This lifts the proven, status-driven Brainchild flow out of
 * src/brainchild/app.js (which is frozen and must NOT be modified) into a
 * reusable, dependency-injected module that the Library mounts. It is pure
 * presentation plus light wiring: all node/spawn/MCP logic lives in the
 * Electron main process and is reached only through the frozen
 * window.electronAPI.brainchild bridge.
 *
 * Bridge contract consumed (frozen, Piece 1):
 *   status()                 -> { status: 'linked'|'connected', vaultPath, installPath, source }
 *                               | { status: 'degraded', reason }
 *   listNotes({ filter? })   -> { success, notes, count }
 *   search({ query, limit }) -> { success, notes }
 *   getNote({ path })        -> { success, note }   (note.body holds the content)
 *   link({ installPath, vaultPath }) -> { success, status }   (clears unlink suppression)
 *   unlink()                 -> { success, status }           (suppresses auto-bind)
 *   discover()               -> { success, installPath, vaultPath, mcpBin }
 *   pickInstall() / pickVault() -> { success, installPath | vaultPath, canceled? }
 *
 * Auto-bind: in the normal case status() returns linked/connected with
 * source 'auto' and listNotes works with zero connect clicks. We never gate
 * notes behind a mandatory Connect step; connect/reconnect are only offered
 * from the degraded states.
 *
 * Org isolation: promotion is CONVENIENCE-gated client-side only. The LANA-AI
 * backend re-derives the org from the JWT and enforces knowledge:promote. Never
 * treat the client gate as authorization.
 *
 * Project constraint: no emojis, no em dashes, no en dashes anywhere here.
 */
(function (global) {
  'use strict';

  // Map a degraded reason code to user-facing copy. Plain lookup, no regex.
  function degradedCopy(reason) {
    if (reason === 'install_not_found') {
      return 'Brainchild was not found on this device. Choose your install folder to connect.';
    }
    if (reason === 'vault_not_found') {
      return 'Your Brainchild vault could not be read. Choose the vault folder to connect.';
    }
    if (reason === 'unlinked_by_user') {
      return 'Brainchild is disconnected. Reconnect to read your personal notes here.';
    }
    if (reason === 'unavailable') {
      return 'The Brainchild bridge is unavailable. Reconnect to try again.';
    }
    return 'Connect Brainchild to read your personal notes here.';
  }

  /*
   * folderView(rows, currentFolder)
   *
   * Pure helper. Given the normalized Library rows (each carrying a vault
   * relative _vaultPath that may contain "/" for nested folders) and the
   * current folder path ('' = vault root), returns the immediate folder/note
   * view for that folder:
   *
   *   {
   *     folders: [{ name, path, count }, ...],  // immediate child folders
   *     notes:   [row, ...]                     // notes directly in the folder
   *   }
   *
   * notes   = rows whose _vaultPath sits directly inside currentFolder (no
   *           further "/" after stripping the "currentFolder + '/'" prefix; at
   *           root, rows whose _vaultPath has no "/").
   * folders = the distinct immediate child folder names under currentFolder,
   *           each with its full path and a count of notes anywhere beneath it.
   *
   * Folders sort alphabetically (case-insensitive); notes sort by filename.
   * Names beginning with "." (dotfolders / dotfiles) are ignored.
   */
  function folderView(rows, currentFolder) {
    var list = Array.isArray(rows) ? rows : [];
    var base = currentFolder || '';
    var prefix = base ? base + '/' : '';

    var notes = [];
    var folderCounts = {}; // child folder name -> rollup note count
    var folderNames = [];  // preserves first-seen order before sort

    list.forEach(function (row) {
      var path = (row && row._vaultPath) || '';
      if (!path) return;

      // Only consider rows that live under the current folder.
      if (prefix) {
        if (path.indexOf(prefix) !== 0) return;
      }
      var rest = prefix ? path.slice(prefix.length) : path;
      if (!rest) return;

      var slash = rest.indexOf('/');
      if (slash === -1) {
        // Direct note in this folder. Skip dotfiles.
        if (rest.charAt(0) === '.') return;
        notes.push(row);
        return;
      }

      // Lives inside a child folder. Skip dotfolders.
      var childName = rest.slice(0, slash);
      if (!childName || childName.charAt(0) === '.') return;
      if (!Object.prototype.hasOwnProperty.call(folderCounts, childName)) {
        folderCounts[childName] = 0;
        folderNames.push(childName);
      }
      folderCounts[childName] += 1;
    });

    var folders = folderNames.map(function (name) {
      return {
        name: name,
        path: prefix ? prefix + name : name,
        count: folderCounts[name]
      };
    });

    folders.sort(function (a, b) {
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    notes.sort(function (a, b) {
      var an = ((a && a.filename) || '').toLowerCase();
      var bn = ((b && b.filename) || '').toLowerCase();
      return an.localeCompare(bn);
    });

    return { folders: folders, notes: notes };
  }

  // Translate an ApiError (thrown by api.post on non 2xx) into promote copy.
  function promoteErrorMessage(error) {
    var status = error && typeof error.status === 'number' ? error.status : 0;
    if (status === 401) return 'Sign in to lana-ai to promote notes.';
    if (status === 403) return 'You do not have permission to promote to this organization.';
    if (status === 409) return 'This note was already promoted to the organization.';
    var detail = error && error.message ? error.message : '';
    return detail || 'Failed to promote note. Check your connection and try again.';
  }

  /*
   * create(options)
   *
   * options:
   *   bridge          window.electronAPI.brainchild (defaults to it)
   *   mapper          DocumentLibraryMapper (defaults to global)
   *   promoteBuilder  BrainchildPromoteBuilder (defaults to global)
   *   api             LanaAPI client with post() that throws ApiError on non 2xx
   *   currentUser()   returns the authenticated user (defaults to api.user / localStorage)
   *   onStatus(text)  optional progress callback (status line copy)
   *   onToast(kind,m) optional toast callback ('success' | 'error')
   *   onChange()      optional callback fired after status/rows change so the
   *                   host can re-render
   */
  function create(options) {
    var opts = options || {};
    var bridge = opts.bridge || (global.electronAPI && global.electronAPI.brainchild) || null;
    var mapper = opts.mapper || global.DocumentLibraryMapper || null;
    var promoteBuilder = opts.promoteBuilder || global.BrainchildPromoteBuilder || null;
    var api = opts.api || global.api || null;
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
    var onToast = typeof opts.onToast === 'function' ? opts.onToast : function () {};
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    var getCurrentUser = typeof opts.currentUser === 'function'
      ? opts.currentUser
      : function () {
          if (api && api.user) return api.user;
          if (global.api && global.api.user) return global.api.user;
          try {
            return JSON.parse((global.localStorage && global.localStorage.getItem('user')) || 'null');
          } catch (_error) {
            return null;
          }
        };

    var state = {
      status: null,
      rows: null,
      loading: false,
      promoteInProgress: false,
      currentFolder: ''
    };

    // Append a single child folder name to the current folder path and notify.
    function enterFolder(name) {
      var child = (name || '').trim();
      if (!child) return state.currentFolder;
      state.currentFolder = state.currentFolder
        ? state.currentFolder + '/' + child
        : child;
      notify();
      return state.currentFolder;
    }

    // Jump to an absolute vault folder path ('' for the vault root) and notify.
    function goToFolder(path) {
      state.currentFolder = path || '';
      notify();
      return state.currentFolder;
    }

    function isConnected(status) {
      var s = status || state.status;
      return !!s && (s.status === 'linked' || s.status === 'connected');
    }

    function notify() { onChange(); }

    // Refresh the cached bridge status. Cheap; does not spawn the MCP server.
    async function refreshStatus() {
      if (!bridge) {
        state.status = { status: 'degraded', reason: 'not_linked' };
        return state.status;
      }
      try {
        var result = await bridge.status();
        state.status = (result && result.success !== false)
          ? result
          : { status: 'degraded', reason: 'not_linked' };
      } catch (_error) {
        state.status = { status: 'degraded', reason: 'unavailable' };
      }
      return state.status;
    }

    // Read the vault note list over the bridge. Returns raw note DTOs; shaping
    // is delegated to the mapper. Any failure degrades to an empty list.
    async function fetchNotes() {
      if (!bridge) return [];
      try {
        var result = await bridge.listNotes({});
        if (!result || result.success === false) return [];
        return Array.isArray(result.notes) ? result.notes : [];
      } catch (_error) {
        return [];
      }
    }

    function normalizeRows(notes) {
      if (!mapper || typeof mapper.normalizeLibraryItems !== 'function') return [];
      return mapper.normalizeLibraryItems({ notes: notes }, 'my');
    }

    // Status driven load: refresh status, fetch + normalize notes when
    // connected, otherwise present an empty row set so the host can show the
    // degraded state. Never gates notes behind a connect step.
    async function load() {
      if (state.loading) return state.rows || [];
      state.loading = true;
      state.currentFolder = '';
      try {
        await refreshStatus();
        var notes = isConnected() ? await fetchNotes() : [];
        state.rows = normalizeRows(notes);
        notify();
        return state.rows;
      } finally {
        state.loading = false;
      }
    }

    async function runSearch(query) {
      var trimmed = (query || '').trim();
      if (!isConnected()) { state.rows = []; notify(); return state.rows; }
      var allRows = normalizeRows(await fetchNotes());
      if (!trimmed) {
        state.rows = allRows;
      } else {
        var needle = trimmed.toLowerCase();
        state.rows = allRows.filter(function (r) {
          var name = ((r && (r.filename || r.name || r.title)) || '').toLowerCase();
          return name.indexOf(needle) !== -1;
        });
      }
      notify();
      return state.rows;
    }

    // Persist a link and reload the vault. Shared by auto-discovery and the
    // manual folder-picker paths. Returns true on success.
    async function applyLink(installPath, vaultPath) {
      if (!bridge || !bridge.link) return false;
      var linked = await bridge.link({ installPath: installPath, vaultPath: vaultPath });
      if (!linked || linked.success === false) {
        onStatus('Could not link Brainchild (' + ((linked && linked.error) || 'unknown') + ').');
        await refreshStatus();
        notify();
        return false;
      }
      onStatus('Connected to Brainchild. Loading your notes.');
      state.rows = null;
      await load();
      onStatus('');
      return true;
    }

    // Manual link via native folder pickers (main-mediated). Used for the
    // genuine install_not_found / vault_not_found case.
    async function pickAndLink() {
      if (!bridge || !bridge.pickInstall || !bridge.pickVault) {
        onStatus('Choosing a folder is only available in the desktop app.');
        return false;
      }
      onStatus('Choose your Brainchild install folder.');
      var install = await bridge.pickInstall();
      if (!install || install.canceled) { onStatus(''); return false; }
      if (install.success === false) {
        onStatus('That folder does not contain Brainchild (bin/brainchild-mcp.js).');
        return false;
      }
      onStatus('Choose your Brainchild vault folder.');
      var vault = await bridge.pickVault();
      if (!vault || vault.canceled) { onStatus(''); return false; }
      if (vault.success === false) {
        onStatus('Could not read that vault folder.');
        return false;
      }
      return applyLink(install.installPath, vault.vaultPath);
    }

    // Connect / Reconnect. link() auto-discovers via the handshake and clears
    // unlink suppression, so the same flow serves not_linked and
    // unlinked_by_user. Falls back to the folder pickers when discovery cannot
    // resolve both an install and a vault.
    async function connect() {
      if (!bridge) {
        onStatus('Brainchild is only available in the desktop app.');
        return false;
      }
      onStatus('Looking for Brainchild on this device.');
      try {
        var found = bridge.discover ? await bridge.discover() : null;
        if (!found || !found.installPath || !found.vaultPath) {
          onStatus('Could not find Brainchild automatically. Choose its folders to connect.');
          return pickAndLink();
        }
        return applyLink(found.installPath, found.vaultPath);
      } catch (error) {
        onStatus('Could not connect to Brainchild: ' + (error && error.message ? error.message : 'unknown error'));
        return false;
      }
    }

    function reconnect() { return connect(); }

    // Unlink: forget the persisted link and suppress auto-bind, then degrade.
    async function unlink() {
      if (!bridge || !bridge.unlink) return false;
      try {
        await bridge.unlink();
      } catch (_error) { /* best effort */ }
      state.rows = null;
      state.currentFolder = '';
      state.status = { status: 'degraded', reason: 'unlinked_by_user' };
      notify();
      onStatus('');
      return true;
    }

    // Read a single note body over the bridge (needed by promote, which sends
    // the content). Returns the note DTO or null.
    async function getNote(path) {
      if (!bridge || !bridge.getNote || !path) return null;
      try {
        var result = await bridge.getNote({ path: path });
        if (!result || result.success === false) return null;
        return result.note || null;
      } catch (_error) {
        return null;
      }
    }

    function canPromote() {
      if (!promoteBuilder || typeof promoteBuilder.canPromote !== 'function') return false;
      return promoteBuilder.canPromote({
        authenticated: !!getCurrentUser(),
        user: getCurrentUser(),
        bridge: bridge
      });
    }

    // Promote a vault note into org knowledge. COPY semantics: the note stays
    // in the vault; the backend receives a copy. row is the Library row view
    // model (carries _vaultPath + filename); note carries the body (fetched via
    // getNote when not supplied). button is an optional element to disable while
    // the POST is in flight.
    async function promote(row, note, button) {
      if (state.promoteInProgress) return { success: false, reason: 'in_progress' };
      if (!promoteBuilder) { onToast('error', 'Promote is unavailable.'); return { success: false }; }
      if (!api || typeof api.post !== 'function') { onToast('error', 'Promote is unavailable.'); return { success: false }; }

      var user = getCurrentUser();
      if (!user) { onToast('error', 'Sign in to lana-ai to promote notes.'); return { success: false }; }

      var body = note;
      if (!body || !body.body) {
        body = await getNote(row && (row._vaultPath || row.path));
      }

      var payload;
      try {
        payload = promoteBuilder.buildPromotePayload(row, body || {}, user);
      } catch (error) {
        onToast('error', error && error.message ? error.message : 'Could not promote note.');
        return { success: false };
      }

      state.promoteInProgress = true;
      if (button) { button.setAttribute('disabled', 'true'); }
      try {
        await api.post(
          '/api/v1/organizations/' + encodeURIComponent(payload.orgId) + '/promoted-knowledge',
          payload.body
        );
        onToast('success', 'Note promoted to your organization. Your copy stays in Brainchild.');
        return { success: true };
      } catch (error) {
        onToast('error', promoteErrorMessage(error));
        return { success: false, error: error };
      } finally {
        state.promoteInProgress = false;
        if (button) { button.removeAttribute('disabled'); }
      }
    }

    return {
      state: state,
      degradedCopy: degradedCopy,
      isConnected: isConnected,
      refreshStatus: refreshStatus,
      load: load,
      runSearch: runSearch,
      fetchNotes: fetchNotes,
      getNote: getNote,
      connect: connect,
      reconnect: reconnect,
      pickAndLink: pickAndLink,
      unlink: unlink,
      canPromote: canPromote,
      promote: promote,
      enterFolder: enterFolder,
      goToFolder: goToFolder,
      folderView: function () { return folderView(state.rows, state.currentFolder); }
    };
  }

  var moduleApi = {
    create: create,
    degradedCopy: degradedCopy,
    promoteErrorMessage: promoteErrorMessage,
    folderView: folderView
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  global.LibraryBrainchildScope = moduleApi;
})(typeof window !== 'undefined' ? window : this);
