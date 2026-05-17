// recording-detail.js — single-recording view.
//
// Fetches /api/v1/recordings/:id, renders header + transcript, and polls every
// 3s while the recording is in a non-terminal state (pending/uploading/
// transcribing). View-only.

(function () {
  'use strict';

  var POLL_INTERVAL_MS = 3000;

  // Task #30 — playback preferences persisted across recordings.
  var STORAGE_KEY_CAPTIONS = 'lana-ai-client.recording-detail.captions';
  var STORAGE_KEY_RATE     = 'lana-ai-client.recording-detail.rate';

  var ALLOWED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  var DEFAULT_RATE = 1;

  var TERMINAL_STATUSES = { ready: true, failed: true, archived: true };

  var STATUS_BADGE_COLOR = {
    ready: 'success',
    transcribing: 'warning',
    uploading: 'warning',
    pending: 'neutral',
    failed: 'danger',
    archived: 'neutral'
  };

  var STATUS_LABEL = {
    ready: 'Ready',
    transcribing: 'Transcribing',
    uploading: 'Uploading',
    pending: 'Pending',
    failed: 'Failed',
    archived: 'Archived'
  };

  var SCOPE_LABEL = {
    private: 'Private',
    organization: 'Organization',
    matter: 'Matter'
  };

  // matter UUID → { matter_id, name } cache for friendly scope chips.
  var matterCache = {};

  // -- Preference helpers (Task #30) ----------------------------------------
  function loadCaptionsPref() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY_CAPTIONS);
      // Default ON: explicit '0'/'false' disables; anything else (incl. null) keeps it on.
      return !(raw === '0' || raw === 'false');
    } catch (_) { return true; }
  }
  function saveCaptionsPref(on) {
    try { window.localStorage.setItem(STORAGE_KEY_CAPTIONS, on ? '1' : '0'); } catch (_) { /* noop */ }
  }
  function loadRatePref() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY_RATE);
      var n = Number(raw);
      if (!Number.isFinite(n)) return DEFAULT_RATE;
      // Snap to allowed set so a stale value can't poison playbackRate.
      for (var i = 0; i < ALLOWED_RATES.length; i++) {
        if (Math.abs(ALLOWED_RATES[i] - n) < 1e-6) return ALLOWED_RATES[i];
      }
      return DEFAULT_RATE;
    } catch (_) { return DEFAULT_RATE; }
  }
  function saveRatePref(rate) {
    try { window.localStorage.setItem(STORAGE_KEY_RATE, String(rate)); } catch (_) { /* noop */ }
  }

  var state = {
    recordingId: null,
    recording: null,
    pollTimer: null,
    showSegments: false,
    loading: false,
    // Media playback state. Set when the recording reaches `ready` and the
    // /media endpoint returns a blob; cleared on cleanup so we don't leak
    // the object URL. mediaRecordingId locks the URL to a specific recording
    // so a stale poll-driven re-render never reuses an unrelated blob.
    mediaUrl: null,
    mediaRecordingId: null,
    mediaLoading: false,
    mediaError: null,
    activeSegmentIndex: -1,
    timeUpdateHandler: null,
    videoEl: null,
    audioEl: null,
    // Task #30 — player mode + UI prefs.
    // mode: 'video' | 'audio' — set after media loadedmetadata. We default
    // to 'video' and reflow once we know the track has no visual stream.
    mode: 'video',
    captionsOn: loadCaptionsPref(),
    playbackRate: loadRatePref(),
    captionsEl: null,
    captionsTextEl: null,
    captionsActiveIndex: -1,
    metadataHandler: null,
    // Task #32 — Picture-in-Picture state. `pipActive` mirrors the browser's
    // PiP state (driven by enter/leave PiP events on the <video>); the toolbar
    // button uses it to set `aria-pressed`. `pipEnterHandler`/`pipLeaveHandler`
    // are kept on state so we can detach them in releaseMedia().
    pipActive: false,
    pipEnterHandler: null,
    pipLeaveHandler: null,
    // Task #32 — keyboard nav. `keyNavHandler` lives on state so we can wire it
    // exactly once and detach on cleanup. `focusedSegmentIndex` tracks which
    // segment row currently owns keyboard focus, so Cmd/Ctrl+C can copy that
    // segment without a mouse click.
    keyNavHandler: null,
    focusedSegmentIndex: -1,
    // Task #34 — retry-transcribe in-flight flag. While true, the header
    // retry button is rendered as "Re-running…" + disabled. The flag is
    // *separate* from state.loading so the surrounding fetch/poll cadence
    // is unaffected when a retry is dispatched.
    retrying: false
  };

  var els = {};

  function init() {
    els = {
      back: document.getElementById('recordingBackBtn'),
      container: document.getElementById('recordingDetailContainer')
    };

    state.recordingId = getRecordingIdFromUrl();

    if (els.back) {
      els.back.addEventListener('click', goBack);
    }

    // Task #32 — global keyboard shortcuts. Wired once at init so the listener
    // outlives partial re-renders (toolbar patches, segments toggle, etc.).
    if (!state.keyNavHandler) {
      state.keyNavHandler = onGlobalKeyDown;
      document.addEventListener('keydown', state.keyNavHandler);
    }

    if (!state.recordingId) {
      renderError('Missing recording id', 'Open a recording from the Recordings list to view it here.');
      return;
    }

    loadRecording();
  }

  // Task #32 — Returns true if the given event originated inside an element
  // that should swallow keyboard shortcuts (text inputs, textareas, native
  // contenteditable surfaces, or elements explicitly opted-in via data-no-shortcuts).
  // Mirrors the focus-skip pattern other client pages use to avoid hijacking
  // user typing.
  function isTypingTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    var tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    if (target.closest && target.closest('[contenteditable="true"], [data-no-shortcuts]')) return true;
    return false;
  }

  // Task #32 — keyboard shortcuts:
  //   [   → previous segment with non-empty text (seek + play)
  //   ]   → next segment with non-empty text (seek + play)
  //   Cmd/Ctrl+C while a segment row is focused → copy segment snippet
  // No hijack while user is typing in an input/textarea/contenteditable.
  function onGlobalKeyDown(event) {
    if (!event || event.defaultPrevented) return;
    if (event.altKey) return;
    if (isTypingTarget(event.target)) return;

    // Cmd/Ctrl+C with a segment focused → copy that segment.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey
        && (event.key === 'c' || event.key === 'C')) {
      if (state.focusedSegmentIndex >= 0) {
        // Don't preempt browser-native text-selection copy; only intercept
        // when the focused element is the segment row itself (no selection).
        var sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
        var hasSelection = sel && typeof sel.toString === 'function' && sel.toString().length > 0;
        if (!hasSelection) {
          event.preventDefault();
          copySegmentByIndex(state.focusedSegmentIndex);
          return;
        }
      }
      return;
    }

    if (event.key !== '[' && event.key !== ']') return;
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;

    var rec = state.recording;
    var segments = (rec && rec.transcript && Array.isArray(rec.transcript.segments))
      ? rec.transcript.segments
      : [];
    if (!segments.length) return;

    var media = activeMediaEl();
    if (!media) return;

    var direction = event.key === '[' ? -1 : 1;
    var targetIndex = pickAdjacentSegmentIndex(segments, media.currentTime || 0, direction);
    if (targetIndex < 0) return;

    var target = segments[targetIndex];
    var startS = segmentStartSeconds(target);
    if (startS == null || !Number.isFinite(startS)) return;

    event.preventDefault();
    try {
      media.currentTime = Math.max(0, startS);
    } catch (_) { /* readyState guard */ }
    if (media.paused) {
      var p = media.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
    updateActiveSegment(media.currentTime);
    updateCaptionsOverlay(media.currentTime);
  }

  // Task #32 — Pick the previous/next segment with non-empty text relative to
  // the current playhead. Boundary rules per the task:
  //   - Before all segments → ']' jumps to first non-empty.
  //   - After all segments  → '[' jumps to last non-empty.
  // "Current segment" is the one whose start <= currentMs < end. When the
  // playhead sits inside segment N, '[' goes to N-1 (previous non-empty) and
  // ']' goes to N+1 (next non-empty).
  function pickAdjacentSegmentIndex(segments, currentSeconds, direction) {
    function hasText(seg) {
      return seg && seg.text != null && String(seg.text).trim().length > 0;
    }

    var currentIndex = -1;
    for (var i = 0; i < segments.length; i++) {
      var startS = segmentStartSeconds(segments[i]);
      var endS = segmentEndSeconds(segments[i]);
      if (startS == null) continue;
      if (currentSeconds >= startS && (endS == null || currentSeconds < endS)) {
        currentIndex = i;
        break;
      }
    }

    if (currentIndex === -1) {
      // Outside any segment — figure out whether we're before all or after all.
      var firstStart = null;
      var lastEnd = null;
      for (var j = 0; j < segments.length; j++) {
        var s = segmentStartSeconds(segments[j]);
        var e = segmentEndSeconds(segments[j]);
        if (s != null && (firstStart == null || s < firstStart)) firstStart = s;
        if (e != null && (lastEnd == null || e > lastEnd)) lastEnd = e;
      }

      // Before all → ']' returns first non-empty; '[' returns -1.
      if (firstStart != null && currentSeconds < firstStart) {
        if (direction < 0) return -1;
        for (var k = 0; k < segments.length; k++) {
          if (hasText(segments[k]) && segmentStartSeconds(segments[k]) != null) return k;
        }
        return -1;
      }

      // After all → '[' returns last non-empty; ']' returns -1.
      if (lastEnd != null && currentSeconds >= lastEnd) {
        if (direction > 0) return -1;
        for (var m = segments.length - 1; m >= 0; m--) {
          if (hasText(segments[m]) && segmentStartSeconds(segments[m]) != null) return m;
        }
        return -1;
      }

      // Between segments (gap with no current). Pick the nearest in direction.
      if (direction > 0) {
        for (var n = 0; n < segments.length; n++) {
          var sn = segmentStartSeconds(segments[n]);
          if (sn != null && sn > currentSeconds && hasText(segments[n])) return n;
        }
      } else {
        for (var q = segments.length - 1; q >= 0; q--) {
          var sq = segmentStartSeconds(segments[q]);
          if (sq != null && sq < currentSeconds && hasText(segments[q])) return q;
        }
      }
      return -1;
    }

    // Inside segment currentIndex — step until we find one with non-empty text.
    var step = direction > 0 ? 1 : -1;
    var probe = currentIndex + step;
    while (probe >= 0 && probe < segments.length) {
      if (hasText(segments[probe]) && segmentStartSeconds(segments[probe]) != null) return probe;
      probe += step;
    }
    return -1;
  }

  function getRecordingIdFromUrl() {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.getParams === 'function') {
      try {
        var params = window.Lex.Nav.getParams();
        if (params && typeof params.get === 'function' && params.get('id')) {
          return params.get('id');
        }
      } catch (_) { /* fall through */ }
    }
    var search = (window.location.search || '').replace(/^\?/, '');
    if (!search) return '';
    var pairs = search.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=');
      if (decodeURIComponent(kv[0] || '') === 'id') {
        return decodeURIComponent(kv[1] || '');
      }
    }
    return '';
  }

  function goBack() {
    if (window.Lex && window.Lex.Nav && typeof window.Lex.Nav.go === 'function') {
      window.Lex.Nav.go('recordings.html');
    } else {
      window.location.href = 'recordings.html';
    }
  }

  function loadRecording() {
    if (state.loading) return Promise.resolve();
    if (!window.api || !api.isAuthenticated()) return Promise.resolve();
    if (!state.recordingId) return Promise.resolve();

    state.loading = true;

    return api.get('/api/v1/recordings/' + encodeURIComponent(state.recordingId))
      .then(function (result) {
        state.recording = (result && (result.data || result)) || null;
        return ensureMatterName(state.recording);
      })
      .then(function () {
        // Fire-and-forget media load: render immediately so the user sees the
        // header/transcript while the blob downloads. The media fetch itself
        // re-renders only the player slot when it resolves or fails.
        ensureMedia();
        render();
        scheduleNextPoll();
      })
      .catch(function (err) {
        console.error('[RecordingDetail] Failed to load recording:', err && err.message ? err.message : err);
        if (!state.recording) {
          renderError('Failed to load recording', 'Refresh the page or return to the recordings list.');
        }
      })
      .finally(function () {
        state.loading = false;
      });
  }

  function ensureMatterName(recording) {
    if (!recording) return Promise.resolve();
    if (recording.visibility !== 'matter' || !recording.matter_id) return Promise.resolve();
    if (matterCache[recording.matter_id]) return Promise.resolve();
    if (!window.api || typeof api.getMatter !== 'function') return Promise.resolve();

    return api.getMatter(recording.matter_id, {})
      .then(function (res) {
        var m = res && (res.matter || res.data || res);
        if (m && m.id) {
          matterCache[m.id] = {
            matter_id: m.matter_id || '',
            name: m.matter_name || m.name || m.title || ''
          };
        }
      })
      .catch(function () { /* silent */ });
  }

  function scheduleNextPoll() {
    clearPoll();
    var status = state.recording && state.recording.status;
    if (!status || TERMINAL_STATUSES[status]) return;
    state.pollTimer = window.setTimeout(function () {
      loadRecording();
    }, POLL_INTERVAL_MS);
  }

  function clearPoll() {
    if (state.pollTimer) {
      window.clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function render() {
    if (!els.container || !state.recording) return;
    var rec = state.recording;
    var status = rec.status || 'pending';
    var badgeColor = STATUS_BADGE_COLOR[status] || 'neutral';
    var statusLabel = STATUS_LABEL[status] || status;

    var title = recordingTitle(rec);
    var scopeChip = renderScopeChip(rec);
    var sizeText = formatBytes(rec.byte_size);
    var durationText = formatDuration(rec.duration_ms);
    var capturedAt = formatAbsolute(rec.created_at);
    var owner = ownerLabel(rec);

    var transcript = rec.transcript || null;
    var hasTranscriptText = !!(transcript && transcript.full_text);
    var segments = (transcript && Array.isArray(transcript.segments)) ? transcript.segments : [];
    var hasSegments = segments.length > 0;

    var html = [
      '<header class="recording-detail__header">',
      '  <div class="recording-detail__header-row">',
      '    <h1 class="recording-detail__title">' + escapeHtml(title) + '</h1>',
      '    ' + renderHeaderActions(rec),
      '  </div>',
      '  <div class="recording-detail__chips">',
      '    <lex-badge label="' + escapeHtml(statusLabel) + '" color="' + escapeHtml(badgeColor) + '" size="md" dot></lex-badge>',
      scopeChip,
      '  </div>',
      '  <div class="recording-detail__facts">',
      capturedAt ? '    <span><span class="recording-detail__fact-label">Captured</span>' + escapeHtml(capturedAt) + '</span>' : '',
      durationText ? '    <span><span class="recording-detail__fact-label">Duration</span>' + escapeHtml(durationText) + '</span>' : '',
      sizeText ? '    <span><span class="recording-detail__fact-label">Size</span>' + escapeHtml(sizeText) + '</span>' : '',
      owner ? '    <span><span class="recording-detail__fact-label">Owner</span>' + escapeHtml(owner) + '</span>' : '',
      '  </div>',
      '</header>',
      '<div class="recording-detail__body">',
      renderPlayerBlock(rec),
      renderTranscriptBlock(rec, transcript, hasTranscriptText),
      hasSegments ? renderSegmentsBlock(segments) : '',
      '</div>'
    ].join('');

    els.container.innerHTML = html;

    bindBodyHandlers(hasTranscriptText, hasSegments);
    bindPlayer();
    bindHeaderActions();
  }

  // ---------------------------------------------------------------------------
  // Header actions (Task #34) — retry-transcribe surfaced when the recording
  // is in `failed` state. Lives in its own render fragment so the structure
  // stays parallel to where a future Delete button (or other row-level
  // actions) would go. The button is the only header action today; keep it
  // empty-string-safe so non-failed statuses render no extra DOM.
  // ---------------------------------------------------------------------------
  function renderHeaderActions(rec) {
    if (!rec || rec.status !== 'failed') return '';
    var label = state.retrying ? 'Re-running…' : 'Retry transcription';
    var disabledAttr = state.retrying ? ' disabled' : '';
    var iconName = state.retrying ? 'rotate-ccw' : 'refresh-cw';
    return [
      '<div class="recording-detail__header-actions">',
      '  <lex-btn',
      '    id="recordingRetryBtn"',
      '    variant="primary"',
      '    size="sm"',
      '    leading-icon="' + iconName + '"',
      '    aria-busy="' + (state.retrying ? 'true' : 'false') + '"',
      '    title="Re-run transcription against the stored media"',
      disabledAttr,
      '  >' + escapeHtml(label) + '</lex-btn>',
      '</div>'
    ].join('');
  }

  function bindHeaderActions() {
    var btn = document.getElementById('recordingRetryBtn');
    if (btn) btn.addEventListener('click', onRetryTranscribe);
  }

  // POST /api/v1/recordings/:id/retry-transcribe (Task #33).
  // - Empty body, bearer-auth via api.post().
  // - 200 → re-fetch the recording so the existing render + poll loop pick
  //   up the new `transcribing` status (which in turn re-arms the poll).
  // - 4xx/5xx → surface the rich `metadata.error`-shaped message via Toast.
  // We do NOT update local recording state speculatively — the canonical
  // truth is the next GET, and waiting for it keeps a single source of
  // truth for status/transcript wiring.
  function onRetryTranscribe() {
    if (state.retrying) return;
    if (!state.recording || !state.recording.id) return;
    if (!window.api || typeof api.post !== 'function') return;

    state.retrying = true;
    // Patch the button in place so we don't re-run the full render() (which
    // would tear down the player and segments list — preserves the studio
    // chrome state during the round-trip).
    applyRetryButtonState();

    var recordingId = state.recording.id;
    api.post('/api/v1/recordings/' + encodeURIComponent(recordingId) + '/retry-transcribe', {})
      .then(function () {
        // Refresh the recording — render() will swap the failed banner for
        // the transcribing spinner and scheduleNextPoll() will resume.
        return loadRecording();
      })
      .catch(function (err) {
        var message = describeRetryError(err);
        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
          window.Lex.Toast.error(message);
        } else {
          // Toast unavailable in test/headless contexts — log so the failure
          // isn't silent.
          console.error('[RecordingDetail] Retry transcription failed:', message);
        }
      })
      .finally(function () {
        state.retrying = false;
        applyRetryButtonState();
      });
  }

  // Pull the most useful human-readable message out of whatever the api
  // helper threw. The api wrapper attaches `.status` + `.data` to errors;
  // Task #33 promises richer `error` strings in the body, so we prefer
  // those over the generic Error.message.
  function describeRetryError(err) {
    if (!err) return 'Failed to retry transcription';
    if (err.data && typeof err.data === 'object') {
      if (typeof err.data.error === 'string' && err.data.error) return err.data.error;
      if (typeof err.data.message === 'string' && err.data.message) return err.data.message;
    }
    if (err.body && typeof err.body === 'object') {
      if (typeof err.body.error === 'string' && err.body.error) return err.body.error;
      if (typeof err.body.message === 'string' && err.body.message) return err.body.message;
    }
    if (typeof err.message === 'string' && err.message) return err.message;
    return 'Failed to retry transcription';
  }

  // Patch the retry button's label/disabled state without re-rendering the
  // whole detail view. Keeps the player/segments DOM intact during the
  // request lifecycle.
  function applyRetryButtonState() {
    var btn = document.getElementById('recordingRetryBtn');
    if (!btn) return;
    var label = state.retrying ? 'Re-running…' : 'Retry transcription';
    var iconName = state.retrying ? 'rotate-ccw' : 'refresh-cw';
    btn.textContent = label;
    btn.setAttribute('leading-icon', iconName);
    btn.setAttribute('aria-busy', state.retrying ? 'true' : 'false');
    if (state.retrying) {
      btn.setAttribute('disabled', '');
    } else {
      btn.removeAttribute('disabled');
    }
  }

  // ---------------------------------------------------------------------------
  // Media playback (Task #28)
  // ---------------------------------------------------------------------------

  function renderPlayerBlock(rec) {
    var status = rec && rec.status;

    // Status guards: only the `ready` state attempts playback. Other states
    // get a Lex banner explaining what the user is waiting on; failed gets a
    // banner with `status="error"`.
    if (status !== 'ready') {
      var bannerStatus = status === 'failed' ? 'error' : 'warning';
      var bannerHeading = status === 'failed'
        ? 'Recording failed'
        : 'Transcribing — playback available when ready';
      return [
        '<section class="recording-detail__player">',
        '  <lex-banner',
        '    variant="light"',
        '    size="compact"',
        '    status="' + escapeHtml(bannerStatus) + '"',
        '    heading="' + escapeHtml(bannerHeading) + '">',
        '  </lex-banner>',
        '</section>'
      ].join('');
    }

    if (state.mediaError) {
      return [
        '<section class="recording-detail__player">',
        renderPlayerToolbar(true),
        '  <lex-banner',
        '    variant="light"',
        '    size="compact"',
        '    status="error"',
        '    heading="Playback unavailable">',
        '  </lex-banner>',
        '</section>'
      ].join('');
    }

    if (!state.mediaUrl) {
      return [
        '<section class="recording-detail__player">',
        renderPlayerToolbar(true),
        '  <div class="recording-detail__player-loading">',
        '    <lex-spinner size="sm"></lex-spinner>',
        '    <span>Loading media…</span>',
        '  </div>',
        '</section>'
      ].join('');
    }

    var modeClass = state.mode === 'audio'
      ? 'recording-detail__player--audio'
      : 'recording-detail__player--video';

    return [
      '<section class="recording-detail__player ' + modeClass + '" data-player-mode="' + escapeHtml(state.mode) + '">',
      renderPlayerToolbar(false),
      '  <div class="recording-detail__player-frame">',
      '    <video',
      '      id="recordingVideo"',
      '      class="recording-detail__video"',
      '      controls',
      '      preload="metadata"',
      '      playsinline',
      '    ></video>',
      '    <div',
      '      id="recordingCaptionsOverlay"',
      '      class="recording-detail__captions-overlay"',
      '      aria-hidden="true"',
      '    >',
      '      <span id="recordingCaptionsText" class="recording-detail__captions-text"></span>',
      '    </div>',
      '  </div>',
      '  <div class="recording-detail__audio-frame">',
      '    <audio',
      '      id="recordingAudio"',
      '      class="recording-detail__audio"',
      '      controls',
      '      preload="metadata"',
      '    ></audio>',
      '    <div',
      '      id="recordingCaptionsBelow"',
      '      class="recording-detail__captions-below"',
      '      aria-hidden="true"',
      '    >',
      '      <span id="recordingCaptionsTextAudio" class="recording-detail__captions-text recording-detail__captions-text--audio"></span>',
      '    </div>',
      '  </div>',
      '</section>'
    ].join('');
  }

  // Player toolbar — speed select, captions toggle, download.
  // Disabled flag mutes interactions while the media is loading or the fetch
  // failed; the toolbar still renders so the layout doesn't shift when media
  // resolves.
  function renderPlayerToolbar(disabled) {
    var rateOptions = [
      { value: '0.5',  label: '0.5x' },
      { value: '0.75', label: '0.75x' },
      { value: '1',    label: '1x' },
      { value: '1.25', label: '1.25x' },
      { value: '1.5',  label: '1.5x' },
      { value: '2',    label: '2x' }
    ];

    var captionsLabel = state.captionsOn ? 'Captions: On' : 'Captions: Off';
    var captionsVariant = state.captionsOn ? 'secondary' : 'ghost';

    var downloadDisabled = disabled || !state.mediaUrl;
    var downloadTitle = downloadDisabled
      ? (state.mediaError ? 'Download unavailable — media failed to load' : 'Download available once media loads')
      : 'Download recording';

    // Task #32 — PiP toolbar entry. Disabled paths:
    //   - browser doesn't support PiP (document.pictureInPictureEnabled === false)
    //   - media isn't loaded yet (no blob URL or error path)
    //   - audio mode (no visual stream to popout — PiP is video-only)
    var pipSupported = (typeof document !== 'undefined') && document.pictureInPictureEnabled === true;
    var pipDisabled = disabled || !state.mediaUrl || !pipSupported || state.mode === 'audio';
    var pipVariant = state.pipActive ? 'secondary' : 'ghost';
    var pipTitle;
    if (!pipSupported) {
      pipTitle = 'Picture-in-Picture not supported in this environment';
    } else if (state.mode === 'audio') {
      pipTitle = 'Picture-in-Picture unavailable for audio-only recordings';
    } else if (!state.mediaUrl) {
      pipTitle = state.mediaError ? 'Picture-in-Picture unavailable — media failed to load' : 'Picture-in-Picture available once media loads';
    } else {
      pipTitle = state.pipActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture';
    }

    // No "picture-in-picture" entry in lex.icons.js — embed an inline SVG
    // (window-out-of-window glyph) and set icon="true" so lex-btn renders
    // square padding for the icon-only shape. aria-label is provided so
    // screen readers don't fall back to the icon name.
    var pipIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2" ry="2"></rect><rect x="12" y="11" width="8" height="6" rx="1" ry="1"></rect></svg>';

    // Task #32 — surface segment-nav shortcuts on the toolbar title so users
    // discover them via hover. Cmd/Ctrl shown; "[" and "]" listed verbatim.
    var toolbarTitle = 'Playback controls — [ previous segment, ] next segment, Cmd/Ctrl+C copy focused segment';

    return [
      '  <div class="recording-detail__player-toolbar" role="toolbar" aria-label="Playback controls" title="' + escapeHtml(toolbarTitle) + '">',
      '    <lex-select',
      '      id="recordingSpeedSelect"',
      '      class="recording-detail__speed-select"',
      '      size="sm"',
      '      value="' + escapeHtml(String(state.playbackRate)) + '"',
      '      aria-label="Playback speed"',
      '      options=\'' + JSON.stringify(rateOptions) + '\'',
      '    ></lex-select>',
      '    <lex-btn',
      '      id="recordingCaptionsToggle"',
      '      variant="' + captionsVariant + '"',
      '      size="sm"',
      '      leading-icon="message-square"',
      '      aria-pressed="' + (state.captionsOn ? 'true' : 'false') + '"',
      '    >' + escapeHtml(captionsLabel) + '</lex-btn>',
      '    <lex-btn',
      '      id="recordingPipToggle"',
      '      class="recording-detail__pip-btn"',
      '      variant="' + pipVariant + '"',
      '      size="sm"',
      '      icon="true"',
      '      aria-label="Picture-in-Picture"',
      '      aria-pressed="' + (state.pipActive ? 'true' : 'false') + '"',
      '      title="' + escapeHtml(pipTitle) + '"',
      (pipDisabled ? '      disabled' : ''),
      '    >' + pipIcon + '</lex-btn>',
      '    <lex-btn',
      '      id="recordingDownloadBtn"',
      '      variant="ghost"',
      '      size="sm"',
      '      leading-icon="download"',
      '      title="' + escapeHtml(downloadTitle) + '"',
      (downloadDisabled ? '      disabled' : ''),
      '    >Download</lex-btn>',
      '  </div>'
    ].filter(Boolean).join('');
  }

  function bindPlayer() {
    var video = document.getElementById('recordingVideo');
    var audio = document.getElementById('recordingAudio');
    state.videoEl = video || null;
    state.audioEl = audio || null;
    state.captionsEl = document.getElementById('recordingCaptionsOverlay');
    state.captionsTextEl = document.getElementById('recordingCaptionsText');

    // Always wire toolbar controls — they exist whether or not media is ready,
    // so users can adjust prefs while the blob is downloading.
    bindPlayerToolbar();
    applyCaptionsVisibility();

    if (!video || !state.mediaUrl) return;

    // Use the property (not the attribute) so the blob URL never lands in
    // the rendered HTML or in DevTools' Elements panel attribute view.
    video.src = state.mediaUrl;
    if (audio) audio.src = state.mediaUrl;

    // Apply persisted playback rate to whichever element ends up active.
    try { video.playbackRate = state.playbackRate; } catch (_) { /* readyState guard */ }
    if (audio) {
      try { audio.playbackRate = state.playbackRate; } catch (_) { /* noop */ }
    }

    // Mode detection — audio-only recordings have no visual stream, so
    // hide the video viewport and surface the native audio control.
    if (state.metadataHandler) {
      video.removeEventListener('loadedmetadata', state.metadataHandler);
    }
    state.metadataHandler = function () {
      var isAudioOnly = video.videoWidth === 0 && video.videoHeight === 0;
      var nextMode = isAudioOnly ? 'audio' : 'video';
      if (nextMode !== state.mode) {
        state.mode = nextMode;
        applyModeToDom();
      }
    };
    video.addEventListener('loadedmetadata', state.metadataHandler);

    if (state.timeUpdateHandler) {
      video.removeEventListener('timeupdate', state.timeUpdateHandler);
      if (audio) audio.removeEventListener('timeupdate', state.timeUpdateHandler);
    }
    state.timeUpdateHandler = function () {
      var current = activeMediaEl();
      if (!current) return;
      updateActiveSegment(current.currentTime);
      updateCaptionsOverlay(current.currentTime);
    };
    video.addEventListener('timeupdate', state.timeUpdateHandler);
    video.addEventListener('seeked', state.timeUpdateHandler);
    if (audio) {
      audio.addEventListener('timeupdate', state.timeUpdateHandler);
      audio.addEventListener('seeked', state.timeUpdateHandler);
    }

    // Task #32 — PiP state sync. The browser is the source of truth for
    // whether the floating window is open (the user can close it via the OS
    // chrome at any time), so we mirror its events back into our state.
    if (state.pipEnterHandler) {
      video.removeEventListener('enterpictureinpicture', state.pipEnterHandler);
    }
    if (state.pipLeaveHandler) {
      video.removeEventListener('leavepictureinpicture', state.pipLeaveHandler);
    }
    state.pipEnterHandler = function () {
      state.pipActive = true;
      applyPipButtonState();
    };
    state.pipLeaveHandler = function () {
      state.pipActive = false;
      applyPipButtonState();
    };
    video.addEventListener('enterpictureinpicture', state.pipEnterHandler);
    video.addEventListener('leavepictureinpicture', state.pipLeaveHandler);
  }

  // Returns the media element currently driving playback for the active mode.
  function activeMediaEl() {
    return state.mode === 'audio' ? state.audioEl : state.videoEl;
  }

  // Reflects state.mode in the DOM without a full re-render: toggles the
  // mode classes on the player section so the CSS can hide the unused
  // viewport. We avoid render() here to preserve the native <video> /
  // <audio> elements' playback state.
  function applyModeToDom() {
    var section = document.querySelector('.recording-detail__player');
    if (!section) return;
    section.classList.remove('recording-detail__player--video');
    section.classList.remove('recording-detail__player--audio');
    section.classList.add(state.mode === 'audio'
      ? 'recording-detail__player--audio'
      : 'recording-detail__player--video');
    section.setAttribute('data-player-mode', state.mode);

    // Task #32 — PiP isn't available for audio-only streams; sync the toolbar
    // button's disabled state without re-rendering the toolbar (which would
    // re-bind handlers and tear down listeners).
    var pipBtn = document.getElementById('recordingPipToggle');
    if (pipBtn) {
      var pipSupported = (typeof document !== 'undefined') && document.pictureInPictureEnabled === true;
      var shouldDisable = state.mode === 'audio' || !state.mediaUrl || !pipSupported;
      if (shouldDisable) {
        pipBtn.setAttribute('disabled', '');
        pipBtn.setAttribute('title', state.mode === 'audio'
          ? 'Picture-in-Picture unavailable for audio-only recordings'
          : 'Picture-in-Picture unavailable');
      } else {
        pipBtn.removeAttribute('disabled');
        pipBtn.setAttribute('title', state.pipActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture');
      }
    }
  }

  function bindPlayerToolbar() {
    var speed = document.getElementById('recordingSpeedSelect');
    if (speed) {
      speed.addEventListener('lex-change', onSpeedChange);
    }
    var captions = document.getElementById('recordingCaptionsToggle');
    if (captions) {
      captions.addEventListener('click', onCaptionsToggle);
    }
    var pip = document.getElementById('recordingPipToggle');
    if (pip) {
      pip.addEventListener('click', onPipToggle);
    }
    var download = document.getElementById('recordingDownloadBtn');
    if (download) {
      download.addEventListener('click', onDownloadClick);
    }
  }

  // Task #32 — PiP toggle. Defensive against:
  //   - browsers that don't expose pictureInPictureEnabled
  //   - the video element being absent (e.g. audio-only recording)
  //   - request/exit promises rejecting (browser gesture or DRM constraints)
  // We do NOT flip state.pipActive here — the source of truth is the
  // `enterpictureinpicture` / `leavepictureinpicture` events on the <video>
  // (wired in bindPlayer), so the button reflects the real PiP state even
  // when the user dismisses the floating window via the OS chrome.
  function onPipToggle() {
    var btn = document.getElementById('recordingPipToggle');
    if (btn && btn.hasAttribute('disabled')) return;
    if (typeof document === 'undefined' || document.pictureInPictureEnabled !== true) return;

    var video = state.videoEl;
    if (!video) return;

    if (state.pipActive && document.pictureInPictureElement === video) {
      var exitP = document.exitPictureInPicture && document.exitPictureInPicture();
      if (exitP && typeof exitP.catch === 'function') exitP.catch(function () { /* user-gesture or state issue */ });
      return;
    }

    if (typeof video.requestPictureInPicture !== 'function') return;
    var enterP = video.requestPictureInPicture();
    if (enterP && typeof enterP.catch === 'function') enterP.catch(function () { /* DRM / readyState / gesture */ });
  }

  // Reflect PiP state in the toolbar button without re-rendering the player
  // (which would tear down the <video> element and abort the PiP session).
  function applyPipButtonState() {
    var btn = document.getElementById('recordingPipToggle');
    if (!btn) return;
    btn.setAttribute('aria-pressed', state.pipActive ? 'true' : 'false');
    btn.setAttribute('variant', state.pipActive ? 'secondary' : 'ghost');
    btn.setAttribute('title', state.pipActive ? 'Exit Picture-in-Picture' : 'Picture-in-Picture');
  }

  function onSpeedChange(event) {
    var raw = event && event.detail ? event.detail.value : null;
    var n = Number(raw);
    if (!Number.isFinite(n)) return;
    var snapped = DEFAULT_RATE;
    for (var i = 0; i < ALLOWED_RATES.length; i++) {
      if (Math.abs(ALLOWED_RATES[i] - n) < 1e-6) { snapped = ALLOWED_RATES[i]; break; }
    }
    state.playbackRate = snapped;
    saveRatePref(snapped);
    if (state.videoEl) {
      try { state.videoEl.playbackRate = snapped; } catch (_) { /* noop */ }
    }
    if (state.audioEl) {
      try { state.audioEl.playbackRate = snapped; } catch (_) { /* noop */ }
    }
  }

  function onCaptionsToggle() {
    state.captionsOn = !state.captionsOn;
    saveCaptionsPref(state.captionsOn);

    // Patch the toggle in place (label + variant + aria-pressed) so we don't
    // disrupt the surrounding <video>/<audio> elements with a re-render.
    var btn = document.getElementById('recordingCaptionsToggle');
    if (btn) {
      btn.textContent = state.captionsOn ? 'Captions: On' : 'Captions: Off';
      btn.setAttribute('variant', state.captionsOn ? 'secondary' : 'ghost');
      btn.setAttribute('aria-pressed', state.captionsOn ? 'true' : 'false');
    }
    applyCaptionsVisibility();
    // Refresh overlay text immediately so toggling-on while paused shows the
    // current caption rather than waiting for the next timeupdate tick.
    var current = activeMediaEl();
    if (current) updateCaptionsOverlay(current.currentTime);
  }

  function applyCaptionsVisibility() {
    var els = [
      document.getElementById('recordingCaptionsOverlay'),
      document.getElementById('recordingCaptionsBelow')
    ];
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      els[i].classList.toggle('is-hidden', !state.captionsOn);
    }
  }

  // Renders the active transcript segment text into both the video overlay
  // and the audio-mode caption strip. CSS controls which is visible.
  // Uses opacity transitions on the wrappers (200ms) to fade between
  // segments; we only swap the text when the active segment index changes.
  function updateCaptionsOverlay(currentTime) {
    var rec = state.recording;
    var segments = (rec && rec.transcript && Array.isArray(rec.transcript.segments))
      ? rec.transcript.segments
      : [];

    var nextIndex = -1;
    if (segments.length) {
      for (var i = 0; i < segments.length; i++) {
        var startS = segmentStartSeconds(segments[i]);
        var endS = segmentEndSeconds(segments[i]);
        if (startS == null) continue;
        if (currentTime >= startS && (endS == null || currentTime < endS)) {
          nextIndex = i;
          break;
        }
      }
    }

    if (nextIndex === state.captionsActiveIndex) return;
    state.captionsActiveIndex = nextIndex;

    var text = nextIndex >= 0 && segments[nextIndex] && segments[nextIndex].text != null
      ? String(segments[nextIndex].text)
      : '';

    setCaptionText('recordingCaptionsOverlay', 'recordingCaptionsText', text);
    setCaptionText('recordingCaptionsBelow', 'recordingCaptionsTextAudio', text);
  }

  function setCaptionText(wrapperId, textId, text) {
    var wrapper = document.getElementById(wrapperId);
    var textEl = document.getElementById(textId);
    if (!wrapper || !textEl) return;

    if (!text) {
      wrapper.classList.remove('is-visible');
      // Allow the fade-out to finish before clearing; uses the same 200ms
      // duration as the CSS transition.
      window.setTimeout(function () {
        if (state.captionsActiveIndex === -1 || textEl.dataset.fadeGen !== wrapper.dataset.fadeGen) return;
        textEl.textContent = '';
      }, 200);
      return;
    }

    // Generation tag prevents a stale fade-out from clearing fresh content.
    var gen = String((Number(wrapper.dataset.fadeGen) || 0) + 1);
    wrapper.dataset.fadeGen = gen;
    textEl.dataset.fadeGen = gen;

    wrapper.classList.remove('is-visible');
    // Force a tick so the transition replays even when the previous caption
    // was visible — micro-task is enough for the browser to register the
    // class change.
    window.setTimeout(function () {
      textEl.textContent = text;
      wrapper.classList.add('is-visible');
    }, 0);
  }

  function onDownloadClick() {
    if (!state.mediaUrl || !state.recording) return;
    var btn = document.getElementById('recordingDownloadBtn');
    if (btn && btn.hasAttribute('disabled')) return;

    var rec = state.recording;
    var idShort = rec.id ? String(rec.id).substring(0, 8) : 'recording';
    var dateStr = formatDateForFilename(rec.created_at);
    var filename = 'lana-recording-' + idShort + '-' + dateStr + '.webm';

    // Programmatic anchor click — reuses the existing blob URL so we never
    // refetch and never leak a second object URL.
    var a = document.createElement('a');
    a.href = state.mediaUrl;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      // Defer removal so Safari/Chromium have time to start the download.
      window.setTimeout(function () {
        try { a.parentNode && a.parentNode.removeChild(a); } catch (_) { /* noop */ }
      }, 0);
    }
  }

  function formatDateForFilename(dateString) {
    var d = dateString ? new Date(dateString) : new Date();
    if (!d || isNaN(d.getTime())) d = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function ensureMedia() {
    var rec = state.recording;
    if (!rec || rec.status !== 'ready') {
      // Status changed away from ready (rare, but possible if archived
      // mid-session) — drop any stale blob URL.
      releaseMedia();
      return;
    }
    if (state.mediaLoading) return;
    if (state.mediaUrl && state.mediaRecordingId === rec.id) return;

    // Recording id changed (e.g. SPA-style navigation reused the page) —
    // release the previous URL before fetching the new one.
    if (state.mediaRecordingId && state.mediaRecordingId !== rec.id) {
      releaseMedia();
    }

    state.mediaLoading = true;
    state.mediaError = null;
    var requestedId = rec.id;

    fetchMediaBlob(requestedId)
      .then(function (blob) {
        // Bail out if the user navigated to a different recording while the
        // request was in flight — don't attach the blob to the new context.
        if (!state.recording || state.recording.id !== requestedId) {
          return;
        }
        state.mediaUrl = URL.createObjectURL(blob);
        state.mediaRecordingId = requestedId;
        render();
      })
      .catch(function (err) {
        if (!state.recording || state.recording.id !== requestedId) return;
        // Avoid leaking signed URLs / tokens through error logs.
        console.error('[RecordingDetail] Media load failed:',
          err && err.message ? err.message : 'unknown error');
        state.mediaError = true;
        render();
      })
      .finally(function () {
        state.mediaLoading = false;
      });
  }

  function fetchMediaBlob(recordingId) {
    if (!window.api || !api.token || !api.baseUrl) {
      return Promise.reject(new Error('API not ready'));
    }
    var url = api.baseUrl + '/api/v1/recordings/' + encodeURIComponent(recordingId) + '/media';
    return fetch(url, {
      headers: { 'Authorization': 'Bearer ' + api.token }
    }).then(function (response) {
      if (!response.ok) {
        // Surface the status code only; do not echo response bodies that may
        // include signed URLs or storage paths.
        var error = new Error('Media request returned ' + response.status);
        error.status = response.status;
        throw error;
      }
      return response.blob();
    });
  }

  function releaseMedia() {
    if (state.mediaUrl) {
      try { URL.revokeObjectURL(state.mediaUrl); } catch (_) { /* noop */ }
    }
    state.mediaUrl = null;
    state.mediaRecordingId = null;
    state.mediaError = null;
    state.activeSegmentIndex = -1;
    state.captionsActiveIndex = -1;
    if (state.videoEl) {
      if (state.timeUpdateHandler) {
        state.videoEl.removeEventListener('timeupdate', state.timeUpdateHandler);
        state.videoEl.removeEventListener('seeked', state.timeUpdateHandler);
      }
      if (state.metadataHandler) {
        state.videoEl.removeEventListener('loadedmetadata', state.metadataHandler);
      }
      // Task #32 — PiP listener cleanup. Exit any active PiP session belonging
      // to *this* element so a stale floating window doesn't keep playing
      // detached audio after navigation.
      if (state.pipEnterHandler) {
        state.videoEl.removeEventListener('enterpictureinpicture', state.pipEnterHandler);
      }
      if (state.pipLeaveHandler) {
        state.videoEl.removeEventListener('leavepictureinpicture', state.pipLeaveHandler);
      }
      try {
        if (typeof document !== 'undefined'
            && document.pictureInPictureElement === state.videoEl
            && typeof document.exitPictureInPicture === 'function') {
          var exitP = document.exitPictureInPicture();
          if (exitP && typeof exitP.catch === 'function') exitP.catch(function () { /* noop */ });
        }
      } catch (_) { /* noop */ }
    }
    if (state.audioEl && state.timeUpdateHandler) {
      state.audioEl.removeEventListener('timeupdate', state.timeUpdateHandler);
      state.audioEl.removeEventListener('seeked', state.timeUpdateHandler);
    }
    state.videoEl = null;
    state.audioEl = null;
    state.captionsEl = null;
    state.captionsTextEl = null;
    state.timeUpdateHandler = null;
    state.metadataHandler = null;
    state.pipEnterHandler = null;
    state.pipLeaveHandler = null;
    state.pipActive = false;
    state.focusedSegmentIndex = -1;
    // Reset mode so the next recording renders the default video viewport
    // until its loadedmetadata fires.
    state.mode = 'video';
  }

  // ---- Segment ↔ video helpers --------------------------------------------

  // Read segment timing in seconds. Backend contract uses
  // `offsets.from` / `offsets.to` in milliseconds (Task #26). Older shapes
  // (`start_ms`/`end_ms`, or `start`/`end` in seconds from whisper) are
  // tolerated so the player works against either representation.
  function segmentStartSeconds(segment) {
    if (!segment) return null;
    if (segment.offsets && Number.isFinite(Number(segment.offsets.from))) {
      return Number(segment.offsets.from) / 1000;
    }
    if (Number.isFinite(Number(segment.start_ms))) return Number(segment.start_ms) / 1000;
    if (Number.isFinite(Number(segment.start))) {
      var s = Number(segment.start);
      // whisper-style segments are seconds; very large values are ms.
      return s > 1000 ? s / 1000 : s;
    }
    return null;
  }

  function segmentEndSeconds(segment) {
    if (!segment) return null;
    if (segment.offsets && Number.isFinite(Number(segment.offsets.to))) {
      return Number(segment.offsets.to) / 1000;
    }
    if (Number.isFinite(Number(segment.end_ms))) return Number(segment.end_ms) / 1000;
    if (Number.isFinite(Number(segment.end))) {
      var e = Number(segment.end);
      return e > 1000 ? e / 1000 : e;
    }
    return null;
  }

  function updateActiveSegment(currentTime) {
    var rec = state.recording;
    var segments = (rec && rec.transcript && Array.isArray(rec.transcript.segments))
      ? rec.transcript.segments
      : [];
    if (!segments.length) return;

    var nextIndex = -1;
    for (var i = 0; i < segments.length; i++) {
      var startS = segmentStartSeconds(segments[i]);
      var endS = segmentEndSeconds(segments[i]);
      if (startS == null) continue;
      if (currentTime >= startS && (endS == null || currentTime < endS)) {
        nextIndex = i;
        break;
      }
    }

    if (nextIndex === state.activeSegmentIndex) return;

    var list = document.getElementById('recordingSegmentsList');
    if (list) {
      var prev = list.querySelector('.recording-detail__segment.is-playing');
      if (prev) prev.classList.remove('is-playing');
      if (nextIndex >= 0) {
        var nextEl = list.querySelector('[data-segment-index="' + nextIndex + '"]');
        if (nextEl) nextEl.classList.add('is-playing');
      }
    }

    state.activeSegmentIndex = nextIndex;
  }

  function renderTranscriptBlock(rec, transcript, hasTranscriptText) {
    var status = rec.status || 'pending';

    if (status === 'failed') {
      var errMessage = '';
      if (rec.metadata && typeof rec.metadata === 'object' && rec.metadata.error) {
        errMessage = String(rec.metadata.error);
      }
      return [
        '<section>',
        '  <div class="recording-detail__section-heading">',
        '    <h2 class="recording-detail__section-title">Transcript</h2>',
        '  </div>',
        '  <div class="recording-detail__error">',
        '    <span class="recording-detail__error-title">Transcription failed</span>',
        errMessage ? '    <span class="recording-detail__error-message">' + escapeHtml(errMessage) + '</span>' : '',
        '  </div>',
        '</section>'
      ].join('');
    }

    if (!hasTranscriptText) {
      var label = status === 'transcribing' ? 'Transcribing…'
        : status === 'uploading' ? 'Uploading…'
        : status === 'pending' ? 'Waiting to upload…'
        : 'No transcript available yet';
      return [
        '<section>',
        '  <div class="recording-detail__section-heading">',
        '    <h2 class="recording-detail__section-title">Transcript</h2>',
        '  </div>',
        '  <div class="recording-detail__transcript-status">',
        '    <lex-spinner size="sm"></lex-spinner>',
        '    <span>' + escapeHtml(label) + '</span>',
        '  </div>',
        '</section>'
      ].join('');
    }

    return [
      '<section>',
      '  <div class="recording-detail__section-heading">',
      '    <h2 class="recording-detail__section-title">Transcript</h2>',
      '    <lex-btn id="recordingCopyBtn" variant="ghost" size="sm" aria-label="Copy transcript">Copy</lex-btn>',
      '  </div>',
      '  <pre class="recording-detail__transcript" id="recordingTranscript">' + escapeHtml(transcript.full_text || '') + '</pre>',
      '</section>'
    ].join('');
  }

  function renderSegmentsBlock(segments) {
    var visible = state.showSegments;
    var toggleLabel = visible ? 'Hide segments' : 'Show segments (' + segments.length + ')';
    var rows = visible ? segments.map(renderSegment).join('') : '';

    return [
      '<section>',
      '  <div class="recording-detail__section-heading">',
      '    <h2 class="recording-detail__section-title">Segments</h2>',
      '    <lex-btn id="recordingSegmentsToggle" variant="ghost" size="sm">' + escapeHtml(toggleLabel) + '</lex-btn>',
      '  </div>',
      visible ? '  <div class="recording-detail__segments" id="recordingSegmentsList">' + rows + '</div>' : '',
      '</section>'
    ].join('');
  }

  function renderSegment(segment, index) {
    var start = formatSegmentTime(segment.start);
    var end = formatSegmentTime(segment.end);
    var time = (start || end) ? (start + (end ? ' – ' + end : '')) : '';
    var speaker = segment.speaker ? String(segment.speaker) : '';
    var text = segment.text != null ? String(segment.text) : '';

    // Task #32 — per-segment copy button. The segment row is itself a <button>
    // (clickable to seek), so we render the copy control as a sibling Lex
    // button outside the row's interactive area to avoid nested-button
    // accessibility issues. They're laid out together via grid/flex in CSS.
    return [
      '<div class="recording-detail__segment-row" data-segment-row-index="' + index + '">',
      '  <button type="button" class="recording-detail__segment" data-segment-index="' + index + '">',
      '    <span class="recording-detail__segment-time">' + escapeHtml(time) + '</span>',
      '    <span class="recording-detail__segment-speaker">' + escapeHtml(speaker) + '</span>',
      '    <span class="recording-detail__segment-text">' + escapeHtml(text) + '</span>',
      '  </button>',
      '  <lex-btn',
      '    class="recording-detail__segment-copy"',
      '    variant="ghost"',
      '    size="sm"',
      '    icon="true"',
      '    leading-icon="copy"',
      '    aria-label="Copy segment"',
      '    title="Copy this segment"',
      '    data-segment-copy-index="' + index + '"',
      '  ></lex-btn>',
      '</div>'
    ].join('');
  }

  // Task #32 — Format a segment as the canonical share-snippet:
  //   [Recording <id8> · 0:42] "<segment text>"
  // <id8> = first 8 hex chars of the recording id (dashes stripped).
  // Time = mm:ss derived from segment.offsets.from / 1000 (the contract field
  // per Task #26). We tolerate older shapes via segmentStartSeconds().
  function formatSegmentSnippet(segment) {
    if (!segment) return '';
    var rec = state.recording || {};
    var id = rec.id ? String(rec.id) : '';
    var idShort = id.replace(/-/g, '').substring(0, 8);
    var startS = segmentStartSeconds(segment);
    var startMs = startS != null ? Math.max(0, Math.round(startS * 1000)) : 0;
    var totalSeconds = Math.floor(startMs / 1000);
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    var timeStr = minutes + ':' + pad(seconds);
    var text = segment.text != null ? String(segment.text) : '';
    return '[Recording ' + idShort + ' · ' + timeStr + '] "' + text + '"';
  }

  function copySegmentByIndex(index) {
    var rec = state.recording;
    var segments = (rec && rec.transcript && Array.isArray(rec.transcript.segments))
      ? rec.transcript.segments
      : [];
    var segment = segments[index];
    if (!segment) return;

    var snippet = formatSegmentSnippet(segment);
    if (!snippet) return;

    if (!navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.warning === 'function') {
        window.Lex.Toast.warning('Clipboard not available in this environment');
      }
      return;
    }

    navigator.clipboard.writeText(snippet)
      .then(function () {
        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.success === 'function') {
          window.Lex.Toast.success('Copied');
        }
      })
      .catch(function () {
        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
          window.Lex.Toast.error('Failed to copy segment');
        }
      });
  }

  function bindBodyHandlers(hasTranscriptText, hasSegments) {
    if (hasTranscriptText) {
      var copyBtn = document.getElementById('recordingCopyBtn');
      if (copyBtn) {
        copyBtn.addEventListener('click', copyTranscript);
      }
    }

    if (hasSegments) {
      var toggleBtn = document.getElementById('recordingSegmentsToggle');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', function () {
          state.showSegments = !state.showSegments;
          render();
        });
      }
      var list = document.getElementById('recordingSegmentsList');
      if (list) {
        // Segment seek (existing) + per-segment copy (Task #32). Both are
        // delegated off the list so virtualized re-renders keep working.
        list.addEventListener('click', onSegmentClick);
        list.addEventListener('click', onSegmentCopyClick);
        // Track which segment row currently owns keyboard focus so Cmd/Ctrl+C
        // can copy the focused segment (Task #32). focusin/focusout bubble.
        list.addEventListener('focusin', onSegmentFocusIn);
        list.addEventListener('focusout', onSegmentFocusOut);
      }
    }
  }

  function onSegmentCopyClick(event) {
    var btn = event.target.closest('[data-segment-copy-index]');
    if (!btn) return;
    // Stop the click from bubbling to onSegmentClick — the row's seek
    // behavior would otherwise fire on a copy press.
    event.stopPropagation();
    var index = Number(btn.getAttribute('data-segment-copy-index'));
    if (!Number.isFinite(index)) return;
    copySegmentByIndex(index);
  }

  function onSegmentFocusIn(event) {
    var seg = event.target.closest('[data-segment-index]');
    if (seg) {
      var idx = Number(seg.getAttribute('data-segment-index'));
      if (Number.isFinite(idx)) state.focusedSegmentIndex = idx;
    }
  }

  function onSegmentFocusOut(event) {
    // If focus moves out of the segments list entirely, clear the tracked
    // index. relatedTarget is null when focus leaves the document.
    var list = document.getElementById('recordingSegmentsList');
    if (!list) { state.focusedSegmentIndex = -1; return; }
    var next = event.relatedTarget;
    if (!next || !list.contains(next)) {
      state.focusedSegmentIndex = -1;
    }
  }

  function onSegmentClick(event) {
    var btn = event.target.closest('[data-segment-index]');
    if (!btn) return;

    var index = Number(btn.getAttribute('data-segment-index'));
    var rec = state.recording;
    var segments = (rec && rec.transcript && Array.isArray(rec.transcript.segments))
      ? rec.transcript.segments
      : [];
    var segment = segments[index];

    // If we have a player, seek to the segment start and resume playback when
    // paused. When no player is mounted (e.g. status !== 'ready'), keep the
    // existing scroll-into-view fallback so the click still does something.
    // We seek the active media element so this also works in audio-only mode.
    var media = activeMediaEl()
      || document.getElementById('recordingVideo')
      || document.getElementById('recordingAudio');
    var startS = segmentStartSeconds(segment);
    if (media && startS != null && Number.isFinite(startS)) {
      try {
        media.currentTime = Math.max(0, startS);
      } catch (_) { /* readyState may not be set yet; ignore */ }
      if (media.paused) {
        var p = media.play();
        // play() returns a promise in modern browsers; swallow rejections
        // (autoplay restrictions / user-gesture failures) — the controls are
        // visible so the user can recover.
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
      updateActiveSegment(media.currentTime);
      updateCaptionsOverlay(media.currentTime);
      return;
    }

    var transcriptEl = document.getElementById('recordingTranscript');
    if (transcriptEl && typeof transcriptEl.scrollIntoView === 'function') {
      transcriptEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function copyTranscript() {
    var transcript = state.recording && state.recording.transcript;
    if (!transcript || !transcript.full_text) return;
    if (!navigator || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.warning === 'function') {
        window.Lex.Toast.warning('Clipboard not available in this environment');
      }
      return;
    }
    navigator.clipboard.writeText(transcript.full_text)
      .then(function () {
        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.success === 'function') {
          window.Lex.Toast.success('Transcript copied');
        }
      })
      .catch(function () {
        if (window.Lex && window.Lex.Toast && typeof window.Lex.Toast.error === 'function') {
          window.Lex.Toast.error('Failed to copy transcript');
        }
      });
  }

  function renderScopeChip(rec) {
    var visibility = rec.visibility || 'private';
    var label = SCOPE_LABEL[visibility] || visibility;
    var modifier = visibility === 'matter' ? 'matter' : (visibility === 'organization' ? 'org' : 'private');

    if (visibility === 'matter' && rec.matter_id) {
      var resolved = matterCache[rec.matter_id];
      if (resolved) {
        var pieces = [];
        if (resolved.name) pieces.push(resolved.name);
        if (resolved.matter_id) pieces.push('(' + resolved.matter_id + ')');
        if (pieces.length > 0) {
          label = pieces.join(' ');
        }
      }
    }

    return '<span class="recordings-item__chip recordings-item__chip--' + escapeHtml(modifier) + '">'
      + escapeHtml(label) + '</span>';
  }

  function renderError(title, description) {
    if (!els.container) return;
    els.container.innerHTML = [
      '<lex-empty icon="alert-circle" message="' + escapeHtml(title) + '" description="' + escapeHtml(description) + '"></lex-empty>'
    ].join('');
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function recordingTitle(rec) {
    var meta = (rec && rec.metadata) || {};
    if (meta && typeof meta === 'object' && meta.title) {
      return String(meta.title);
    }
    var id = rec && rec.id ? String(rec.id) : '';
    var short = id ? id.substring(0, 8) : '';
    return short ? 'Recording ' + short : 'Recording';
  }

  function ownerLabel(rec) {
    if (!rec) return '';
    // owner_name + owner_email come from the backend's LEFT JOIN on `users`
    // (Task #18). The "User <first 8>" branch is kept as the deleted-owner
    // fallback so a missing JOIN doesn't render "User undefined".
    if (rec.owner_name) return String(rec.owner_name);
    if (rec.owner_email) return String(rec.owner_email);
    if (rec.owner_id) {
      var id = String(rec.owner_id);
      return 'User ' + id.substring(0, 8);
    }
    return '';
  }

  function formatBytes(bytes) {
    if (window.Lex && window.Lex.Utils && typeof window.Lex.Utils.formatFileSize === 'function') {
      return window.Lex.Utils.formatFileSize(bytes) || '';
    }
    var n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n = n / 1024;
      i++;
    }
    return (Math.round(n * 10) / 10) + ' ' + units[i];
  }

  function formatDuration(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '';
    var totalSeconds = Math.round(n / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    }
    return pad(minutes) + ':' + pad(seconds);
  }

  function formatSegmentTime(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '';
    // Segments may use seconds (whisper) or milliseconds. Heuristic: <1000
    // is treated as seconds, otherwise milliseconds.
    var totalSeconds = n < 1000 ? Math.round(n) : Math.round(n / 1000);
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var pad = function (v) { return v < 10 ? '0' + v : '' + v; };
    if (hours > 0) {
      return hours + ':' + pad(minutes) + ':' + pad(seconds);
    }
    return pad(minutes) + ':' + pad(seconds);
  }

  function formatAbsolute(dateString) {
    if (!dateString) return '';
    if (window.Lex && window.Lex.Utils && typeof window.Lex.Utils.formatDateTime === 'function') {
      return window.Lex.Utils.formatDateTime(dateString) || '';
    }
    var date = new Date(dateString);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  // Cleanup polling and any in-flight media blob URL on page unload to
  // avoid leaked timers / object URLs.
  function cleanup() {
    clearPoll();
    releaseMedia();
    if (state.keyNavHandler) {
      document.removeEventListener('keydown', state.keyNavHandler);
      state.keyNavHandler = null;
    }
  }
  window.addEventListener('beforeunload', cleanup);
  window.addEventListener('pagehide', cleanup);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
