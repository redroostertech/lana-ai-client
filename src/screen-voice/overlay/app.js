(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    shell: document.querySelector('.voice-shell'), mode: $('modeBadge'), mic: $('micButton'),
    title: $('statusTitle'), detail: $('statusDetail'), context: $('contextNotice'), meter: $('levelMeter'),
    transcript: $('transcript'), preview: $('preview'), previewText: $('previewText'),
    confirm: $('confirmButton'), copy: $('copyButton'), cancel: $('cancelButton'), idle: $('idleActions'),
    dictate: $('dictateButton'), agent: $('agentButton'), undo: $('undoButton'), settings: $('settingsPanel')
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

  function render(next) {
    snapshot = next || snapshot;
    const state = snapshot.state || 'idle';
    const session = snapshot.session || {};
    const copy = stateCopy[state] || stateCopy.idle;
    els.shell.className = `voice-shell ${state}`;
    els.mode.textContent = session.mode === 'agent' ? 'Agent' : 'Dictation';
    els.title.textContent = session.error?.message || copy[0];
    els.detail.textContent = session.error ? copy[1] : copy[1];
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
    els.idle.hidden = !['idle', 'error', 'canceled'].includes(state);
    els.undo.hidden = !session.result?.canUndo;
    els.mic.setAttribute('aria-label', state === 'listening' ? 'Stop listening' : 'Start dictation');
    if (state !== 'listening') els.meter.value = 0;
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
      els.meter.value = Math.min(1, rms * 4);
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
    $('screenContextEnabled').checked = settings.screenContextEnabled !== false;
    $('voiceOutputEnabled').checked = Boolean(settings.voiceOutputEnabled);
    $('confirmationPolicy').value = settings.confirmationPolicy || 'risk_based';
  }

  els.mic.addEventListener('click', () => snapshot.state === 'listening' ? stopCapture(false) : window.screenVoice.activate('dictation'));
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
    if (!els.settings.hidden) window.screenVoice.openSettings();
  });
  $('accessibilityButton').addEventListener('click', () => window.screenVoice.requestPermission('accessibility'));
  $('microphoneButton').addEventListener('click', () => window.screenVoice.requestPermission('microphone'));
  els.settings.addEventListener('submit', async (event) => {
    event.preventDefault();
    await window.screenVoice.saveSettings({ ...snapshot.settings,
      dictationShortcut: $('dictationShortcut').value.trim(), agentShortcut: $('agentShortcut').value.trim(),
      defaultMode: $('defaultMode').value,
      screenContextEnabled: $('screenContextEnabled').checked,
      voiceOutputEnabled: $('voiceOutputEnabled').checked,
      confirmationPolicy: $('confirmationPolicy').value });
    els.settings.hidden = true;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { stopCapture(true); window.screenVoice.cancel(); }
  });

  window.screenVoice.onState(render);
  window.screenVoice.onStartCapture(startCapture);
  window.screenVoice.onStopCapture(({ discard }) => stopCapture(discard));
  window.screenVoice.onUndone(() => { els.detail.textContent = 'The last voice edit was undone.'; });
  window.screenVoice.onPlayAudio(({ base64, mime_type: mimeType }) => {
    if (playback) playback.pause();
    playback = new Audio(`data:${mimeType || 'audio/wav'};base64,${base64}`);
    playback.play().catch(() => {});
  });
  window.addEventListener('beforeunload', cleanupCapture);
  window.screenVoice.getState().then(render);
})();
