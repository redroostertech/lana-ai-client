/* File viewer: the live processing panel.

   While LANA is still working on a file (or it failed), the viewer shows the
   file with a panel beside it listing what LANA is doing, step by step, as it
   happens. Closing the panel stops nothing: the work runs on the server, and
   the file shows the panel again the next time it is opened, until it is
   ready. A ready file opens in the plain viewer.

   FileViewerIngestion.start(file, { matterId, uploads })   after the file is shown
   FileViewerIngestion.stop()                               before another file loads

   `uploads` ([{ id, name }]) is the set of files uploaded together: the panel
   shows a strip to move between them, with each one's progress, and stays
   for every file in the set (ready ones included).

   Events for the page (file-viewer-page.js), so the viewer itself responds:
     lana-ingestion-pages     { pageCount, ready, finished } or null: light
                              the PDF's pages as they become searchable
     lana-viewer-go-to-page   { page }: a page tile was chosen
     lana-viewer-open-upload  { id }: another file in the strip was chosen

   Steps and wording: js/shared/ingestion-progress.model.js. Styles:
   css/file-viewer-ingestion.css. Rows: lex-run-trace. */

(function (global) {
  'use strict';

  var Model = global.LanaIngestionProgress;
  var RECONNECT_LIMIT = 5;
  var RECONNECT_MS = 2000;
  var UPLOAD_POLL_MS = 4000;
  var UPLOAD_POLL_BATCH = 6;
  var MAX_PAGE_TILES = 120;
  var PAGES_CLEAR_MS = 2500;

  // `run` counts starts: anything begun for an earlier start (a lookup, a
  // stream, a reconnect) checks it and stops, so only the latest start acts.
  var state = {
    run: 0, fileId: null, progress: null, controller: null, reconnects: 0, timer: null, closed: false,
    uploads: [], uploadStatus: {}, uploadCursor: 0, uploadTimer: null, pagesTimer: null, pageTiles: 0
  };

  function current(run) {
    return state.run === run && !state.closed;
  }

  function el(id) { return document.getElementById(id); }

  function apiClient() { return global.api; }

  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail }));
  }

  function inUploadSet() {
    return state.uploads.length > 1 && state.uploads.some(function (u) { return u.id === state.fileId; });
  }

  function renderPages(progress) {
    var box = el('ingestionPages');
    var grid = el('ingestionPageGrid');
    var caption = el('ingestionPagesCaption');
    var map = progress && Model.pageMap(progress);
    if (box) box.classList.toggle('hidden', !map);
    if (!map || !grid) return;
    var shown = Math.min(map.pageCount, MAX_PAGE_TILES);
    if (state.pageTiles !== shown) {
      grid.textContent = '';
      for (var page = 1; page <= shown; page += 1) {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'file-viewer-ingestion__page';
        tile.dataset.page = String(page);
        tile.setAttribute('aria-label', 'Go to page ' + page);
        tile.title = 'Page ' + page;
        grid.appendChild(tile);
      }
      state.pageTiles = shown;
    }
    map.pages.slice(0, shown).forEach(function (item, index) {
      var tile = grid.children[index];
      tile.classList.toggle('file-viewer-ingestion__page--ready', item.state === 'ready');
    });
    if (caption) {
      caption.textContent = map.caption + (map.pageCount > shown ? ' (first ' + shown + ' shown)' : '');
    }
  }

  // The viewer lights the pages of the PDF itself; when the file is ready the
  // light stays a moment, then the document goes back to plain.
  function emitPages(progress) {
    // A failed or stopped file goes back to plain at once: nothing more will light.
    if (progress && Model.isTerminal(progress.status) && progress.status !== 'completed') {
      emit('lana-ingestion-pages', null);
      return;
    }
    var map = progress && Model.pageMap(progress);
    var finished = Boolean(progress && progress.status === 'completed');
    emit('lana-ingestion-pages', map ? { pageCount: map.pageCount, ready: map.ready, finished: finished } : null);
    if (finished && map && !state.pagesTimer) {
      var run = state.run;
      state.pagesTimer = setTimeout(function () {
        state.pagesTimer = null;
        if (state.run === run) emit('lana-ingestion-pages', null);
      }, PAGES_CLEAR_MS);
    }
  }

  function renderUploads() {
    var strip = el('ingestionUploads');
    if (!strip) return;
    var show = inUploadSet();
    strip.classList.toggle('hidden', !show);
    if (!show) return;
    if (!strip._built) {
      strip.textContent = '';
      state.uploads.forEach(function (upload) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'file-viewer-ingestion__upload';
        chip.dataset.id = upload.id;
        var name = document.createElement('span');
        name.className = 'file-viewer-ingestion__upload-name';
        name.textContent = upload.name || 'File';
        chip.title = upload.name || '';
        // A native <progress>: a bar may sit inside a button only as phrasing content.
        var bar = document.createElement('progress');
        bar.className = 'file-viewer-ingestion__upload-bar';
        bar.max = 100;
        chip.appendChild(name);
        chip.appendChild(bar);
        strip.appendChild(chip);
      });
      strip._built = true;
    }
    Array.prototype.forEach.call(strip.children, function (chip) {
      var id = chip.dataset.id;
      var progress = id === state.fileId ? state.progress : state.uploadStatus[id];
      var status = progress && progress.status;
      var active = id === state.fileId;
      chip.classList.toggle('file-viewer-ingestion__upload--active', active);
      if (active) chip.setAttribute('aria-current', 'true');
      else chip.removeAttribute('aria-current');
      var bar = chip.querySelector('progress');
      bar.value = status === 'completed' ? 100 : Math.max(0, Math.min(100, Number(progress && progress.progress) || 0));
      chip.dataset.status = status || 'waiting';
    });
  }

  // The other files in the set are read now and then (one live stream is
  // enough); the one on screen streams.
  async function pollUploads(run) {
    var client = apiClient();
    if (!client || !current(run) || !inUploadSet()) return;
    var others = state.uploads.filter(function (u) {
      var known = state.uploadStatus[u.id];
      return u.id !== state.fileId && !(known && Model.isTerminal(known.status));
    });
    // A few per round, taking turns, so a large set does not flood the server.
    var start = others.length ? state.uploadCursor % others.length : 0;
    others = others.slice(start).concat(others.slice(0, start)).slice(0, UPLOAD_POLL_BATCH);
    state.uploadCursor = start + others.length;
    await Promise.all(others.map(function (u) {
      return client.get('/api/v1/storage/files/' + encodeURIComponent(u.id) + '/ingestion')
        .then(function (result) { if (result && result.job) state.uploadStatus[u.id] = result.job; })
        .catch(function () { /* shown as it was */ });
    }));
    if (!current(run)) return;
    renderUploads();
    var waiting = state.uploads.some(function (u) {
      var known = state.uploadStatus[u.id];
      return u.id !== state.fileId && !(known && Model.isTerminal(known.status));
    });
    if (waiting) state.uploadTimer = setTimeout(function () { pollUploads(run); }, UPLOAD_POLL_MS);
  }

  function render() {
    var panel = el('ingestionPanel');
    var progress = state.progress;
    if (!panel) return;
    // Shown when the file was still processing as it opened, and kept through
    // Ready until the person closes it.
    panel.classList.toggle('hidden', state.closed || !state.lastShown);
    if (!progress) return;

    var finished = progress.status === 'completed';
    var failed = progress.status === 'failed';
    panel.classList.toggle('file-viewer-ingestion--ready', finished);
    panel.classList.toggle('file-viewer-ingestion--failed', failed);
    var headline = el('ingestionHeadline');
    if (headline) headline.textContent = Model.headline(progress);
    var bar = el('ingestionProgressBar');
    if (bar) {
      bar.setAttribute('value', String(finished ? 100 : Math.max(0, Math.min(100, Number(progress.progress) || 0))));
      bar.setAttribute('color', failed ? 'danger' : (finished ? 'success' : 'accent'));
    }
    var trace = el('ingestionTrace');
    if (trace) {
      trace.live = !Model.isTerminal(progress.status);
      trace.steps = Model.traceSteps(progress);
    }
    var note = el('ingestionNote');
    if (note) note.classList.toggle('hidden', finished || failed);
    var ask = el('ingestionAskLana');
    if (ask) ask.classList.toggle('hidden', !finished);
    var retry = el('ingestionRetry');
    if (retry) retry.classList.toggle('hidden', !failed);
    renderPages(progress);
    renderUploads();
  }

  function setProgress(progress) {
    state.progress = progress;
    if (Model.shouldShow(progress) || inUploadSet()) state.lastShown = true;
    render();
    if (!state.closed) emitPages(progress);
  }

  function clearTimer() {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  }

  function stopStream() {
    clearTimer();
    if (state.controller) {
      state.controller.abort();
      state.controller = null;
    }
  }

  // Read the job again and, if it is still running, listen again. The job on
  // the server is the only state, so a dropped connection loses nothing.
  function scheduleReconnect(run) {
    if (!current(run) || state.reconnects >= RECONNECT_LIMIT) return;
    state.reconnects += 1;
    clearTimer();
    state.timer = setTimeout(function () { follow(run); }, RECONNECT_MS * state.reconnects);
  }

  async function streamJob(run, jobId) {
    var client = apiClient();
    if (!current(run)) return;
    if (state.controller) state.controller.abort();
    var controller = new AbortController();
    state.controller = controller;
    var ended = false;
    try {
      var response = await fetch(client.baseUrl + '/api/v1/storage/jobs/' + encodeURIComponent(jobId) + '/status/stream', {
        headers: client.getHeaders(),
        signal: controller.signal
      });
      if (!response.ok || !response.body) throw new Error('stream ' + response.status);
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        var parsed = Model.parseEvents(buffer + decoder.decode(chunk.value, { stream: true }));
        buffer = parsed.rest;
        parsed.events.forEach(function (event) {
          if (!current(run)) return;
          if (event.type === 'progress' || Model.isTerminal(event.type)) {
            state.reconnects = 0;
            setProgress(event);
            if (Model.isTerminal(event.type)) ended = true;
          }
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
    } finally {
      if (state.controller === controller) state.controller = null;
    }
    if (!ended && !controller.signal.aborted) scheduleReconnect(run);
  }

  async function follow(run) {
    var client = apiClient();
    var fileId = state.fileId;
    if (!client || !current(run)) return;
    var result;
    try {
      result = await client.get('/api/v1/storage/files/' + encodeURIComponent(fileId) + '/ingestion');
    } catch (error) {
      // A server without live steps (or a file the viewer cannot read)
      // answers 4xx: the file simply opens plain. Only a dropped connection
      // or a server error is worth asking again.
      var status = error && error.status;
      if (!(status >= 400 && status < 500)) scheduleReconnect(run);
      return;
    }
    if (!current(run)) return;
    var progress = result && result.job;
    if (!progress) return;
    // A ready file opens plain, unless it is one of a set just uploaded.
    if (!state.lastShown && !Model.shouldShow(progress) && !inUploadSet()) return;
    setProgress(progress);
    if (!Model.isTerminal(progress.status)) streamJob(run, progress.job_id);
  }

  async function retry() {
    var client = apiClient();
    var fileId = state.fileId;
    var run = state.run;
    if (!client || !fileId || state.closed) return;
    var button = el('ingestionRetry');
    if (button) button.setAttribute('loading', '');
    try {
      await client.post('/api/v1/documents/' + encodeURIComponent(fileId) + '/reindex', {});
      if (!current(run)) return; // another file opened meanwhile
      state.reconnects = 0;
      await follow(run);
    } catch (error) {
      if (global.Lex && global.Lex.Toast) global.Lex.Toast.error('LANA could not start this file again. Please try again in a moment.');
    } finally {
      if (button) button.removeAttribute('loading');
    }
  }

  function clearSideTimers() {
    if (state.uploadTimer) { clearTimeout(state.uploadTimer); state.uploadTimer = null; }
    if (state.pagesTimer) { clearTimeout(state.pagesTimer); state.pagesTimer = null; }
  }

  function close() {
    state.closed = true;
    stopStream();
    clearSideTimers();
    emit('lana-ingestion-pages', null);
    var panel = el('ingestionPanel');
    if (panel) panel.classList.add('hidden');
  }

  function wire() {
    var closeBtn = el('ingestionClose');
    if (closeBtn && !closeBtn._ingestionWired) {
      closeBtn._ingestionWired = true;
      closeBtn.addEventListener('click', close);
    }
    var retryBtn = el('ingestionRetry');
    if (retryBtn && !retryBtn._ingestionWired) {
      retryBtn._ingestionWired = true;
      retryBtn.addEventListener('click', retry);
    }
    var grid = el('ingestionPageGrid');
    if (grid && !grid._ingestionWired) {
      grid._ingestionWired = true;
      grid.addEventListener('click', function (event) {
        var tile = event.target.closest('.file-viewer-ingestion__page');
        if (tile) emit('lana-viewer-go-to-page', { page: Number(tile.dataset.page) });
      });
    }
    var strip = el('ingestionUploads');
    if (strip && !strip._ingestionWired) {
      strip._ingestionWired = true;
      strip.addEventListener('click', function (event) {
        var chip = event.target.closest('.file-viewer-ingestion__upload');
        if (chip && chip.dataset.id !== state.fileId) emit('lana-viewer-open-upload', { id: chip.dataset.id });
      });
    }
  }

  function configureAsk(file, matterId) {
    var ask = el('ingestionAskLana');
    if (!ask || !file) return;
    ask.setAttribute('document-id', file.id);
    ask.setAttribute('document-name', file.filename || file.original_filename || '');
    ask.setAttribute('context-type', 'document_chat');
    if (matterId) ask.setAttribute('matter-id', matterId);
    else ask.removeAttribute('matter-id');
  }

  function start(file, options) {
    stop();
    if (!Model || !file || !file.id) return;
    state.run += 1;
    state.fileId = file.id;
    state.closed = false;
    wire();
    configureAsk(file, options && options.matterId);
    state.uploads = Array.isArray(options && options.uploads) ? options.uploads : [];
    follow(state.run);
    if (inUploadSet()) pollUploads(state.run);
  }

  function stop() {
    state.run += 1;
    stopStream();
    state.fileId = null;
    state.progress = null;
    state.reconnects = 0;
    state.lastShown = false;
    state.uploads = [];
    state.uploadStatus = {};
    state.uploadCursor = 0;
    state.pageTiles = 0;
    clearSideTimers();
    var strip = el('ingestionUploads');
    if (strip) strip._built = false;
    var grid = el('ingestionPageGrid');
    if (grid) grid.textContent = '';
    emit('lana-ingestion-pages', null);
    var panel = el('ingestionPanel');
    if (panel) panel.classList.add('hidden');
  }

  global.addEventListener('beforeunload', stop);
  global.FileViewerIngestion = { start: start, stop: stop };
})(window);
