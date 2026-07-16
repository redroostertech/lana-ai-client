(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    shell: document.querySelector('.voice-shell'), expanded: $('expandedSurface'), expandedStatus: $('expandedStatus'),
    mode: $('modeBadge'), mic: $('micButton'),
    title: $('statusTitle'), detail: $('statusDetail'), context: $('contextNotice'), meter: $('levelMeter'),
    transcript: $('transcript'), preview: $('preview'), previewText: $('previewText'),
    confirm: $('confirmButton'), copy: $('copyButton'), cancel: $('cancelButton'), idle: $('idleActions'),
    dictate: $('dictateButton'), agent: $('agentButton'), compactAgent: $('agentCompactButton'),
    undo: $('undoButton'), settings: $('settingsPanel'),
    microphonePermission: $('microphonePermissionBadge'), accessibilityPermission: $('accessibilityPermissionBadge'),
    permissionHelp: $('permissionHelp'), microphonePermissionButton: $('microphoneButton'),
    accessibilityPermissionButton: $('accessibilityButton')
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
  let permissionTimer = null;

  const stateCopy = {
    idle: ['Ready', 'Dictate into the focused field or ask LANA about this window.'],
    listening: ['Listening', 'Speak naturally. Press the microphone or shortcut again to finish.'],
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

  function syncExpandedSurface(state = snapshot.state || 'idle') {
    const settingsOpen = !els.settings.hidden;
    els.expanded.hidden = !(settingsOpen || state === 'previewing' || state === 'error');
    els.expandedStatus.hidden = settingsOpen;
  }

  function render(next) {
    snapshot = next || snapshot;
    const state = snapshot.state || 'idle';
    const session = snapshot.session || {};
    const copy = stateCopy[state] || stateCopy.idle;
    els.shell.className = `voice-shell ${state}`;
    const isAgent = session.mode === 'agent';
    els.mode.label = isAgent ? 'Agent' : 'Dictation';
    els.mode.color = isAgent ? 'indigo' : 'gray';
    els.title.textContent = state === 'listening' && !isAgent ? 'Dictating' : copy[0];
    els.detail.textContent = session.error?.message || copy[1];
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
    els.idle.hidden = state !== 'error';
    els.undo.hidden = !session.result?.canUndo;
    els.mic.leadingIcon = state === 'listening' ? 'square' : 'mic';
    labelLexButton(els.mic, state === 'listening' ? 'Stop listening' : 'Start dictation');
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
    if (recorder && recorder.state !== 'inactive') recorder.stop();
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

  function populateSettings() {
    const settings = snapshot.settings || {};
    $('dictationShortcut').value = settings.dictationShortcut || '';
    $('agentShortcut').value = settings.agentShortcut || '';
    $('defaultMode').value = settings.defaultMode || 'dictation';
    $('openAtLogin').checked = Boolean(settings.openAtLogin);
    $('screenContextEnabled').checked = settings.screenContextEnabled !== false;
    $('voiceOutputEnabled').checked = Boolean(settings.voiceOutputEnabled);
    $('confirmationPolicy').value = settings.confirmationPolicy || 'risk_based';
  }

  function permissionBadge(badge, allowed, blocked, unavailable) {
    badge.label = unavailable ? 'Unavailable' : allowed ? 'Allowed' : blocked ? 'Denied' : 'Required';
    badge.color = unavailable ? 'gray' : allowed ? 'green' : blocked ? 'red' : 'yellow';
  }

  function renderPermissions(value = {}) {
    const microphoneBlocked = ['denied', 'restricted'].includes(value.microphoneStatus);
    const microphoneUnavailable = value.microphoneStatus === 'unavailable';
    permissionBadge(els.microphonePermission, value.microphone === true, microphoneBlocked, microphoneUnavailable);
    permissionBadge(els.accessibilityPermission, value.accessibility === true, false, value.supported === false);
    els.microphonePermissionButton.disabled = value.microphone === true;
    els.accessibilityPermissionButton.disabled = value.accessibility === true || value.supported === false;
    if (value.microphone === true && value.accessibility === true) {
      els.permissionHelp.textContent = 'Ready for dictation and screen-aware commands.';
    } else if (microphoneBlocked) {
      els.permissionHelp.textContent = 'Microphone access is blocked. Enable it in System Settings.';
    } else if (value.accessibility !== true) {
      els.permissionHelp.textContent = 'Accessibility access is required to find and safely update the focused field.';
    } else {
      els.permissionHelp.textContent = 'Microphone access will be requested when you start dictation.';
    }
  }

  function refreshPermissions() {
    return window.screenVoice.getPermissions().then(renderPermissions).catch(() => {
      els.permissionHelp.textContent = 'Permission status is temporarily unavailable.';
    });
  }

  function monitorPermissions(enabled) {
    clearInterval(permissionTimer);
    permissionTimer = null;
    if (!enabled) return;
    refreshPermissions();
    permissionTimer = setInterval(refreshPermissions, 1500);
  }

  function requestSystemPermission(type) {
    els.permissionHelp.textContent = `Requesting ${type} access…`;
    return window.screenVoice.requestPermission(type).then(renderPermissions).catch(() => {
      els.permissionHelp.textContent = 'The permission request could not be opened. Check System Settings manually.';
    });
  }

  els.mic.addEventListener('click', () => snapshot.state === 'listening' ? stopCapture(false) : window.screenVoice.activate('dictation'));
  els.compactAgent.addEventListener('click', () => window.screenVoice.activate('agent'));
  els.dictate.addEventListener('click', () => window.screenVoice.activate('dictation'));
  els.agent.addEventListener('click', () => window.screenVoice.activate('agent'));
  els.undo.addEventListener('click', () => window.screenVoice.undo());
  els.confirm.addEventListener('click', () => window.screenVoice.confirm(snapshot.session?.id));
  els.copy.addEventListener('click', () => window.screenVoice.copy(els.previewText.value));
  els.cancel.addEventListener('click', () => window.screenVoice.cancel());
  $('dismissButton').addEventListener('click', () => window.screenVoice.dismiss());
  $('settingsButton').addEventListener('click', () => {
    populateSettings();
    els.settings.hidden = !els.settings.hidden;
    syncExpandedSurface();
    monitorPermissions(!els.settings.hidden);
    if (els.settings.hidden) window.screenVoice.closeSettings();
    else {
      window.screenVoice.openSettings();
    }
  });
  $('accessibilityButton').addEventListener('click', () => requestSystemPermission('accessibility'));
  $('microphoneButton').addEventListener('click', () => requestSystemPermission('microphone'));
  els.settings.addEventListener('submit', async (event) => {
    event.preventDefault();
    const save = window.screenVoice.saveSettings({ ...snapshot.settings,
      dictationShortcut: $('dictationShortcut').value.trim(), agentShortcut: $('agentShortcut').value.trim(),
      defaultMode: $('defaultMode').value,
      openAtLogin: $('openAtLogin').checked,
      screenContextEnabled: $('screenContextEnabled').checked,
      voiceOutputEnabled: $('voiceOutputEnabled').checked,
      confirmationPolicy: $('confirmationPolicy').value });
    els.settings.hidden = true;
    monitorPermissions(false);
    syncExpandedSurface();
    await save;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { stopCapture(true); window.screenVoice.cancel(); }
  });

  window.screenVoice.onState(render);
  window.screenVoice.onStartCapture(startCapture);
  window.screenVoice.onStopCapture(({ discard }) => stopCapture(discard));
  window.screenVoice.onPermissions(renderPermissions);
  window.screenVoice.onUndone(() => { els.detail.textContent = 'The last voice edit was undone.'; });
  window.screenVoice.onPlayAudio(({ base64, mime_type: mimeType }) => {
    if (playback) playback.pause();
    playback = new Audio(`data:${mimeType || 'audio/wav'};base64,${base64}`);
    playback.play().catch(() => {});
  });
  window.addEventListener('beforeunload', () => { monitorPermissions(false); cleanupCapture(); });
  labelLexButton(els.compactAgent, 'Ask LANA');
  labelLexButton(els.undo, 'Undo last voice edit');
  labelLexButton($('settingsButton'), 'Voice settings');
  labelLexButton($('dismissButton'), 'Hide voice overlay');
  window.screenVoice.getState().then(render);
})();
