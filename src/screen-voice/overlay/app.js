(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    shell: document.querySelector('.voice-shell'), expanded: $('expandedSurface'), expandedStatus: $('expandedStatus'),
    info: $('infoButton'), shortcutHint: $('shortcutHint'),
    shortcutVerb: $('shortcutVerb'), shortcutKeys: $('shortcutKeys'), shortcutAction: $('shortcutAction'),
    title: $('statusTitle'), detail: $('statusDetail'), context: $('contextNotice'), meter: $('levelMeter'),
    transcript: $('transcript'), preview: $('preview'), previewText: $('previewText'),
    confirm: $('confirmButton'), copy: $('copyButton'), cancel: $('cancelButton'), undo: $('undoButton'),
    hideDetails: $('hideDetailsButton')
  };
  let snapshot = { state: 'idle', session: null, settings: {} };
  let stream = null;
  let recorder = null;
  let chunks = [];
  let audioContext = null;
  let analyser = null;
  let animationFrame = null;
  let stopTimer = null;
  let activeSessionId = null;
  let discardRecording = false;
  let captureStopRequested = null;
  let capturePhase = 'idle';
  let playback = null;
  let detailsOpen = true;
  let drawerTimer = null;
  let resizeFrame = null;
  let captureChordActive = false;
  const pressedCaptureKeys = new Set();

  const stateCopy = {
    idle: ['Ready', 'Ask LANA about your matter, this window, or what to do next.'],
    listening: ['Listening', 'Speak after the start chime, then release the shortcut to process.'],
    transcribing: ['Transcribing', 'Turning your audio into text…'],
    gathering_context: ['Reading this window', 'Collecting only the active, accessible context needed for your request.'],
    thinking: ['Thinking', 'Preparing a constrained response…'],
    previewing: ['Review before applying', 'Nothing has been changed yet.'],
    executing: ['Applying', 'Rechecking the target before inserting…'],
    speaking: ['Speaking', 'Playing LANA’s response…'],
    canceled: ['Canceled', 'No changes were made.'],
    error: ['Couldn’t complete that', 'Try again or open settings for permission help.']
  };

  function labelLexButton(element, label) {
    element.title = label;
    queueMicrotask(() => element.querySelector('button')?.setAttribute('aria-label', label));
  }

  function displayShortcut(shortcut) {
    const parts = String(shortcut || '').split('+').filter(Boolean);
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    if (!isMac) return parts.map((part) => part === 'CommandOrControl' ? 'Ctrl' : part).join('+');
    const symbols = { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Shift: '⇧', Alt: '⌥', Option: '⌥' };
    return parts.map((part) => symbols[part] || part).join('');
  }

  function syncOverlayHeight() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      const shellBottom = els.shell.getBoundingClientRect().bottom;
      window.screenVoice.setOverlayHeight(Math.ceil(shellBottom + 4));
    });
  }

  function syncExpandedSurface(state = snapshot.state || 'idle') {
    const previewing = state === 'previewing';
    const shouldShow = detailsOpen || previewing;
    clearTimeout(drawerTimer);
    if (shouldShow) {
      els.expanded.hidden = false;
      els.expanded.classList.remove('is-closing');
    } else if (!els.expanded.hidden) {
      els.expanded.classList.add('is-closing');
      drawerTimer = setTimeout(() => {
        els.expanded.hidden = true;
        els.expanded.classList.remove('is-closing');
        syncOverlayHeight();
      }, 190);
    }
    els.expandedStatus.hidden = !detailsOpen;
    els.expanded.classList.toggle('details-open', detailsOpen);
    els.info.setAttribute('aria-expanded', detailsOpen ? 'true' : 'false');
    syncOverlayHeight();
  }

  function render(next) {
    snapshot = next || snapshot;
    const state = snapshot.state || 'idle';
    const session = snapshot.session || {};
    const copy = stateCopy[state] || stateCopy.idle;
    els.shell.className = `voice-shell ${state} capture-${capturePhase}`;
    const activeShortcut = snapshot.settings?.captureShortcut;
    const shortcutLabel = displayShortcut(activeShortcut || 'Control+Option');
    const captureReady = state === 'listening' && capturePhase === 'recording';
    const captureStarting = state === 'listening' && ['idle', 'preparing', 'chiming'].includes(capturePhase);
    const captureReleasing = state === 'listening' && capturePhase === 'releasing';
    els.shortcutKeys.textContent = captureReleasing ? '' : shortcutLabel;
    els.shortcutVerb.textContent = captureReady ? 'Release' : captureStarting ? 'Keep holding' : captureReleasing ? 'Processing' : 'Hold';
    els.shortcutAction.textContent = captureReady ? 'to process' : captureStarting ? 'until ready' : captureReleasing ? 'audio…' : 'to speak';
    els.shortcutHint.title = `${els.shortcutVerb.textContent} ${els.shortcutKeys.textContent} ${els.shortcutAction.textContent}`.trim();
    els.title.textContent = copy[0];
    els.shell.setAttribute('aria-label', `${copy[0]}. ${session.error?.message || copy[1]}`);
    els.detail.textContent = session.error?.message || copy[1];
    if (state === 'listening') {
      const captureCopy = {
        preparing: ['Preparing microphone', 'Please wait for the start chime.'],
        chiming: ['Get ready', 'Recording begins as soon as the chime finishes.'],
        recording: ['Listening', 'Speak now, then release the shortcut to process.'],
        releasing: ['Finishing capture', 'Recording has stopped. Preparing your audio…']
      }[capturePhase] || ['Preparing microphone', 'Please wait for the start chime.'];
      els.title.textContent = captureCopy[0];
      els.detail.textContent = captureCopy[1];
    }
    if (state === 'idle') {
      els.detail.textContent = `Hold ${displayShortcut(snapshot.settings?.captureShortcut || 'Control+Option')} to ask LANA. Release to process.`;
    }
    els.context.hidden = state !== 'gathering_context';
    els.transcript.hidden = !session.transcript;
    els.transcript.textContent = session.transcript || '';
    const decision = session.decision;
    els.preview.hidden = state !== 'previewing';
    els.previewText.value = decision?.displayResponse || '';
    els.confirm.hidden = !decision?.proposedActions?.length;
    if (decision?.proposedActions?.[0]?.type === 'open_url') els.confirm.textContent = 'Open browser';
    else if (decision?.proposedActions?.[0]?.type === 'navigate_client') els.confirm.textContent = 'Open in LANA';
    else if (decision?.proposedActions?.[0]?.type === 'replace_selection') els.confirm.textContent = 'Replace';
    else if (decision?.proposedActions?.[0]?.type === 'insert_table') els.confirm.textContent = 'Insert cells';
    else els.confirm.textContent = 'Insert';
    els.undo.hidden = !session.result?.canUndo;
    labelLexButton(els.info, state === 'error' ? 'Voice error details' : 'Voice details');
    els.meter.color = state === 'listening' ? 'danger' : 'accent';
    if (state !== 'listening') els.meter.value = 0;
    syncExpandedSurface(state);
  }

  function supportedMimeType() {
    return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function reportCaptureStatus(status, metadata) {
    window.screenVoice.captureStatus(status, metadata).catch(() => {});
  }

  function setCapturePhase(phase) {
    capturePhase = phase;
    render(snapshot);
  }

  function isEditableTarget(target) {
    const tag = String(target?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable);
  }

  function captureKey(event) {
    if (event.key === 'Control' || event.code === 'ControlLeft' || event.code === 'ControlRight') return 'control';
    if (event.key === 'Alt' || event.key === 'Option' || event.code === 'AltLeft' || event.code === 'AltRight') return 'option';
    return null;
  }

  function captureChordDown() {
    return pressedCaptureKeys.has('control') && pressedCaptureKeys.has('option');
  }

  function releaseOverlayCapture() {
    if (!captureChordActive) return;
    captureChordActive = false;
    if (capturePhase === 'recording') window.screenVoice.captureRelease().catch(() => {});
  }

  async function startCapture({ sessionId, maxDurationMs }) {
    await cleanupCapture();
    activeSessionId = sessionId;
    discardRecording = false;
    captureStopRequested = null;
    setCapturePhase('preparing');
    try {
      reportCaptureStatus('requesting_microphone');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
      chunks = [];
      const mimeType = supportedMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => window.screenVoice.captureError('MICROPHONE_DISCONNECTED');
      recorder.onstop = finalizeCapture;
      if (!stream.getAudioTracks().some((track) => track.readyState === 'live')) {
        throw Object.assign(new Error('No live microphone track'), { name: 'NotFoundError' });
      }
      reportCaptureStatus('microphone_ready', { trackCount: stream.getAudioTracks().length });
      if (captureStopRequested) {
        await cleanupCapture();
        reportCaptureStatus('capture_failed');
        window.screenVoice.captureError('NO_SPEECH');
        return;
      }
      setCapturePhase('chiming');
      reportCaptureStatus('start_chime');
      await playCue('start');
      if (captureStopRequested) {
        const pending = captureStopRequested;
        await cleanupCapture();
        if (!pending.discard) playCue('release');
        if (!pending.discard) {
          reportCaptureStatus('capture_failed');
          window.screenVoice.captureError('NO_SPEECH');
        }
        return;
      }
      recorder.start(200);
      setCapturePhase('recording');
      reportCaptureStatus('recording_started');
      startMeter(stream);
      if (!captureChordActive) {
        setTimeout(() => window.screenVoice.captureRelease().catch(() => {}), 250);
      }
      stopTimer = setTimeout(() => stopCapture(false), Math.min(90000, Number(maxDurationMs) || 90000));
    } catch (error) {
      await cleanupCapture();
      const code = error?.name === 'NotAllowedError' ? 'MICROPHONE_DENIED' : 'MICROPHONE_UNAVAILABLE';
      setCapturePhase('idle');
      reportCaptureStatus('capture_failed');
      window.screenVoice.captureError(code);
    }
  }

  function startMeter(mediaStream) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    audioContext.createMediaStreamSource(mediaStream).connect(analyser);
    const values = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!analyser) return;
      analyser.getByteTimeDomainData(values);
      const rms = Math.sqrt(values.reduce((sum, value) => sum + Math.pow((value - 128) / 128, 2), 0) / values.length);
      els.meter.value = Math.round(Math.min(1, rms * 4) * 100);
      animationFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopCapture(discard) {
    discardRecording = Boolean(discard);
    setCapturePhase(discard ? 'idle' : 'releasing');
    if (!recorder || recorder.state === 'inactive') {
      captureStopRequested = { discard: discardRecording };
      return;
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      reportCaptureStatus('recording_released');
      if (!discard) playCue('release');
    }
  }

  function playCue(type) {
    const CueContext = window.AudioContext || window.webkitAudioContext;
    if (!CueContext) return Promise.resolve();
    const cue = new CueContext();
    const oscillator = cue.createOscillator();
    const gain = cue.createGain();
    const now = cue.currentTime;
    const rising = type === 'start';
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(rising ? 520 : 620, now);
    oscillator.frequency.exponentialRampToValueAtTime(rising ? 760 : 420, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.065, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    oscillator.connect(gain).connect(cue.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.12);
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        cue.close().catch(() => {}).finally(resolve);
      };
      oscillator.addEventListener('ended', finish, { once: true });
      setTimeout(finish, 180);
    });
  }

  async function finalizeCapture() {
    const sessionId = activeSessionId;
    const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const discard = discardRecording;
    await cleanupCapture();
    capturePhase = 'idle';
    if (discard || !blob.size) return;
    reportCaptureStatus('audio_ready', { bytes: blob.size });
    const audioBase64 = await blobToBase64(blob);
    await window.screenVoice.audioComplete({ sessionId, audioBase64, mimeType });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.readAsDataURL(blob);
    });
  }

  async function cleanupCapture() {
    clearTimeout(stopTimer); stopTimer = null;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null; analyser = null;
    if (audioContext) await audioContext.close().catch(() => {});
    audioContext = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null; recorder = null; chunks = [];
  }

  els.undo.addEventListener('click', () => window.screenVoice.undo());
  els.confirm.addEventListener('click', () => window.screenVoice.confirm(snapshot.session?.id));
  els.copy.addEventListener('click', () => window.screenVoice.copy(els.previewText.value));
  els.cancel.addEventListener('click', () => window.screenVoice.cancel());
  $('dismissButton').addEventListener('click', () => window.screenVoice.dismiss());
  els.info.addEventListener('click', async () => {
    detailsOpen = !detailsOpen;
    syncExpandedSurface();
    if (detailsOpen) await window.screenVoice.openDetails();
    else await window.screenVoice.closeDetails();
  });
  els.hideDetails.addEventListener('click', async () => {
    detailsOpen = false;
    syncExpandedSurface();
    await window.screenVoice.closeDetails();
  });
  $('settingsButton').addEventListener('click', () => window.screenVoice.openSettings());
  document.addEventListener('keydown', (event) => {
    const key = captureKey(event);
    if (key && !isEditableTarget(event.target)) {
      event.preventDefault();
      pressedCaptureKeys.add(key);
      if (captureChordDown() && !captureChordActive) {
        captureChordActive = true;
        window.screenVoice.captureStart().catch(() => { captureChordActive = false; });
      }
      return;
    }
    if (event.key !== 'Escape') return;
    if (detailsOpen) {
      detailsOpen = false;
      syncExpandedSurface();
      window.screenVoice.closeDetails();
      return;
    }
    stopCapture(true); window.screenVoice.cancel();
  });
  document.addEventListener('keyup', (event) => {
    const key = captureKey(event);
    if (!key) return;
    if (!isEditableTarget(event.target)) event.preventDefault();
    pressedCaptureKeys.delete(key);
    if (!captureChordDown()) releaseOverlayCapture();
  });
  window.addEventListener('blur', () => {
    pressedCaptureKeys.clear();
    releaseOverlayCapture();
  });

  window.screenVoice.onState(render);
  window.screenVoice.onStartCapture(startCapture);
  window.screenVoice.onStopCapture(({ discard }) => stopCapture(discard));
  window.screenVoice.onShowDetails(() => {
    detailsOpen = true;
    syncExpandedSurface();
    render(snapshot);
  });
  window.screenVoice.onUndone(() => { els.detail.textContent = 'The last voice edit was undone.'; });
  window.screenVoice.onPlayAudio(({ base64, mime_type: mimeType }) => {
    if (playback) playback.pause();
    playback = new Audio(`data:${mimeType || 'audio/wav'};base64,${base64}`);
    playback.play().catch(() => {});
  });
  window.addEventListener('beforeunload', cleanupCapture);
  if ('ResizeObserver' in window) new ResizeObserver(syncOverlayHeight).observe(els.shell);
  labelLexButton(els.undo, 'Undo last voice edit');
  labelLexButton(els.info, 'Voice details');
  labelLexButton(els.hideDetails, 'Hide voice details');
  labelLexButton($('settingsButton'), 'Open LANA Voice Agent settings');
  labelLexButton($('dismissButton'), 'Hide voice overlay');
  window.screenVoice.getState().then(render);
})();
