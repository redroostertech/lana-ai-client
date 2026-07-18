import {
  FILTER_DEFAULTS,
  SIDEBAR_NAV_ITEMS,
  STORAGE_KEYS,
  SYSTEM_CONNECTORS,
  TEMPLATE_LIBRARY,
  VIEW_DEFINITIONS
} from './js/constants.js';
import { escapeHtml, normalizeText, parseJson } from './js/shared/utils.js';
import { getApiUrl } from './js/shared/api-base-url.js';
import { renderConnectors } from './js/views/connectors.js';
import { renderConnectorDetail, teardownConnectorDetail } from './js/views/connector-detail.js';
import { buildChecklist, renderHome } from './js/views/home.js';
import { renderLibrary, toggleAutomation } from './js/views/library.js';
import {
  createLibraryDetailState,
  handleLibraryDetailClick,
  loadLibraryDetailAutomation,
  loadMatterAttachments,
  loadAutomationRuns,
  renderLibraryDetail
} from './js/views/library-detail.js';
import {
  applyTemplate,
  addBuilderAction,
  builderPreflight,
  clampBuilderStep,
  configIsValid,
  createAutomation,
  createBuilderState,
  generateAutomationDesign,
  getSelectedTemplate,
  loadAutomationForEdit,
  mergeBuilderDraft,
  normalizeTemplate,
  resetOverdueReminderMatrix,
  removeBuilderAction,
  renderBuilder,
  selectBuilderAction,
  selectOverdueReminderCell,
  syncBuilderJson,
  updateOverdueReminderField,
  updateBuilderAction,
  validateBuilder
} from './js/views/builder.js';
import { renderRuns } from './js/views/runs.js';
import { renderApprovals } from './js/views/approvals.js';
import { indexConnectors, findConnectorById, normalizeConnector, buildLanaClientConnectorUrl } from './js/shared/connectors.js';
import { hasAdminRole } from './js/shared/access.js';
import { formatFileSize } from './js/shared/utils.js';

function openWorkspaceResourceUrl(resourceUrl) {
  const href = String(resourceUrl || '').trim();
  if (!href) return;

  if (href.includes('workspace-details.html')) {
    let params = null;
    try {
      params = new URL(href, window.location.href).searchParams;
    } catch (_error) {
      const query = href.includes('?') ? href.slice(href.indexOf('?')) : '';
      params = new URLSearchParams(query);
    }

    const matterId = params.get('id') || '';
    if (!matterId) return;

    const nextParams = new URLSearchParams({ id: matterId });
    for (const key of ['tab', 'task', 'task_id', 'open_file', 'artifact', 'activity']) {
      const value = params.get(key);
      if (value) nextParams.set(key, value);
    }
    if (!nextParams.get('tab')) nextParams.set('tab', 'activity');

    window.location.href = new URL(`../workspace-details.html?${nextParams.toString()}`, import.meta.url).href;
    return;
  }

  window.location.href = href;
}

function readCanonicalToken() {
  if (window.api && window.api.token) return window.api.token;
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('token') || '';
}

function readCanonicalUser() {
  if (window.api && window.api.user) return window.api.user;
  if (typeof localStorage === 'undefined') return null;
  return parseJson(localStorage.getItem('user'), null);
}

const state = {
  token: readCanonicalToken(),
  user: readCanonicalUser(),
  apiBaseUrl: (window.api && window.api.baseUrl) || '',
  connectorsChecklistHidden: typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.connectorsChecklistHidden) === '1'
    : false,
  links: null,
  currentView: 'home',
  dashboard: null,
  templates: [],
  automations: [],
  homeRecentRuns: [],
  homeRunBusyId: null,
  actionCatalog: [],
  matters: [],
  runs: [],
  runsPagination: {
    total: 0,
    limit: 25,
    offset: 0,
    has_more: false
  },
  selectedRunId: null,
  selectedRunDetail: null,
  selectedRunArtifactId: null,
  selectedRunArtifactDetail: null,
  selectedRunArtifactLoading: false,
  connectors: [],
  connectorHealth: [],
  installedConnectors: [],
  connectorIndex: [],
  pinnedConnectors: (() => {
    if (typeof localStorage === 'undefined') return [];
    const raw = parseJson(localStorage.getItem(STORAGE_KEYS.pinnedConnectors), []);
    return Array.isArray(raw) ? raw.filter((id) => typeof id === 'string' && id) : [];
  })(),
  connectorDetail: {
    selectedId: typeof localStorage !== 'undefined'
      ? (localStorage.getItem(STORAGE_KEYS.selectedConnectorId) || null)
      : null,
    error: null,
    // GAP #10: lazy-loaded integration sources for multi-account default UI
    sourcesState: null // { sources: [], loading: false, loaded: false }
  },
  connectorImport: {
    open: false,
    selectedFile: null,
    uploading: false,
    error: null,
    // Context for "Update connector" flows. When set, the import is
    // scoped to a specific connector kind and the backend rejects a
    // mismatched ZIP. When null, the import is a fresh install.
    targetConnectorId: null,
    targetConnectorName: null
  },
  connectorAddInstance: {
    open: false,
    slug: null,
    connectorName: null,
    manifest: null,
    submitting: false,
    error: null
  },
  connectorConfirm: {
    mode: null,
    connectorId: null,
    busy: false
  },
  approvals: [],
  selectedApprovalId: null,
  selectedApprovalDetail: null,
  approvalActioning: false,
  userProfile: null,
  onboardingState: null,
  filters: createFilterState(),
  builderStep: 1,
  builder: createBuilderState(TEMPLATE_LIBRARY[0], []),
  libraryDetail: createLibraryDetailState(),
  libraryLoading: false,
  libraryLoadingToken: 0
};

const els = {};

const API_PATH_FALLBACKS = {
  '/api/auth/login': '/api/v1/auth/login',
  '/api/v1/auth/login': '/api/auth/login',
  '/api/auth/logout': '/api/v1/auth/logout',
  '/api/v1/auth/logout': '/api/auth/logout',
  '/api/auth/me': '/api/v1/auth/me',
  '/api/v1/auth/me': '/api/auth/me',
  '/api/auth/refresh': '/api/v1/auth/refresh',
  '/api/v1/auth/refresh': '/api/auth/refresh',
  '/api/auth/session': '/api/v1/auth/session',
  '/api/v1/auth/session': '/api/auth/session',
  '/api/users/me/profile': '/api/v1/users/me/profile',
  '/api/v1/users/me/profile': '/api/users/me/profile',
  '/api/users/me/preferences': '/api/v1/users/me/preferences',
  '/api/v1/users/me/preferences': '/api/users/me/preferences',
  '/api/users/me/preferences/reset': '/api/v1/users/me/preferences/reset',
  '/api/v1/users/me/preferences/reset': '/api/users/me/preferences/reset',
  '/api/users/me/security': '/api/v1/users/me/security',
  '/api/v1/users/me/security': '/api/users/me/security',
  '/api/rbac/roles': '/api/v1/rbac/roles',
  '/api/v1/rbac/roles': '/api/rbac/roles',
  '/api/dashboard': '/api/v1/automation/dashboard',
  '/api/v1/automation/dashboard': '/api/dashboard',
  '/api/templates': '/api/v1/automation/templates',
  '/api/v1/automation/templates': '/api/templates',
  '/api/automations': '/api/v1/automations',
  '/api/v1/automations': '/api/automations',
  '/api/automation-actions': '/api/v1/automation-actions',
  '/api/v1/automation-actions': '/api/automation-actions',
  '/api/matters': '/api/v1/matters',
  '/api/v1/matters': '/api/matters',
  '/api/executions': '/api/v1/automation/executions',
  '/api/v1/automation/executions': '/api/executions',
  '/api/approvals/inbox': '/api/v1/approvals/inbox',
  '/api/v1/approvals/inbox': '/api/approvals/inbox',
  '/api/connectors': '/api/v1/connectors/registry/catalog',
  '/api/v1/connectors/registry/catalog': '/api/connectors',
  '/api/integrations/connectors': '/api/v1/integrations/connectors',
  '/api/v1/integrations/connectors': '/api/integrations/connectors',
  '/api/connector-health': '/api/v1/automation/connector-health',
  '/api/v1/automation/connector-health': '/api/connector-health',
  '/api/connector-health/refresh': '/api/v1/automation/connector-health/refresh',
  '/api/v1/automation/connector-health/refresh': '/api/connector-health/refresh',
  '/api/onboarding-state': '/api/v1/automation/onboarding-state',
  '/api/v1/automation/onboarding-state': '/api/onboarding-state'
};

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    ensureLexComposerRegistered();
    window.openAutomationBuilder = (automationId) => gotoBuilder(undefined, automationId);
    await ensureShellReady();
    ensureAutomationMount();
    cacheElements();
    bindGlobalEvents();
    applyTemplate(createContext(), getSelectedTemplate(createContext()));
    await loadLinks();

    // Auth is owned by the lana-ai-client host: auth-guard.js has already
    // validated localStorage.token and bounced unauthenticated users to
    // login.html before this module ran. If state.token is still empty,
    // we are mid-redirect — bail out without booting the SPA.
    if (!state.token) {
      showLogin();
      return;
    }

    // Best-effort: refresh user profile from /api/auth/me. Don't gate page
    // entry on it; if the call fails (Core hiccup, network blip, expired
    // token), still boot the app and let the next API call's 401 handler
    // own session-expiry, instead of silently bouncing back to the host
    // dashboard via login.html's already-authenticated redirect.
    const resumed = await tryResumeSession();
    if (resumed) {
      return;
    }

    startAuthLifecycle();
    showApp();
    await bootstrapApp();
  });
}

function createFilterState() {
  return JSON.parse(JSON.stringify(FILTER_DEFAULTS));
}

function ensureShellReady() {
  const shell = document.getElementById('automation-shell');
  if (!shell || shell._shellRendered) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      shell.removeEventListener('lex-app-ready', done);
      resolve();
    };
    shell.addEventListener('lex-app-ready', done);
    window.setTimeout(done, 500);
  });
}

function ensureAutomationMount() {
  const shell = document.getElementById('automation-shell');
  const content = shell?.getContentEl ? shell.getContentEl() : document.getElementById('lex-main-content');
  if (!content || document.getElementById('automation-root')) return;

  content.innerHTML = `
    <div id="automation-root" class="automation-root">
      <div id="flash" class="flash hidden"></div>
      <section id="view-content" class="view"></section>
    </div>
  `;
  content.classList.add('ready');
}

function cacheElements() {
  els.shell = document.getElementById('automation-shell');
  els.appScreen = document.body;
  els.sidebar = els.shell?.querySelector('lex-sidebar') || document.querySelector('lex-sidebar');
  els.topbar = els.shell?.querySelector('lex-topbar') || document.querySelector('lex-topbar');
  els.flash = document.getElementById('flash');
  els.viewContent = document.getElementById('view-content');
  els.templateModal = document.getElementById('template-modal');
  els.templateModalTitle = document.getElementById('template-modal-title');
  els.templateModalDescription = document.getElementById('template-modal-description');
  els.templateModalRecommended = document.getElementById('template-modal-recommended');
  els.templateModalApps = document.getElementById('template-modal-apps');
  els.templateModalSteps = document.getElementById('template-modal-steps');
  els.templateModalTry = document.getElementById('template-modal-try');
  els.checkDataModal = document.getElementById('check-data-modal');
  els.checkDataModalDescription = document.getElementById('check-data-modal-description');
  els.checkDataModalHints = document.getElementById('check-data-modal-hints');
  els.checkDataModalSteps = document.getElementById('check-data-modal-steps');
  els.checkDataModalGo = document.getElementById('check-data-modal-go');

  els.connectorImportModal = document.getElementById('connector-import-modal');
  els.connectorImportDropZone = document.getElementById('connector-import-dropzone');
  els.connectorImportFileInput = document.getElementById('connector-import-file-input');
  els.connectorImportPreview = document.getElementById('connector-import-preview');
  els.connectorImportFileName = document.getElementById('connector-import-file-name');
  els.connectorImportFileSize = document.getElementById('connector-import-file-size');
  els.connectorImportStatus = document.getElementById('connector-import-status');
  els.connectorImportSubmit = document.getElementById('connector-import-submit');

  els.connectorConfirmModal = document.getElementById('connector-confirm-modal');
  els.connectorConfirmTitle = document.getElementById('connector-confirm-title');
  els.connectorConfirmMessage = document.getElementById('connector-confirm-message');
  els.connectorConfirmSubmit = document.getElementById('connector-confirm-submit');
  els.connectorConfirmCancel = document.getElementById('connector-confirm-cancel');

  els.connectorAddInstanceModal = document.getElementById('connector-add-instance-modal');
  els.connectorAddInstanceConnectorName = document.getElementById('connector-add-instance-connector-name');
  els.connectorAddInstanceLabel = document.getElementById('connector-add-instance-label');
  els.connectorAddInstanceHelper = document.getElementById('connector-add-instance-helper');
  els.connectorAddInstanceKey = document.getElementById('connector-add-instance-key');
  els.connectorAddInstanceForm = document.getElementById('connector-add-instance-form');
  els.connectorAddInstanceError = document.getElementById('connector-add-instance-error');
  els.connectorAddInstanceSubmit = document.getElementById('connector-add-instance-submit');
}

function bindGlobalEvents() {
  document.addEventListener('lex-refresh', (event) => {
    event.preventDefault();
    refreshCurrentView();
  });

  if (els.topbar) {
    // Settings + Administration live in the host shell (LanaWorks). The
    // topbar menu and cog route there so every sub-app reaches the same
    // canonical pages — see LanaSidebarFooter.hydrate() for the matching
    // user-menu items in the sidebar drawer.
    els.topbar.menuItems = [
      { id: 'settings', label: 'Settings', icon: 'settings' },
      { divider: true },
      { id: 'logout', label: 'Sign Out', icon: 'log-out', variant: 'danger' }
    ];
    els.topbar.addEventListener('topbar-menu-action', onTopbarMenuAction);
    els.topbar.addEventListener('topbar-settings-click', () => {
      window.location.href = '../settings-v2.html';
    });
  }

  if (els.sidebar) {
    els.sidebar.addEventListener('sidebar-nav-click', onSidebarNavClick);
    els.sidebar.addEventListener('sidebar-user-action', onSidebarUserAction);
  }

  document.body.addEventListener('click', onAppClick);
  document.body.addEventListener('input', onAppInput);
  document.body.addEventListener('change', onAppInput);
  document.body.addEventListener('lex-composer-send', onHomeComposerSend);
  document.body.addEventListener('lex-close', onAppLexClose);
  document.body.addEventListener('breadcrumb-navigate', onBreadcrumbNavigate);
  document.addEventListener('keydown', onGlobalKeydown);

  // Dirty-state guard: warn before the user closes/reloads the tab while in
  // edit mode with unsaved changes.
  window.addEventListener('beforeunload', (event) => {
    if (state.currentView === 'builder' && builderIsDirty()) {
      event.preventDefault();
      // Most modern browsers show a generic message; setting returnValue
      // ensures the dialog fires.
      event.returnValue = '';
    }
  });

  if (els.connectorImportFileInput) {
    els.connectorImportFileInput.addEventListener('change', onConnectorImportFileChange);
  }
  if (els.connectorImportDropZone) {
    setupConnectorImportDropZone(els.connectorImportDropZone);
  }
}

function onAppLexClose(event) {
  if (event.target?.matches?.('[data-run-detail-drawer]')) {
    state.selectedRunId = null;
    state.selectedRunDetail = null;
    state.selectedRunArtifactId = null;
    state.selectedRunArtifactDetail = null;
    state.selectedRunArtifactLoading = false;
    renderCurrentView();
  }

  if (event.target?.matches?.('[data-approval-detail-drawer]')) {
    state.selectedApprovalId = null;
    state.selectedApprovalDetail = null;
    renderCurrentView();
  }
}

async function loadLinks() {
  // The shared shell no longer exposes /api/meta/links through Core. Keep this
  // optional state null so cross-app links fall back to their local defaults
  // without producing a startup 404 in Electron.
  state.links = null;
}

async function bootstrapApp() {
  // Enrich localStorage.user with the full profile (role_name, roles,
  // username, organization_name, etc.). The login response stores a slim
  // user object; without this, the sidebar footer's role gating treats
  // every user as non-admin and the @handle falls back to the email.
  // Host pages (dashboard.html, matters.html, chat.html, etc.) all do this
  // up-front — sub-apps must do the same for parity.
  if (window.api && typeof window.api.loadUserProfile === 'function') {
    try {
      await window.api.loadUserProfile();
    } catch (error) {
      console.warn('[automation] api.loadUserProfile failed; sidebar footer will use slim user.', error);
    }
  }

  renderUserChip();
  setView(state.currentView);
  await Promise.all([
    loadDashboard(),
    loadTemplates(),
    loadAutomations(),
    loadHomeRecentRuns(),
    loadMatters(),
    loadConnectors(),
    // Load installed connectors at boot too, not just when the Connectors
    // view is opened. The Home screen's "N ready connectors" badge reads
    // from state.connectorIndex (built from state.installedConnectors), so
    // without this the badge always shows 0 on first render.
    loadInstalledConnectors(),
    loadConnectorHealth(),
    loadUserProfile()
  ]);
  rebuildConnectorIndex();
  await loadOnboardingState();

  // Check for deep-link: /builder?automationId=<uuid>
  // If present, go directly to the builder in edit mode.
  const deepLinkAutomationId = parseDeepLinkAutomationId();
  if (deepLinkAutomationId) {
    // Remove the query param from the URL without reloading the page so that
    // refreshing later does not re-enter edit mode unexpectedly.
    if (typeof history !== 'undefined' && history.replaceState) {
      const cleanUrl = window.location.pathname;
      history.replaceState(null, '', cleanUrl);
    }
    // Skip onboarding draft restore — we are loading a specific automation.
    renderUserChip();
    gotoBuilder(undefined, deepLinkAutomationId);
    return;
  }

  restoreOnboardingDraft();
  renderUserChip();
  renderCurrentView();
}

/**
 * Parse ?automationId=<uuid> from the current URL.
 * Returns the automation ID string if present and non-empty, otherwise null.
 *
 * @returns {string|null}
 */
function parseDeepLinkAutomationId() {
  if (typeof window === 'undefined' || !window.location?.search) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const automationId = params.get('automationId');
    return automationId && automationId.trim() ? automationId.trim() : null;
  } catch (_err) {
    return null;
  }
}

function showLogin() {
  // Auth is owned by the lana-ai-client host. When the automation page is
  // reached without a valid session, send the user to the host login flow
  // rather than rendering an in-app sign-in UI (the login screen markup was
  // removed in the lana-ai-client convergence).
  const dest = (typeof getLoginPath === 'function') ? getLoginPath() : '../login.html';
  window.location.href = dest;
}

function resolveApiFallbackUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/api')) return '';
  const queryIndex = url.indexOf('?');
  const path = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const query = queryIndex >= 0 ? url.slice(queryIndex) : '';
  const fallbackPath = API_PATH_FALLBACKS[path] || resolveApiFallbackPath(path);
  if (!fallbackPath) return '';
  return `${fallbackPath}${query}`;
}

function resolvePreferredApiUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/api')) return '';
  const queryIndex = url.indexOf('?');
  const path = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  if (path.startsWith('/api/v1/')) return '';

  const candidate = resolveApiFallbackUrl(url);
  return candidate && candidate.startsWith('/api/v1/') ? candidate : '';
}

function resolveApiFallbackPath(path) {
  const prefixes = [
    ['/api/automations/', '/api/v1/automations/'],
    ['/api/matters/', '/api/v1/matters/'],
    ['/api/executions/', '/api/v1/automation/executions/'],
    ['/api/approvals/', '/api/v1/approvals/'],
    ['/api/integrations/connectors/', '/api/v1/integrations/connectors/']
  ];

  for (const [from, to] of prefixes) {
    if (path.startsWith(from)) return `${to}${path.slice(from.length)}`;
  }

  return '';
}

function showApp() {
  const root = document.getElementById('automation-root');
  if (root) root.classList.remove('hidden');
}

function setView(view) {
  if (state.currentView === 'connector-detail' && view !== 'connector-detail') {
    teardownConnectorDetail();
    // GAP #10: clear lazy-loaded sources when leaving connector-detail
    state.connectorDetail.sourcesState = null;
  }
  if (state.currentView === 'runs' && view !== 'runs') {
    state.selectedRunId = null;
    state.selectedRunDetail = null;
    state.selectedRunArtifactId = null;
    state.selectedRunArtifactDetail = null;
    state.selectedRunArtifactLoading = false;
  }
  // Reset edit mode when navigating away from builder so a subsequent
  // "Create Automation" does not inherit a previous edit session.
  if (state.currentView === 'builder' && view !== 'builder') {
    if (state.builder.editMode) {
      state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
    }
  }
  state.currentView = view;
  syncSidebarActive();

  const meta = VIEW_DEFINITIONS[view] || VIEW_DEFINITIONS.home;

  if (els.topbar) {
    let heading = meta.title || 'Automation';
    if (view === 'connector-detail') {
      const selected = resolveSelectedConnector();
      if (selected?.name) heading = selected.name;
    }
    if (view === 'library-detail') {
      const automation = state.libraryDetail?.automation;
      if (automation?.automation_name) heading = automation.automation_name;
    }
    els.topbar.heading = heading;
  }
  if (els.shell) {
    els.shell.pageTitle = els.topbar?.heading || meta.title || 'Automation';
    els.shell.activeNavId = state.currentView;
  }
  renderCurrentView();
}

function resolveSelectedConnector() {
  const id = state.connectorDetail?.selectedId;
  if (!id) return null;
  const direct = findConnectorById(state.connectorIndex || [], id);
  if (direct) return direct;
  const fromReadiness = findConnectorById(state.connectors || [], id);
  return fromReadiness ? normalizeConnector(fromReadiness) : null;
}

function onTopbarMenuAction(event) {
  event.stopPropagation();
  const action = event.detail?.actionId;
  if (action === 'settings') {
    window.location.href = '../settings-v2.html';
    return;
  }
  if (action === 'signout' || action === 'logout') {
    onLogout();
  }
}

function ensureLexComposerRegistered() {
  const lex = window.Lex || {};
  const composerClass = lex.Chat && lex.Chat.LexChatComposer;
  const defineLex = lex.defineLex;
  if (!composerClass || typeof defineLex !== 'function') return;
  if (window.customElements && window.customElements.get('lex-chat-composer')) return;
  defineLex('lex-chat-composer', composerClass);
}

function onHomeComposerSend(event) {
  if (state.currentView !== 'home') return;
  const idea = event.detail && typeof event.detail.content === 'string'
    ? event.detail.content.trim()
    : '';
  if (!idea) return;
  // TODO(home-composer-ai): Lana should reason about the user's idea end-to-end:
  //   1) inspect the available trigger event catalog, action catalog, and
  //      connectors the org has on hand
  //   2) propose a multi-step plan back to the user (trigger → conditions →
  //      actions, with the right scope and matter binding)
  //   3) once confirmed, synthesize the automation JSON (config + steps) and
  //      drop the user into the builder pre-populated, not blank
  // Today this is a passthrough: we drop the raw idea into builder.message and
  // open the empty builder. Replace this with an /api call that returns a draft
  // automation config so the builder loads with a real proposed structure.
  state.builder.message = idea;
  syncBuilderJson(createContext());
  gotoBuilder();
}

function configureHomeComposer() {
  if (state.currentView !== 'home') return;
  const composer = document.getElementById('home-lex-composer');
  if (!composer) return;

  const applyDefaults = () => {
    // Home experience: lock to Automations Chat with no extra "+" actions.
    composer.tools = [{ id: 'insights_chat', label: 'Automations Chat' }];
    if (typeof composer.setActiveTools === 'function') {
      composer.setActiveTools(['insights_chat']);
    }
    if (typeof composer.setToolsLocked === 'function') {
      composer.setToolsLocked(true);
    }
  };

  if (typeof composer.setActiveTools === 'function') {
    applyDefaults();
    return;
  }

  requestAnimationFrame(applyDefaults);
}

async function onSidebarNavClick(event) {
  event.stopPropagation();
  const targetView = event.detail?.id;
  if (!VIEW_DEFINITIONS[targetView]) return;
  setView(targetView);
  await refreshCurrentView();
}

async function onBreadcrumbNavigate(event) {
  const href = String(event.detail?.href || '');
  const raw = href.startsWith('#') ? href.slice(1) : href;
  if (!raw) return;

  // Dirty-state guard when leaving the builder in edit mode
  if (state.currentView === 'builder' && state.builder.editMode?.isEdit && builderIsDirty()) {
    if (!window.confirm('Discard unsaved changes to this automation?')) {
      return;
    }
    state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
  }

  // Composite target: `library-detail:<automationId>`
  if (raw.startsWith('library-detail:')) {
    const automationId = raw.slice('library-detail:'.length);
    if (automationId) {
      await gotoLibraryDetail(automationId);
    }
    return;
  }

  if (!VIEW_DEFINITIONS[raw]) return;
  if (state.currentView === 'connector-detail' && raw === 'connectors') {
    clearSelectedConnector();
  }
  setView(raw);
  await refreshCurrentView();
}

function onSidebarUserAction(event) {
  event.stopPropagation();
  // The sidebar's [data-user-action] click handler calls preventDefault on
  // <a> tags so the host SPA's router can take over. Sub-apps don't have a
  // router, so we navigate manually when the event carries an href. Only
  // 'signout' uses an action (so we can run the logout sequence — clear
  // token, stop timers — before redirecting); everything else is a host
  // page and just needs window.location.href.
  const detail = event && event.detail;
  if (!detail) return;
  if (detail.action === 'signout') {
    onLogout();
    return;
  }
  if (detail.href) {
    window.location.href = detail.href;
  }
}

function syncSidebarActive() {
  if (els.sidebar) {
    els.sidebar.activeId = state.currentView;
  }
  if (els.shell) {
    els.shell.activeNavId = state.currentView;
  }
}

function getTemplateLibrary() {
  if (!state.templates.length) return TEMPLATE_LIBRARY;
  const loadedIds = new Set(state.templates.map((template) => template.id));
  const merged = [...state.templates];
  for (const template of TEMPLATE_LIBRARY) {
    if (!loadedIds.has(template.id)) {
      merged.push(template);
    }
  }
  return merged;
}

async function refreshCurrentView() {
  if (!state.token) return;

  switch (state.currentView) {
    case 'home':
      // Also refresh installed connectors so the "N ready connectors" badge
      // on the home screen stays in sync with the Connectors view (both reads
      // from state.connectorIndex via countReadyConnectors).
      await Promise.all([
        loadDashboard(),
        loadTemplates(),
        loadAutomations(),
        loadHomeRecentRuns(),
        loadConnectors(),
        loadInstalledConnectors(),
        loadConnectorHealth()
      ]);
      rebuildConnectorIndex();
      await loadOnboardingState();
      break;
    case 'connectors':
      await Promise.all([
        loadConnectors(),
        loadConnectorHealth(),
        loadInstalledConnectors(),
        loadUserProfile()
      ]);
      rebuildConnectorIndex();
      break;
    case 'connector-detail':
      await Promise.all([
        loadConnectors(),
        loadInstalledConnectors(),
        loadUserProfile()
      ]);
      rebuildConnectorIndex();
      break;
    case 'library':
      await Promise.all([loadTemplates(), loadAutomations()]);
      break;
    case 'library-detail': {
      const automationId = state.libraryDetail?.automationId;
      if (automationId) {
        try {
          await loadLibraryDetailAutomation(createContext(), automationId);
          // GAP #1: auto-load attachments if settings tab is active and not yet loaded
          const ld = state.libraryDetail;
          if (ld && ld.activeTab === 'settings' && ld.matterAttachments === null && !ld.matterAttachmentsLoading) {
            await loadMatterAttachments(createContext(), automationId);
          }
        } catch (err) {
          flash(err.message || 'Failed to load automation.', true);
        }
      }
      break;
    }
    case 'builder':
      await Promise.all([loadTemplates(), loadAutomations(), loadConnectors(), loadConnectorHealth(), loadMatters()]);
      await loadOnboardingState();
      break;
    case 'runs':
      await loadRuns();
      break;
    case 'approvals':
      await loadApprovals();
      break;
    default:
      break;
  }

  restoreOnboardingDraft();
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.token) return;

  const focusSnapshot = captureFocusSnapshot(els.viewContent);
  const context = createContext();

  if (state.currentView === 'home') {
    renderHome(context);
    configureHomeComposer();
  }
  if (state.currentView === 'connectors') renderConnectors(context);
  if (state.currentView === 'connector-detail') renderConnectorDetail(context);
  if (state.currentView === 'library') renderLibrary(context);
  if (state.currentView === 'library-detail') renderLibraryDetail(context);
  if (state.currentView === 'builder') renderBuilder(context);
  if (state.currentView === 'runs') renderRuns(context);
  if (state.currentView === 'approvals') renderApprovals(context);

  restoreFocusSnapshot(els.viewContent, focusSnapshot);
}

/**
 * Capture identity + selection of the currently focused form element so we
 * can restore it after a re-render. Without this, every keystroke in a
 * `data-filter-field` / `data-builder-field` input bounces focus to <body>
 * because the `input` event triggers `renderCurrentView()`, which wipes and
 * rebuilds `#view-content`.
 *
 * The snapshot uses stable selectors (id > data-* pair > name) rather than
 * referencing the old DOM node directly, because the node itself is gone
 * after the re-render — we need to look up its replacement in the new tree.
 */
function captureFocusSnapshot(container) {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!active || !container || !container.contains(active)) return null;

  const tag = active.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return null;

  const selector = buildStableSelector(active);
  if (!selector) return null;

  const snapshot = {
    selector,
    scrollTop: active.scrollTop || 0,
    scrollLeft: active.scrollLeft || 0
  };

  // `selectionStart` is meaningful only on text-like inputs and textareas.
  // Reading it on type="number"/"email"/"url"/etc. throws in some browsers.
  if (tag === 'TEXTAREA' || (tag === 'INPUT' && isSelectableInputType(active.type))) {
    try {
      snapshot.selectionStart = active.selectionStart;
      snapshot.selectionEnd = active.selectionEnd;
      snapshot.selectionDirection = active.selectionDirection || 'none';
    } catch (_error) {
      // Some input types throw on access — ignore and skip cursor restore.
    }
  }

  return snapshot;
}

function isSelectableInputType(type) {
  if (!type) return true; // default is 'text'
  return ['text', 'search', 'tel', 'url', 'password'].includes(type);
}

function buildStableSelector(el) {
  const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape
    : (value) => String(value).replace(/["\\]/g, '\\$&');

  if (el.id) {
    return `#${esc(el.id)}`;
  }

  // Filter inputs: keyed on (viewKey, field)
  const filterView = el.dataset.filterView;
  const filterField = el.dataset.filterField;
  if (filterView && filterField) {
    return `[data-filter-view="${esc(filterView)}"][data-filter-field="${esc(filterField)}"]`;
  }

  // Builder top-level fields
  const builderField = el.dataset.builderField;
  if (builderField) {
    return `[data-builder-field="${esc(builderField)}"]`;
  }

  // Builder per-action config fields, keyed on (actionIndex, fieldName)
  const actionIndex = el.dataset.actionIndex;
  const actionField = el.dataset.actionField;
  if (actionIndex != null && actionField) {
    return `[data-action-index="${esc(actionIndex)}"][data-action-field="${esc(actionField)}"]`;
  }

  const overdueField = el.dataset.overdueField;
  if (overdueField) {
    const selectors = [`[data-overdue-field="${esc(overdueField)}"]`];
    if (el.dataset.overdueBucketIndex != null) {
      selectors.push(`[data-overdue-bucket-index="${esc(el.dataset.overdueBucketIndex)}"]`);
    }
    if (el.dataset.overdueBucketKey) {
      selectors.push(`[data-overdue-bucket-key="${esc(el.dataset.overdueBucketKey)}"]`);
    }
    if (el.dataset.overdueStageKey) {
      selectors.push(`[data-overdue-stage-key="${esc(el.dataset.overdueStageKey)}"]`);
    }
    return selectors.join('');
  }

  if (el.name) {
    return `[name="${esc(el.name)}"]`;
  }

  return null;
}

function restoreFocusSnapshot(container, snapshot) {
  if (!snapshot || !container) return;
  const next = container.querySelector(snapshot.selector);
  if (!next) return;

  try {
    next.focus({ preventScroll: true });
  } catch (_error) {
    return;
  }

  if (typeof next.scrollTop === 'number') {
    next.scrollTop = snapshot.scrollTop || 0;
    next.scrollLeft = snapshot.scrollLeft || 0;
  }

  if (snapshot.selectionStart != null && typeof next.setSelectionRange === 'function') {
    try {
      next.setSelectionRange(
        snapshot.selectionStart,
        snapshot.selectionEnd,
        snapshot.selectionDirection || 'none'
      );
    } catch (_error) {
      // Non-selectable input types throw — cursor position isn't meaningful.
    }
  }
}

async function onLogout() {
  if (state._isLoggingOut) return;
  state._isLoggingOut = true;
  try {
    if (state.token) {
      await fetchJson('/api/auth/logout', {
        method: 'POST',
        headers: authHeaders()
      });
    }
  } catch (error) {
    console.warn(error);
  }

  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
  window.clearTimeout(state._onboardingSaveTimer);
  stopAuthLifecycle();
  state.token = '';
  state.user = null;
  state.dashboard = null;
  state._isLoggingOut = false;
  showLogin();
}

async function tryResumeSession() {
  try {
    const payload = await fetchJson('/api/auth/me', {
      headers: authHeaders()
    });
    if (!payload || !payload.user) return false;

    const user = payload.user;
    state.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name || user.firstName || '',
      lastName: user.last_name || user.lastName || '',
      organizationId: user.organization_id || user.organizationId || ''
    };

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(state.user));
      if (state.token) {
        localStorage.setItem(STORAGE_KEYS.token, state.token);
      }
    }

    startAuthLifecycle();
    showApp();
    await bootstrapApp();
    return true;
  } catch (_error) {
    return false;
  }
}

async function onAppClick(event) {
  if (event.target.closest('[data-connector-import-close]') || event.target.closest('[data-connector-import-overlay]')) {
    closeConnectorImportModal();
    return;
  }

  if (event.target.closest('[data-connector-confirm-close]') || event.target.closest('[data-connector-confirm-overlay]')) {
    closeConnectorConfirmModal();
    return;
  }

  if (event.target.closest('[data-add-instance-close]') || event.target.closest('[data-add-instance-overlay]')) {
    closeAddInstanceModal();
    return;
  }

  if (event.target.closest('[data-check-data-modal-close]') || event.target.closest('[data-check-data-modal-overlay]')) {
    closeCheckDataModal();
    return;
  }

  if (event.target.closest('[data-check-data-go]')) {
    closeCheckDataModal();
    setView('connectors');
    await refreshCurrentView();
    return;
  }

  if (event.target.closest('[data-template-modal-close]') || event.target.closest('[data-template-modal-overlay]')) {
    closeTemplateModal();
    return;
  }

  const tryTemplateButton = event.target.closest('[data-template-try]');
  if (tryTemplateButton) {
    const templateId = tryTemplateButton.dataset.templateId;
    closeTemplateModal();
    gotoBuilder(templateId);
    return;
  }

  const navButton = event.target.closest('[data-open-view]');
  if (navButton) {
    setView(navButton.dataset.openView);
    await refreshCurrentView();
    return;
  }

  // Pin toggle must run before the open-connector check, because the pin
  // button lives inside a <tr> that also carries data-open-connector-detail.
  const pinEl = event.target.closest('[data-connector-pin]');
  if (pinEl) {
    event.preventDefault();
    event.stopPropagation();
    const id = pinEl.dataset.connectorPin;
    if (id) {
      toggleConnectorPin(id);
    }
    return;
  }

  // Add Instance — same story: the button lives inside a row that carries
  // data-open-connector-detail, so it must be checked first to prevent the
  // click from falling through to opening the current instance.
  const addInstanceEl = event.target.closest('[data-connector-add-instance]');
  if (addInstanceEl) {
    event.preventDefault();
    event.stopPropagation();
    const slug = addInstanceEl.dataset.connectorAddInstance;
    if (slug) {
      openAddInstanceModal(slug);
    }
    return;
  }

  // Update connector — opens the import modal pre-scoped to this connector
  // kind so the backend rejects a mismatched ZIP.
  const updateConnectorEl = event.target.closest('[data-connector-update]');
  if (updateConnectorEl) {
    event.preventDefault();
    event.stopPropagation();
    const slug = updateConnectorEl.dataset.connectorUpdate;
    const name = updateConnectorEl.dataset.connectorUpdateName || slug;
    if (slug) {
      openConnectorImportModal({
        targetConnectorId: slug,
        targetConnectorName: name
      });
    }
    return;
  }

  // GAP #3: Re-auth banner — "Re-authorize" button opens connector detail (OAuth flow)
  const reauthEl = event.target.closest('[data-connector-reauth]');
  if (reauthEl) {
    const connectorId = reauthEl.dataset.connectorReauth;
    if (connectorId) {
      openConnectorInLanaClient(connectorId);
    }
    return;
  }

  // GAP #3: Re-auth banner — "Dismiss" button
  const dismissReauthEl = event.target.closest('[data-dismiss-reauth-banner]');
  if (dismissReauthEl) {
    const slug = dismissReauthEl.dataset.dismissReauthBanner;
    if (slug) {
      if (!Array.isArray(state.dismissedReauthBanners)) state.dismissedReauthBanners = [];
      if (!state.dismissedReauthBanners.includes(slug)) {
        state.dismissedReauthBanners.push(slug);
      }
      renderCurrentView();
    }
    return;
  }

  const openConnectorEl = event.target.closest('[data-open-connector-detail]');
  if (openConnectorEl) {
    const id = openConnectorEl.dataset.openConnectorDetail;
    if (id) {
      openConnectorInLanaClient(id);
    }
    return;
  }

  const connectorActionEl = event.target.closest('[data-connector-action]');
  if (connectorActionEl) {
    const action = connectorActionEl.dataset.connectorAction;
    const targetId = connectorActionEl.dataset.connectorId
      || state.connectorDetail.selectedId
      || null;
    await handleConnectorAction(action, targetId);
    return;
  }

  // GAP #10: Load integration sources for a connector (lazy)
  const loadSourcesEl = event.target.closest('[data-connector-load-sources]');
  if (loadSourcesEl) {
    const slug = loadSourcesEl.dataset.connectorLoadSources;
    if (slug) {
      await handleLoadConnectorSources(slug);
    }
    return;
  }

  // GAP #10: Set integration source as default
  const setDefaultEl = event.target.closest('[data-connector-set-default]');
  if (setDefaultEl) {
    const sourceId = setDefaultEl.dataset.connectorSetDefault;
    if (sourceId) {
      await handleSetConnectorDefault(sourceId);
    }
    return;
  }

  const templateButton = event.target.closest('[data-template-id]');
  if (templateButton) {
    openTemplateModal(templateButton.dataset.templateId);
    return;
  }

  const homeRunButton = event.target.closest('[data-home-run-automation-id]');
  if (homeRunButton) {
    event.preventDefault();
    event.stopPropagation();
    const automationId = homeRunButton.dataset.homeRunAutomationId;
    if (automationId) {
      await runAutomationFromHome(automationId);
    }
    return;
  }

  const checkDataButton = event.target.closest('[data-template-check-data]');
  if (checkDataButton) {
    openCheckDataModal(checkDataButton.dataset.templateCheckData);
    return;
  }

  const openEventBrowserButton = event.target.closest('[data-open-event-browser]');
  if (openEventBrowserButton && window.LanaEventBrowser) {
    event.preventDefault();
    event.stopPropagation();
    const triggerSelect = document.getElementById('builder-trigger');
    const currentValue = triggerSelect ? triggerSelect.value : (openEventBrowserButton.dataset.eventBrowserCurrent || '');
    window.LanaEventBrowser.open({
      currentValue,
      onSelect: (eventType) => {
        if (triggerSelect) {
          triggerSelect.value = eventType;
          triggerSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
    return;
  }

  // Library-detail internal event delegation — runs before the row-level
  // open-detail handler so inner buttons don't bubble into detail navigation.
  // The edit button returns false from handleLibraryDetailClick so it falls
  // through to the gotoBuilder handler below.
  if (state.currentView === 'library-detail') {
    const handled = await handleLibraryDetailClick(createContext(), event);
    if (handled) return;
  }

  // Edit button inside library-detail header — opens builder in edit mode.
  const editAutomationEl = event.target.closest('[data-ld-edit-automation]');
  if (editAutomationEl) {
    const automationId = editAutomationEl.dataset.ldEditAutomation;
    if (automationId) {
      gotoBuilder(undefined, automationId);
    }
    return;
  }

  // .automation-toggle must come BEFORE the row-level open-detail handler so
  // the deactivate/activate button inside the list item row doesn't also
  // trigger detail navigation.
  const activateButton = event.target.closest('.automation-toggle');
  if (activateButton) {
    await toggleAutomation(createContext(), activateButton.dataset.automationId, activateButton.dataset.enabled === 'true');
    return;
  }

  // Open library detail view when clicking an automation row.
  const openDetailEl = event.target.closest('[data-open-library-detail]');
  if (openDetailEl) {
    const automationId = openDetailEl.dataset.openLibraryDetail;
    if (automationId) {
      await gotoLibraryDetail(automationId);
    }
    return;
  }


  if (event.target.closest('#reset-builder-btn')) {
    const context = createContext();
    // In edit mode, confirm before replacing the loaded config with a template
    if (state.builder.editMode?.isEdit) {
      if (!window.confirm('Replace current configuration with a Quick Start template? Unsaved changes will be lost.')) {
        return;
      }
      // Clear edit mode since user is explicitly starting fresh from a template
      state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
    }
    applyTemplate(context, getSelectedTemplate(context));
    renderBuilder(context);
    return;
  }

  if (event.target.closest('#create-automation-btn')) {
    state.builder.publishModalOpen = false;
    await createAutomation(createContext());
    return;
  }

  // Cancel button in edit mode — navigate back to library without saving
  const cancelEditBtn = event.target.closest('[data-builder-cancel-edit]');
  if (cancelEditBtn) {
    const automationId = cancelEditBtn.dataset.editAutomationId || null;
    if (state.builder.editMode?.isEdit && builderIsDirty()) {
      if (!window.confirm('Discard unsaved changes to this automation?')) {
        return;
      }
    }
    state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
    setView('library');
    await refreshCurrentView();
    return;
  }

  if (event.target.closest('[data-open-publish-modal]')) {
    state.builder.publishModalOpen = true;
    renderBuilder(createContext());
    return;
  }

  // Activate/Deactivate from the builder edit banner
  const builderToggleActiveBtn = event.target.closest('[data-builder-toggle-active]');
  if (builderToggleActiveBtn) {
    const automationId = builderToggleActiveBtn.dataset.editAutomationId;
    const isEnabled = builderToggleActiveBtn.dataset.currentEnabled === 'true';
    if (!automationId) return;
    try {
      await fetchJson(`/api/automations/${encodeURIComponent(automationId)}/${isEnabled ? 'deactivate' : 'activate'}`, {
        method: 'POST',
        headers: authHeaders()
      });
      const editMode = state.builder.editMode;
      if (editMode?.originalAutomation) {
        editMode.originalAutomation.is_enabled = !isEnabled;
      }
      state.builder.publishMode = !isEnabled ? 'enabled' : 'disabled';
      await loadAutomations();
      renderCurrentView();
      flash(`Automation ${isEnabled ? 'deactivated' : 'activated'}.`);
    } catch (err) {
      flash(err.message || 'Failed to toggle activation.', true);
    }
    return;
  }

  // Delete from the builder edit banner
  const builderDeleteBtn = event.target.closest('[data-builder-delete]');
  if (builderDeleteBtn) {
    const automationId = builderDeleteBtn.dataset.editAutomationId;
    const automationName = builderDeleteBtn.dataset.editAutomationName || 'this automation';
    if (!automationId) return;
    if (!window.confirm(`Delete "${automationName}"? This cannot be undone.`)) return;
    try {
      await fetchJson(`/api/v1/automations/${encodeURIComponent(automationId)}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      await loadAutomations();
      state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
      flash('Automation deleted.');
      setView('library');
      await refreshCurrentView();
    } catch (err) {
      flash(err.message || 'Failed to delete automation.', true);
    }
    return;
  }

  if (event.target.closest('[data-close-publish-modal]')) {
    state.builder.publishModalOpen = false;
    renderBuilder(createContext());
    return;
  }

  if (event.target.closest('[data-app-action="refresh-connector-health"]')) {
    await refreshConnectorHealth();
    return;
  }

  if (event.target.closest('[data-app-action="hide-connectors-checklist"]')) {
    state.connectorsChecklistHidden = true;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.connectorsChecklistHidden, '1');
    }
    renderCurrentView();
    return;
  }

  if (event.target.closest('[data-app-action="validate-builder"]')) {
    validateBuilder(createContext());
    return;
  }

  const connectorsPageButton = event.target.closest('[data-connectors-page]');
  if (connectorsPageButton) {
    const page = parseInt(connectorsPageButton.dataset.connectorsPage, 10);
    if (Number.isFinite(page) && state.filters.connectors) {
      state.filters.connectors.page = page;
      renderCurrentView();
    }
    return;
  }

  const runsPageButton = event.target.closest('[data-runs-page]');
  if (runsPageButton) {
    const page = parseInt(runsPageButton.dataset.runsPage, 10);
    if (Number.isFinite(page) && state.filters.runs) {
      state.filters.runs.page = page;
      await loadRuns();
      renderCurrentView();
    }
    return;
  }

  const runsSortButton = event.target.closest('[data-runs-sort]');
  if (runsSortButton && state.filters.runs) {
    const field = runsSortButton.dataset.runsSort;
    if (!field) return;
    if (state.filters.runs.sortBy === field) {
      state.filters.runs.sortDir = state.filters.runs.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.filters.runs.sortBy = field;
      state.filters.runs.sortDir = 'asc';
    }
    state.filters.runs.page = 1;
    await loadRuns();
    renderCurrentView();
    return;
  }

  if (event.target.closest('[data-run-matter-link]')) {
    return;
  }

  const openRunDetailButton = event.target.closest('[data-open-run-detail]');
  if (openRunDetailButton) {
    await loadRunDetail(openRunDetailButton.dataset.openRunDetail);
    renderCurrentView();
    return;
  }

  if (event.target.closest('[data-close-run-detail]')) {
    state.selectedRunId = null;
    state.selectedRunDetail = null;
    state.selectedRunArtifactId = null;
    state.selectedRunArtifactDetail = null;
    state.selectedRunArtifactLoading = false;
    renderCurrentView();
    return;
  }

  const runArtifactViewButton = event.target.closest('[data-run-artifact-view]');
  if (runArtifactViewButton) {
    await loadRunArtifact(runArtifactViewButton.dataset.runArtifactView);
    return;
  }

  const runArtifactWorkspaceButton = event.target.closest('[data-run-artifact-open-workspace]');
  if (runArtifactWorkspaceButton) {
    openWorkspaceResourceUrl(runArtifactWorkspaceButton.dataset.runArtifactOpenWorkspace || '');
    return;
  }

  const runArtifactDownloadButton = event.target.closest('[data-run-artifact-download]');
  if (runArtifactDownloadButton) {
    const artifactId = runArtifactDownloadButton.dataset.runArtifactDownload;
    if (artifactId) {
      window.open(
        getApiUrl(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}/download`),
        '_blank',
        'noopener,noreferrer'
      );
    }
    return;
  }

  if (event.target.closest('[data-close-run-artifact-preview]')) {
    state.selectedRunArtifactId = null;
    state.selectedRunArtifactDetail = null;
    state.selectedRunArtifactLoading = false;
    renderCurrentView();
    return;
  }

  const runControlButton = event.target.closest('[data-run-action][data-run-id]');
  if (runControlButton) {
    await controlRunExecution(runControlButton.dataset.runId, runControlButton.dataset.runAction);
    return;
  }

  if (event.target.closest('[data-close-approval-detail]')) {
    state.selectedApprovalId = null;
    state.selectedApprovalDetail = null;
    renderCurrentView();
    return;
  }

  const approvalActionButton = event.target.closest('[data-approval-action][data-approval-id]');
  if (approvalActionButton) {
    const drawer = approvalActionButton.closest('[data-approval-detail-drawer]');
    const comment = drawer?.querySelector('[data-approval-comment]')?.value || '';
    await decideApproval(
      approvalActionButton.dataset.approvalId,
      approvalActionButton.dataset.approvalAction,
      comment
    );
    return;
  }

  const libraryPageButton = event.target.closest('[data-library-page]');
  if (libraryPageButton) {
    const page = parseInt(libraryPageButton.dataset.libraryPage, 10);
    if (Number.isFinite(page) && state.filters.library) {
      state.filters.library.page = page;
      renderCurrentView();
    }
    return;
  }

  const connectorsSortButton = event.target.closest('[data-connectors-sort]');
  if (connectorsSortButton && state.filters.connectors) {
    const field = connectorsSortButton.dataset.connectorsSort;
    if (!field) return;
    if (state.filters.connectors.sortBy === field) {
      state.filters.connectors.sortDir = state.filters.connectors.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.filters.connectors.sortBy = field;
      state.filters.connectors.sortDir = 'asc';
    }
    state.filters.connectors.page = 1;
    renderCurrentView();
    return;
  }

  if (event.target.closest('[data-design-generate]')) {
    await generateAutomationDesign(createContext());
    return;
  }

  const addActionButton = event.target.closest('[data-add-action-type]');
  if (addActionButton) {
    addBuilderAction(createContext(), addActionButton.dataset.addActionType);
    renderBuilder(createContext());
    return;
  }

  const overdueSelectButton = event.target.closest('[data-overdue-select-cell]');
  if (overdueSelectButton) {
    const bucketKey = overdueSelectButton.dataset.overdueBucketKey;
    const stageKey = overdueSelectButton.dataset.overdueStageKey;
    if (bucketKey && stageKey) {
      selectOverdueReminderCell(createContext(), bucketKey, stageKey);
      renderBuilder(createContext());
      scheduleOnboardingSave();
    }
    return;
  }

  if (event.target.closest('[data-overdue-reset-defaults]')) {
    resetOverdueReminderMatrix(createContext());
    renderBuilder(createContext());
    scheduleOnboardingSave();
    return;
  }

  const removeActionButton = event.target.closest('[data-remove-action-index]');
  if (removeActionButton) {
    removeBuilderAction(createContext(), removeActionButton.dataset.removeActionIndex);
    renderBuilder(createContext());
    return;
  }

  const configureActionButton = event.target.closest('[data-configure-action-index]');
  if (configureActionButton) {
    selectBuilderAction(createContext(), configureActionButton.dataset.configureActionIndex);
    renderBuilder(createContext());
    return;
  }

  if (event.target.closest('[data-close-action-config]')) {
    selectBuilderAction(createContext(), null);
    renderBuilder(createContext());
    return;
  }

  const builderStepButton = event.target.closest('[data-builder-step]');
  if (builderStepButton) {
    state.builderStep = clampBuilderStep(parseInt(builderStepButton.dataset.builderStep, 10), 5);
    renderBuilder(createContext());
  }
}

function waitForNextPaint(minDelayMs = 120) {
  return new Promise((resolve) => {
    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => setTimeout(callback, 16);

    schedule(() => {
      setTimeout(resolve, minDelayMs);
    });
  });
}

async function showLibraryLoadingState() {
  const token = Date.now();
  state.libraryLoadingToken = token;
  state.libraryLoading = true;
  renderCurrentView();

  await waitForNextPaint(180);

  if (state.libraryLoadingToken !== token) return;
  state.libraryLoading = false;
  renderCurrentView();
}

async function onAppInput(event) {
  // "Build with Lana" description — store without re-rendering so the textarea
  // keeps focus while typing (re-render wipes and rebuilds the DOM).
  const designPromptField = event.target.closest('[data-design-prompt]');
  if (designPromptField) {
    state.builder.designPrompt = designPromptField.value;
    return;
  }

  const overdueField = event.target.closest('[data-overdue-field]');
  if (overdueField) {
    updateOverdueReminderField(createContext(), overdueField);
    renderBuilder(createContext());
    scheduleOnboardingSave();
    return;
  }

  // Inline visibility selector in the builder edit page — PATCH immediately
  const builderVisibilityField = event.target.closest('[data-builder-visibility]');
  if (builderVisibilityField && event.type === 'change') {
    const automationId = builderVisibilityField.dataset.editAutomationId;
    const nextVisibility = builderVisibilityField.value;
    if (!automationId) return;
    try {
      await fetchJson(`/api/v1/automations/${encodeURIComponent(automationId)}/visibility`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: nextVisibility })
      });
      const editMode = state.builder.editMode;
      if (editMode?.originalAutomation) {
        editMode.originalAutomation.visibility = nextVisibility;
      }
      flash(`Visibility changed to ${nextVisibility === 'org_wide' ? 'Organization-Wide' : 'Private'}.`);
    } catch (err) {
      flash(err.message || 'Failed to update visibility.', true);
    }
    return;
  }

  const builderField = event.target.closest('[data-builder-field]');
  if (builderField) {
    const fieldName = builderField.dataset.builderField;
    state.builder[fieldName] = builderField.value;

    if (fieldName === 'scopeType') {
      if (builderField.value !== 'matter') {
        state.builder.matterId = '';
      } else if (!state.builder.matterId && state.matters.length) {
        state.builder.matterId = state.matters[0].matter_id || state.matters[0].id;
      }
    }

    if (fieldName === 'triggerMode') {
      const triggerOptions = builderField.value === 'scheduled'
        ? ['schedule.daily', 'schedule.weekly']
        : ['document.uploaded', 'connector.synced'];
      if (!triggerOptions.includes(state.builder.triggerEvent)) {
        state.builder.triggerEvent = triggerOptions[0];
      }
      syncBuilderJson(createContext());
      renderCurrentView();
      scheduleOnboardingSave();
      return;
    }

    if (fieldName === 'triggerEvent') {
      state.builder.triggerMode = String(builderField.value).startsWith('schedule.') ? 'scheduled' : 'event';
    }

    if (fieldName !== 'customJson' && fieldName !== 'matterSearch') {
      syncBuilderJson(createContext());
      const jsonField = document.getElementById('builder-json');
      if (jsonField && jsonField !== builderField) {
        jsonField.value = state.builder.customJson;
      }
    }

    if (fieldName === 'scopeType' || fieldName === 'matterId' || fieldName === 'matterSearch' || event.type === 'change') {
      renderCurrentView();
    }

    scheduleOnboardingSave();
    return;
  }

  const actionField = event.target.closest('[data-action-field]');
  if (actionField) {
    const result = updateBuilderAction(
      createContext(),
      actionField.dataset.actionIndex,
      actionField.dataset.actionField,
      actionField.value
    );
    if (!result.ok) {
      flash(result.error || 'Unable to update step config.', true);
      return;
    }
    if (actionField.dataset.actionField !== 'config_json') {
      renderBuilder(createContext());
    }
    return;
  }

  const filterField = event.target.closest('[data-filter-view][data-filter-field]');
  if (filterField) {
    const { filterView, filterField: key } = filterField.dataset;
    if (state.filters[filterView]) {
      const nextValue = (key === 'page' || key === 'perPage')
        ? parseInt(filterField.value, 10)
        : filterField.value;
      state.filters[filterView][key] = Number.isNaN(nextValue) ? filterField.value : nextValue;
      if ((filterView === 'connectors' || filterView === 'library' || filterView === 'runs') && key !== 'page') {
        state.filters[filterView].page = 1;
      }
      if (filterView === 'runs') {
        loadRuns()
          .then(() => renderCurrentView())
          .catch((error) => flash(error.message || 'Failed to refresh runs.', true));
        return;
      }
      if (filterView === 'library') {
        await showLibraryLoadingState();
        return;
      }
      renderCurrentView();
    }
  }
}

/**
 * Navigate to the builder view.
 *
 * @param {string} [templateId]  - When set, apply this template (create mode).
 * @param {string} [automationId]     - When set, load an existing automation for editing.
 *                                  Takes precedence over templateId.
 */
function gotoBuilder(templateId, automationId) {
  const context = createContext();

  if (automationId) {
    // Edit mode — reset to a clean base state first, then load automation async.
    // editMode.loading is set inside loadAutomationForEdit before the first render.
    state.builder = createBuilderState(null, state.matters);
    state.builder.editMode = { isEdit: false, automationId, originalAutomation: null, loading: true };
    state.builderStep = 1;
    state.builder.publishModalOpen = false;
    setView('builder');
    // Load automation asynchronously; loadAutomationForEdit calls renderCurrentView when done.
    loadAutomationForEdit(createContext(), automationId);
    return;
  }

  if (templateId) {
    const template = getTemplateLibrary().find((entry) => entry.id === templateId);
    applyTemplate(context, template);
  } else {
    // Fresh create — reset to default-template builder state so prior edit data
    // (name, description, JSON config, scope, etc.) doesn't carry over.
    applyTemplate(context, getTemplateLibrary()[0]);
  }
  state.builderStep = 1;
  // Ensure editMode is clean for create flow
  state.builder.editMode = { isEdit: false, automationId: null, originalAutomation: null, loading: false };
  state.builder.publishModalOpen = false;
  setView('builder');
  renderCurrentView();
}

/**
 * Navigate to the library-detail view for the given automation.
 * Resets libraryDetail state, loads the automation, then optionally loads runs.
 *
 * @param {string} automationId
 */
async function gotoLibraryDetail(automationId) {
  if (!automationId) return;
  state.libraryDetail = createLibraryDetailState(automationId);
  setView('library-detail');
  renderCurrentView();
  try {
    await loadLibraryDetailAutomation(createContext(), automationId);
  } catch (err) {
    flash(err.message || 'Failed to load automation.', true);
  }
  renderCurrentView();
}

/**
 * Returns true when the builder JSON has diverged from the original automation's
 * config (i.e., the user has unsaved changes in edit mode).
 * Always returns false in create mode (there is nothing to compare against).
 *
 * @returns {boolean}
 */
function builderIsDirty() {
  if (!state.builder.editMode?.isEdit) return false;
  const original = state.builder.editMode.originalAutomation;
  if (!original) return false;
  try {
    const originalJson = JSON.stringify(original.automation_config || original.config || {}, null, 2);
    return state.builder.customJson !== originalJson;
  } catch (_err) {
    return false;
  }
}

function openTemplateModal(templateId) {
  const template = getTemplateLibrary().find((entry) => entry.id === templateId);
  if (!template || !els.templateModal) {
    gotoBuilder(templateId);
    return;
  }

  const steps = buildTemplateSteps(template);
  const appTypes = resolveTemplateAppTypes(template);

  els.templateModalTitle.textContent = template.name || 'Automation Template';
  els.templateModalDescription.textContent = template.description || template.bestFor || 'Use this template to launch your workflow quickly.';
  els.templateModalRecommended.textContent = template.bestFor || 'Recommended for you';
  els.templateModalApps.innerHTML = appTypes.map((typeLabel) => `
    <span class="template-modal-app">${escapeHtml(typeLabel)}</span>
  `).join('');
  els.templateModalSteps.innerHTML = steps.map((step, index) => `
    <li>
      <span class="template-step-number">${index + 1}</span>
      <span class="template-step-text">${formatStepWithCode(step)}</span>
    </li>
  `).join('');
  els.templateModalTry.dataset.templateId = template.id;
  els.templateModalTry.textContent = 'Continue to Builder';

  els.templateModal.classList.remove('hidden');
}

function closeTemplateModal() {
  if (!els.templateModal) return;
  els.templateModal.classList.add('hidden');
}

function openCheckDataModal(templateId) {
  const template = getTemplateLibrary().find((entry) => entry.id === templateId);
  if (!template || !els.checkDataModal) {
    setView('connectors');
    refreshCurrentView();
    return;
  }

  els.checkDataModalDescription.textContent = `Before using "${template.name}", confirm that required connector sources are installed, authorized, and healthy.`;
  els.checkDataModalHints.innerHTML = (template.connectorHints || []).map((hint) => `
    <span class="template-modal-app">${escapeHtml(hint)}</span>
  `).join('');
  els.checkDataModalSteps.innerHTML = [
    `Verify connectors for ${template.trigger || template.defaults?.triggerEvent || 'the template trigger'}.`,
    'Confirm auth and runtime readiness for each source.',
    'Return to the template library and continue to Builder.'
  ].map((step, index) => `
    <li>
      <span class="template-step-number">${index + 1}</span>
      <span class="template-step-text">${escapeHtml(step)}</span>
    </li>
  `).join('');

  els.checkDataModal.classList.remove('hidden');
}

function closeCheckDataModal() {
  if (!els.checkDataModal) return;
  els.checkDataModal.classList.add('hidden');
}

function buildTemplateSteps(template) {
  if (Array.isArray(template.workflowSteps) && template.workflowSteps.length) {
    return template.workflowSteps;
  }

  const trigger = template.trigger || template.defaults?.triggerEvent || 'an event';
  const message = template.defaults?.message || template.description || 'Run the configured automation action.';
  const scopeHint = template.scopeHint || 'Choose matter or organization scope and publish.';

  return [
    `Listen for ${trigger}.`,
    message,
    scopeHint
  ];
}

function formatStepWithCode(step) {
  const text = String(step || '');
  const codeTokenPattern = /\b[a-z]+(?:\.[a-z_]+)+\b/g;
  const parts = [];
  let cursor = 0;
  let match;

  while ((match = codeTokenPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(escapeHtml(text.slice(cursor, match.index)));
    }
    parts.push(`<code>${escapeHtml(match[0])}</code>`);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)));
  }

  return parts.join('');
}

function resolveTemplateAppTypes(template) {
  const typeLabelMap = {
    crm: 'CRM',
    communication: 'Communication',
    document_storage: 'Document Storage',
    productivity: 'Productivity',
    accounting: 'Financial',
    financial: 'Financial',
    billing: 'Billing',
    case_management: 'Case Management'
  };

  const normalizedCategories = new Set(
    (state.connectors || [])
      .map((connector) => normalizeText(connector?.metadata?.category))
      .filter(Boolean)
  );

  const inferred = new Set();
  const hints = Array.isArray(template.connectorHints) ? template.connectorHints : [];
  const trigger = normalizeText(template.trigger || template.defaults?.triggerEvent);

  for (const hint of hints) {
    const text = normalizeText(hint);
    if (text.includes('crm') || text.includes('sales')) inferred.add('crm');
    if (text.includes('document')) inferred.add('document_storage');
    if (text.includes('matter') || text.includes('case')) inferred.add('case_management');
    if (text.includes('communication') || text.includes('email') || text.includes('message')) inferred.add('communication');
    if (text.includes('report') || text.includes('sheet') || text.includes('calendar') || text.includes('task')) inferred.add('productivity');
    if (text.includes('account') || text.includes('finance') || text.includes('billing')) inferred.add('financial');
    if (text.includes('billing')) inferred.add('billing');
  }

  if (trigger.includes('document')) inferred.add('document_storage');
  if (trigger.includes('connector')) inferred.add('crm');
  if (trigger.includes('schedule')) inferred.add('productivity');

  const picked = [];
  for (const category of inferred) {
    if (normalizedCategories.size === 0 || normalizedCategories.has(category)) {
      picked.push(category);
    }
  }

  if (!picked.length) {
    for (const category of normalizedCategories) {
      if (typeLabelMap[category]) picked.push(category);
      if (picked.length >= 4) break;
    }
  }

  if (!picked.length) {
    return ['CRM', 'Document Storage', 'Communication'];
  }

  return [...new Set(picked.map((category) => typeLabelMap[category] || category))]
    .slice(0, 4);
}

function onGlobalKeydown(event) {
  // Enter submits the Add Instance form when the key input is focused
  if (
    event.key === 'Enter' &&
    els.connectorAddInstanceModal &&
    !els.connectorAddInstanceModal.classList.contains('hidden') &&
    document.activeElement === els.connectorAddInstanceKey
  ) {
    event.preventDefault();
    submitAddInstance();
    return;
  }

  if (event.key !== 'Escape') return;
  if (els.connectorAddInstanceModal && !els.connectorAddInstanceModal.classList.contains('hidden')) {
    closeAddInstanceModal();
    return;
  }
  if (els.connectorImportModal && !els.connectorImportModal.classList.contains('hidden')) {
    closeConnectorImportModal();
    return;
  }
  if (els.connectorConfirmModal && !els.connectorConfirmModal.classList.contains('hidden')) {
    closeConnectorConfirmModal();
    return;
  }
  if (els.checkDataModal && !els.checkDataModal.classList.contains('hidden')) {
    closeCheckDataModal();
    return;
  }
  if (els.templateModal && !els.templateModal.classList.contains('hidden')) {
    closeTemplateModal();
  }
}

async function loadDashboard() {
  // The current Core API does not expose an automation dashboard endpoint.
  // Keep the state initialized without probing a missing route at startup.
  state.dashboard = null;
}

async function loadTemplates() {
  try {
    const payload = await fetchJson('/api/templates', {
      headers: authHeaders()
    });
    state.templates = (payload.templates || []).map(normalizeTemplate).filter(Boolean);
  } catch (error) {
    console.warn('Failed to load automation templates', error);
    state.templates = [];
  }
}

async function loadAutomations() {
  try {
    const [automationsPayload, actionsPayload] = await Promise.all([
      fetchJson('/api/automations?limit=100', { headers: authHeaders() }),
      fetchJson('/api/automation-actions?limit=200', { headers: authHeaders() })
    ]);

    state.automations = automationsPayload.automations || [];
    state.actionCatalog = actionsPayload.data || [];
  } catch (error) {
    console.warn('Failed to load automations', error);
    state.automations = [];
    state.actionCatalog = [];
  }
}

async function loadMatters() {
  const payload = await fetchJson('/api/matters?limit=50&sort_by=updated_at&sort_order=desc', {
    headers: authHeaders()
  });

  state.matters = payload.matters || [];

  if (state.builder.scopeType === 'matter' && !state.builder.matterId && state.matters.length) {
    state.builder.matterId = state.matters[0].matter_id || state.matters[0].id;
  }
}

async function loadRuns() {
  const runFilters = state.filters.runs || {};
  const query = new URLSearchParams();
  const page = Math.max(parseInt(runFilters.page, 10) || 1, 1);
  const perPage = Math.max(parseInt(runFilters.perPage, 10) || 25, 1);
  const offset = (page - 1) * perPage;
  const searchQuery = String(runFilters.query || '').trim();

  query.set('limit', String(perPage));
  query.set('offset', String(offset));
  if (runFilters.state && runFilters.state !== 'all') query.set('status', runFilters.state);
  if (searchQuery) query.set('query', searchQuery);
  if (runFilters.sortBy) query.set('sort_by', String(runFilters.sortBy));
  if (runFilters.sortDir) query.set('sort_dir', String(runFilters.sortDir));

  const payload = await fetchJson(`/api/executions?${query.toString()}`, {
    headers: authHeaders()
  });

  state.runs = payload.data || [];
  state.runsPagination = payload.pagination || {
    total: state.runs.length,
    limit: perPage,
    offset,
    has_more: false
  };

  if (state.selectedRunId) {
    const stillVisible = state.runs.some((run) => run.execution_id === state.selectedRunId);
    if (!stillVisible) {
      state.selectedRunId = null;
      state.selectedRunDetail = null;
      state.selectedRunArtifactId = null;
      state.selectedRunArtifactDetail = null;
      state.selectedRunArtifactLoading = false;
    }
  }
}

async function loadHomeRecentRuns() {
  const query = new URLSearchParams();
  query.set('limit', '10');
  query.set('offset', '0');
  query.set('sort_by', 'created_at');
  query.set('sort_dir', 'desc');

  try {
    const payload = await fetchJson(`/api/executions?${query.toString()}`, {
      headers: authHeaders()
    });
    state.homeRecentRuns = payload.data || payload.executions || [];
  } catch (error) {
    console.warn('[automation] Failed to load recent executions for Home.', error);
    state.homeRecentRuns = [];
  }
}

async function runAutomationFromHome(automationId) {
  const automation = state.automations.find((item) => {
    const id = item.automation_id || item.id;
    return String(id || '') === String(automationId);
  });
  const automationName = automation?.automation_name || automation?.name || 'Automation';

  state.homeRunBusyId = automationId;
  renderCurrentView();

  try {
    await fetchJson(`/api/v1/automations/${encodeURIComponent(automationId)}/execute`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    await recordAutomationTriggeredActivity(automation, automationId);
    await loadHomeRecentRuns();
    rememberHomeRecentRun(automationId, automationName);
    flash(`Triggered ${automationName}.`);
  } catch (error) {
    flash(error.message || 'Failed to trigger automation.', true);
  } finally {
    state.homeRunBusyId = null;
    renderCurrentView();
  }
}

function rememberHomeRecentRun(automationId, automationName) {
  const now = new Date().toISOString();
  state.homeRecentRuns = [
    {
      automation_id: automationId,
      automation_name: automationName,
      status: 'pending',
      created_at: now,
      started_at: now
    },
    ...(state.homeRecentRuns || []).filter((run) => {
      return String(run.automation_id || run.automationId || '') !== String(automationId);
    })
  ].slice(0, 10);
}

async function recordAutomationTriggeredActivity(automation, automationId) {
  const automationName = automation?.automation_name || automation?.name || 'Automation';

  try {
    await fetchJson('/api/v1/notifications/admin', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'info',
        title: 'Automation triggered',
        body: `${automationName} was started from LanaAutomate Home.`,
        action_url: 'automation/index.html#runs'
      })
    });
    await refreshNotificationBadge();
  } catch (error) {
    console.warn('[automation] Failed to record automation trigger notification.', error);
  }
}

async function refreshNotificationBadge() {
  try {
    const payload = await fetchJson('/api/v1/notifications/unread-count', {
      headers: authHeaders()
    });
    const count = Number(payload?.unread_count || payload?.count || 0);
    if (els.topbar) {
      els.topbar.notificationCount = count;
    }
  } catch (error) {
    console.warn('[automation] Failed to refresh notification badge.', error);
  }
}

async function loadRunDetail(executionId) {
  if (!executionId) return;
  const payload = await fetchJson(`/api/executions/${executionId}`, {
    headers: authHeaders()
  });
  state.selectedRunId = executionId;
  state.selectedRunDetail = payload || null;
  state.selectedRunArtifactId = null;
  state.selectedRunArtifactDetail = null;
  state.selectedRunArtifactLoading = false;
}

async function loadRunArtifact(artifactId) {
  if (!artifactId) return;
  state.selectedRunArtifactId = artifactId;
  state.selectedRunArtifactDetail = null;
  state.selectedRunArtifactLoading = true;
  renderCurrentView();

  try {
    const payload = await fetchJson(`/api/v1/automation/artifacts/${encodeURIComponent(artifactId)}`, {
      headers: authHeaders()
    });
    state.selectedRunArtifactDetail = payload?.data || payload || null;
  } catch (error) {
    state.selectedRunArtifactId = null;
    state.selectedRunArtifactDetail = null;
    flash(error.message || 'Failed to load artifact.', true);
  } finally {
    state.selectedRunArtifactLoading = false;
    renderCurrentView();
  }
}

async function controlRunExecution(executionId, action) {
  if (!executionId || !action) return;
  try {
    await fetchJson(`/api/executions/${executionId}/control`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ action })
    });
    await loadRuns();
    if (state.selectedRunId === executionId) {
      await loadRunDetail(executionId);
    }
    renderCurrentView();
    flash(`Run ${action} request submitted.`);
  } catch (error) {
    flash(error.message || `Failed to ${action} run.`, true);
  }
}

async function loadInstalledConnectors() {
  try {
    const payload = await fetchJson('/api/integrations/connectors', {
      headers: authHeaders()
    });
    const list = payload?.data || payload?.connectors || [];
    state.installedConnectors = list;
    console.log('[connectors] loadInstalledConnectors:', {
      rawPayload: payload,
      count: list.length,
      sample: list.slice(0, 3).map((c) => ({
        id: c.id,
        connector_type: c.connector_type,
        source_type: c.source_type,
        type: c.type,
        name: c.name,
        source_name: c.source_name,
        has_ui_entry_point: Boolean(c.ui_entry_point),
        ui_entry_point: c.ui_entry_point
      }))
    });
  } catch (error) {
    console.warn('[connectors] Failed to load installed connectors', error);
    state.installedConnectors = [];
  }
}

function rebuildConnectorIndex() {
  state.connectorIndex = indexConnectors(state.installedConnectors || []);
  console.log('[connectors] rebuildConnectorIndex:', {
    count: state.connectorIndex.length,
    withUiEntry: state.connectorIndex.filter((c) => c.ui_entry_point).length,
    summary: state.connectorIndex.map((c) => ({
      id: c.id,
      connector_type: c.connector_type,
      name: c.name,
      ui: Boolean(c.ui_entry_point),
      dash: Boolean(c.dashboard),
      system: Boolean(c.isSystem)
    }))
  });
}

function gotoConnectorDetail(connectorId) {
  if (!connectorId) return;
  state.connectorDetail.selectedId = connectorId;
  state.connectorDetail.error = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.selectedConnectorId, connectorId);
  }
  setView('connector-detail');
  refreshCurrentView();
}

/**
 * Open the given connector's management page in lana-client.
 *
 * The automation server mounts lana-client/src at /lex-framework on its
 * own origin, so we route to a same-origin URL under that mount. The
 * target page is lana-client's existing per-connector HTML, which is
 * already shell-embedded via chrome="embedded" with a back button.
 */
function openConnectorInLanaClient(connectorId) {
  if (!connectorId) return;

  const connector = findConnectorById(state.connectorIndex || [], connectorId)
    || findConnectorById(state.connectors || [], connectorId);

  const url = buildLanaClientConnectorUrl(connector);
  if (!url) {
    console.warn('[connectors] Unable to resolve connector for routing', { connectorId });
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Toggle a connector's pinned state. Pinned connectors always sort to
 * the top of the connectors list, regardless of the active sort field.
 * Persisted to localStorage so the pin survives reloads.
 */
function toggleConnectorPin(connectorId) {
  if (!connectorId) return;
  const current = Array.isArray(state.pinnedConnectors) ? state.pinnedConnectors : [];
  const idx = current.indexOf(connectorId);
  if (idx === -1) {
    state.pinnedConnectors = [...current, connectorId];
  } else {
    state.pinnedConnectors = current.filter((id) => id !== connectorId);
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEYS.pinnedConnectors, JSON.stringify(state.pinnedConnectors));
  }
  renderCurrentView();
}

function clearSelectedConnector() {
  state.connectorDetail.selectedId = null;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.selectedConnectorId);
  }
  teardownConnectorDetail();
}

async function handleConnectorAction(action, connectorId) {
  switch (action) {
    case 'back':
      clearSelectedConnector();
      setView('connectors');
      await refreshCurrentView();
      return;

    case 'open-import': {
      if (!hasAdminRole(createContext())) {
        flash('You do not have permission to import connectors.', true);
        return;
      }
      openConnectorImportModal();
      return;
    }

    case 'retry-ui':
      renderCurrentView();
      return;

    case 'use-in-builder': {
      if (connectorId) {
        state.builder.preferredConnectorId = connectorId;
      }
      setView('builder');
      await refreshCurrentView();
      return;
    }

    case 'uninstall':
      openConnectorConfirmModal('uninstall', connectorId);
      return;

    case 'delete':
      openConnectorConfirmModal('delete', connectorId);
      return;

    case 'confirm-cancel':
      closeConnectorConfirmModal();
      return;

    case 'confirm-submit':
      await submitConnectorConfirm();
      return;

    case 'import-close':
      closeConnectorImportModal();
      return;

    case 'import-clear':
      clearConnectorImportFile();
      return;

    case 'import-submit':
      await submitConnectorImport();
      return;

    case 'add-instance-close':
      closeAddInstanceModal();
      return;

    case 'add-instance-submit':
      await submitAddInstance();
      return;

    default:
      console.warn('[connector-action] unknown action:', action);
  }
}

/**
 * GAP #10: Lazily load integration sources for a connector slug.
 * Calls GET /api/v1/integrations/sources?connector_id=<slug>.
 * Results stored in state.connectorDetail.sourcesState.
 *
 * @param {string} slug - connector_id slug
 */
async function handleLoadConnectorSources(slug) {
  state.connectorDetail.sourcesState = { sources: [], loading: true, loaded: false };
  renderCurrentView();
  try {
    const payload = await fetchJson(
      `/api/v1/integrations/sources?connector_id=${encodeURIComponent(slug)}`,
      { headers: authHeaders() }
    );
    state.connectorDetail.sourcesState = {
      sources: payload.sources || [],
      loading: false,
      loaded: true
    };
  } catch (err) {
    state.connectorDetail.sourcesState = { sources: [], loading: false, loaded: true };
    flash(err.message || 'Failed to load accounts.', true);
  }
  renderCurrentView();
}

/**
 * GAP #10: Set a specific integration_source as the default for its connector.
 * Calls PATCH /api/v1/integrations/sources/:id/default.
 * On success, updates the local connector index entry and re-renders.
 *
 * @param {string} sourceId - integration_source UUID
 */
async function handleSetConnectorDefault(sourceId) {
  try {
    const res = await fetch(`/api/v1/integrations/sources/${encodeURIComponent(sourceId)}/default`, {
      method: 'PATCH',
      headers: { ...authHeaders() }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      flash((err.error && err.error.message) || err.error || 'Failed to set default.', true);
      return;
    }
    const data = await res.json();
    flash('Default account updated.');

    // Update the in-memory sourcesState so the badge flips immediately without a full reload
    if (state.connectorDetail.sourcesState && Array.isArray(state.connectorDetail.sourcesState.sources)) {
      const connectorId = data.data?.connector_id;
      state.connectorDetail.sourcesState.sources = state.connectorDetail.sourcesState.sources.map((s) => ({
        ...s,
        is_default: connectorId
          ? (s.id === sourceId && s.connector_id === connectorId)
          : s.id === sourceId
      }));
    }

    // Refresh connectors so the UI reflects the new default
    await loadConnectors();
    renderCurrentView();
  } catch (err) {
    flash(err.message || 'Failed to set default.', true);
  }
}

function openConnectorConfirmModal(mode, connectorId) {
  if (!els.connectorConfirmModal) return;
  const targetId = connectorId || state.connectorDetail.selectedId;
  if (!targetId) {
    flash('No connector selected.', true);
    return;
  }
  const connector = findConnectorById(state.connectorIndex || [], targetId)
    || findConnectorById(state.connectors || [], targetId);
  if (!connector) {
    flash('Connector not found.', true);
    return;
  }

  if (mode === 'delete' && connector.allowDelete === false) {
    flash('System connectors cannot be permanently deleted.', true);
    return;
  }

  state.connectorConfirm = { mode, connectorId: targetId, busy: false };

  const title = mode === 'delete' ? 'Delete Connector' : 'Uninstall Connector';
  const body = mode === 'delete'
    ? `Permanently delete "${connector.name}"? All synced data, configuration, and custom UI files will be removed. This cannot be undone.`
    : `Uninstall "${connector.name}"? The connection will be disconnected but configuration and synced data will be preserved.`;

  if (els.connectorConfirmTitle) els.connectorConfirmTitle.textContent = title;
  if (els.connectorConfirmMessage) els.connectorConfirmMessage.textContent = body;
  if (els.connectorConfirmSubmit) {
    els.connectorConfirmSubmit.textContent = mode === 'delete' ? 'Delete Permanently' : 'Uninstall';
    els.connectorConfirmSubmit.setAttribute('variant', mode === 'delete' ? 'danger' : 'primary');
  }

  els.connectorConfirmModal.classList.remove('hidden');
}

function closeConnectorConfirmModal() {
  if (els.connectorConfirmModal) {
    els.connectorConfirmModal.classList.add('hidden');
  }
  state.connectorConfirm = { mode: null, connectorId: null, busy: false };
}

async function submitConnectorConfirm() {
  const { mode, connectorId, busy } = state.connectorConfirm || {};
  if (!mode || !connectorId || busy) return;

  state.connectorConfirm.busy = true;
  if (els.connectorConfirmSubmit) els.connectorConfirmSubmit.setAttribute('disabled', '');

  try {
    const suffix = mode === 'delete' ? '?hard=true' : '';
    await fetchJson(`/api/integrations/connectors/${encodeURIComponent(connectorId)}${suffix}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    flash(mode === 'delete' ? 'Connector deleted.' : 'Connector uninstalled.');
    closeConnectorConfirmModal();
    clearSelectedConnector();
    setView('connectors');
    await refreshCurrentView();
  } catch (error) {
    flash(error.message || `Failed to ${mode} connector.`, true);
    state.connectorConfirm.busy = false;
    if (els.connectorConfirmSubmit) els.connectorConfirmSubmit.removeAttribute('disabled');
  }
}

function openAddInstanceModal(slug) {
  if (!els.connectorAddInstanceModal || !slug) return;

  // Resolve the connector from the index so we can pull the manifest labels.
  const connector = (state.connectorIndex || []).find((c) =>
    (c.connector_id || c.connector_type) === slug
  );

  if (!connector) {
    flash(`Connector '${slug}' not found.`, true);
    return;
  }

  const multi = connector.multi_instance || {};
  if (!multi.enabled) {
    flash(`Connector '${connector.name || slug}' does not support multiple instances.`, true);
    return;
  }

  state.connectorAddInstance = {
    open: true,
    slug,
    connectorName: connector.name || slug,
    manifest: multi,
    submitting: false,
    error: null
  };

  if (els.connectorAddInstanceConnectorName) {
    els.connectorAddInstanceConnectorName.textContent = connector.name || slug;
  }
  if (els.connectorAddInstanceLabel) {
    els.connectorAddInstanceLabel.textContent = multi.instance_label || 'Instance name';
  }
  if (els.connectorAddInstanceHelper) {
    els.connectorAddInstanceHelper.textContent =
      multi.instance_helper_text || 'Use letters, numbers, and hyphens only. No spaces.';
  }
  if (els.connectorAddInstanceKey) {
    els.connectorAddInstanceKey.value = '';
    els.connectorAddInstanceKey.placeholder = multi.instance_placeholder || 'instance-name';
  }
  if (els.connectorAddInstanceError) {
    els.connectorAddInstanceError.textContent = '';
    els.connectorAddInstanceError.classList.add('hidden');
  }
  if (els.connectorAddInstanceSubmit) {
    els.connectorAddInstanceSubmit.removeAttribute('disabled');
  }

  els.connectorAddInstanceModal.classList.remove('hidden');

  // Focus the input after the modal renders
  requestAnimationFrame(() => {
    if (els.connectorAddInstanceKey) {
      els.connectorAddInstanceKey.focus();
    }
  });
}

function closeAddInstanceModal() {
  if (!els.connectorAddInstanceModal) return;
  els.connectorAddInstanceModal.classList.add('hidden');
  state.connectorAddInstance = {
    open: false,
    slug: null,
    connectorName: null,
    manifest: null,
    submitting: false,
    error: null
  };
  if (els.connectorAddInstanceKey) {
    els.connectorAddInstanceKey.value = '';
  }
  if (els.connectorAddInstanceError) {
    els.connectorAddInstanceError.textContent = '';
    els.connectorAddInstanceError.classList.add('hidden');
  }
}

async function submitAddInstance() {
  const s = state.connectorAddInstance;
  if (!s.open || !s.slug || s.submitting) return;

  const rawKey = (els.connectorAddInstanceKey?.value || '').trim();
  if (!rawKey) {
    showAddInstanceError(`${s.manifest?.instance_label || 'Instance name'} is required.`);
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(rawKey)) {
    showAddInstanceError('Use letters, numbers, and hyphens only. No spaces.');
    return;
  }
  if (rawKey.toLowerCase() === 'default') {
    showAddInstanceError("'default' is reserved for the original instance — pick a different name.");
    return;
  }

  state.connectorAddInstance.submitting = true;
  if (els.connectorAddInstanceSubmit) els.connectorAddInstanceSubmit.setAttribute('disabled', '');
  if (els.connectorAddInstanceError) {
    els.connectorAddInstanceError.textContent = '';
    els.connectorAddInstanceError.classList.add('hidden');
  }

  try {
    const result = await fetchJson(
      `/api/integrations/connectors/${encodeURIComponent(s.slug)}/instances`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ instance_key: rawKey })
      }
    );

    flash(`Created ${result?.data?.source_name || `${s.connectorName} instance`}.`);
    closeAddInstanceModal();

    // Refresh the connectors view so the new row shows up immediately
    await loadInstalledConnectors();
    rebuildConnectorIndex();
    renderCurrentView();
  } catch (error) {
    const msg = error?.payload?.error || error?.message || 'Failed to create instance.';
    showAddInstanceError(msg);
    state.connectorAddInstance.submitting = false;
    if (els.connectorAddInstanceSubmit) els.connectorAddInstanceSubmit.removeAttribute('disabled');
  }
}

function showAddInstanceError(message) {
  if (!els.connectorAddInstanceError) return;
  els.connectorAddInstanceError.textContent = message;
  els.connectorAddInstanceError.classList.remove('hidden');
}

function openConnectorImportModal(opts = {}) {
  if (!els.connectorImportModal) return;
  const targetConnectorId = opts.targetConnectorId || null;
  const targetConnectorName = opts.targetConnectorName || null;

  state.connectorImport = {
    open: true,
    selectedFile: null,
    uploading: false,
    error: null,
    targetConnectorId,
    targetConnectorName
  };
  resetConnectorImportDom();
  applyConnectorImportModalContext();
  els.connectorImportModal.classList.remove('hidden');
}

function closeConnectorImportModal() {
  if (!els.connectorImportModal) return;
  els.connectorImportModal.classList.add('hidden');
  state.connectorImport = {
    open: false,
    selectedFile: null,
    uploading: false,
    error: null,
    targetConnectorId: null,
    targetConnectorName: null
  };
  resetConnectorImportDom();
  applyConnectorImportModalContext();
}

// Update the import modal chrome (title, description, submit label) based on
// whether we're running a fresh import or an "Update <connector>" flow.
function applyConnectorImportModalContext() {
  const titleEl = document.getElementById('connector-import-modal-title');
  const descEl = els.connectorImportModal?.querySelector('.template-modal-description');
  const submitEl = els.connectorImportSubmit;
  const ctx = state.connectorImport;

  if (ctx?.targetConnectorId && ctx.targetConnectorName) {
    if (titleEl) titleEl.textContent = `Update ${ctx.targetConnectorName}`;
    if (descEl) {
      descEl.innerHTML = `Upload a ZIP package to update <strong>${escapeHtmlSafe(ctx.targetConnectorName)}</strong>. ` +
        'The new version will replace the current files and apply to every instance of this connector. ' +
        'The manifest must match — uploading a ZIP for a different connector will be rejected.';
    }
    if (submitEl) submitEl.textContent = 'Upload Update';
  } else {
    if (titleEl) titleEl.textContent = 'Import Connector';
    if (descEl) {
      descEl.innerHTML = 'Upload a ZIP package containing <code>manifest.json</code>, <code>connector.json</code>, and optional UI assets. ' +
        'The backend validates the manifest, hook code, and UI files before installing.';
    }
    if (submitEl) submitEl.textContent = 'Upload Connector';
  }
}

// Minimal escape — reuse the shared one when we already have access, otherwise fall back
function escapeHtmlSafe(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resetConnectorImportDom() {
  if (els.connectorImportFileInput) els.connectorImportFileInput.value = '';
  if (els.connectorImportPreview) els.connectorImportPreview.classList.add('hidden');
  if (els.connectorImportFileName) els.connectorImportFileName.textContent = '';
  if (els.connectorImportFileSize) els.connectorImportFileSize.textContent = '';
  if (els.connectorImportStatus) {
    els.connectorImportStatus.textContent = '';
    els.connectorImportStatus.className = 'muted';
  }
  if (els.connectorImportSubmit) els.connectorImportSubmit.setAttribute('disabled', '');
}

function clearConnectorImportFile() {
  state.connectorImport.selectedFile = null;
  resetConnectorImportDom();
}

function onConnectorImportFileChange(event) {
  const file = event?.target?.files?.[0] || null;
  applyConnectorImportFile(file);
}

function applyConnectorImportFile(file) {
  if (!file) {
    clearConnectorImportFile();
    return;
  }
  const isZip = file.type === 'application/zip'
    || file.type === 'application/x-zip-compressed'
    || (file.name && file.name.toLowerCase().endsWith('.zip'));
  if (!isZip) {
    if (els.connectorImportStatus) {
      els.connectorImportStatus.textContent = 'Please select a valid ZIP file.';
      els.connectorImportStatus.className = 'form-error';
    }
    return;
  }
  state.connectorImport.selectedFile = file;
  if (els.connectorImportPreview) els.connectorImportPreview.classList.remove('hidden');
  if (els.connectorImportFileName) els.connectorImportFileName.textContent = file.name;
  if (els.connectorImportFileSize) els.connectorImportFileSize.textContent = formatFileSize(file.size);
  if (els.connectorImportStatus) {
    els.connectorImportStatus.textContent = 'Ready to upload.';
    els.connectorImportStatus.className = 'muted';
  }
  if (els.connectorImportSubmit) els.connectorImportSubmit.removeAttribute('disabled');
}

function setupConnectorImportDropZone(zone) {
  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((name) => {
    zone.addEventListener(name, prevent);
  });
  zone.addEventListener('dragenter', () => zone.classList.add('drop-hover'));
  zone.addEventListener('dragover', () => zone.classList.add('drop-hover'));
  zone.addEventListener('dragleave', () => zone.classList.remove('drop-hover'));
  zone.addEventListener('drop', (event) => {
    zone.classList.remove('drop-hover');
    const file = event.dataTransfer?.files?.[0] || null;
    applyConnectorImportFile(file);
  });
  zone.addEventListener('click', (event) => {
    if (event.target.closest('[data-connector-action]')) return;
    if (els.connectorImportFileInput) els.connectorImportFileInput.click();
  });
}

async function submitConnectorImport() {
  const file = state.connectorImport?.selectedFile;
  if (!file) return;
  if (state.connectorImport.uploading) return;

  state.connectorImport.uploading = true;
  if (els.connectorImportSubmit) els.connectorImportSubmit.setAttribute('disabled', '');
  if (els.connectorImportStatus) {
    els.connectorImportStatus.textContent = 'Uploading…';
    els.connectorImportStatus.className = 'muted';
  }

  try {
    const formData = new FormData();
    formData.append('connector_zip', file);

    // When invoked from an "Update <connector>" context, scope the import
    // so the backend rejects a mismatched manifest.
    const targetSlug = state.connectorImport.targetConnectorId;
    const targetName = state.connectorImport.targetConnectorName;
    if (targetSlug) {
      formData.append('target_connector_id', targetSlug);
    }

    const headers = { ...authHeaders() };
    // Let the browser set the correct multipart boundary.
    delete headers['Content-Type'];

    const response = await fetch('/api/generic-connectors/import', {
      method: 'POST',
      headers,
      body: formData
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = typeof payload === 'string'
        ? payload
        : (payload?.detail || payload?.error || payload?.message || `Upload failed (${response.status})`);
      throw new Error(message);
    }

    const connectorLabel = targetName || payload?.name || 'Connector';
    flash(targetSlug ? `Updated ${connectorLabel}.` : `${connectorLabel} imported.`);
    closeConnectorImportModal();
    await loadInstalledConnectors();
    rebuildConnectorIndex();
    renderCurrentView();
  } catch (error) {
    state.connectorImport.uploading = false;
    if (els.connectorImportSubmit) els.connectorImportSubmit.removeAttribute('disabled');
    if (els.connectorImportStatus) {
      els.connectorImportStatus.textContent = error.message || 'Upload failed.';
      els.connectorImportStatus.className = 'form-error';
    }
  }
}

async function loadConnectors() {
  const payload = await fetchJson('/api/connectors', {
    headers: authHeaders()
  });
  const fetched = Array.isArray(payload.data)
    ? payload.data
    : (Array.isArray(payload.connectors) ? payload.connectors : []);

  // Always include SYSTEM_CONNECTORS in the readiness catalog so legacy
  // built-ins (Leadly, ActionStep, GoHighLevel) are visible in the table
  // even when the backend's registry catalog doesn't return them. Once
  // they're converted into ZIP-style imports with their own ui/index.html,
  // the backend will return them and this merge becomes a no-op.
  const fetchedIds = new Set(
    fetched.map((c) => String(c?.id || '').toLowerCase()).filter(Boolean)
  );
  const seedRows = SYSTEM_CONNECTORS
    .filter((sys) => !fetchedIds.has(String(sys.id || '').toLowerCase()))
    .map((sys) => ({
      id: sys.id,
      name: sys.name,
      description: sys.description,
      version: '1.0.0',
      authType: sys.auth_type,
      source: 'system',
      metadata: {
        name: sys.name,
        category: sys.category,
        description: sys.description
      },
      auth: { type: sys.auth_type }
    }));

  state.connectors = [...fetched, ...seedRows];
}

async function loadConnectorHealth() {
  try {
    const payload = await fetchJson('/api/connector-health', {
      headers: authHeaders()
    });
    state.connectorHealth = payload.data || [];
  } catch (error) {
    console.warn('Failed to load connector health', error);
    state.connectorHealth = [];
  }
}

async function refreshConnectorHealth() {
  try {
    await fetchJson('/api/connector-health/refresh', {
      method: 'POST',
      headers: authHeaders()
    });
    await loadConnectorHealth();
    renderCurrentView();
    flash('Connector readiness refreshed.');
  } catch (error) {
    flash(error.message || 'Failed to refresh connector readiness.', true);
  }
}

async function loadApprovals() {
  const payload = await fetchJson('/api/approvals/inbox?limit=100', {
    headers: authHeaders()
  });
  state.approvals = payload.approvals || payload.data || [];

  if (state.selectedApprovalId) {
    const selectedStillVisible = state.approvals.some((approval) => {
      const id = approval.approval_id || approval.id || approval.title || approval.approval_type || '';
      return String(id) === String(state.selectedApprovalId);
    });
    if (!selectedStillVisible) {
      state.selectedApprovalId = null;
      state.selectedApprovalDetail = null;
    }
  }
}

async function loadApprovalDetail(approvalId, fallbackApproval = null) {
  if (!approvalId) return;
  const localApproval = fallbackApproval || state.approvals.find((approval) => {
    const id = approval.approval_id || approval.id || approval.title || approval.approval_type || '';
    return String(id) === String(approvalId);
  }) || null;
  state.selectedApprovalId = approvalId;
  state.selectedApprovalDetail = localApproval || state.selectedApprovalDetail || null;

  try {
    const payload = await fetchJson(`/api/approvals/${encodeURIComponent(approvalId)}`, {
      headers: authHeaders()
    });
    state.selectedApprovalDetail = payload.data || payload.approval || payload || localApproval || null;
  } catch (error) {
    if (localApproval) {
      console.warn('Failed to load approval detail; showing inbox row payload instead.', error);
      flash('Showing available approval details only.', true);
      return;
    }
    throw error;
  }
}

async function decideApproval(approvalId, action, comments = '') {
  if (!approvalId || !['approve', 'reject'].includes(action)) return;

  state.approvalActioning = true;
  renderCurrentView();

  try {
    await fetchJson(`/api/approvals/${encodeURIComponent(approvalId)}/${action}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ comments })
    });
    await loadApprovals();
    state.selectedApprovalId = null;
    state.selectedApprovalDetail = null;
    flash(`Approval ${action === 'approve' ? 'approved' : 'rejected'}.`);
  } catch (error) {
    flash(error.message || `Failed to ${action} approval.`, true);
  } finally {
    state.approvalActioning = false;
    renderCurrentView();
  }
}

async function loadUserProfile() {
  try {
    const payload = await fetchJson('/api/users/me/profile', {
      headers: authHeaders()
    });
    state.userProfile = payload.profile || payload.user || payload || null;
  } catch (error) {
    console.warn('Profile endpoint unavailable; continuing without profile payload.', error);
    state.userProfile = null;
  }
}

async function loadOnboardingState() {
  try {
    const payload = await fetchJson('/api/onboarding-state', {
      headers: authHeaders()
    });
    state.onboardingState = payload.onboarding_state || null;
  } catch (error) {
    console.warn('Failed to load onboarding state', error);
    state.onboardingState = null;
  }
}

function restoreOnboardingDraft() {
  const draft = state.onboardingState?.builder_draft;
  if (!draft || !Object.keys(draft).length) return;

  const templateId = draft.templateId;
  if (templateId && state.templates.length && !state.templates.some((template) => template.id === templateId)) {
    return;
  }

  mergeBuilderDraft(createContext(), draft);
}

async function saveOnboardingState() {
  if (!state.token) return;

  const context = createContext();
  const setupState = {
    connectors_reviewed: state.connectors.length > 0,
    ready_connectors: builderPreflight(context)[1]?.done || false,
    template_selected: Boolean(state.builder.templateId),
    builder_started: Boolean(state.builder.name && state.builder.message),
    builder_validated: configIsValid(state.builder),
    automation_published: state.automations.length > 0
  };

  const preferredNextStep = (buildChecklist(context).find((item) => !item.done) || { view: 'library' }).view;

  state.onboardingState = await fetchJson('/api/onboarding-state', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      setup_state: setupState,
      preferred_next_step: preferredNextStep,
      builder_draft: state.builder
    })
  }).then((payload) => payload.onboarding_state || null);
}

function scheduleOnboardingSave() {
  if (!state.token) return;
  window.clearTimeout(state._onboardingSaveTimer);
  state._onboardingSaveTimer = window.setTimeout(() => {
    saveOnboardingState().catch((error) => {
      console.warn('Failed to persist onboarding state', error);
    });
  }, 500);
}

function renderUserChip() {
  if (!els.sidebar) return;

  // Primary nav is owned by the automation app — its own surfaces (Create
  // + SIDEBAR_NAV_ITEMS like Home, Connectors, Library, Runs, Approvals).
  const sections = [
    {
      id: 'main-actions',
      isStaticTop: true,
      items: [{ id: 'create', label: 'New Automation', icon: 'plus', isButton: true, onClick: 'openAutomationBuilder', variant: 'create-chat' }]
    },
    {
      id: 'navigation',
      items: SIDEBAR_NAV_ITEMS.map((item) => ({
        ...item,
        href: '#'
      }))
    }
  ];
  if (els.shell?.setSections) {
    els.shell.setSections(sections);
  } else {
    els.sidebar.sections = sections;
  }
  els.sidebar.activeId = state.currentView;

  // Footer (user block + canonical user menu + version) is shared with the
  // host shell — set via the LanaSidebarFooter helper so every sub-app
  // routes Settings/Connectors/Help/Admin to the same host pages.
  // The helper reads localStorage.user (same source the host's Lex.state
  // uses), so role gating + handle derivation match the host exactly.
  // Do NOT pass state.userProfile here — /api/users/me/profile returns a
  // sanitized shape that drops role_name, which would silently disable the
  // Administration item for admin users.
  if (window.LanaSidebarFooter) {
    window.LanaSidebarFooter.hydrate(els.sidebar, { pathPrefix: '../' });
  }
}

function authHeaders() {
  return {
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };
}

function parseJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized));
    return decoded && typeof decoded === 'object' ? decoded : null;
  } catch (_error) {
    return null;
  }
}

function getTokenExpirationMs() {
  const payload = parseJwt(state.token);
  if (!payload || !payload.exp) return null;
  return Number(payload.exp) * 1000;
}

function stopAuthLifecycle() {
  if (state._tokenRefreshTimer) {
    window.clearTimeout(state._tokenRefreshTimer);
    state._tokenRefreshTimer = null;
  }
  if (state._activityHandler) {
    window.removeEventListener('click', state._activityHandler);
    window.removeEventListener('keydown', state._activityHandler);
    window.removeEventListener('mousemove', state._activityHandler);
    state._activityHandler = null;
  }
}

function scheduleTokenRefresh() {
  if (!state.token) return;
  if (state._tokenRefreshTimer) {
    window.clearTimeout(state._tokenRefreshTimer);
    state._tokenRefreshTimer = null;
  }

  const expiresAt = getTokenExpirationMs();
  if (!expiresAt) return;

  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  const fiveMinutes = 5 * 60 * 1000;
  const refreshInMs = Math.max(Math.min(expiresAt - now - oneHour, oneHour), fiveMinutes);

  state._tokenRefreshTimer = window.setTimeout(() => {
    refreshAuthToken().catch(() => {});
  }, refreshInMs);
}

async function refreshAuthToken() {
  if (!state.token || state._isRefreshingToken || state._isLoggingOut) return;
  state._isRefreshingToken = true;
  try {
    const payload = await fetchJson('/api/auth/refresh', {
      method: 'GET',
      headers: authHeaders()
    });

    const nextToken = payload?.token;
    if (nextToken && nextToken !== state.token) {
      state.token = nextToken;
      localStorage.setItem(STORAGE_KEYS.token, state.token);
    }
  } catch (_error) {
    // Let existing 401/logout handling own terminal auth failures.
  } finally {
    state._isRefreshingToken = false;
    scheduleTokenRefresh();
  }
}

function startAuthLifecycle() {
  if (!state.token) return;
  stopAuthLifecycle();

  state._lastActivityAt = Date.now();
  state._activityHandler = () => {
    state._lastActivityAt = Date.now();
  };
  window.addEventListener('click', state._activityHandler, { passive: true });
  window.addEventListener('keydown', state._activityHandler, { passive: true });
  window.addEventListener('mousemove', state._activityHandler, { passive: true });

  scheduleTokenRefresh();
}

async function fetchJson(url, options = {}) {
  // Browser → canonical Lana API. The shared ApiClient owns the active Core
  // server URL; this wrapper preserves legacy automation paths and retries
  // equivalent /api/v1 routes when older unversioned paths are missing.
  const { headers: optionHeaders = {}, _skipFallback = false, ...restOptions } = options;
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
  };
  const preferredUrl = !_skipFallback ? resolvePreferredApiUrl(url) : '';
  const apiPath = preferredUrl || url;
  const requestUrl = getApiUrl(apiPath);
  const response = await fetch(requestUrl, {
    ...restOptions,
    headers: {
      ...baseHeaders,
      ...optionHeaders
    }
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    if (response.status === 404 && !_skipFallback) {
      const fallbackUrl = preferredUrl ? url : resolveApiFallbackUrl(url);
      if (fallbackUrl && fallbackUrl !== apiPath) {
        return fetchJson(fallbackUrl, {
          ...restOptions,
          headers: optionHeaders,
          _skipFallback: true
        });
      }
    }

    const message = getPayloadErrorMessage(payload);

    if (
      response.status === 401
      && !state._isLoggingOut
      && !String(url).includes('/auth/logout')
      && !String(url).includes('/auth/login')
      && !String(url).includes('/auth/discovery')
    ) {
      await onLogout();
    }

    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function getPayloadErrorMessage(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return 'Request failed';

  const candidates = [
    payload.error,
    payload.message,
    payload.detail,
    payload.details && payload.details.message
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (candidate && typeof candidate === 'object') {
      if (typeof candidate.message === 'string' && candidate.message.trim()) {
        return candidate.message;
      }
      try {
        return JSON.stringify(candidate);
      } catch (_error) {
        return 'Request failed';
      }
    }
  }

  return 'Request failed';
}

function flash(message, isError = false) {
  els.flash.textContent = message;
  els.flash.classList.remove('hidden', 'flash-error', 'flash-success');
  els.flash.classList.add(isError ? 'flash-error' : 'flash-success');

  window.clearTimeout(flash._timeoutId);
  flash._timeoutId = window.setTimeout(() => {
    els.flash.classList.add('hidden');
  }, 3500);
}

function createContext() {
  return {
    state,
    els,
    getTemplateLibrary,
    setView,
    renderCurrentView,
    refreshCurrentView,
    loadAutomations,
    saveOnboardingState,
    scheduleOnboardingSave,
    fetchJson,
    authHeaders,
    flash,
    configIsValid,
    gotoBuilder,
    gotoLibraryDetail,
    loadRunDetail,
    loadApprovalDetail,
    decideApproval
  };
}
