const API_ROOT = '/api/v1/voice/agents';

const TABS = [
  { id: 'agent', label: 'Agent' },
  { id: 'voice', label: 'Voice' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'tools', label: 'Tools' },
  { id: 'channels', label: 'Channels' },
  { id: 'tests', label: 'Tests' },
  { id: 'import-export', label: 'Import / Export' }
];

const VOICE_SETTING_INFO = {
  speed: {
    title: 'Speed',
    body: 'Controls speech playback speed for synthesized responses. Keep this close to 1.0 for a natural receptionist voice.'
  },
  runtime: {
    title: 'Runtime',
    body: 'The LANA voice orchestrator that coordinates calls, transcription, response generation, synthesis, and intake capture.'
  },
  transport: {
    title: 'Realtime Transport',
    body: 'The realtime media layer used for active voice sessions. LiveKit is the self-hosted transport used by this install.'
  },
  transcription: {
    title: 'Transcription',
    body: 'The local speech-to-text service that turns caller audio into text before the agent reasons over the conversation.'
  },
  transcription_model: {
    title: 'Transcription Model',
    body: 'The Whisper model used by the transcription sidecar. Larger models can improve accuracy but may increase latency.'
  },
  synthesis: {
    title: 'Speech Synthesis',
    body: 'The local text-to-speech service that converts the agent response into audio for the caller.'
  },
  synthesis_voice: {
    title: 'Synthesis Voice',
    body: 'The Kokoro voice identifier used for generated speech. This is a runtime voice ID, not an external vendor setting.'
  },
  response_model: {
    title: 'Response Model',
    body: 'The LANA response model profile used to generate the agent reply before speech synthesis.'
  }
};

const VOICE_TOOL_CATALOG = [
  {
    id: 'capture_intake',
    name: 'Capture caller intake',
    backendName: 'capture_intake_field',
    type: 'builtin',
    description: 'Collects caller identity, contact details, reason for call, urgency, and preferred next step.',
    details: 'Maps to the voice capture field contract. This should stay enabled for agents that need to collect caller details.'
  },
  {
    id: 'create_callback_task',
    name: 'Create callback task',
    backendName: 'create_callback_task',
    type: 'workflow',
    description: 'Creates a human follow-up task when the caller needs a response from the firm.',
    details: 'This should map to the platform task or workflow layer before runtime dispatch is enabled.'
  },
  {
    id: 'route_urgent_call',
    name: 'Route urgent call',
    backendName: 'route_urgent_call',
    type: 'handoff',
    description: 'Escalates urgent callers to the configured handoff path instead of only taking a message.',
    details: 'Uses the channel handoff policy and should be scoped to urgent or emergency classifications.'
  }
];

const DEFAULT_AGENT = {
  id: null,
  name: 'Receptionist',
  type: 'receptionist',
  status: 'draft',
  language: 'en-US',
  timezone: 'America/New_York',
  tone: 'calm, reassuring, professional, plain-spoken',
  description: 'Answers inbound calls for RedRooster, a personal injury law firm, screens new potential matters, captures incident details, and routes urgent requests.',
  greeting: 'Thank you for calling RedRooster. This is Lana. How can I help today?',
  instructions: [
    'You are the phone receptionist for RedRooster, a personal injury law firm.',
    'Speak naturally and listen to what the caller actually says.',
    'Help callers with new personal injury inquiries, current-client messages, callback requests, office questions, and urgent routing.',
    'For new potential matters, gather the caller name, best callback number, injury or incident type, incident date, incident location, whether medical treatment has been received, whether a claim or lawsuit is already open, whether the caller has signed anything with an insurer, and a brief description of what happened.',
    'If the caller is a current client, capture their name, callback number, matter or attorney if known, and the message they want delivered.',
    'If the caller asks whether RedRooster handles a case type, answer from the firm profile when possible and continue with useful screening.',
    'Do not ask for information already provided. If the caller is unsure, accept that and move forward.',
    'Do not give legal advice, evaluate the value of a claim, promise representation, or say an attorney is available unless configured in the handoff policy.',
    'When enough details are captured, summarize briefly, confirm the best callback number, and tell the caller you will forward the information to an attorney or legal team for review.',
    'For routine new inquiries, tell the caller they should hear back today or the next business day.',
    'If the caller offers photos, incident numbers, medical records, or other follow-up materials, acknowledge that they can send those along and explain the attorney-review callback next step.'
  ].join(' '),
  escalation: 'Escalate immediately when the caller mentions a same-day deadline, statute-of-limitations concern, court date, active hospitalization, severe injury, fatality, police at the scene, hostile caller, media inquiry, signed release, settlement offer, or request for legal advice.',
  completion_criteria: 'New inquiry has caller identity, callback number, incident type, incident date or approximate timing, incident location, injury or treatment status, claim or lawsuit status, insurer/release status when relevant, urgency, and preferred next step captured or marked unavailable. Current-client messages have caller identity, callback number, matter or attorney if known, and message captured.',
  additional_details: [
    'Firm profile: RedRooster is a personal injury law firm focused on helping injured people understand whether the firm can review a potential claim.',
    'Common inquiry types: auto accidents, trucking accidents, motorcycle accidents, pedestrian or bicycle injuries, slip and falls, premises liability, dog bites, wrongful death, workplace injury referrals, and injury-related insurance disputes.',
    'Call goals: make the caller feel heard, capture enough detail for human review, identify urgency, avoid legal advice, and route urgent or high-risk calls for human follow-up.',
    'Do not say RedRooster represents the caller until a human confirms representation. Do not estimate case value, deadlines, liability, settlement timing, or whether the caller has a valid claim.',
    'For insurance adjusters, medical providers, courts, opposing parties, media, vendors, and solicitors, take a concise message and callback information unless a configured route applies.'
  ].join('\n'),
  intake_schema: [
    { name: 'caller_name', label: 'Caller name', type: 'text', required: true, prompt: 'May I have your name?' },
    { name: 'caller_phone', label: 'Best callback number', type: 'phone', required: true, prompt: 'What is the best callback number?' },
    { name: 'caller_email', label: 'Email', type: 'email', required: false, prompt: 'Do you have an email address you would like us to include?' },
    { name: 'incident_type', label: 'Incident type', type: 'enum', required: true, options: ['auto_accident', 'truck_accident', 'motorcycle_accident', 'pedestrian_or_bicycle', 'slip_and_fall', 'premises_liability', 'workplace_injury', 'dog_bite', 'wrongful_death', 'insurance_dispute', 'other'], prompt: 'What type of injury or incident is this about?' },
    { name: 'incident_date', label: 'Incident date', type: 'date', required: true, prompt: 'When did the incident happen?' },
    { name: 'incident_location', label: 'Incident location', type: 'text', required: false, prompt: 'Where did it happen?' },
    { name: 'at_fault_party', label: 'Other party', type: 'text', required: false, prompt: 'Was another person, company, property owner, driver, or insurer involved?' },
    { name: 'injury_summary', label: 'Injury summary', type: 'text', required: true, prompt: 'Can you briefly describe the injury or medical treatment?' },
    { name: 'claim_status', label: 'Claim or lawsuit status', type: 'text', required: false, prompt: 'Has an insurance claim or lawsuit already been opened?' },
    { name: 'signed_documents', label: 'Signed documents or release', type: 'boolean', required: false, prompt: 'Have you signed any release, settlement, or insurance paperwork about this incident?' },
    { name: 'current_client_status', label: 'Current client status', type: 'boolean', required: false, prompt: 'Are you already a RedRooster client?' },
    { name: 'attorney_or_matter', label: 'Attorney or matter', type: 'text', required: false, prompt: 'If you are a current client, do you know the attorney, case, or matter name?' },
    { name: 'message_summary', label: 'Message summary', type: 'text', required: false, prompt: 'What message should I pass along?' },
    { name: 'urgency', label: 'Urgency', type: 'enum', required: true, options: ['low', 'normal', 'high', 'emergency'], prompt: 'Is there anything urgent or time-sensitive?' },
    { name: 'preferred_next_step', label: 'Preferred next step', type: 'enum', required: false, options: ['callback', 'consultation', 'message_only', 'transfer_if_available'], prompt: 'Would you prefer a callback or should I just pass along the message?' }
  ],
  safety: {
    legal_advice_disclaimer: true,
    no_attorney_client_relationship: true,
    no_case_value_estimates: true,
    no_representation_promises: true,
    recording_disclosure_required: true,
    matter_retrieval_requires_verification: true,
    transfer_on_low_confidence: true,
  },
  voice: {
    runtime: 'lana-voice',
    transport: 'livekit',
    stt_provider: 'whisper',
    stt_model: 'base.en',
    tts_provider: 'kokoro',
    tts_voice: 'af_heart',
    response_model: 'default-voice-agent',
    speed: 1
  },
  knowledge: {
    retrieval_enabled: true,
    organization_enabled: true,
    system_enabled: true,
    workspace_enabled: false,
    workspace_id: '',
    matter_enabled: false,
    matter_id: '',
    fallback_response: 'I do not want to guess. I can take a message and have the RedRooster team follow up.'
  },
  tools: [
    { id: 'capture_intake', enabled: true },
    { id: 'create_callback_task', enabled: true },
    { id: 'route_urgent_call', enabled: true }
  ],
  channels: {
    twilio_phone: true,
    whatsapp: false,
    web_console: true,
    phone: true,
    web: true,
    sms_followup: false,
    handoff_number: '',
    after_hours_mode: 'message'
  },
  test: {
    scenario: 'New caller says they were injured in a car crash last week and wants to know whether RedRooster can help.',
    last_result: null
  }
};

const state = {
  agents: [],
  selectedId: null,
  activeTab: 'agent',
  query: '',
  loading: false,
  dirty: false,
  usingFallback: false,
  testRunning: false,
  voiceConsole: {
    supported: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    sessionActive: false,
    listening: false,
    phase: 'idle',
    busy: false,
    callId: '',
    status: 'Idle',
    transcript: '',
    interimTranscript: '',
    streamingResponse: '',
    error: '',
    turns: [],
    telemetry: null,
    tools: [],
    mediaStream: null,
    audioContext: null,
    processor: null,
    source: null,
    currentAudio: null,
    currentAudioId: '',
    realtimeSocket: null,
    realtimeActive: false,
    realtimeReady: false,
    realtimeFallback: false,
    realtimeCanSendAudio: false,
    realtimePendingAudio: [],
    realtimeAudioQueue: [],
    realtimeAudioPlaying: false,
    realtimeAudioReceived: false,
    playbackStartedAt: 0,
    openingPlayed: false,
    chunks: [],
    sampleRate: 16000,
    startedAt: 0,
    lastVoiceAt: 0,
    speechStarted: false,
    minTurnMs: 550,
    silenceMs: 900,
    rmsThreshold: 0.018,
    bargeInGraceMs: 900,
    bargeInRmsThreshold: 0.05,
    bargeInHoldMs: 420,
    bargeInStartedAt: 0,
    micLevel: 0,
    peakMicLevel: 0,
    lastLevelRenderAt: 0
  }
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function actionTarget(event) {
  if (!event) return null;
  if (typeof event.composedPath === 'function') {
    const found = event.composedPath().find((node) => node?.dataset?.action);
    if (found) return found;
  }
  return event.target?.closest?.('[data-action]') || null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function authHeaders() {
  const token = (window.api && window.api.token) || localStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function resolveUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (window.api && window.api.baseUrl) || '';
  return base + (path.startsWith('/') ? path : `/${path}`);
}

function resolveWsUrl(path) {
  const resolved = resolveUrl(path);
  const url = new URL(resolved, window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function createRealtimeVoiceToken() {
  const payload = await request('/api/v1/voice/realtime-token', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const token = payload.data?.token || payload.token;
  if (!token) throw new Error('Realtime token was not returned');
  return token;
}

function normalizeVoiceStack(voice = {}) {
  return {
    ...DEFAULT_AGENT.voice,
    ...voice,
    runtime: 'lana-voice',
    provider: undefined,
    transport: voice.transport || 'livekit',
    stt_provider: voice.stt_provider || 'whisper',
    stt_model: voice.stt_model || 'base.en',
    tts_provider: voice.tts_provider || 'kokoro',
    tts_voice: voice.tts_voice || 'af_heart',
    response_model: voice.response_model || voice.model || DEFAULT_AGENT.voice.response_model,
    speed: Number.isFinite(Number(voice.speed)) ? Number(voice.speed) : DEFAULT_AGENT.voice.speed
  };
}

function normalizeCaptureSchema(schema) {
  const fallback = JSON.parse(JSON.stringify(DEFAULT_AGENT.intake_schema));
  const source = Array.isArray(schema) && schema.length ? schema : fallback;
  return source.map((field) => ({
    name: field.name || '',
    label: field.label || field.name || '',
    type: field.type || 'text',
    required: field.required === true || field.required === 'true',
    options: Array.isArray(field.options) ? field.options : String(field.options || '').split(',').map((item) => item.trim()).filter(Boolean),
    prompt: field.prompt || ''
  }));
}

function normalizeSafety(safety = {}) {
  return {
    ...DEFAULT_AGENT.safety,
    ...(safety && typeof safety === 'object' ? safety : {})
  };
}

async function request(path, options = {}) {
  const headers = {
    ...authHeaders(),
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };
  let response;
  try {
    response = await fetch(resolveUrl(path), { ...options, headers });
  } catch (error) {
    error.isNetworkError = true;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text();
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload, `Request failed with status ${response.status}`));
  }
  return payload;
}

function isNetworkRequestError(error) {
  if (!error) return false;
  if (error.isNetworkError) return true;
  const message = String(error.message || '').toLowerCase();
  return error.name === 'TypeError'
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('connection refused')
    || message.includes('err_connection_refused')
    || message.includes('socket error')
    || message.includes('connection timeout');
}

function errorMessageFromPayload(payload, fallback) {
  if (typeof payload === 'string') return payload || fallback;
  if (!payload || typeof payload !== 'object') return fallback;
  const candidate = payload.error || payload.message || payload.details;
  if (typeof candidate === 'string') return candidate;
  if (candidate) {
    try { return JSON.stringify(candidate); } catch (_error) {}
  }
  try { return JSON.stringify(payload); } catch (_error) {}
  return fallback;
}

function normalizeAgent(agent = {}) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_AGENT));
  const activeVersion = Array.isArray(agent.versions)
    ? agent.versions.find((version) => version.id === agent.active_version_id) || agent.versions[0]
    : null;
  const config = activeVersion && activeVersion.config ? activeVersion.config : {};
  const persona = config.persona || {};
  const instructions = config.instructions || {};
  const runtime = config.runtime || {};
  const metadata = config.metadata || {};

  const normalized = {
    ...merged,
    ...agent,
    id: agent.id || merged.id,
    type: agent.type || agent.agent_type || merged.type,
    language: agent.language || runtime.language || merged.language,
    timezone: agent.timezone || runtime.timezone || merged.timezone,
    greeting: agent.greeting || persona.greeting || merged.greeting,
    tone: agent.tone || persona.tone || merged.tone,
    instructions: agent.instructions || instructions.system || merged.instructions,
    escalation: agent.escalation || instructions.escalation || merged.escalation,
    completion_criteria: agent.completion_criteria || instructions.completion_criteria || merged.completion_criteria,
    additional_details: agent.additional_details || instructions.additional_details || metadata.additional_details || merged.additional_details,
    intake_schema: normalizeCaptureSchema(agent.capture_schema || agent.intake_schema || config.capture_schema || config.intake_schema || merged.intake_schema),
    capture_schema: normalizeCaptureSchema(agent.capture_schema || agent.intake_schema || config.capture_schema || config.intake_schema || merged.intake_schema),
    safety: normalizeSafety({ ...(config.safety || {}), ...(agent.safety || {}) }),
    voice: normalizeVoiceStack({ ...(metadata.voice || {}), ...(agent.voice || {}) }),
    knowledge: {
      ...merged.knowledge,
      ...(metadata.knowledge || {}),
      ...(agent.knowledge || {}),
      sources: agent.knowledge?.sources || (activeVersion?.knowledge_bindings || []).map((binding) => binding.label || binding.source_id || binding.source_type)
    },
    tools: Array.isArray(agent.tools)
      ? agent.tools
      : (activeVersion?.tools || merged.tools).map((tool) => ({
        id: tool.id || tool.name,
        name: tool.name,
        backendName: tool.name,
        type: tool.type,
        config: tool.config,
        permissions: tool.permissions,
        enabled: tool.enabled !== false
      })),
    channels: { ...merged.channels, ...(metadata.channels || {}), ...(agent.channels || {}) },
    test: { ...merged.test, ...(agent.test || {}) },
  };

  normalized.tools = (normalized.tools || []).map(normalizeTool);
  normalized.knowledge.workspace_enabled = false;
  normalized.knowledge.workspace_id = '';
  normalized.knowledge.matter_enabled = false;
  normalized.knowledge.matter_id = '';
  normalized.channels.twilio_phone = normalized.channels.twilio_phone ?? normalized.channels.phone ?? true;
  normalized.channels.web_console = normalized.channels.web_console ?? normalized.channels.web ?? true;
  normalized.channels.whatsapp = normalized.channels.whatsapp ?? false;
  return normalized;
}

function selectedAgent() {
  return state.agents.find((agent) => String(agent.id) === String(state.selectedId)) || null;
}

function showFlash(message, tone = 'info') {
  els.flash.textContent = message;
  els.flash.className = `voice-flash ${tone}`;
  window.clearTimeout(showFlash.timer);
  showFlash.timer = window.setTimeout(() => {
    els.flash.className = 'voice-flash hidden';
  }, 4200);
}

function setDirty(value) {
  state.dirty = value;
  if (els.saveBtn) {
    els.saveBtn.textContent = value ? 'Save Changes' : 'Saved';
    els.saveBtn.disabled = !selectedAgent();
  }
}

function filteredAgents() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.agents;
  return state.agents.filter((agent) => [
    agent.name,
    agent.type,
    agent.status,
    agent.description
  ].join(' ').toLowerCase().includes(query));
}

function statusLabel(agent) {
  if (agent.status === 'active') return 'Active';
  if (agent.status === 'disabled' || agent.status === 'paused') return 'Disabled';
  if (agent.status === 'archived') return 'Archived';
  return 'Draft';
}

function voiceStackLabel(agent) {
  const voice = agent.voice || {};
  const runtime = voice.runtime || 'lana-voice';
  const stt = voice.stt_provider || 'whisper';
  const tts = voice.tts_provider || 'kokoro';
  return `${runtime} / ${stt} / ${tts}`;
}

function normalizeTool(tool = {}) {
  const key = tool.id || tool.name || tool.backendName;
  const catalogItem = VOICE_TOOL_CATALOG.find((item) => (
    item.id === key || item.backendName === key || item.name === key
  ));
  if (catalogItem) {
    return {
      ...catalogItem,
      ...tool,
      id: catalogItem.id,
      name: catalogItem.name,
      backendName: catalogItem.backendName,
      type: tool.type || catalogItem.type,
      enabled: tool.enabled !== false
    };
  }
  return {
    id: String(key || 'custom_tool'),
    name: tool.config?.label || tool.name || 'Custom platform tool',
    backendName: tool.name || key || 'custom_tool',
    type: tool.type || 'workflow',
    description: tool.config?.description || 'Advanced platform-scoped tool binding.',
    details: 'Custom tools should map to a vetted MCP, webhook, workflow, or handoff integration before they are enabled for callers.',
    config: tool.config || {},
    permissions: tool.permissions || [],
    enabled: tool.enabled !== false
  };
}

function renderAgentList() {
  const agents = filteredAgents();
  if (!agents.length) {
    els.agentList.innerHTML = `
      <div class="list-empty">
        <strong>No agents found</strong>
        <span>${state.query ? 'Try a different search.' : 'Create the receptionist agent to get started.'}</span>
      </div>
    `;
    return;
  }

  els.agentList.innerHTML = `
    <div class="agent-list-section">
      <div class="agent-list-section-title">Default</div>
      ${agents.map((agent) => {
    const active = String(agent.id) === String(state.selectedId) ? 'active' : '';
    return `
      <button type="button" class="agent-card ${active}" data-agent-id="${escapeHtml(agent.id)}">
        <span class="agent-card-top">
          <strong>${escapeHtml(agent.name)}</strong>
          <span class="status-pill ${escapeHtml(agent.status || 'draft')}">${escapeHtml(statusLabel(agent))}</span>
        </span>
      </button>
    `;
  }).join('')}
    </div>
  `;
}

function renderEditor() {
  const agent = selectedAgent();
  els.editorEmpty.classList.toggle('hidden', Boolean(agent));
  els.editorPanel.classList.toggle('hidden', !agent);
  renderAgentList();
  if (!agent) return;

  els.selectedName.textContent = agent.name || 'Receptionist';
  els.selectedMeta.innerHTML = `
    <span>${escapeHtml(statusLabel(agent))}</span>
    <span>${escapeHtml(agent.language || 'en-US')}</span>
    <span>${escapeHtml(agent.timezone || 'Firm timezone')}</span>
    ${state.usingFallback ? '<span>Local draft</span>' : ''}
  `;
  els.tabs.setAttribute('tabs', JSON.stringify(TABS));
  els.tabs.setAttribute('active', state.activeTab);

  const renderers = {
    agent: renderAgentTab,
    voice: renderVoiceTab,
    knowledge: renderKnowledgeTab,
    tools: renderToolsTab,
    channels: renderChannelsTab,
    tests: renderTestsTab,
    'import-export': renderImportExportTab
  };

  // Render every panel for the currently selected agent, not just the active
  // one. updateSelectedFromForm() builds FormData against the entire <form>,
  // so any stale inputs left over from a previously selected agent in a
  // hidden panel would silently overwrite the new agent on the next save.
  // The `hidden` class still controls visibility — only one panel is shown.
  for (const panel of els.form.querySelectorAll('[data-tab-panel]')) {
    const tab = panel.dataset.tabPanel;
    panel.classList.toggle('hidden', tab !== state.activeTab);
    if (renderers[tab]) {
      panel.innerHTML = renderers[tab](agent);
    }
  }

  setDirty(state.dirty);
}

function field(label, name, value, attrs = '') {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" ${attrs}>
    </label>
  `;
}

function textArea(label, name, value, attrs = '') {
  return `
    <label class="field field-wide">
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeHtml(name)}" ${attrs}>${escapeHtml(value || '')}</textarea>
    </label>
  `;
}

function settingLabel(label, settingKey) {
  return `
    <span class="setting-label">
      <span>${escapeHtml(label)}</span>
      <lex-btn
        type="button"
        variant="ghost"
        size="sm"
        icon="true"
        leading-icon="info"
        aria-label="Show details for ${escapeHtml(label)}"
        data-action="setting-info"
        data-setting="${escapeHtml(settingKey)}"
      ></lex-btn>
    </span>
  `;
}

function fieldWithInfo(label, name, value, settingKey, attrs = '') {
  return `
    <label class="field">
      ${settingLabel(label, settingKey)}
      <input name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" ${attrs}>
    </label>
  `;
}

function selectField(label, name, value, options) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeHtml(name)}">
        ${options.map(([optionValue, optionLabel]) => `
          <option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>
            ${escapeHtml(optionLabel)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function selectFieldWithInfo(label, name, value, options, settingKey) {
  return `
    <label class="field">
      ${settingLabel(label, settingKey)}
      <select name="${escapeHtml(name)}">
        ${options.map(([optionValue, optionLabel]) => `
          <option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>
            ${escapeHtml(optionLabel)}
          </option>
        `).join('')}
      </select>
    </label>
  `;
}

function renderAgentTab(agent) {
  return `
    <div class="panel-grid">
      ${field('Agent name', 'name', agent.name, 'required')}
      ${selectField('Status', 'status', agent.status, [['draft', 'Draft'], ['active', 'Active'], ['disabled', 'Disabled'], ['archived', 'Archived']])}
      ${selectField('Agent type', 'type', agent.type, [['receptionist', 'Receptionist'], ['intake', 'Intake'], ['routing', 'Routing'], ['followup', 'Follow-up'], ['custom', 'Custom']])}
      ${field('Timezone', 'timezone', agent.timezone)}
      ${field('Language', 'language', agent.language)}
      ${field('Tone', 'tone', agent.tone)}
      ${textArea('Description', 'description', agent.description)}
      ${textArea('Opening greeting', 'greeting', agent.greeting)}
      ${textArea('Behavior instructions', 'instructions', agent.instructions, 'rows="8"')}
      <details class="advanced-config field-wide" open>
        <summary>Advanced Agent Configuration</summary>
        <div class="panel-grid advanced-config-grid">
          ${textArea('Escalation policy', 'escalation', agent.escalation, 'rows="5"')}
          ${textArea('Completion criteria', 'completion_criteria', agent.completion_criteria, 'rows="5"')}
          ${textArea('Additional agent details', 'additional_details', agent.additional_details, 'rows="5"')}
          <section class="contract-section field-wide">
            <div class="contract-section-head">
              <div>
                <h3>Capture Schema</h3>
                <p>Conversation fields this agent should collect when they are relevant to the configured use case.</p>
              </div>
              <lex-btn type="button" variant="ghost" size="sm" leading-icon="plus" data-action="add-intake-field">Add Field</lex-btn>
            </div>
            <div class="intake-field-list">
              ${renderCaptureSchema(agent)}
            </div>
          </section>
          <section class="contract-section field-wide">
            <div class="contract-section-head">
              <div>
                <h3>Safety</h3>
                <p>Boundaries the runtime includes in the agent configuration.</p>
              </div>
            </div>
            <div class="safety-grid">
              ${renderSafetySettings(agent)}
            </div>
          </section>
        </div>
      </details>
    </div>
  `;
}

function renderCaptureSchema(agent) {
  const fields = normalizeCaptureSchema(agent.capture_schema || agent.intake_schema);
  return fields.map((fieldItem, index) => `
    <article class="intake-field-row">
      <div class="intake-field-row-head">
        <strong>${escapeHtml(fieldItem.label || fieldItem.name || `Field ${index + 1}`)}</strong>
        <lex-btn type="button" variant="ghost" size="sm" leading-icon="trash-2" data-action="remove-intake-field" data-index="${index}">Remove</lex-btn>
      </div>
      <div class="panel-grid intake-field-grid">
        ${field('Field name', `intake_schema.${index}.name`, fieldItem.name, 'placeholder="caller_name"')}
        ${field('Label', `intake_schema.${index}.label`, fieldItem.label)}
        ${selectField('Type', `intake_schema.${index}.type`, fieldItem.type, [['text', 'Text'], ['number', 'Number'], ['boolean', 'Boolean'], ['date', 'Date'], ['datetime', 'Date and time'], ['email', 'Email'], ['phone', 'Phone'], ['enum', 'Options'], ['json', 'JSON']])}
        <label class="toggle-row">
          <input type="checkbox" name="intake_schema.${index}.required" ${fieldItem.required ? 'checked' : ''}>
          <span><strong>Required</strong><small>The agent should try to capture this before completing the intake.</small></span>
        </label>
        ${field('Options', `intake_schema.${index}.options`, (fieldItem.options || []).join(', '), 'placeholder="low, normal, high"')}
        ${textArea('Prompt guidance', `intake_schema.${index}.prompt`, fieldItem.prompt, 'rows="3"')}
      </div>
    </article>
  `).join('');
}

function renderSafetySettings(agent) {
  const safety = normalizeSafety(agent.safety);
  const settings = [
    ['legal_advice_disclaimer', 'No legal advice', 'The agent should avoid legal advice and route those questions to the team.'],
    ['no_attorney_client_relationship', 'No attorney-client relationship claims', 'The agent should not imply a relationship was formed during intake.'],
    ['no_case_value_estimates', 'No case value estimates', 'The agent should not estimate claim value or settlement expectations.'],
    ['no_representation_promises', 'No representation promises', 'The agent should not promise RedRooster will take the matter.'],
    ['recording_disclosure_required', 'Recording disclosure required', 'The agent should respect configured recording disclosure requirements.'],
    ['matter_retrieval_requires_verification', 'Verify before matter lookup', 'Matter-specific data requires identity and access checks.'],
    ['transfer_on_low_confidence', 'Transfer on low confidence', 'Escalate or take a message when the agent is unsure.'],
  ];
  return settings.map(([key, label, description]) => `
    <label class="toggle-row">
      <input type="checkbox" name="safety.${key}" ${safety[key] ? 'checked' : ''}>
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span>
    </label>
  `).join('');
}

function renderVoiceTab(agent) {
  return `
    <div class="voice-tab-layout">
      <div class="voice-primary-grid">
        ${fieldWithInfo('Speed', 'voice.speed', agent.voice.speed, 'speed', 'type="number" min="0.7" max="1.3" step="0.05"')}
        <div class="voice-preview">
          <div>
            <span>LANA voice preview line</span>
            <strong>${escapeHtml(agent.greeting || DEFAULT_AGENT.greeting)}</strong>
          </div>
          <lex-btn type="button" variant="ghost" size="md" leading-icon="volume-2" data-action="voice-preview">Test Voice</lex-btn>
        </div>
      </div>
      <details class="advanced-config">
        <summary>Advanced Configuration</summary>
        <div class="panel-grid advanced-config-grid">
          ${selectFieldWithInfo('Runtime', 'voice.runtime', agent.voice.runtime || 'lana-voice', [['lana-voice', 'LANA Voice Runtime']], 'runtime')}
          ${selectFieldWithInfo('Realtime transport', 'voice.transport', agent.voice.transport || 'livekit', [['livekit', 'LiveKit']], 'transport')}
          ${selectFieldWithInfo('Transcription', 'voice.stt_provider', agent.voice.stt_provider || 'whisper', [['whisper', 'Whisper STT']], 'transcription')}
          ${fieldWithInfo('Transcription model', 'voice.stt_model', agent.voice.stt_model || 'base.en', 'transcription_model')}
          ${selectFieldWithInfo('Speech synthesis', 'voice.tts_provider', agent.voice.tts_provider || 'kokoro', [['kokoro', 'Kokoro TTS']], 'synthesis')}
          ${fieldWithInfo('Synthesis voice', 'voice.tts_voice', agent.voice.tts_voice || 'af_heart', 'synthesis_voice')}
          ${fieldWithInfo('Response model', 'voice.response_model', agent.voice.response_model || agent.voice.model || 'default-voice-agent', 'response_model')}
        </div>
      </details>
    </div>
  `;
}

function showSettingInfo(settingKey) {
  const info = VOICE_SETTING_INFO[settingKey];
  if (!info) return;
  const content = `<p class="voice-setting-modal-text">${escapeHtml(info.body)}</p>`;
  if (window.Lex?.Modal?.open) {
    window.Lex.Modal.open({
      heading: info.title,
      content,
      size: 'md',
      hideActions: true
    });
    return;
  }
  window.alert(`${info.title}\n\n${info.body}`);
}

async function showVoicePreview() {
  const agent = updateSelectedFromForm() || selectedAgent();
  if (!agent) return;
  const voice = normalizeVoiceStack(agent.voice || {});
  const previewText = agent.greeting || DEFAULT_AGENT.greeting;
  let previewResult = null;
  let playbackMessage = '';

  try {
    previewResult = await synthesizeAgentSpeech(previewText, voice);
    if (!previewResult?.audio?.base64) {
      playbackMessage = previewResult?.message || 'Audio playback is not available from the current LANA voice runtime.';
    } else {
      const audio = new Audio(`data:${previewResult.audio.mime_type || 'audio/wav'};base64,${previewResult.audio.base64}`);
      if (state.voiceConsole.currentPreviewAudio) {
        try { state.voiceConsole.currentPreviewAudio.pause(); } catch (_error) {}
        try { state.voiceConsole.currentPreviewAudio.currentTime = 0; } catch (_error) {}
      }
      state.voiceConsole.currentPreviewAudio = audio;
      await audio.play();
      showFlash(`Playing ${voice.tts_voice} preview.`, 'success');
      return;
    }
  } catch (error) {
    playbackMessage = `Audio preview failed: ${error.message}`;
  }

  const content = `
    <div class="voice-preview-modal">
      <div class="voice-preview-modal-line">
        <span>Preview text</span>
        <strong>${escapeHtml(previewText)}</strong>
      </div>
      <dl class="voice-preview-modal-meta">
        <div><dt>Runtime</dt><dd>${escapeHtml(voice.runtime)}</dd></div>
        <div><dt>Transport</dt><dd>${escapeHtml(voice.transport)}</dd></div>
        <div><dt>Transcription</dt><dd>${escapeHtml(`${voice.stt_provider} / ${voice.stt_model}`)}</dd></div>
        <div><dt>Synthesis</dt><dd>${escapeHtml(`${voice.tts_provider} / ${voice.tts_voice}`)}</dd></div>
        <div><dt>Speed</dt><dd>${escapeHtml(voice.speed)}</dd></div>
      </dl>
      <p class="voice-preview-modal-note">${escapeHtml(playbackMessage)}</p>
    </div>
  `;
  if (window.Lex?.Modal?.open) {
    window.Lex.Modal.open({
      heading: 'Test Voice',
      content,
      size: 'md',
      hideActions: true
    });
    return;
  }
  window.alert(`Test Voice\n\n${previewText}`);
}

async function synthesizeAgentSpeech(text, voice) {
  const response = await fetch(resolveUrl('/api/v1/voice/preview'), {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      text,
      voice: voice.tts_voice,
      speed: voice.speed,
      format: 'wav',
    }),
  });
  const payload = await response.json().catch(() => ({}));
  const result = payload.data || payload;
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(result, `Speech synthesis failed with status ${response.status}`));
  }
  return result;
}

function renderKnowledgeTab(agent) {
  return `
    <div class="panel-grid">
      <label class="toggle-row field-wide">
        <input type="checkbox" name="knowledge.retrieval_enabled" ${agent.knowledge.retrieval_enabled ? 'checked' : ''}>
        <span>
          <strong>Use firm knowledge retrieval</strong>
          <small>Answer from approved scoped knowledge before falling back to message capture.</small>
        </span>
      </label>
      <label class="toggle-row field-wide">
        <input type="checkbox" name="knowledge.organization_enabled" ${agent.knowledge.organization_enabled ? 'checked' : ''}>
        <span>
          <strong>Firm knowledge base</strong>
          <small>Organization-wide receptionist knowledge such as office hours, practice areas, routing rules, and intake policy.</small>
        </span>
      </label>
      <label class="toggle-row field-wide">
        <input type="checkbox" name="knowledge.system_enabled" ${agent.knowledge.system_enabled ? 'checked' : ''}>
        <span>
          <strong>System voice guidance</strong>
          <small>LANA operating guidance for safety, disclosures, and call handling. This is separate from firm, matter, and workspace content.</small>
        </span>
      </label>
      <div class="setting-note field-wide">
        Workspace and matter knowledge are disabled in this editor until they can be attached through a guarded search-and-lookup flow with access checks. The receptionist can use firm knowledge and system guidance without exposing matter-specific content.
      </div>
      ${textArea('Fallback response', 'knowledge.fallback_response', agent.knowledge.fallback_response, 'rows="5"')}
    </div>
  `;
}

function renderToolsTab(agent) {
  const tools = agent.tools || [];
  return `
    <div class="setting-note">
      Voice agents can only call approved LANA capabilities. These toggles save allowlisted tool bindings; runtime execution still has to map each binding to a builtin action, workflow, handoff, or vetted integration.
    </div>
    <div class="tool-list">
      ${tools.map((tool, index) => `
        <label class="tool-row">
          <input type="checkbox" name="tools.${index}.enabled" ${tool.enabled ? 'checked' : ''}>
          <span>
            <strong>${escapeHtml(tool.name)}</strong>
            <small>${escapeHtml(tool.description || '')}</small>
          </span>
          <details class="tool-details">
            <summary>Advanced</summary>
            <dl>
              <dt>Runtime binding</dt>
              <dd>${escapeHtml(tool.backendName || tool.id)}</dd>
              <dt>Type</dt>
              <dd>${escapeHtml(tool.type || 'builtin')}</dd>
              <dt>Scope</dt>
              <dd>${escapeHtml(tool.details || 'Approved for this voice agent only.')}</dd>
            </dl>
          </details>
        </label>
      `).join('')}
    </div>
  `;
}

function renderChannelsTab(agent) {
  return `
    <div class="setting-note">
      Channels are connector-backed delivery paths. Voice calling should bind to Twilio for now; WhatsApp can be enabled when the WhatsApp connector is installed. The web console is internal QA only.
    </div>
    <div class="panel-grid">
      <label class="toggle-row">
        <input type="checkbox" name="channels.twilio_phone" ${agent.channels.twilio_phone ? 'checked' : ''}>
        <span><strong>Twilio phone</strong><small>Inbound and outbound voice calls through the connected Twilio account.</small></span>
      </label>
      <label class="toggle-row">
        <input type="checkbox" name="channels.whatsapp" ${agent.channels.whatsapp ? 'checked' : ''}>
        <span><strong>WhatsApp</strong><small>Connector-backed WhatsApp conversations and follow-up messages.</small></span>
      </label>
      <label class="toggle-row">
        <input type="checkbox" name="channels.web_console" ${agent.channels.web_console ? 'checked' : ''}>
        <span><strong>Web test console</strong><small>Internal browser-based QA for testing agent behavior before publishing.</small></span>
      </label>
      ${field('Handoff number', 'channels.handoff_number', agent.channels.handoff_number, 'placeholder="+1 555 0100"')}
      ${selectField('After-hours mode', 'channels.after_hours_mode', agent.channels.after_hours_mode, [['message', 'Take message'], ['urgent_only', 'Route urgent only'], ['closed', 'Closed message']])}
    </div>
  `;
}

function renderTestsTab(agent) {
  const result = agent.test?.last_result;
  const consoleState = state.voiceConsole;
  const sessionRunning = consoleState.sessionActive || consoleState.phase === 'processing' || consoleState.phase === 'speaking';
  const micLevelPercent = Math.min(100, Math.round((consoleState.micLevel || 0) * 1000));
  const bargeInPercent = Math.min(100, Math.round((consoleState.bargeInRmsThreshold || 0) * 1000));
  const transcriptPlaceholder = sessionRunning
    ? 'Listening. Speak naturally; a short pause will send the current turn.'
    : 'Start a session to speak with the agent.';
  return `
    <div class="test-console">
      <section class="web-voice-console">
        <div class="web-voice-console-head">
          <div>
            <h3>Web Voice Console</h3>
            <p>Use the MacBook mic to run a live session against this agent, including turn taking and interruptions.</p>
          </div>
          <div class="web-voice-actions">
            <lex-btn
              type="button"
              variant="${sessionRunning ? 'secondary' : 'primary'}"
              size="md"
              leading-icon="${sessionRunning ? 'square' : 'mic'}"
              data-action="${sessionRunning ? 'end-web-voice-session' : 'start-web-voice-session'}"
            >${sessionRunning ? 'End Session' : 'Start Session'}</lex-btn>
            <lex-btn type="button" variant="ghost" size="md" leading-icon="rotate-ccw" data-action="reset-web-voice">Reset</lex-btn>
          </div>
        </div>

        <div class="voice-console-status ${consoleState.error ? 'error' : ''}">
          <strong>${escapeHtml(consoleState.status)}</strong>
          <span>${escapeHtml(consoleState.error || (consoleState.supported ? 'Local mic capture is available. Audio is transcribed by the LANA Whisper sidecar.' : 'This browser does not expose local microphone capture.'))}</span>
        </div>

        <div class="voice-volume-panel">
          <div class="voice-volume-head">
            <span>Mic volume</span>
            <strong id="voice-volume-value">${micLevelPercent}%</strong>
          </div>
          <div class="voice-volume-meter" aria-label="Current microphone volume">
            <span id="voice-volume-bar" style="width:${micLevelPercent}%"></span>
            <i id="voice-volume-threshold" style="left:${bargeInPercent}%"></i>
          </div>
          <div class="voice-volume-hint">
            <span>Barge-in threshold ${bargeInPercent}%</span>
            <span>Current <b id="voice-volume-current">${micLevelPercent}%</b></span>
          </div>
        </div>

        <div class="voice-console-live">
          <div>
            <span>Current transcript</span>
            <p>${escapeHtml(consoleState.interimTranscript || consoleState.transcript || transcriptPlaceholder)}</p>
          </div>
          <div>
            <span>Session</span>
            <p>${escapeHtml(consoleState.callId || 'Not started')}</p>
          </div>
        </div>

        <div class="voice-console-grid">
          <section>
            <h4>Conversation</h4>
            <div class="voice-turn-log">
              ${consoleState.turns.length ? consoleState.turns.map((turn) => `
                <article class="voice-turn ${escapeHtml(turn.role)}">
                  <span>${escapeHtml(turn.role === 'user' ? 'Caller' : 'Agent')}</span>
                  <p>${escapeHtml(turn.text)}</p>
                </article>
              `).join('') : '<p class="muted">No conversation yet.</p>'}
            </div>
          </section>
          <section>
            <h4>Functions Called</h4>
            <div class="voice-tool-log">
              ${consoleState.tools.length ? consoleState.tools.map((tool) => `
                <article class="voice-tool-call ${escapeHtml(tool.status || '')}">
                  <div>
                    <strong>${escapeHtml(tool.name || 'tool')}</strong>
                    <span>${escapeHtml(tool.status || 'unknown')}</span>
                  </div>
                  <pre>${escapeHtml(JSON.stringify({ input: tool.input, output: tool.output, error: tool.error }, null, 2))}</pre>
                </article>
              `).join('') : '<p class="muted">No functions called yet.</p>'}
            </div>
          </section>
          <section>
            <h4>Response Timing</h4>
            <dl class="voice-telemetry">
              ${renderTelemetry(consoleState.telemetry)}
            </dl>
          </section>
        </div>
      </section>

      <section class="scenario-test-console">
        ${textArea('Text test scenario', 'test.scenario', agent.test?.scenario || '', 'rows="5"')}
        <lex-btn type="button" variant="primary" size="md" leading-icon="play" data-action="run-test" ${state.testRunning ? 'disabled' : ''}>
          ${state.testRunning ? 'Running Test' : 'Run Text Test'}
        </lex-btn>
        <div class="test-result">
          <strong>Latest result</strong>
          <pre>${escapeHtml(result ? JSON.stringify(result, null, 2) : 'No test run yet.')}</pre>
        </div>
      </section>
    </div>
  `;
}

function renderTelemetry(telemetry) {
  const items = [
    ['Transcription', telemetry?.transcription_ms],
    ['Intent', telemetry?.intent_ms],
    ['Tools', telemetry?.tool_ms],
    ['Response', telemetry?.response_ms],
    ['Synthesis', telemetry?.synthesis_ms],
    ['Total', telemetry?.total_ms]
  ];
  return items.map(([label, value]) => `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : '--'}</dd>
    </div>
  `).join('');
}

function renderImportExportTab(agent) {
  return `
    <div class="import-export-grid">
      <section>
        <h3>Export</h3>
        <p>Download the selected agent configuration as JSON.</p>
        <lex-btn type="button" variant="ghost" size="md" leading-icon="download" data-action="export-agent">Export Agent</lex-btn>
      </section>
      <section>
        <h3>Import</h3>
        <p>Import a JSON configuration and update the selected agent.</p>
        <input id="agent-import-file" type="file" accept="application/json,.json">
        <lex-btn type="button" variant="primary" size="md" leading-icon="upload" data-action="import-agent">Import Agent</lex-btn>
      </section>
      <section class="payload-preview">
        <h3>Current payload</h3>
        <pre>${escapeHtml(JSON.stringify(agent, null, 2))}</pre>
      </section>
    </div>
  `;
}

function writePath(target, path, value) {
  const parts = path.split('.');
  let current = target;
  while (parts.length > 1) {
    const part = parts.shift();
    current[part] = current[part] || {};
    current = current[part];
  }
  current[parts[0]] = value;
}

function updateSelectedFromForm() {
  const agent = selectedAgent();
  if (!agent) return null;
  const formData = new FormData(els.form);
  for (const [name, value] of formData.entries()) {
    if (name === 'voice.speed') {
      writePath(agent, name, Number(value));
    } else if (!name.startsWith('tools.') && !name.startsWith('intake_schema.') && !name.startsWith('safety.')) {
      writePath(agent, name, value);
    }
  }

  agent.capture_schema = readCaptureSchemaFromForm();
  agent.intake_schema = agent.capture_schema;

  agent.knowledge.workspace_enabled = false;
  agent.knowledge.workspace_id = '';
  agent.knowledge.matter_enabled = false;
  agent.knowledge.matter_id = '';

  for (const name of [
    'knowledge.retrieval_enabled',
    'knowledge.organization_enabled',
    'knowledge.system_enabled',
    'channels.twilio_phone',
    'channels.whatsapp',
    'channels.web_console',
    'channels.phone',
    'channels.web',
    'channels.sms_followup'
  ]) {
    const control = els.form.querySelector(`[name="${name}"]`);
    if (control) {
      writePath(agent, name, Boolean(control.checked));
    }
  }
  agent.channels.phone = Boolean(agent.channels.twilio_phone);
  agent.channels.web = Boolean(agent.channels.web_console);
  agent.channels.sms_followup = Boolean(agent.channels.whatsapp);
  agent.safety = normalizeSafety(agent.safety);
  for (const key of Object.keys(normalizeSafety(agent.safety))) {
    const control = els.form.querySelector(`[name="safety.${key}"]`);
    if (control) {
      agent.safety[key] = Boolean(control.checked);
    }
  }
  for (const [index, tool] of (agent.tools || []).entries()) {
    const control = els.form.querySelector(`[name="tools.${index}.enabled"]`);
    if (control) {
      tool.enabled = Boolean(control.checked);
    }
  }
  return agent;
}

function readCaptureSchemaFromForm() {
  const rows = Array.from(els.form.querySelectorAll('.intake-field-row'));
  if (!rows.length) return normalizeCaptureSchema(selectedAgent()?.capture_schema || selectedAgent()?.intake_schema || []);
  return rows.map((row, index) => {
    const read = (fieldName) => els.form.querySelector(`[name="intake_schema.${index}.${fieldName}"]`);
    const options = String(read('options')?.value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return {
      name: String(read('name')?.value || '').trim(),
      label: String(read('label')?.value || '').trim(),
      type: String(read('type')?.value || 'text').trim(),
      required: Boolean(read('required')?.checked),
      options,
      prompt: String(read('prompt')?.value || '').trim(),
    };
  }).filter((fieldItem) => fieldItem.name || fieldItem.label || fieldItem.prompt);
}

async function loadAgents() {
  state.loading = true;
  renderAgentList();
  try {
    const payload = await request(API_ROOT);
    const agents = Array.isArray(payload) ? payload : (payload.data || payload.agents || []);
    state.agents = agents.map(normalizeAgent);
    state.usingFallback = false;
  } catch (error) {
    state.agents = [normalizeAgent({ id: 'local-receptionist' })];
    state.usingFallback = true;
    showFlash('Voice agent API is not available yet. Showing a local receptionist draft.', 'warn');
  } finally {
    state.loading = false;
    state.selectedId = state.selectedId || state.agents[0]?.id || null;
    setDirty(false);
    renderEditor();
  }
}

async function createAgent(source = DEFAULT_AGENT) {
  const draft = normalizeAgent({ ...source, id: null, name: source.name || 'Receptionist' });
  let createdLocally = false;
  try {
    const payload = await request(API_ROOT, {
      method: 'POST',
      body: JSON.stringify(draft)
    });
    const created = normalizeAgent(payload.data || payload.agent || payload);
    state.agents.unshift(created);
    state.selectedId = created.id;
    state.usingFallback = false;
    showFlash('Agent created.', 'success');
  } catch (error) {
    const local = normalizeAgent({ ...draft, id: `local-${Date.now()}` });
    state.agents.unshift(local);
    state.selectedId = local.id;
    state.usingFallback = true;
    createdLocally = true;
    showFlash('Created a local draft because the API is unavailable.', 'warn');
  }
  setDirty(createdLocally);
  renderEditor();
}

async function saveAgent() {
  const agent = updateSelectedFromForm();
  if (!agent) return;
  if (String(agent.id || '').startsWith('local-')) {
    showFlash('Local draft updated. It will save once the API is connected.', 'warn');
    setDirty(false);
    renderEditor();
    return;
  }
  try {
    const payload = await request(`${API_ROOT}/${encodeURIComponent(agent.id)}`, {
      method: 'PUT',
      body: JSON.stringify(agent)
    });
    const saved = normalizeAgent(payload.data || payload.agent || payload || agent);
    state.agents = state.agents.map((item) => String(item.id) === String(agent.id) ? saved : item);
    state.selectedId = saved.id;
    setDirty(false);
    showFlash('Agent saved.', 'success');
    renderEditor();
  } catch (error) {
    showFlash(`Save failed: ${error.message}`, 'error');
  }
}

async function deleteAgent() {
  const agent = selectedAgent();
  if (!agent) return;
  if (!window.confirm(`Delete ${agent.name}?`)) return;
  try {
    if (!String(agent.id || '').startsWith('local-')) {
      await request(`${API_ROOT}/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
    }
    state.agents = state.agents.filter((item) => String(item.id) !== String(agent.id));
    state.selectedId = state.agents[0]?.id || null;
    setDirty(false);
    showFlash('Agent deleted.', 'success');
    renderEditor();
  } catch (error) {
    showFlash(`Delete failed: ${error.message}`, 'error');
  }
}

async function runTest() {
  const agent = updateSelectedFromForm();
  if (!agent) return;
  state.testRunning = true;
  renderEditor();
  try {
    const payload = await request(`${API_ROOT}/${encodeURIComponent(agent.id)}/test`, {
      method: 'POST',
      body: JSON.stringify({ scenario: agent.test?.scenario || '' })
    });
    agent.test.last_result = payload.data || payload.result || payload;
    showFlash('Test completed.', 'success');
  } catch (error) {
    agent.test.last_result = {
      status: 'local',
      summary: 'API unavailable. Local validation only.',
      checked: ['required fields', 'voice settings', 'enabled channels'],
      error: error.message
    };
    showFlash('Test API unavailable. Showing local validation output.', 'warn');
  } finally {
    state.testRunning = false;
    renderEditor();
  }
}

function resetWebVoiceConsole() {
  endWebVoiceSession({ render: false });
  state.voiceConsole.callId = '';
  state.voiceConsole.status = 'Idle';
  state.voiceConsole.phase = 'idle';
  state.voiceConsole.transcript = '';
  state.voiceConsole.interimTranscript = '';
  state.voiceConsole.streamingResponse = '';
  state.voiceConsole.error = '';
  state.voiceConsole.turns = [];
  state.voiceConsole.telemetry = null;
  state.voiceConsole.tools = [];
  state.voiceConsole.busy = false;
  state.voiceConsole.sessionActive = false;
  state.voiceConsole.listening = false;
  state.voiceConsole.openingPlayed = false;
  state.voiceConsole.streamingResponse = '';
  state.voiceConsole.realtimeSocket = null;
  state.voiceConsole.realtimeActive = false;
  state.voiceConsole.realtimeReady = false;
  state.voiceConsole.realtimeFallback = false;
  state.voiceConsole.realtimeCanSendAudio = false;
  state.voiceConsole.realtimePendingAudio = [];
  state.voiceConsole.realtimeAudioQueue = [];
  state.voiceConsole.realtimeAudioPlaying = false;
  state.voiceConsole.realtimeAudioReceived = false;
  state.voiceConsole.micLevel = 0;
  state.voiceConsole.peakMicLevel = 0;
  state.voiceConsole.lastLevelRenderAt = 0;
  renderEditor();
}

async function startWebVoiceSession() {
  if (state.dirty) {
    state.voiceConsole.status = 'Save required';
    state.voiceConsole.error = 'Save this agent before starting a voice session so the runtime uses the same configuration shown here.';
    showFlash('Save changes before starting a voice session.', 'warn');
    renderEditor();
    return;
  }

  const agent = selectedAgent();
  if (!agent) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    state.voiceConsole.supported = false;
    state.voiceConsole.error = 'Mic testing requires local microphone capture support.';
    state.voiceConsole.status = 'Unsupported browser';
    renderEditor();
    return;
  }

  endWebVoiceSession({ render: false });
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      handleVoiceSessionAudio(event.inputBuffer.getChannelData(0));
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    state.voiceConsole.callId = `web-${Date.now()}`;
    state.voiceConsole.sessionActive = true;
    state.voiceConsole.listening = true;
    state.voiceConsole.phase = 'listening';
    state.voiceConsole.busy = false;
    state.voiceConsole.status = 'Listening';
    state.voiceConsole.error = '';
    state.voiceConsole.interimTranscript = 'Listening. Speak naturally; pauses will send each turn.';
    state.voiceConsole.streamingResponse = '';
    state.voiceConsole.mediaStream = stream;
    state.voiceConsole.audioContext = audioContext;
    state.voiceConsole.processor = processor;
    state.voiceConsole.source = source;
    state.voiceConsole.chunks = [];
    state.voiceConsole.sampleRate = audioContext.sampleRate;
    state.voiceConsole.startedAt = 0;
    state.voiceConsole.lastVoiceAt = 0;
    state.voiceConsole.speechStarted = false;
    state.voiceConsole.openingPlayed = false;
    state.voiceConsole.currentAudioId = '';
    state.voiceConsole.realtimeSocket = null;
    state.voiceConsole.realtimeActive = false;
    state.voiceConsole.realtimeReady = false;
    state.voiceConsole.realtimeFallback = false;
    state.voiceConsole.realtimeCanSendAudio = false;
    state.voiceConsole.realtimePendingAudio = [];
    state.voiceConsole.realtimeAudioQueue = [];
    state.voiceConsole.realtimeAudioPlaying = false;
    state.voiceConsole.realtimeAudioReceived = false;
    state.voiceConsole.micLevel = 0;
    state.voiceConsole.peakMicLevel = 0;
    state.voiceConsole.lastLevelRenderAt = 0;
    renderEditor();
    connectRealtimeVoiceSession(agent, audioContext.sampleRate).catch((error) => {
      if (isNetworkRequestError(error)) {
        endWebVoiceSession({ render: false });
        state.voiceConsole.error = `Realtime voice unavailable: ${error.message}`;
        state.voiceConsole.status = 'Voice API unavailable';
        state.voiceConsole.interimTranscript = 'The local voice API is not reachable. Start or restart LANA API and try again.';
        renderEditor();
        return;
      }
      state.voiceConsole.realtimeFallback = true;
      state.voiceConsole.realtimeActive = false;
      state.voiceConsole.realtimeReady = false;
      state.voiceConsole.realtimeCanSendAudio = false;
      state.voiceConsole.realtimePendingAudio = [];
      state.voiceConsole.error = `Realtime voice unavailable; using upload fallback: ${error.message}`;
      renderEditor();
    });
    playSessionOpening(agent);
  } catch (error) {
    state.voiceConsole.error = `Unable to start local mic capture: ${error.message}`;
    state.voiceConsole.status = 'Mic unavailable';
    state.voiceConsole.listening = false;
    renderEditor();
  }
}

async function playSessionOpening(agent) {
  const consoleState = state.voiceConsole;
  if (!consoleState.sessionActive || consoleState.openingPlayed) return;

  const voice = normalizeVoiceStack(agent.voice || {});
  const openingText = String(agent.greeting || DEFAULT_AGENT.greeting || '').trim();
  if (!openingText) return;

  consoleState.openingPlayed = true;
  consoleState.busy = true;
  consoleState.listening = false;
  consoleState.phase = 'processing';
  consoleState.status = 'Preparing greeting';
  consoleState.interimTranscript = 'Preparing the agent opening message.';
  consoleState.error = '';
  renderEditor();

  try {
    const result = await synthesizeAgentSpeech(openingText, voice);
    consoleState.turns.push({ role: 'agent', text: openingText, at: new Date().toISOString(), opening: true });
    await playAgentAudio(result.audio, {
      speakingStatus: 'Agent opening',
      noAudioStatus: 'Listening',
      noAudioMessage: 'Opening message was prepared without audio. Listening for your first turn.',
    });
  } catch (error) {
    consoleState.error = `Opening message failed: ${error.message}`;
    consoleState.phase = consoleState.sessionActive ? 'listening' : 'idle';
    consoleState.status = consoleState.sessionActive ? 'Listening' : 'Stopped';
    consoleState.listening = consoleState.sessionActive;
    consoleState.interimTranscript = consoleState.sessionActive
      ? 'Opening message failed. Listening for your first turn.'
      : '';
    consoleState.busy = false;
    renderEditor();
  }
}

function connectRealtimeVoiceSession(agent, sampleRate) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') {
      reject(new Error('WebSocket is not available in this browser'));
      return;
    }
    if (!agent.id) {
      reject(new Error('Save the voice agent before starting realtime voice.'));
      return;
    }

    const consoleState = state.voiceConsole;
    let settled = false;
    let activeSocket = null;
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        try { activeSocket?.close(); } catch (_error) {}
        reject(new Error('connection timeout'));
      }
    }, 5000);

    createRealtimeVoiceToken().then((voiceToken) => {
      const url = new URL(resolveWsUrl('/api/v1/voice/realtime'));
      url.searchParams.set('voice_token', voiceToken);
      return url.toString();
    }).then((url) => {
      const socket = new WebSocket(url);
      activeSocket = socket;
      socket.binaryType = 'arraybuffer';
      bindRealtimeVoiceSocket(socket, agent, sampleRate, consoleState, resolve, reject, () => settled, (value) => { settled = value; }, timeout);
    }).catch((error) => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function bindRealtimeVoiceSocket(socket, agent, sampleRate, consoleState, resolve, reject, getSettled, setSettled, timeout) {
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      consoleState.realtimeSocket = socket;
      consoleState.realtimeActive = true;
      socket.send(JSON.stringify({
        type: 'start',
        call_id: consoleState.callId || `web-${Date.now()}`,
        agent_id: agent.id || undefined,
        agent,
        language: (agent.language || 'en-US').split('-')[0] || 'en',
        sample_rate: sampleRate || consoleState.sampleRate || 16000,
        rms_threshold: consoleState.rmsThreshold,
        min_turn_ms: consoleState.minTurnMs,
        silence_ms: consoleState.silenceMs,
        partial_stt: true,
      }));
    });

    socket.addEventListener('message', (event) => {
      let message = {};
      try {
        message = JSON.parse(event.data || '{}');
      } catch (_error) {
        return;
      }
      handleRealtimeVoiceEvent(message);
      if (message.event === 'session_started' && !getSettled()) {
        setSettled(true);
        window.clearTimeout(timeout);
        resolve();
      }
    });

    socket.addEventListener('error', () => {
      if (!getSettled()) {
        setSettled(true);
        window.clearTimeout(timeout);
        reject(new Error('socket error'));
      }
    });

    socket.addEventListener('close', () => {
      if (consoleState.realtimeSocket === socket) {
        consoleState.realtimeSocket = null;
        consoleState.realtimeActive = false;
        consoleState.realtimeReady = false;
        consoleState.realtimeCanSendAudio = false;
        consoleState.realtimePendingAudio = [];
      }
      if (!getSettled()) {
        setSettled(true);
        window.clearTimeout(timeout);
        reject(new Error('socket closed'));
      }
    });
}

function handleRealtimeVoiceEvent(message) {
  const consoleState = state.voiceConsole;
  if (message.event === 'session_started') {
    consoleState.realtimeReady = true;
    consoleState.realtimeCanSendAudio = true;
    consoleState.callId = message.call_id || consoleState.callId;
    consoleState.error = '';
    consoleState.interimTranscript = 'Realtime voice stream connected. Listening for your turn.';
    renderEditor();
    return;
  }

  if (message.event === 'turn_started') {
    consoleState.speechStarted = true;
    consoleState.status = 'Listening';
    consoleState.phase = 'listening';
    consoleState.interimTranscript = 'Listening to your turn...';
    renderEditor();
    return;
  }

  if (message.event === 'turn_processing') {
    consoleState.busy = true;
    consoleState.listening = false;
    consoleState.realtimeCanSendAudio = false;
    consoleState.phase = 'processing';
    consoleState.status = 'Streaming audio to LANA';
    consoleState.interimTranscript = 'Realtime stream is transcribing and sending this turn to the agent.';
    consoleState.streamingResponse = '';
    renderEditor();
    return;
  }

  if (message.event === 'transcript_partial') {
    consoleState.transcript = message.transcript || consoleState.transcript;
    consoleState.interimTranscript = message.transcript || consoleState.interimTranscript;
    renderEditor();
    return;
  }

  if (message.event === 'response_delta') {
    consoleState.streamingResponse = message.text || `${consoleState.streamingResponse || ''}${message.delta || ''}`;
    consoleState.status = 'Agent responding';
    consoleState.interimTranscript = consoleState.streamingResponse;
    renderEditor();
    return;
  }

  if (message.event === 'response_audio_delta') {
    enqueueRealtimeResponseAudio(message);
    return;
  }

  if (message.event === 'turn_result') {
    if (consoleState.realtimeAudioReceived && message.data && typeof message.data === 'object') {
      message.data.__realtime_audio_streamed = true;
    }
    processWebVoiceTurnResult(message.data, message.recorded_ms).catch((error) => {
      consoleState.error = `Voice turn failed: ${error.message}`;
      consoleState.status = 'Turn failed';
      consoleState.busy = false;
      consoleState.listening = consoleState.sessionActive;
      consoleState.phase = consoleState.sessionActive ? 'listening' : 'idle';
      renderEditor();
    });
    return;
  }

  if (message.event === 'listening') {
    consoleState.realtimeCanSendAudio = true;
    flushRealtimeAudioQueue();
    if (consoleState.phase !== 'speaking' && consoleState.sessionActive) {
      consoleState.busy = false;
      consoleState.listening = true;
      consoleState.phase = 'listening';
      consoleState.status = 'Listening';
      consoleState.interimTranscript = 'Listening. Speak naturally; pauses will send each turn.';
      renderEditor();
    }
    return;
  }

  if (message.event === 'error') {
    consoleState.error = message.message || 'Realtime voice stream failed.';
    consoleState.status = 'Realtime error';
    consoleState.busy = false;
    consoleState.listening = consoleState.sessionActive;
    consoleState.phase = consoleState.sessionActive ? 'listening' : 'idle';
    renderEditor();
  }
}

function handleVoiceSessionAudio(input) {
  const consoleState = state.voiceConsole;
  if (!consoleState.sessionActive) return;

  const now = performance.now();
  const chunk = new Float32Array(input);
  const rms = computeRms(chunk);
  const hasVoice = rms >= consoleState.rmsThreshold;
  consoleState.micLevel = smoothLevel(consoleState.micLevel || 0, rms);
  consoleState.peakMicLevel = Math.max(consoleState.peakMicLevel || 0, rms);
  if (now - (consoleState.lastLevelRenderAt || 0) >= 140) {
    consoleState.lastLevelRenderAt = now;
    updateVoiceVolumeMeter();
  }

  if (consoleState.phase === 'speaking') {
    const pastGrace = now - consoleState.playbackStartedAt >= consoleState.bargeInGraceMs;
    const strongVoice = rms >= consoleState.bargeInRmsThreshold;
    if (!pastGrace || !strongVoice) {
      consoleState.bargeInStartedAt = 0;
      return;
    }
    consoleState.bargeInStartedAt = consoleState.bargeInStartedAt || now;
    if (now - consoleState.bargeInStartedAt >= consoleState.bargeInHoldMs) {
      interruptAgentPlayback();
    } else {
      return;
    }
  }

  if (consoleState.phase === 'processing' || consoleState.busy) return;

  if (consoleState.realtimeActive && consoleState.realtimeReady) {
    sendRealtimeAudioChunk(chunk);
    return;
  }

  if (hasVoice && !consoleState.speechStarted) {
    consoleState.speechStarted = true;
    consoleState.startedAt = now;
    consoleState.lastVoiceAt = now;
    consoleState.chunks = [];
    consoleState.transcript = '';
    consoleState.interimTranscript = 'Listening to your turn...';
    consoleState.status = 'Listening';
    consoleState.phase = 'listening';
    renderEditor();
  }

  if (consoleState.speechStarted) {
    consoleState.chunks.push(chunk);
    if (hasVoice) consoleState.lastVoiceAt = now;
    const silenceMs = now - consoleState.lastVoiceAt;
    const recordedMs = now - consoleState.startedAt;
    if (silenceMs >= consoleState.silenceMs && recordedMs >= consoleState.minTurnMs) {
      finalizeCurrentVoiceTurn();
    }
  }
}

function computeRms(samples) {
  if (!samples.length) return 0;
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    total += samples[index] * samples[index];
  }
  return Math.sqrt(total / samples.length);
}

function smoothLevel(previous, next) {
  const attack = next > previous ? 0.55 : 0.18;
  return previous + ((next - previous) * attack);
}

function updateVoiceVolumeMeter() {
  const level = Math.min(100, Math.round((state.voiceConsole.micLevel || 0) * 1000));
  const value = $('voice-volume-value');
  const current = $('voice-volume-current');
  const bar = $('voice-volume-bar');
  if (value) value.textContent = `${level}%`;
  if (current) current.textContent = `${level}%`;
  if (bar) bar.style.width = `${level}%`;
}

function finalizeCurrentVoiceTurn() {
  const consoleState = state.voiceConsole;
  if (!consoleState.speechStarted || consoleState.busy || consoleState.phase === 'processing') return;

  const chunks = consoleState.chunks || [];
  const sampleRate = consoleState.sampleRate || 16000;
  const recordedMs = consoleState.startedAt ? Math.max(0, performance.now() - consoleState.startedAt) : null;
  consoleState.chunks = [];
  consoleState.speechStarted = false;
  consoleState.lastVoiceAt = 0;
  consoleState.startedAt = 0;

  if (!chunks.length) return;

  consoleState.busy = true;
  consoleState.phase = 'processing';
  consoleState.listening = false;
  consoleState.status = 'Processing turn';
  consoleState.interimTranscript = 'Transcribing and sending this turn to the agent.';
  const wav = encodeWav(chunks, sampleRate);
  runWebVoiceAudioTurn(wav, recordedMs);
  renderEditor();
}

function endWebVoiceSession(options = {}) {
  state.voiceConsole.sessionActive = false;
  state.voiceConsole.listening = false;
  state.voiceConsole.busy = false;
  state.voiceConsole.phase = 'idle';
  state.voiceConsole.speechStarted = false;
  state.voiceConsole.openingPlayed = false;
  state.voiceConsole.startedAt = 0;
  state.voiceConsole.lastVoiceAt = 0;
  state.voiceConsole.bargeInStartedAt = 0;
  state.voiceConsole.micLevel = 0;
  state.voiceConsole.peakMicLevel = 0;
  state.voiceConsole.lastLevelRenderAt = 0;
  state.voiceConsole.interimTranscript = '';
  cleanupWebVoiceAudio();
  if (state.voiceConsole.status !== 'Idle') {
    state.voiceConsole.status = 'Stopped';
  }
  if (options.render !== false) renderEditor();
}

function interruptAgentPlayback() {
  const audio = state.voiceConsole.currentAudio;
  if (audio) {
    sendRealtimePlaybackEvent('interrupted', {
      audioId: state.voiceConsole.currentAudioId || '',
      reason: 'barge_in',
      currentTimeMs: Math.round((audio.currentTime || 0) * 1000),
      durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null,
    });
    try { audio.pause(); } catch (_error) {}
    try { audio.currentTime = 0; } catch (_error) {}
  }
  state.voiceConsole.currentAudio = null;
  state.voiceConsole.currentAudioId = '';
  state.voiceConsole.realtimeAudioQueue = [];
  state.voiceConsole.realtimeAudioPlaying = false;
  state.voiceConsole.realtimePendingAudio = [];
  state.voiceConsole.playbackStartedAt = 0;
  state.voiceConsole.bargeInStartedAt = 0;
  state.voiceConsole.phase = 'listening';
  state.voiceConsole.listening = true;
  state.voiceConsole.busy = false;
  state.voiceConsole.status = 'Interrupted';
  state.voiceConsole.interimTranscript = 'Interrupted agent playback. Listening to your next turn...';
}

function bufferRealtimeAudioChunk(chunk) {
  const consoleState = state.voiceConsole;
  const pending = consoleState.realtimePendingAudio || [];
  pending.push(new Float32Array(chunk));
  const maxSamples = (consoleState.sampleRate || 16000) * 3;
  let totalSamples = pending.reduce((sum, item) => sum + item.length, 0);
  while (pending.length > 1 && totalSamples > maxSamples) {
    const removed = pending.shift();
    totalSamples -= removed.length;
  }
  consoleState.realtimePendingAudio = pending;
}

function flushRealtimeAudioQueue() {
  const consoleState = state.voiceConsole;
  const pending = consoleState.realtimePendingAudio || [];
  if (!pending.length || !consoleState.realtimeCanSendAudio) return;
  consoleState.realtimePendingAudio = [];
  for (const chunk of pending) {
    sendRealtimeAudioChunk(chunk);
  }
}

function sendRealtimeAudioChunk(chunk) {
  const consoleState = state.voiceConsole;
  if (!consoleState.realtimeCanSendAudio) {
    bufferRealtimeAudioChunk(chunk);
    return;
  }
  try {
    const outbound = new Float32Array(chunk);
    consoleState.realtimeSocket?.send(outbound.buffer);
  } catch (error) {
    consoleState.realtimeFallback = true;
    consoleState.realtimeActive = false;
    consoleState.realtimeReady = false;
    consoleState.realtimeCanSendAudio = false;
    consoleState.realtimePendingAudio = [];
    consoleState.error = `Realtime stream failed; using upload fallback: ${error.message}`;
  }
}

function enqueueRealtimeResponseAudio(message) {
  const consoleState = state.voiceConsole;
  if (!message?.audio?.base64) return;
  consoleState.realtimeAudioReceived = true;
  consoleState.realtimeAudioQueue.push({
    audio: message.audio,
    text: message.text || '',
    audioId: message.audio_id || '',
  });
  playNextRealtimeResponseAudio();
}

function playNextRealtimeResponseAudio() {
  const consoleState = state.voiceConsole;
  if (consoleState.realtimeAudioPlaying || !consoleState.realtimeAudioQueue.length) return;
  const next = consoleState.realtimeAudioQueue.shift();
  consoleState.realtimeAudioPlaying = true;
  playAgentAudio(next.audio, {
    audioId: next.audioId,
    textLength: next.text.length,
    speakingStatus: 'Agent speaking',
    noAudioStatus: consoleState.sessionActive ? 'Listening' : 'Agent replied without audio',
    noAudioMessage: 'Listening. Speak naturally; pauses will send each turn.',
    onFinished: () => {
      consoleState.realtimeAudioPlaying = false;
      if (consoleState.realtimeAudioQueue.length) {
        playNextRealtimeResponseAudio();
      }
    },
  }).catch((error) => {
    consoleState.realtimeAudioPlaying = false;
    consoleState.error = `Realtime audio playback failed: ${error.message}`;
    renderEditor();
  });
}

async function playAgentAudio(audioPayload, options = {}) {
  const consoleState = state.voiceConsole;
  const speakingStatus = options.speakingStatus || 'Agent speaking';
  const noAudioStatus = options.noAudioStatus || 'Agent replied without audio';
  const noAudioMessage = options.noAudioMessage || 'Listening. Speak naturally; pauses will send each turn.';
  const audioId = options.audioId || audioPayload?.audio_id || '';
  const textLength = Number.isFinite(Number(options.textLength)) ? Number(options.textLength) : null;
  let playbackFinished = false;
  const finishPlayback = () => {
    if (playbackFinished) return;
    playbackFinished = true;
    if (typeof options.onFinished === 'function') {
      options.onFinished();
    }
  };

  if (audioPayload?.base64) {
    const audio = new Audio(`data:${audioPayload.mime_type || 'audio/wav'};base64,${audioPayload.base64}`);
    consoleState.currentAudio = audio;
    consoleState.currentAudioId = audioId;
    consoleState.playbackStartedAt = performance.now();
    consoleState.phase = 'speaking';
    consoleState.status = speakingStatus;
    consoleState.busy = false;
    consoleState.listening = true;
    consoleState.interimTranscript = 'Agent speaking. Start talking to interrupt.';
    renderEditor();
    sendRealtimePlaybackEvent('started', {
      audioId,
      textLength,
      durationMs: null,
      currentTimeMs: 0,
    });
    audio.addEventListener('ended', () => {
      if (consoleState.currentAudio === audio) {
        consoleState.currentAudio = null;
        consoleState.currentAudioId = '';
        consoleState.playbackStartedAt = 0;
        consoleState.bargeInStartedAt = 0;
      }
      sendRealtimePlaybackEvent('ended', {
        audioId,
        textLength,
        durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null,
        currentTimeMs: Math.round((audio.currentTime || 0) * 1000),
      });
      if (consoleState.sessionActive) {
        consoleState.phase = 'listening';
        consoleState.status = 'Listening';
        consoleState.listening = true;
        consoleState.interimTranscript = 'Listening. Speak naturally; pauses will send each turn.';
      } else {
        consoleState.phase = 'idle';
        consoleState.status = 'Stopped';
        consoleState.listening = false;
        consoleState.interimTranscript = '';
      }
      renderEditor();
      finishPlayback();
    }, { once: true });
    await audio.play().catch((error) => {
      sendRealtimePlaybackEvent('blocked', {
        audioId,
        textLength,
        reason: error.message,
        durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null,
        currentTimeMs: Math.round((audio.currentTime || 0) * 1000),
      });
      if (consoleState.currentAudio === audio) {
        consoleState.currentAudio = null;
        consoleState.currentAudioId = '';
      }
      consoleState.error = `Audio generated but playback was blocked: ${error.message}`;
      consoleState.phase = consoleState.sessionActive ? 'listening' : 'idle';
      consoleState.status = consoleState.sessionActive ? 'Listening' : 'Stopped';
      consoleState.listening = consoleState.sessionActive;
      consoleState.interimTranscript = consoleState.sessionActive
        ? noAudioMessage
        : '';
      consoleState.busy = false;
      renderEditor();
      finishPlayback();
    });
    return;
  }

  sendRealtimePlaybackEvent('missing_audio', {
    audioId,
    textLength,
    reason: 'no_audio_payload',
  });
  if (consoleState.sessionActive) {
    consoleState.phase = 'listening';
    consoleState.status = noAudioStatus;
    consoleState.listening = true;
    consoleState.interimTranscript = noAudioMessage;
  } else {
    consoleState.phase = 'idle';
    consoleState.status = noAudioStatus;
    consoleState.listening = false;
    consoleState.interimTranscript = '';
  }
  consoleState.busy = false;
  renderEditor();
  finishPlayback();
}

function sendRealtimePlaybackEvent(status, details = {}) {
  const socket = state.voiceConsole.realtimeSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify({
      type: 'audio_playback',
      status,
      audio_id: details.audioId || '',
      reason: details.reason || null,
      duration_ms: Number.isFinite(Number(details.durationMs)) ? Number(details.durationMs) : null,
      current_time_ms: Number.isFinite(Number(details.currentTimeMs)) ? Number(details.currentTimeMs) : null,
      text_length: Number.isFinite(Number(details.textLength)) ? Number(details.textLength) : null,
      timestamp: new Date().toISOString(),
    }));
  } catch (_error) {}
}

function stopWebVoiceConsole(options = {}) {
  if (options.process !== false && state.voiceConsole.speechStarted) {
    finalizeCurrentVoiceTurn();
    return;
  }
  endWebVoiceSession(options);
}

function cleanupWebVoiceAudio() {
  const processor = state.voiceConsole.processor;
  const source = state.voiceConsole.source;
  const audioContext = state.voiceConsole.audioContext;
  const stream = state.voiceConsole.mediaStream;
  const audio = state.voiceConsole.currentAudio;
  const socket = state.voiceConsole.realtimeSocket;
  try { if (audio) audio.pause(); } catch (_error) {}
  try { if (socket) socket.close(); } catch (_error) {}
  try { if (processor) processor.disconnect(); } catch (_error) {}
  try { if (source) source.disconnect(); } catch (_error) {}
  try { if (audioContext && audioContext.state !== 'closed') audioContext.close(); } catch (_error) {}
  try { stream?.getTracks?.().forEach((track) => track.stop()); } catch (_error) {}
  state.voiceConsole.processor = null;
  state.voiceConsole.source = null;
  state.voiceConsole.audioContext = null;
  state.voiceConsole.mediaStream = null;
  state.voiceConsole.currentAudio = null;
  state.voiceConsole.currentAudioId = '';
  state.voiceConsole.realtimeSocket = null;
  state.voiceConsole.realtimeActive = false;
  state.voiceConsole.realtimeReady = false;
  state.voiceConsole.realtimeCanSendAudio = false;
  state.voiceConsole.realtimePendingAudio = [];
  state.voiceConsole.realtimeAudioQueue = [];
  state.voiceConsole.realtimeAudioPlaying = false;
  state.voiceConsole.realtimeAudioReceived = false;
  state.voiceConsole.playbackStartedAt = 0;
  state.voiceConsole.chunks = [];
}

function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (position, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(position + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let output = 44;
  for (let index = 0; index < samples.length; index += 1, output += 2) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(output, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('failed to read audio blob'));
    reader.readAsDataURL(blob);
  });
}

async function runWebVoiceAudioTurn(wavBlob, recordedMs) {
  const agent = updateSelectedFromForm() || selectedAgent();
  if (!agent || !wavBlob) return;

  state.voiceConsole.busy = true;
  state.voiceConsole.listening = false;
  state.voiceConsole.phase = 'processing';
  state.voiceConsole.status = 'Sending audio to LANA';
  renderEditor();

  try {
    const audioBase64 = await blobToBase64(wavBlob);
    const payload = await request('/api/v1/voice/session-turn/audio', {
      method: 'POST',
      body: JSON.stringify({
        call_id: state.voiceConsole.callId || `web-${Date.now()}`,
        agent_id: agent.id || undefined,
        audio_base64: audioBase64,
        mime_type: 'audio/wav',
        language: (agent.language || 'en-US').split('-')[0] || 'en',
        agent,
      }),
    });
    const result = payload.data || payload;
    await processWebVoiceTurnResult(result, recordedMs);
  } catch (error) {
    if (isNetworkRequestError(error)) {
      endWebVoiceSession({ render: false });
      state.voiceConsole.error = `Voice API unavailable: ${error.message}`;
      state.voiceConsole.status = 'Voice API unavailable';
      state.voiceConsole.interimTranscript = 'The local voice API is not reachable. Start or restart LANA API and try again.';
      renderEditor();
      return;
    }
    state.voiceConsole.error = `Voice turn failed: ${error.message}`;
    state.voiceConsole.status = 'Turn failed';
    state.voiceConsole.phase = state.voiceConsole.sessionActive ? 'listening' : 'idle';
    state.voiceConsole.listening = state.voiceConsole.sessionActive;
    state.voiceConsole.interimTranscript = state.voiceConsole.sessionActive
      ? 'Listening. Speak naturally; pauses will send each turn.'
      : '';
  } finally {
    if (state.voiceConsole.phase !== 'speaking') {
      state.voiceConsole.busy = false;
    }
    renderEditor();
  }
}

async function processWebVoiceTurnResult(result, recordedMs) {
  if (!result) return;
  const transcript = result.transcript?.text || result.transcription?.text || '';
  if (result.ignored) {
    state.voiceConsole.transcript = '';
    state.voiceConsole.error = '';
    state.voiceConsole.telemetry = {
      ...(result.telemetry || {}),
      recorded_ms: Number.isFinite(Number(recordedMs)) ? Math.round(recordedMs) : undefined,
    };
    if (state.voiceConsole.sessionActive) {
      state.voiceConsole.phase = 'listening';
      state.voiceConsole.status = 'Listening';
      state.voiceConsole.listening = true;
      state.voiceConsole.interimTranscript = 'No speech detected. Listening for your next turn.';
    } else {
      state.voiceConsole.phase = 'idle';
      state.voiceConsole.status = 'Stopped';
      state.voiceConsole.interimTranscript = '';
    }
    renderEditor();
    return;
  }
  state.voiceConsole.transcript = transcript;
  state.voiceConsole.interimTranscript = transcript || 'No transcript returned for this turn.';
  state.voiceConsole.streamingResponse = '';
  if (transcript) {
    state.voiceConsole.turns.push({ role: 'user', text: transcript, at: new Date().toISOString() });
  }
  if (result.response?.mode === 'failed') {
    state.voiceConsole.tools = Array.isArray(result.tools) ? result.tools : [];
    state.voiceConsole.telemetry = {
      ...(result.telemetry || {}),
      recorded_ms: Number.isFinite(Number(recordedMs)) ? Math.round(recordedMs) : undefined,
    };
    state.voiceConsole.error = result.synthesis?.message || result.response?.metadata?.error || 'The voice agent did not return a response.';
    state.voiceConsole.status = 'Agent response failed';
    state.voiceConsole.phase = state.voiceConsole.sessionActive ? 'listening' : 'idle';
    state.voiceConsole.listening = state.voiceConsole.sessionActive;
    state.voiceConsole.interimTranscript = state.voiceConsole.sessionActive
      ? 'The AI response failed. Listening for your next turn.'
      : '';
    renderEditor();
    return;
  }
  const reply = result.response?.text || 'The agent did not return a text response.';
  state.voiceConsole.turns.push({ role: 'agent', text: reply, at: new Date().toISOString() });
  state.voiceConsole.tools = Array.isArray(result.tools) ? result.tools : [];
  state.voiceConsole.telemetry = {
    ...(result.telemetry || {}),
    recorded_ms: Number.isFinite(Number(recordedMs)) ? Math.round(recordedMs) : undefined,
  };
  state.voiceConsole.error = result.synthesis?.message && !result.audio ? result.synthesis.message : '';
  if (result.__realtime_audio_streamed || result.synthesis?.streamed) {
    if (!state.voiceConsole.realtimeAudioPlaying && !state.voiceConsole.realtimeAudioQueue.length) {
      state.voiceConsole.phase = state.voiceConsole.sessionActive ? 'listening' : 'idle';
      state.voiceConsole.status = state.voiceConsole.sessionActive ? 'Listening' : 'Stopped';
      state.voiceConsole.listening = state.voiceConsole.sessionActive;
      state.voiceConsole.interimTranscript = state.voiceConsole.sessionActive
        ? 'Listening. Speak naturally; pauses will send each turn.'
        : '';
      state.voiceConsole.busy = false;
    }
    state.voiceConsole.realtimeAudioReceived = false;
    renderEditor();
    return;
  }
  await playAgentAudio(result.audio, {
    speakingStatus: 'Agent speaking',
    noAudioStatus: state.voiceConsole.sessionActive ? 'Listening' : 'Agent replied without audio',
    noAudioMessage: 'Listening. Speak naturally; pauses will send each turn.',
  });
}

async function exportAgent() {
  const agent = updateSelectedFromForm();
  if (!agent) return;
  try {
    const payload = await request(`${API_ROOT}/${encodeURIComponent(agent.id)}/export`);
    downloadJson(payload.data || payload.agent || payload, `${agent.name || 'voice-agent'}.json`);
  } catch (_error) {
    downloadJson(agent, `${agent.name || 'voice-agent'}.json`);
    showFlash('Exported the local editor payload.', 'warn');
  }
}

async function importAgent() {
  const agent = selectedAgent();
  const file = $('agent-import-file')?.files?.[0];
  if (!agent || !file) {
    showFlash('Choose a JSON file to import.', 'warn');
    return;
  }
  let imported;
  try {
    imported = JSON.parse(await file.text());
    const payload = await request(`${API_ROOT}/${encodeURIComponent(agent.id)}/import`, {
      method: 'POST',
      body: JSON.stringify(imported)
    });
    const next = normalizeAgent(payload.data || payload.agent || imported);
    next.id = next.id || agent.id;
    state.agents = state.agents.map((item) => String(item.id) === String(agent.id) ? next : item);
    state.selectedId = next.id;
    setDirty(false);
    showFlash('Agent imported.', 'success');
  } catch (error) {
    if (imported && String(agent.id || '').startsWith('local-')) {
      const next = normalizeAgent({ ...imported, id: agent.id });
      state.agents = state.agents.map((item) => String(item.id) === String(agent.id) ? next : item);
      state.selectedId = next.id;
      setDirty(true);
      showFlash('Imported into the local draft. Save when the API is connected.', 'warn');
    } else {
      showFlash(`Import failed: ${error.message}`, 'error');
    }
  } finally {
    renderEditor();
  }
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bind() {
  els.shell = $('voice-shell');
  els.sidebar = els.shell?.querySelector('lex-sidebar') || document.querySelector('lex-sidebar');
  els.topbar = els.shell?.querySelector('lex-topbar') || document.querySelector('lex-topbar');
  els.flash = $('voice-flash');
  els.agentList = $('agent-list');
  els.agentSearch = $('agent-search');
  els.editorEmpty = $('editor-empty');
  els.editorPanel = $('editor-panel');
  els.selectedName = $('selected-agent-name');
  els.selectedMeta = $('selected-agent-meta');
  els.tabs = $('agent-tabs');
  els.form = $('agent-form');
  els.saveBtn = $('save-agent-btn');

  $('refresh-agents-btn').addEventListener('click', loadAgents);
  if (els.topbar) {
    els.topbar.addEventListener('topbar-refresh-click', loadAgents);
  }

  // When this page is hosted inside <lex-app>, the shell catches
  // `topbar-refresh-click` and dispatches a cancelable `lex-refresh`
  // document event — and reloads the whole page if nobody marks it
  // handled. Voice's standalone shell doesn't dispatch this today, but
  // signalling handled here is cheap insurance against a future wrap and
  // keeps any in-flight edits from being discarded by a hard reload.
  // `topbar-refresh-click` above already triggers loadAgents(), so we
  // only need to mark the lex-refresh as handled — calling loadAgents
  // again here would just race the same fetch.
  document.addEventListener('lex-refresh', (event) => {
    event.preventDefault();
  });
  $('create-agent-btn').addEventListener('click', () => createAgent(DEFAULT_AGENT));
  $('empty-create-agent-btn').addEventListener('click', () => createAgent(DEFAULT_AGENT));
  $('duplicate-agent-btn').addEventListener('click', () => {
    const agent = updateSelectedFromForm();
    if (agent) createAgent({ ...agent, id: null, name: `${agent.name} Copy`, status: 'draft' });
  });
  $('delete-agent-btn').addEventListener('click', deleteAgent);
  els.saveBtn.addEventListener('click', saveAgent);

  els.agentSearch.addEventListener('input', (event) => {
    state.query = event.target.value;
    renderAgentList();
  });
  els.agentList.addEventListener('click', (event) => {
    const card = event.target.closest('[data-agent-id]');
    if (!card) return;
    updateSelectedFromForm();
    state.selectedId = card.dataset.agentId;
    state.dirty = false;
    renderEditor();
  });
  els.tabs.addEventListener('tab-change', (event) => {
    updateSelectedFromForm();
    state.activeTab = event.detail?.tab || 'agent';
    renderEditor();
  });
  els.form.addEventListener('input', () => {
    updateSelectedFromForm();
    setDirty(true);
    renderAgentList();
    els.selectedName.textContent = selectedAgent()?.name || 'Receptionist';
  });
  els.form.addEventListener('change', () => {
    updateSelectedFromForm();
    setDirty(true);
  });
  els.form.addEventListener('click', (event) => {
    const target = actionTarget(event);
    const action = target?.dataset.action;
    if (!action) return;
    if (action === 'add-intake-field') addIntakeField();
    if (action === 'remove-intake-field') removeIntakeField(Number(target.dataset.index));
    if (action === 'run-test') runTest();
    if (action === 'export-agent') exportAgent();
    if (action === 'import-agent') importAgent();
    if (action === 'voice-preview') showVoicePreview();
    if (action === 'setting-info') showSettingInfo(target.dataset.setting);
    if (action === 'start-web-voice-session') startWebVoiceSession();
    if (action === 'end-web-voice-session') endWebVoiceSession();
    if (action === 'start-web-voice') startWebVoiceSession();
    if (action === 'stop-web-voice') stopWebVoiceConsole();
    if (action === 'reset-web-voice') resetWebVoiceConsole();
  });

  if (els.sidebar) {
    els.sidebar.sections = [
      {
        id: 'voice',
        items: [
          { id: 'voice-agents', label: 'Voice Agents', icon: 'phone', href: './index.html' }
        ]
      }
    ];
    els.sidebar.activeId = 'voice-agents';
    els.sidebar.addEventListener('sidebar-user-action', onSidebarUserAction);
    els.sidebar.addEventListener('sidebar-nav-click', onSidebarUserAction);
  }
}

function addIntakeField() {
  const agent = updateSelectedFromForm() || selectedAgent();
  if (!agent) return;
  agent.capture_schema = normalizeCaptureSchema(agent.capture_schema || agent.intake_schema);
  agent.capture_schema.push({
    name: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
    prompt: ''
  });
  agent.intake_schema = agent.capture_schema;
  setDirty(true);
  renderEditor();
}

function removeIntakeField(index) {
  const agent = updateSelectedFromForm() || selectedAgent();
  if (!agent || !Number.isInteger(index)) return;
  agent.capture_schema = normalizeCaptureSchema(agent.capture_schema || agent.intake_schema).filter((_, itemIndex) => itemIndex !== index);
  agent.intake_schema = agent.capture_schema;
  setDirty(true);
  renderEditor();
}

function onSidebarUserAction(event) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
  const detail = event && event.detail;
  if (!detail) return;
  if (detail.action === 'signout') {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.api) {
        window.api.token = null;
        window.api.user = null;
      }
    } catch (_e) {
      // Ignore storage failures during sign out.
    }
    window.location.href = '../login.html';
    return;
  }
  if (detail.href) {
    const targetUrl = new URL(detail.href, window.location.href);
    if (targetUrl.pathname === window.location.pathname) {
      return;
    }
    window.location.href = targetUrl.href;
  }
}

bind();
if (window.api && window.api._readyPromise) {
  await window.api._readyPromise;
}
if (window.api && typeof window.api.loadUserProfile === 'function') {
  try {
    await window.api.loadUserProfile();
  } catch (error) {
    console.warn('[voice] api.loadUserProfile failed; sidebar footer will use slim user.', error);
  }
}
if (window.LanaSidebarFooter && els.sidebar) {
  window.LanaSidebarFooter.hydrate(els.sidebar, { pathPrefix: '../' });
}
await loadAgents();
