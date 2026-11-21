/* File viewer: the live processing panel.

   While LANA is still working on a file (or it failed), the viewer shows the
   file with a panel beside it listing what LANA is doing, step by step, as it
   happens. Closing the panel stops nothing: the work runs on the server, and
   the file shows the panel again the next time it is opened, until it is
   ready. A ready file opens in the plain viewer.

   FileViewerIngestion.start(file)   after the file is shown
   FileViewerIngestion.stop()        before another file loads

   Steps and wording: js/shared/ingestion-progress.model.js. Styles:
   css/file-viewer-ingestion.css. Rows: lex-run-trace. */

(function (global) {
  'use strict';

  var Model = global.LanaIngestionProgress;
  var RECONNECT_LIMIT = 5;
  var RECONNECT_MS = 2000;

  // `run` counts starts: anything begun for an earlier start (a lookup, a
  // stream, a reconnect) checks it and stops, so only the latest start acts.
  var state = { run: 0, fileId: null, progress: null, controller: null, reconnects: 0, timer: null, closed: false };

  function current(run) {
    return state.run === run && !state.closed;
  }

  function el(id) { return document.getElementById(id); }

  function apiClient() { return global.api; }

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
  }

  function setProgress(progress) {
    state.progress = progress;
    if (Model.shouldShow(progress)) state.lastShown = true;
    render();
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
    if (!state.lastShown && !Model.shouldShow(progress)) return; // a ready file opens plain
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

  function close() {
    state.closed = true;
    stopStream();
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
    follow(state.run);
  }

  function stop() {
    state.run += 1;
    stopStream();
    state.fileId = null;
    state.progress = null;
    state.reconnects = 0;
    state.lastShown = false;
    var panel = el('ingestionPanel');
    if (panel) panel.classList.add('hidden');
  }

  global.addEventListener('beforeunload', stop);
  global.FileViewerIngestion = { start: start, stop: stop };
})(window);
