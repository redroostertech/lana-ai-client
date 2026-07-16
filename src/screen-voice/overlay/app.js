(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    shell: document.querySelector('.voice-shell'), expanded: $('expandedSurface'), expandedStatus: $('expandedStatus'),
    mode: $('modeSelect'), info: $('infoButton'), shortcutHint: $('shortcutHint'),
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
  let playback = null;
  let detailsOpen = true;
  let modeInitialized = false;
  let selectedMode = 'dictation';
  let modeMenuOpen = false;
  let drawerTimer = null;
  let resizeFrame = null;

  const stateCopy = {
    idle: ['Ready', 'Dictate into the focused field or ask LANA about this window.'],
    listening: ['Listening', 'Speak naturally, then release the shortcut to process.'],
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
      const dropdown = modeMenuOpen ? els.mode.querySelector('.lex-ddbtn-dropdown') : null;
      const dropdownBottom = dropdown?.getBoundingClientRect().bottom || 0;
      window.screenVoice.setOverlayHeight(Math.ceil(Math.max(shellBottom, dropdownBottom) + 4));
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
    els.shell.className = `voice-shell ${state}`;
    const isAgent = session.mode === 'agent';
    if (!modeInitialized) {
      selectedMode = snapshot.selectedMode === 'agent' || snapshot.settings?.defaultMode === 'agent' ? 'agent' : 'dictation';
      modeInitialized = true;
    }
    if (!['idle', 'canceled', 'error'].includes(state) && session.mode) selectedMode = session.mode;
    els.mode.buttonLabel = selectedMode === 'agent' ? 'Agent' : 'Dictation';
    els.mode.disabled = !['idle', 'canceled', 'error'].includes(state);
    const activeShortcut = selectedMode === 'agent'
      ? snapshot.settings?.agentShortcut
      : snapshot.settings?.dictationShortcut;
    const shortcutLabel = displayShortcut(activeShortcut || (selectedMode === 'agent'
      ? 'CommandOrControl+Shift+A'
      : 'CommandOrControl+Shift+Space'));
    els.shortcutKeys.textContent = shortcutLabel;
    els.shortcutVerb.textContent = state === 'listening' ? 'Release' : 'Hold';
    els.shortcutAction.textContent = state === 'listening' ? 'to process' : 'to speak';
    els.shortcutHint.title = `${state === 'listening' ? 'Release' : 'Hold'} ${shortcutLabel} ${state === 'listening' ? 'to process' : 'to speak'}`;
    els.title.textContent = state === 'listening' && !isAgent ? 'Dictating' : copy[0];
    els.shell.setAttribute('aria-label', `${copy[0]}. ${session.error?.message || copy[1]}`);
    els.detail.textContent = session.error?.message || copy[1];
    if (state === 'idle') {
      els.detail.textContent = `Hold ${displayShortcut(snapshot.settings?.dictationShortcut || 'CommandOrControl+Shift+Space')} to dictate, or ${displayShortcut(snapshot.settings?.agentShortcut || 'CommandOrControl+Shift+A')} for Agent mode. Release to process.`;
    }
    els.context.hidden = state !== 'gathering_context';
    els.transcript.hidden = !session.transcript;
    els.transcript.textContent = session.transcript || '';
    const decision = session.decision;
    els.preview.hidden = state !== 'previewing';
    els.previewText.value = decision?.displayResponse || '';
    els.confirm.hidden = !decision?.proposedActions?.length;
    if (decision?.proposedActions?.[0]?.type === 'replace_selection') els.confirm.textContent = 'Replace';
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

  async function startCapture({ sessionId, maxDurationMs }) {
    await cleanupCapture();
    activeSessionId = sessionId;
    discardRecording = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
      chunks = [];
      const mimeType = supportedMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => window.screenVoice.captureError('MICROPHONE_DISCONNECTED');
      recorder.onstop = finalizeCapture;
      recorder.start(200);
      playCue('start');
      startMeter(stream);
      stopTimer = setTimeout(() => stopCapture(false), Math.min(90000, Number(maxDurationMs) || 90000));
    } catch (error) {
      await cleanupCapture();
      window.screenVoice.captureError(error?.name === 'NotAllowedError' ? 'MICROPHONE_DENIED' : 'MICROPHONE_UNAVAILABLE');
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
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      if (!discard) playCue('release');
    }
  }

  function playCue(type) {
    const CueContext = window.AudioContext || window.webkitAudioContext;
    if (!CueContext) return;
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
    oscillator.addEventListener('ended', () => cue.close().catch(() => {}), { once: true });
  }

  async function finalizeCapture() {
    const sessionId = activeSessionId;
    const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const discard = discardRecording;
    await cleanupCapture();
    if (discard || !blob.size) return;
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

  function setModeMenu(open) {
    modeMenuOpen = Boolean(open);
    document.body.classList.toggle('mode-menu-open', modeMenuOpen);
    window.screenVoice.setModeMenuOpen(modeMenuOpen);
    setTimeout(syncOverlayHeight, 0);
  }
  els.mode.addEventListener('click', () => {
    setTimeout(() => setModeMenu(Boolean(els.mode._open)), 0);
  });
  els.mode.addEventListener('lex-select', (event) => {
    selectedMode = event.detail?.value === 'agent' ? 'agent' : 'dictation';
    setModeMenu(false);
    render(snapshot);
  });
  document.addEventListener('mousedown', (event) => {
    if (modeMenuOpen && !els.mode.contains(event.target)) setModeMenu(false);
  });
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
    if (event.key !== 'Escape') return;
    if (modeMenuOpen) {
      setModeMenu(false);
      return;
    }
    if (detailsOpen) {
      detailsOpen = false;
      syncExpandedSurface();
      window.screenVoice.closeDetails();
      return;
    }
    stopCapture(true); window.screenVoice.cancel();
  });

  window.screenVoice.onState(render);
  window.screenVoice.onStartCapture(startCapture);
  window.screenVoice.onStopCapture(({ discard }) => stopCapture(discard));
  window.screenVoice.onShowDetails(({ mode } = {}) => {
    if (mode === 'agent' || mode === 'dictation') selectedMode = mode;
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
  labelLexButton($('settingsButton'), 'Open Screen Dictation settings');
  labelLexButton($('dismissButton'), 'Hide voice overlay');
  window.screenVoice.getState().then(render);
})();
