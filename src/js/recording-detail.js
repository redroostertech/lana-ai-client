// recording-detail.js — single-recording view.
//
// Fetches /api/v1/recordings/:id, renders header + transcript, and polls every
// 3s while the recording is in a non-terminal state (pending/uploading/
// transcribing). View-only.

(function () {
  'use strict';

  var POLL_INTERVAL_MS = 3000;

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

  var state = {
    recordingId: null,
    recording: null,
    pollTimer: null,
    showSegments: false,
    loading: false
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

    if (!state.recordingId) {
      renderError('Missing recording id', 'Open a recording from the Recordings list to view it here.');
      return;
    }

    loadRecording();
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
      '  <h1 class="recording-detail__title">' + escapeHtml(title) + '</h1>',
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
      renderTranscriptBlock(rec, transcript, hasTranscriptText),
      hasSegments ? renderSegmentsBlock(segments) : '',
      '</div>'
    ].join('');

    els.container.innerHTML = html;

    bindBodyHandlers(hasTranscriptText, hasSegments);
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

    return [
      '<button type="button" class="recording-detail__segment" data-segment-index="' + index + '">',
      '  <span class="recording-detail__segment-time">' + escapeHtml(time) + '</span>',
      '  <span class="recording-detail__segment-speaker">' + escapeHtml(speaker) + '</span>',
      '  <span class="recording-detail__segment-text">' + escapeHtml(text) + '</span>',
      '</button>'
    ].join('');
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
        list.addEventListener('click', onSegmentClick);
      }
    }
  }

  function onSegmentClick(event) {
    var btn = event.target.closest('[data-segment-index]');
    if (!btn) return;
    // Basic UX: scroll the transcript pane into view. Per-segment jump within
    // the transcript text is a follow-up.
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

  // Cleanup polling on page unload to avoid leaked timers.
  window.addEventListener('beforeunload', clearPoll);
  window.addEventListener('pagehide', clearPoll);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
