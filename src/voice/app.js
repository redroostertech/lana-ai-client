const state = {
  config: null,
  callId: null,
  capturedFields: {},
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function authHeaders() {
  const token = (window.api && window.api.token) || localStorage.getItem('token') || '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function resolveUrl(path) {
  if (typeof path !== 'string' || !path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const base = (window.api && window.api.baseUrl) || '';
  const suffix = path.startsWith('/') ? path : '/' + path;
  return base + suffix;
}

async function api(path, options = {}) {
  const response = await fetch(resolveUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function appendMessage(role, text) {
  const node = document.createElement('div');
  node.className = 'message';
  node.innerHTML = `<strong>${role}</strong><span></span>`;
  node.querySelector('span').textContent = text;
  els.transcript.appendChild(node);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function renderFields() {
  els.fieldList.innerHTML = '';
  const entries = Object.entries(state.capturedFields);
  if (!entries.length) {
    els.fieldList.innerHTML = '<div class="field-item"><span>Status</span><strong>No fields captured yet</strong></div>';
    return;
  }
  for (const [field, value] of entries) {
    const node = document.createElement('div');
    node.className = 'field-item';
    node.innerHTML = `<span>${field}</span><strong></strong>`;
    node.querySelector('strong').textContent = value || '-';
    els.fieldList.appendChild(node);
  }
}

function renderConfig() {
  els.firmName.textContent = state.config?.firm?.name || '-';
  els.workflowName.textContent = state.config?.voice?.workflow || '-';
  els.fieldName.innerHTML = '';
  for (const field of state.config?.firm?.required_intake_fields || []) {
    const option = document.createElement('option');
    option.value = field;
    option.textContent = field;
    els.fieldName.appendChild(option);
  }
}

async function loadConfig() {
  const payload = await api('/api/config');
  state.config = payload.data;
  renderConfig();
}

async function checkHealth() {
  try {
    const health = await api('/health');
    els.healthPill.textContent = health.status;
    els.healthPill.className = 'pill ok';
  } catch (error) {
    els.healthPill.textContent = 'degraded';
    els.healthPill.className = 'pill warn';
  }
}

async function newSession() {
  const payload = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ workflow: state.config?.voice?.workflow || 'intake' }),
  });
  state.callId = payload.data.call_id;
  els.callId.textContent = state.callId;
  appendMessage('system', `Started ${payload.data.workflow} session ${state.callId}.`);
}

async function sendTurn(event) {
  event.preventDefault();
  const text = els.turnInput.value.trim();
  if (!text) return;
  if (!state.callId) await newSession();
  els.turnInput.value = '';
  appendMessage('caller', text);
  try {
    const payload = await api('/api/dev/turn', {
      method: 'POST',
      body: JSON.stringify({ call_id: state.callId, text }),
    });
    appendMessage('lana', payload.data.response_text || '(no response)');
  } catch (error) {
    appendMessage('error', error.message);
  }
}

async function captureField(event) {
  event.preventDefault();
  if (!state.callId) await newSession();
  const field = els.fieldName.value;
  const value = els.fieldValue.value.trim();
  if (!field || !value) return;
  try {
    await api('/api/tools/intake/capture-field', {
      method: 'POST',
      body: JSON.stringify({
        call_id: state.callId,
        workflow: state.config?.voice?.workflow || 'intake',
        field_name: field,
        value,
      }),
    });
    state.capturedFields[field] = value;
    els.fieldValue.value = '';
    renderFields();
    appendMessage('tool', `Captured ${field}.`);
  } catch (error) {
    appendMessage('error', error.message);
  }
}

function bind() {
  els.sidebar = $('app-sidebar');
  els.newSessionBtn = $('new-session-btn');
  els.firmName = $('firm-name');
  els.workflowName = $('workflow-name');
  els.callId = $('call-id');
  els.healthPill = $('health-pill');
  els.transcript = $('transcript');
  els.turnForm = $('turn-form');
  els.turnInput = $('turn-input');
  els.fieldForm = $('field-form');
  els.fieldName = $('field-name');
  els.fieldValue = $('field-value');
  els.fieldList = $('field-list');

  els.newSessionBtn.addEventListener('click', newSession);
  els.turnForm.addEventListener('submit', sendTurn);
  els.fieldForm.addEventListener('submit', captureField);

  if (els.sidebar) {
    els.sidebar.sections = [
      {
        id: 'voice',
        items: [
          { id: 'voice', label: 'Voice Intake', icon: 'phone' }
        ]
      }
    ];
    els.sidebar.activeId = 'voice';
    els.sidebar.addEventListener('sidebar-user-action', onSidebarUserAction);
  }
}

function onSidebarUserAction(event) {
  // The sidebar preventDefaults <a> clicks so the host router can take
  // over; voice doesn't have a router, so navigate manually on href.
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
    } catch (_e) { /* ignore */ }
    window.location.href = '../login.html';
    return;
  }
  if (detail.href) {
    window.location.href = detail.href;
  }
}

bind();
renderFields();
if (window.api && window.api._readyPromise) {
  await window.api._readyPromise;
}
// Enrich localStorage.user with the full profile (role_name, roles,
// username) so the sidebar footer matches the host. See automation/app.js
// bootstrapApp for the same pattern.
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
await Promise.all([loadConfig(), checkHealth()]);
