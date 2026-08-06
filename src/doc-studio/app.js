const state = {
  deck: {
    title: 'Untitled file',
    subtitle: 'Generate a file to begin',
    theme: { accent: '#2f6f73', background: '#f7f4ef', foreground: '#17201f' },
    cards: []
  },
  view: 'slides',
  presentationId: null,
  presentations: [],
  libraryDocuments: [],
  selectedSlideIndex: 0,
  templateGalleryOpen: false,
  templates: [],
  brandKits: [],
  critique: null,
  libraryCapabilities: {
    duplicate: true,
    rename: true,
    delete: true,
    updateMetadata: true,
    rewriteSlide: false,
    regenerateSlide: false,
    generateSlideImage: false,
    removeSlideImage: false,
    critique: false,
    autoPolish: false,
    share: true,
    imageAvailable: false
  },
  activeSignaturePad: null,
  documentDirty: false,
  documentComments: [],
  documentPermissions: [],
  documentCollaborators: [],
  documentCollaborationLoaded: false,
  documentPanelTab: 'comments',
  documentVersions: [],
  selectedDocumentVersion: null,
  documentHistory: [],
  documentHistoryIndex: -1,
  historyTimer: null,
  autosaveTimer: null,
  autosaving: false,
  documentLastSavedAt: null
};

const initialParams = new URLSearchParams(window.location.search);
state.embedded = initialParams.get('embed') === '1' || initialParams.get('embedded') === '1';
state.documentEditor = initialParams.get('editor') === '1' ||
  initialParams.get('docEditor') === '1' ||
  (initialParams.has('id') && initialParams.get('view') === 'doc');
if (state.embedded) {
  document.body.dataset.embedded = 'true';
  const shell = document.getElementById('doc-studio-shell');
  if (shell) {
    shell.setAttribute('chrome', 'embedded');
  }
}
if (state.documentEditor) {
  document.body.dataset.documentEditor = 'true';
}

function setDocumentEditorMode(enabled) {
  state.documentEditor = !!enabled;
  if (state.documentEditor) {
    document.body.dataset.documentEditor = 'true';
  } else {
    delete document.body.dataset.documentEditor;
  }
}

function savedServerUrl() {
  try {
    const saved = JSON.parse(localStorage.getItem('lana_saved_server') || 'null');
    return typeof saved?.url === 'string' ? saved.url.trim() : '';
  } catch (_error) {
    return '';
  }
}

const API_BASE_URL = (() => {
  const configured = window.LanaConfig && typeof window.LanaConfig.API_BASE_URL === 'string'
    ? window.LanaConfig.API_BASE_URL.trim()
    : '';
  if (configured) return configured.replace(/\/+$/, '');
  if (window.location.protocol === 'file:') return (savedServerUrl() || 'http://localhost:8080').replace(/\/+$/, '');
  return '';
})();

function apiUrl(path) {
  if (!path) return API_BASE_URL || '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.charAt(0) === '/' ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

function authToken() {
  try {
    return localStorage.getItem('token') || '';
  } catch (_error) {
    return '';
  }
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = authToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(apiUrl(path), { ...options, headers });
}

function clientDeckUrl(path) {
  if (!path) return window.location.href;
  const productPath = path.replace(/^\/deck-studio(?=\/|\?|$)/, '/doc-studio');
  if (window.location.protocol !== 'file:') return productPath;
  const queryIndex = productPath.indexOf('?');
  const query = queryIndex >= 0 ? productPath.substring(queryIndex) : '';
  return `index.html${query}`;
}

function replaceClientUrl(path) {
  window.history.replaceState({}, '', clientDeckUrl(path));
}

async function openDocStudioLibrary() {
  if (state.view !== 'library' && !confirmUnsavedDocumentChanges()) {
    return;
  }
  setDocumentEditorMode(false);
  state.view = 'library';
  replaceClientUrl('/doc-studio/?view=library');
  await loadLibrary();
  render();
}

window.openDocStudioLibrary = openDocStudioLibrary;

function currentDocumentFileId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('file_id') || params.get('document_id') || '';
}

function currentMatterId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('matter_id') || '';
}

function currentDocumentFileName() {
  const params = new URLSearchParams(window.location.search);
  return params.get('file_name') || params.get('filename') || `${slug(state.deck?.title || 'document')}.pdf`;
}

const elements = {
  mode: document.getElementById('mode'),
  documentType: document.getElementById('documentType'),
  audience: document.getElementById('audience'),
  tone: document.getElementById('tone'),
  style: document.getElementById('style'),
  metadataTitle: document.getElementById('metadataTitle'),
  metadataSubtitle: document.getElementById('metadataSubtitle'),
  themeAccent: document.getElementById('themeAccent'),
  themeBackground: document.getElementById('themeBackground'),
  themeForeground: document.getElementById('themeForeground'),
  brandKitSelect: document.getElementById('brandKitSelect'),
  brandKitName: document.getElementById('brandKitName'),
  brandLogoUrl: document.getElementById('brandLogoUrl'),
  brandTextMark: document.getElementById('brandTextMark'),
  brandFontFamily: document.getElementById('brandFontFamily'),
  brandIconMode: document.getElementById('brandIconMode'),
  brandImageStyle: document.getElementById('brandImageStyle'),
  brandDensity: document.getElementById('brandDensity'),
  brandComposition: document.getElementById('brandComposition'),
  saveBrandKitBtn: document.getElementById('saveBrandKitBtn'),
  cardCount: document.getElementById('cardCount'),
  generateImages: document.getElementById('generateImages'),
  prompt: document.getElementById('prompt'),
  sourceUrl: document.getElementById('sourceUrl'),
  sourceFiles: document.getElementById('sourceFiles'),
  importSourceBtn: document.getElementById('importSourceBtn'),
  generateBtn: document.getElementById('generateBtn'),
  outlineBtn: document.getElementById('outlineBtn'),
  sampleBtn: document.getElementById('sampleBtn'),
  printBtn: document.getElementById('printBtn'),
  pptxBtn: document.getElementById('pptxBtn'),
  htmlBtn: document.getElementById('htmlBtn'),
  status: document.getElementById('status'),
  standardHeader: document.getElementById('standardHeader'),
  docHeaderChrome: document.getElementById('docHeaderChrome'),
  docHeaderBanner: document.getElementById('docHeaderBanner'),
  docHeaderBreadcrumbs: document.getElementById('docHeaderBreadcrumbs'),
  docEditorLayout: document.getElementById('docEditorLayout'),
  docSidePanel: document.getElementById('docSidePanel'),
  deckTitle: document.getElementById('deckTitle'),
  deckSubtitle: document.getElementById('deckSubtitle'),
  editorTools: document.getElementById('editorTools'),
  slidePicker: document.getElementById('slidePicker'),
  prevSlideBtn: document.getElementById('prevSlideBtn'),
  nextSlideBtn: document.getElementById('nextSlideBtn'),
  slideLayout: document.getElementById('slideLayout'),
  slideStyle: document.getElementById('slideStyle'),
  addSlideBtn: document.getElementById('addSlideBtn'),
  duplicateSlideBtn: document.getElementById('duplicateSlideBtn'),
  removeSlideBtn: document.getElementById('removeSlideBtn'),
  moveSlideUpBtn: document.getElementById('moveSlideUpBtn'),
  moveSlideDownBtn: document.getElementById('moveSlideDownBtn'),
  rewriteSlideBtn: document.getElementById('rewriteSlideBtn'),
  regenerateSlideBtn: document.getElementById('regenerateSlideBtn'),
  generateSlideImageBtn: document.getElementById('generateSlideImageBtn'),
  removeSlideImageBtn: document.getElementById('removeSlideImageBtn'),
  toggleTemplatesBtn: document.getElementById('toggleTemplatesBtn'),
  sharePresentationBtn: document.getElementById('sharePresentationBtn'),
  saveMetadataBtn: document.getElementById('saveMetadataBtn'),
  styleCompare: document.getElementById('styleCompare'),
  criticPanel: document.getElementById('criticPanel'),
  visualEditor: document.getElementById('visualEditor'),
  templateGallery: document.getElementById('templateGallery'),
  slidesView: document.getElementById('slidesView'),
  presentView: document.getElementById('presentView'),
  docView: document.getElementById('docView'),
  libraryView: document.getElementById('libraryView'),
  libraryList: document.getElementById('libraryList'),
  quickStarts: document.querySelectorAll('[data-quick-start]'),
  tabs: document.querySelectorAll('[data-view]')
};

const iconSvgs = {
  'bar-chart-3': '<svg viewBox="0 0 24 24"><path d="M3 20h18"/><path d="M7 16V8"/><path d="M12 16V4"/><path d="M17 16v-6"/></svg>',
  boxes: '<svg viewBox="0 0 24 24"><path d="M7 8l5-3 5 3-5 3z"/><path d="M7 8v6l5 3 5-3V8"/><path d="M3 14l4-2.5 4 2.5-4 2.5z"/><path d="M13 14l4-2.5 4 2.5-4 2.5z"/></svg>',
  'check-circle': '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-5"/><circle cx="12" cy="12" r="9"/></svg>',
  'circle-dot': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  'circle-x': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/></svg>',
  'clipboard-check': '<svg viewBox="0 0 24 24"><path d="M9 5h6"/><path d="M9 3h6v4H9z"/><path d="M7 5H5v16h14V5h-2"/><path d="M9 14l2 2 4-5"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M17.5 19H8a5 5 0 1 1 1.1-9.9A7 7 0 0 1 22 12.5 4.5 4.5 0 0 1 17.5 19z"/></svg>',
  'cloud-off': '<svg viewBox="0 0 24 24"><path d="M2 2l20 20"/><path d="M5.8 5.8A5 5 0 0 0 8 19h9.5a4.5 4.5 0 0 0 2.6-8.2A7 7 0 0 0 9.1 9.1"/><path d="M11.2 5.1A7 7 0 0 1 19 10"/></svg>',
  code: '<svg viewBox="0 0 24 24"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/><path d="M14 4l-4 16"/></svg>',
  database: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/></svg>',
  'gauge-circle': '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 1 8 0"/><path d="M12 14l3-3"/></svg>',
  'hard-drive': '<svg viewBox="0 0 24 24"><path d="M4 14l2-8h12l2 8"/><path d="M4 14h16v5H4z"/><path d="M7 17h.01"/><path d="M11 17h6"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v7"/><path d="M12 7h.01"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l8-8"/><path d="M15 8l3 3"/><path d="M17 6l3 3"/></svg>',
  laptop: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H4z"/><path d="M2 19h20"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></svg>',
  'list-checks': '<svg viewBox="0 0 24 24"><path d="M10 6h10"/><path d="M10 12h10"/><path d="M10 18h10"/><path d="M4 6l1 1 2-2"/><path d="M4 12l1 1 2-2"/><path d="M4 18l1 1 2-2"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  memory: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4"/><path d="M15 2v4"/><path d="M9 18v4"/><path d="M15 18v4"/><path d="M2 9h4"/><path d="M2 15h4"/><path d="M18 9h4"/><path d="M18 15h4"/></svg>',
  network: '<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="3" y="16" width="6" height="6" rx="1"/><rect x="15" y="16" width="6" height="6" rx="1"/><path d="M12 8v4"/><path d="M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>',
  'octagon-alert': '<svg viewBox="0 0 24 24"><path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/><path d="M12 7v6"/><path d="M12 17h.01"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/></svg>',
  presentation: '<svg viewBox="0 0 24 24"><path d="M3 4h18v12H3z"/><path d="M12 16v4"/><path d="M8 20h8"/></svg>',
  route: '<svg viewBox="0 0 24 24"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h2a5 5 0 0 0 5-5V8"/></svg>',
  scale: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M5 6h14"/><path d="M6 6l-4 7h8z"/><path d="M18 6l-4 7h8z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 8h.01"/><path d="M7 17h.01"/></svg>',
  'shield-alert': '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 8v5"/><path d="M12 16h.01"/></svg>',
  'shield-check': '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-5"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24"><path d="M12 3l1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></svg>',
  split: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M4 7h5"/><path d="M15 7h5"/><path d="M4 17h5"/><path d="M15 17h5"/></svg>',
  target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  'thumbs-down': '<svg viewBox="0 0 24 24"><path d="M14 10V4h4a3 3 0 0 1 3 3v3z"/><path d="M14 10l-3 8a2 2 0 0 1-4-1v-5H4a2 2 0 0 1-2-2l1-5a2 2 0 0 1 2-1h9"/></svg>',
  'thumbs-up': '<svg viewBox="0 0 24 24"><path d="M10 14v6H6a3 3 0 0 1-3-3v-3z"/><path d="M10 14l3-8a2 2 0 0 1 4 1v5h3a2 2 0 0 1 2 2l-1 5a2 2 0 0 1-2 1h-9"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/></svg>',
  'trending-up': '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></svg>',
  'triangle-alert': '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
  'user-check': '<svg viewBox="0 0 24 24"><circle cx="9" cy="7" r="4"/><path d="M3 21a6 6 0 0 1 12 0"/><path d="M16 11l2 2 4-5"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><path d="M4 7h16v13H4z"/><path d="M4 7l2-3h12l2 3"/><path d="M16 14h4"/></svg>',
  workflow: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="15" width="6" height="5" rx="1"/><path d="M9 6.5h3a3 3 0 0 1 3 3V15"/><path d="M6 9v6a3 3 0 0 0 3 3h6"/></svg>',
  zap: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 10-13h-7z"/></svg>'
};

function iconSvg(name) {
  return iconSvgs[name] || iconSvgs.info;
}

const iconNames = Object.keys(iconSvgs).sort();
const styleOptions = ['editorial', 'executive', 'noir', 'atelier', 'modern', 'signal', 'luxe', 'blueprint'];
const layoutOptions = ['title', 'agenda', 'statement', 'image-left', 'image-right', 'image-led', 'comparison', 'pros-cons', 'metric-grid', 'timeline', 'process', 'quote', 'section-break', 'table-list', 'summary'];
const iconModeOptions = ['restrained', 'balanced', 'minimal'];
const imageStyleOptions = ['editorial', 'product', 'abstract', 'documentary', 'diagrammatic', 'illustration', 'data'];
const densityOptions = ['standard', 'dense', 'spacious'];
const compositionOptions = ['magazine', 'boardroom', 'cinematic', 'gallery', 'product', 'briefing', 'luxury', 'systems'];
const fontFamilyOptions = ['inter', 'aptos', 'serif', 'mono'];
const deckFontFamilies = {
  inter: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  aptos: 'Aptos, "Aptos Display", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", "Roboto Mono", Consolas, "Liberation Mono", monospace'
};
const brandKitStorageKey = 'lana.deckStudio.brandKits.v2';
const legacyBrandKitStorageKey = 'lana.deckStudio.brandKits.v1';
const stylePresets = {
  editorial: { accent: '#b56b45', background: '#f7f4ef', foreground: '#17201f', muted: '#7c6f64', surface: '#ffffff', media: '#efe7db', radius: '6px', shadow: '0 22px 60px rgba(23, 32, 31, 0.12)' },
  executive: { accent: '#2f6f73', background: '#f4f6f5', foreground: '#14201f', muted: '#60706d', surface: '#ffffff', media: '#dfeceb', radius: '5px', shadow: '0 20px 54px rgba(12, 26, 25, 0.13)' },
  noir: { accent: '#d2a45f', background: '#121615', foreground: '#f3efe6', muted: '#a99f91', surface: '#1d2321', media: '#2a2722', radius: '4px', shadow: '0 26px 70px rgba(0, 0, 0, 0.34)' },
  atelier: { accent: '#8f4e45', background: '#f5f1ea', foreground: '#201b18', muted: '#72685f', surface: '#fffdf8', media: '#eee3d8', radius: '3px', shadow: '0 24px 62px rgba(61, 45, 34, 0.14)' },
  modern: { accent: '#5268a8', background: '#f5f7fb', foreground: '#172033', muted: '#667085', surface: '#ffffff', media: '#e8edf7', radius: '8px', shadow: '0 20px 58px rgba(24, 35, 62, 0.13)' },
  signal: { accent: '#c14f35', background: '#f2f3ee', foreground: '#111614', muted: '#68706b', surface: '#ffffff', media: '#e4e8df', radius: '2px', shadow: '0 18px 46px rgba(17, 22, 20, 0.11)' },
  luxe: { accent: '#a47a3d', background: '#111111', foreground: '#f7f0e4', muted: '#b7aa98', surface: '#1a1815', media: '#2b241a', radius: '0px', shadow: '0 30px 80px rgba(0, 0, 0, 0.4)' },
  blueprint: { accent: '#3f7f93', background: '#edf4f5', foreground: '#10252c', muted: '#5d7177', surface: '#ffffff', media: '#dcebed', radius: '4px', shadow: '0 20px 56px rgba(16, 37, 44, 0.12)' }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStatus(message) {
  elements.status.textContent = message;
}

function markDocumentDirty(message = 'Unsaved document changes.') {
  state.documentDirty = true;
  setStatus(message);
  const dirtyState = document.querySelector('[data-doc-dirty-state]');
  if (dirtyState) {
    dirtyState.setAttribute('label', 'Unsaved changes');
    dirtyState.setAttribute('color', 'yellow');
    dirtyState.classList.add('is-dirty');
  }
  scheduleDocumentHistorySnapshot();
  scheduleDocumentAutosave();
}

function clearDocumentDirty() {
  state.documentDirty = false;
  updateDocumentHistoryControls();
}

function formatLastSaved(value) {
  if (!value) {
    return 'Last saved not yet';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Last saved recently';
  }
  return `Last saved ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function confirmUnsavedDocumentChanges() {
  if (!state.documentDirty) {
    return true;
  }
  return window.confirm('Continue with unsaved document changes? Save first if you want them persisted.');
}

function cloneDocumentModel() {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  return documentModel ? JSON.parse(JSON.stringify(documentModel)) : null;
}

function documentSnapshotKey(snapshot) {
  return JSON.stringify(snapshot || null);
}

function resetDocumentHistory() {
  const snapshot = cloneDocumentModel();
  state.documentHistory = snapshot ? [snapshot] : [];
  state.documentHistoryIndex = snapshot ? 0 : -1;
  updateDocumentHistoryControls();
}

function pushDocumentHistorySnapshot() {
  const snapshot = cloneDocumentModel();
  if (!snapshot) {
    return;
  }
  const current = state.documentHistory[state.documentHistoryIndex];
  if (documentSnapshotKey(current) === documentSnapshotKey(snapshot)) {
    updateDocumentHistoryControls();
    return;
  }
  state.documentHistory = state.documentHistory.slice(0, state.documentHistoryIndex + 1);
  state.documentHistory.push(snapshot);
  if (state.documentHistory.length > 60) {
    state.documentHistory.shift();
  }
  state.documentHistoryIndex = state.documentHistory.length - 1;
  updateDocumentHistoryControls();
}

function scheduleDocumentHistorySnapshot() {
  if (!state.deck.document) {
    return;
  }
  window.clearTimeout(state.historyTimer);
  state.historyTimer = window.setTimeout(pushDocumentHistorySnapshot, 550);
}

function updateDocumentHistoryControls() {
  document.querySelectorAll('[data-doc-undo]').forEach(button => {
    button.disabled = state.documentHistoryIndex <= 0;
  });
  document.querySelectorAll('[data-doc-redo]').forEach(button => {
    button.disabled = state.documentHistoryIndex < 0 || state.documentHistoryIndex >= state.documentHistory.length - 1;
  });
}

function restoreDocumentHistory(index) {
  if (index < 0 || index >= state.documentHistory.length) {
    return;
  }
  state.documentHistoryIndex = index;
  state.deck.document = JSON.parse(JSON.stringify(state.documentHistory[index]));
  state.deck.title = state.deck.document.title || state.deck.title;
  state.deck.subtitle = state.deck.document.subtitle || state.deck.subtitle;
  state.documentDirty = true;
  render();
  markDocumentDirty('Document history restored. Save document to persist.');
}

function scheduleDocumentAutosave() {
  if (!state.presentationId || !state.deck.document || state.autosaving) {
    return;
  }
  window.clearTimeout(state.autosaveTimer);
  state.autosaveTimer = window.setTimeout(() => {
    saveDocumentEdits({ autosave: true, silent: true }).catch(error => {
      setStatus(`Autosave failed: ${error.message}`);
    });
  }, 1800);
}

function setInputValue(input, value) {
  if (input && document.activeElement !== input) {
    input.value = value;
  }
}

function sourceFileNames() {
  return Array.from(elements.sourceFiles?.files || []).map(file => file.name).join(', ');
}

function normalizeColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function enumOption(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function normalizeUrl(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? text : '';
  } catch (error) {
    return '';
  }
}

function activeDeckStyle() {
  return state.deck.style || state.deck.theme?.style || 'editorial';
}

function stylePreset(style) {
  return stylePresets[style] || stylePresets.editorial;
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function loadBrandKits() {
  if (typeof localStorage === 'undefined') {
    state.brandKits = [];
    return;
  }

  const kits = parseJson(localStorage.getItem(brandKitStorageKey), null)
    || parseJson(localStorage.getItem(legacyBrandKitStorageKey), []);
  state.brandKits = Array.isArray(kits)
    ? kits.filter(kit => kit && typeof kit === 'object' && kit.name)
    : [];
}

function persistBrandKits() {
  if (typeof localStorage === 'undefined') {
    return;
  }
  localStorage.setItem(brandKitStorageKey, JSON.stringify(state.brandKits));
}

function currentBrandKit() {
  const style = activeDeckStyle();
  const preset = stylePreset(style);
  const designSystem = state.deck.designSystem || {};
  return {
    id: `kit-${LanaTime.nowMs()}`,
    version: 2,
    name: elements.brandKitName?.value.trim() || state.deck.title || 'Current file',
    style,
    identity: {
      logoUrl: normalizeUrl(elements.brandLogoUrl?.value || state.deck.brandKit?.identity?.logoUrl),
      textMark: (elements.brandTextMark?.value || state.deck.brandKit?.identity?.textMark || '').trim().slice(0, 24)
    },
    typography: {
      fontFamily: enumOption(elements.brandFontFamily?.value || designSystem.fontFamily, fontFamilyOptions, 'inter')
    },
    preferences: {
      iconMode: enumOption(elements.brandIconMode?.value || designSystem.iconMode, iconModeOptions, preset.iconMode || 'restrained'),
      imageStyle: enumOption(elements.brandImageStyle?.value || designSystem.imageStyle, imageStyleOptions, 'editorial'),
      density: enumOption(elements.brandDensity?.value || designSystem.density, densityOptions, 'standard'),
      composition: enumOption(elements.brandComposition?.value || designSystem.composition, compositionOptions, preset.composition || 'magazine')
    },
    colors: {
      accent: normalizeColor(state.deck.theme?.accent, preset.accent),
      background: normalizeColor(state.deck.theme?.background, preset.background),
      foreground: normalizeColor(state.deck.theme?.foreground, preset.foreground),
      muted: state.deck.theme?.muted || preset.muted,
      surface: state.deck.theme?.surface || preset.surface,
      media: state.deck.theme?.media || preset.media
    }
  };
}

function activeBrandKitModel() {
  const designSystem = state.deck.designSystem || {};
  const preset = stylePreset(activeDeckStyle());
  return {
    identity: {
      logoUrl: normalizeUrl(state.deck.brandKit?.identity?.logoUrl),
      textMark: (state.deck.brandKit?.identity?.textMark || '').trim().slice(0, 24)
    },
    typography: {
      fontFamily: enumOption(designSystem.fontFamily || state.deck.brandKit?.typography?.fontFamily, fontFamilyOptions, 'inter')
    },
    preferences: {
      iconMode: enumOption(designSystem.iconMode, iconModeOptions, preset.iconMode || 'restrained'),
      imageStyle: enumOption(designSystem.imageStyle, imageStyleOptions, 'editorial'),
      density: enumOption(designSystem.density, densityOptions, 'standard'),
      composition: enumOption(designSystem.composition, compositionOptions, preset.composition || 'magazine')
    }
  };
}

function activeSlideImageStyle(card = selectedCard()) {
  return enumOption(
    card?.design?.imageStyle || activeBrandKitModel().preferences.imageStyle,
    imageStyleOptions,
    'editorial'
  );
}

function updateBrandKitControls() {
  const brand = activeBrandKitModel();
  setInputValue(elements.brandLogoUrl, brand.identity.logoUrl);
  setInputValue(elements.brandTextMark, brand.identity.textMark);
  setInputValue(elements.brandFontFamily, brand.typography.fontFamily);
  setInputValue(elements.brandIconMode, brand.preferences.iconMode);
  setInputValue(elements.brandImageStyle, brand.preferences.imageStyle);
  setInputValue(elements.brandDensity, brand.preferences.density);
  setInputValue(elements.brandComposition, brand.preferences.composition);
}

function applyBrandPreferences(preferences = {}, identity = {}, typography = {}) {
  const style = activeDeckStyle();
  const preset = stylePreset(style);
  const iconMode = enumOption(preferences.iconMode, iconModeOptions, preset.iconMode || 'restrained');
  const imageStyle = enumOption(preferences.imageStyle, imageStyleOptions, 'editorial');
  const density = enumOption(preferences.density, densityOptions, 'standard');
  const composition = enumOption(preferences.composition, compositionOptions, preset.composition || 'magazine');
  const fontFamily = enumOption(typography.fontFamily, fontFamilyOptions, 'inter');

  state.deck.brandKit = {
    ...(state.deck.brandKit || {}),
    identity: {
      logoUrl: normalizeUrl(identity.logoUrl),
      textMark: String(identity.textMark || '').trim().slice(0, 24)
    },
    typography: { fontFamily },
    preferences: { iconMode, imageStyle, density, composition }
  };
  state.deck.designSystem = {
    ...(state.deck.designSystem || {}),
    iconMode,
    imageStyle,
    density,
    composition,
    fontFamily
  };
  if (Array.isArray(state.deck.cards)) {
    state.deck.cards.forEach(card => {
      card.design = {
        ...(card.design || {}),
        density,
        composition
      };
    });
  }
}

function applyBrandControlsToDeck() {
  applyBrandPreferences({
    iconMode: elements.brandIconMode?.value,
    imageStyle: elements.brandImageStyle?.value,
    density: elements.brandDensity?.value,
    composition: elements.brandComposition?.value
  }, {
    logoUrl: elements.brandLogoUrl?.value,
    textMark: elements.brandTextMark?.value
  }, {
    fontFamily: elements.brandFontFamily?.value
  });
}

function brandMarkMarkup() {
  const identity = activeBrandKitModel().identity;
  if (identity.logoUrl) {
    return `<span class="deck-brand-mark"><img src="${escapeHtml(identity.logoUrl)}" alt="${escapeHtml(identity.textMark || 'Brand mark')}"></span>`;
  }
  if (identity.textMark) {
    return `<span class="deck-brand-mark deck-brand-text">${escapeHtml(identity.textMark)}</span>`;
  }
  return '';
}

function cardStyle(card) {
  return card?.design?.style || activeDeckStyle();
}

function selectedCard() {
  return state.deck.cards[state.selectedSlideIndex] || null;
}

function availableTemplates() {
  if (state.templates.length) {
    return state.templates;
  }
  const embedded = state.deck.designSystem?.templates;
  return Array.isArray(embedded) ? embedded : [];
}

function selectedTemplateId(card = selectedCard()) {
  return card?.design?.templateId || card?.design?.template?.id || '';
}

async function loadTemplates() {
  try {
    const response = await apiFetch('/api/v1/deck-studio/templates');
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    const payload = await response.json();
    state.templates = Array.isArray(payload.templates) ? payload.templates : [];
    renderTemplateGallery();
  } catch (error) {
    state.templates = availableTemplates();
    renderTemplateGallery();
    setStatus(`Using embedded templates: ${error.message}`);
  }
}

function visualModelForCard(card, design = {}) {
  const model = card.visualModel || design.visualModel;
  return model && typeof model === 'object' ? model : null;
}

function renderVisualModel(model) {
  if (!model || typeof model !== 'object') {
    return '';
  }

  const title = model.title ? `<strong>${escapeHtml(model.title)}</strong>` : '';
  const type = String(model.type || '').toLowerCase();
  if ((type === 'bar-chart' || type === 'chart') && Array.isArray(model.items) && model.items.length) {
    const values = model.items.map(item => Number.parseFloat(String(item.value || item.amount || '').replace(/[^0-9.-]/g, ''))).filter(Number.isFinite);
    const max = Math.max(...values, 1);
    return `<div class="structured-visual structured-visual-chart" data-visual-type="${escapeHtml(type)}">${title}<div class="chart-bars">${model.items.slice(0, 6).map(item => {
      const rawValue = Number.parseFloat(String(item.value || item.amount || '').replace(/[^0-9.-]/g, ''));
      const width = Number.isFinite(rawValue) ? Math.max(8, Math.round((rawValue / max) * 100)) : 42;
      return `<div class="chart-row"><span>${escapeHtml(item.label || item.source || 'Value')}</span><i style="--bar:${width}%"></i><b>${escapeHtml(item.value || item.amount || '')}</b></div>`;
    }).join('')}</div></div>`;
  }

  if (type === 'metrics' && Array.isArray(model.items) && model.items.length) {
    return `<div class="structured-visual structured-visual-metrics" data-visual-type="metrics">${title}<dl>${model.items.map(item => `<div><dt>${escapeHtml(item.label || item.source || 'Metric')}</dt><dd>${escapeHtml(item.value || '')}</dd></div>`).join('')}</dl></div>`;
  }

  if ((type === 'timeline' || type === 'process') && Array.isArray(model.items) && model.items.length) {
    return `<div class="structured-visual structured-visual-${escapeHtml(type)}" data-visual-type="${escapeHtml(type)}">${title}<ol>${model.items.map((item, index) => `<li><span>${escapeHtml(item.marker || item.step || index + 1)}</span><em>${escapeHtml(item.label || item.source || '')}</em></li>`).join('')}</ol></div>`;
  }

  if (type === 'pros-cons') {
    const pros = Array.isArray(model.pros) ? model.pros : [];
    const cons = Array.isArray(model.cons) ? model.cons : [];
    if (!pros.length && !cons.length) {
      return '';
    }
    return `<div class="structured-visual structured-visual-pros-cons" data-visual-type="pros-cons">${title}<div class="structured-columns"><section><b>Pros</b><ul>${pros.map(item => `<li>${escapeHtml(item.label || item)}</li>`).join('')}</ul></section><section><b>Cons</b><ul>${cons.map(item => `<li>${escapeHtml(item.label || item)}</li>`).join('')}</ul></section></div></div>`;
  }

  if (type === 'comparison' && Array.isArray(model.rows) && model.rows.length) {
    return `<div class="structured-visual structured-visual-comparison" data-visual-type="comparison"><table><caption>${title}</caption><tbody>${model.rows.map(row => `<tr><td>${escapeHtml(row.left || row.label || '')}</td><td>${escapeHtml(row.right || row.value || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  if (type === 'table' && Array.isArray(model.rows) && model.rows.length) {
    return `<div class="structured-visual structured-visual-table" data-visual-type="table"><table><caption>${title}</caption><tbody>${model.rows.map(row => `<tr><th scope="row">${escapeHtml(row.label || '')}</th><td>${escapeHtml(row.value || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  return '';
}

function cardPoints(card) {
  return Array.isArray(card?.points) ? card.points : [];
}

function pointIconMarkup(point, pointIndex, bulletIcons, icons) {
  return `<span class="point-icon" title="${escapeHtml(bulletIcons[pointIndex]?.query || point)}">${iconSvg(bulletIcons[pointIndex]?.icon || icons[pointIndex % icons.length])}</span>`;
}

function editablePoint(point, pointIndex) {
  return `<span contenteditable="true" data-field="point" data-point-index="${pointIndex}">${escapeHtml(point)}</span>`;
}

function editableTitle(card) {
  return `<h2 contenteditable="true" data-field="title">${escapeHtml(card.title)}</h2>`;
}

function editableBody(card) {
  return `<p contenteditable="true" data-field="body">${escapeHtml(card.body)}</p>`;
}

function renderSlideChrome(role, layout, icons, index) {
  return `
    <span class="role-badge">${iconSvg(icons[0])}<span>${escapeHtml(role)}</span></span>
    <span class="slide-label">Slide ${index + 1} · ${escapeHtml(layout.replace(/-/g, ' '))}</span>
    ${brandMarkMarkup()}
  `;
}

function renderPointList(card, bulletIcons, icons, className = 'slide-points') {
  return `<ul class="${className}">${cardPoints(card).map((point, pointIndex) => `<li>${pointIconMarkup(point, pointIndex, bulletIcons, icons)}${editablePoint(point, pointIndex)}</li>`).join('')}</ul>`;
}

function splitPoints(points) {
  const midpoint = Math.ceil(points.length / 2);
  return [points.slice(0, midpoint), points.slice(midpoint)];
}

function renderMediaBlock(card, context, className = 'slide-media') {
  const { design, layout, icons, quietIcons, structuredVisual, visualModel } = context;
  return `
    <div class="${className}">
      ${card.image_url ? `<img src="${escapeHtml(card.image_url)}" alt="">` : structuredVisual || (quietIcons ? '' : `<div class="icon-cluster">${icons.slice(0, 2).map(iconSvg).join('')}</div>`)}
      <span class="visual-note" contenteditable="true" data-field="visual">${escapeHtml(visualLabel(card.visual, layout))}</span>
      <small class="visual-kind">${escapeHtml(visualModel?.type || design.visualTreatment || design.mediaStyle || 'generated visual direction')}</small>
    </div>
  `;
}

function renderTitleTemplate(card, context) {
  return `
    <div class="slide-content title-hero-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${card.subtitle ? `<p class="slide-subtitle">${escapeHtml(card.subtitle)}</p>` : ''}
      ${editableBody(card)}
      ${renderPointList(card, context.bulletIcons, context.icons, 'title-proof-points')}
    </div>
    ${renderMediaBlock(card, context, 'slide-media title-hero-media')}
  `;
}

function renderAgendaTemplate(card, context) {
  return `
    <div class="slide-content agenda-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <ol class="agenda-list">
      ${cardPoints(card).map((point, pointIndex) => `<li><span class="agenda-number">${String(pointIndex + 1).padStart(2, '0')}</span>${editablePoint(point, pointIndex)}</li>`).join('')}
    </ol>
  `;
}

function renderSectionBreakTemplate(card, context) {
  return `
    <div class="slide-content section-break-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      <span class="section-kicker">${escapeHtml(visualLabel(card.visual, 'section'))}</span>
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
  `;
}

function renderMetricsTemplate(card, context) {
  if (context.structuredVisual) {
    return `
      <div class="slide-content metrics-copy">
        ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
        ${editableTitle(card)}
        ${editableBody(card)}
      </div>
      ${context.structuredVisual}
    `;
  }
  return `
    <div class="slide-content metrics-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <div class="metrics-grid">
      ${cardPoints(card).map((point, pointIndex) => `<div class="metric-tile">${pointIconMarkup(point, pointIndex, context.bulletIcons, context.icons)}<strong>${escapeHtml(point.split(/\s+/).slice(0, 2).join(' '))}</strong>${editablePoint(point, pointIndex)}</div>`).join('')}
    </div>
  `;
}

function renderTimelineTemplate(card, context) {
  return `
    <div class="slide-content timeline-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <ol class="timeline-track">
      ${cardPoints(card).map((point, pointIndex) => `<li><span class="timeline-marker">${pointIconMarkup(point, pointIndex, context.bulletIcons, context.icons)}</span><small>Phase ${pointIndex + 1}</small>${editablePoint(point, pointIndex)}</li>`).join('')}
    </ol>
  `;
}

function renderProcessTemplate(card, context) {
  return `
    <div class="slide-content process-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <div class="process-flow">
      ${cardPoints(card).map((point, pointIndex) => `<div class="process-step"><span>${pointIndex + 1}</span>${pointIconMarkup(point, pointIndex, context.bulletIcons, context.icons)}${editablePoint(point, pointIndex)}</div>`).join('')}
    </div>
  `;
}

function renderComparisonTemplate(card, context) {
  const [left, right] = splitPoints(cardPoints(card));
  const renderColumn = (points, label, offset) => `
    <div class="comparison-column">
      <strong>${label}</strong>
      <div class="decision-list">${points.map((point, pointIndex) => `<div class="decision-item">${pointIconMarkup(point, pointIndex + offset, context.bulletIcons, context.icons)}${editablePoint(point, pointIndex + offset)}</div>`).join('')}</div>
    </div>
  `;
  return `
    <div class="slide-content comparison-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <div class="comparison-panels">
      ${renderColumn(left, 'Option A', 0)}
      ${renderColumn(right, 'Option B', left.length)}
    </div>
  `;
}

function renderProsConsTemplate(card, context) {
  const [pros, cons] = splitPoints(cardPoints(card));
  const renderColumn = (points, label, icon, offset) => `
    <div class="pros-cons-column ${label.toLowerCase().replace(/\s+/g, '-')}">
      <strong>${iconSvg(icon)}${escapeHtml(label)}</strong>
      <div class="decision-list">${points.map((point, pointIndex) => `<div class="decision-item">${pointIconMarkup(point, pointIndex + offset, context.bulletIcons, context.icons)}${editablePoint(point, pointIndex + offset)}</div>`).join('')}</div>
    </div>
  `;
  return `
    <div class="slide-content pros-cons-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <div class="pros-cons-grid">
      ${renderColumn(pros, 'Upside', 'thumbs-up', 0)}
      ${renderColumn(cons, 'Watchouts', 'triangle-alert', pros.length)}
    </div>
  `;
}

function renderQuoteTemplate(card, context) {
  return `
    <figure class="quote-layout">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      <blockquote contenteditable="true" data-field="body">${escapeHtml(card.body || card.title)}</blockquote>
      <figcaption contenteditable="true" data-field="title">${escapeHtml(card.title)}</figcaption>
      ${renderPointList(card, context.bulletIcons, context.icons, 'quote-proof-points')}
    </figure>
    ${renderMediaBlock(card, context, 'slide-media quote-media')}
  `;
}

function renderImageLedTemplate(card, context) {
  return `
    ${renderMediaBlock(card, context, 'slide-media image-led-frame')}
    <div class="slide-content image-led-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
      ${renderPointList(card, context.bulletIcons, context.icons, 'image-led-points')}
    </div>
  `;
}

function renderTableListTemplate(card, context) {
  if (context.structuredVisual) {
    return `
      <div class="slide-content table-list-copy">
        ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
        ${editableTitle(card)}
        ${editableBody(card)}
      </div>
      ${context.structuredVisual}
    `;
  }
  return `
    <div class="slide-content table-list-copy">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
    </div>
    <div class="structured-table" role="table">
      ${cardPoints(card).map((point, pointIndex) => `<div class="structured-row" role="row"><span>${String(pointIndex + 1).padStart(2, '0')}</span>${pointIconMarkup(point, pointIndex, context.bulletIcons, context.icons)}${editablePoint(point, pointIndex)}</div>`).join('')}
    </div>
  `;
}

function renderDefaultTemplate(card, context) {
  return `
    <div class="slide-content">
      ${renderSlideChrome(context.role, context.layout, context.icons, context.index)}
      ${editableTitle(card)}
      ${editableBody(card)}
      ${renderPointList(card, context.bulletIcons, context.icons)}
    </div>
    ${renderMediaBlock(card, context)}
  `;
}

function renderSlideTemplate(card, context) {
  if (context.layout === 'title') return renderTitleTemplate(card, context);
  if (context.layout === 'agenda') return renderAgendaTemplate(card, context);
  if (context.layout === 'section-break') return renderSectionBreakTemplate(card, context);
  if (context.layout === 'metric-grid') return renderMetricsTemplate(card, context);
  if (context.layout === 'timeline') return renderTimelineTemplate(card, context);
  if (context.layout === 'process') return renderProcessTemplate(card, context);
  if (context.layout === 'comparison') return renderComparisonTemplate(card, context);
  if (context.layout === 'pros-cons') return renderProsConsTemplate(card, context);
  if (context.layout === 'quote') return renderQuoteTemplate(card, context);
  if (context.layout === 'image-led' || context.layout === 'image-left' || context.layout === 'image-right') return renderImageLedTemplate(card, context);
  if (context.layout === 'table-list') return renderTableListTemplate(card, context);
  return renderDefaultTemplate(card, context);
}

function renderSlideCard(card, index) {
  const deck = state.deck;
  const design = card.design || {};
  const template = design.template || {};
  const layout = template.layoutFamily || design.layout || 'statement';
  const role = design.semanticRole || 'neutral';
  const slideStyle = cardStyle(card);
  const slidePreset = stylePreset(slideStyle);
  const accent = design.accent || slidePreset.accent || deck.theme?.accent || '#2f6f73';
  const icons = Array.isArray(design.icons) && design.icons.length ? design.icons : ['info'];
  const bulletIcons = Array.isArray(design.bulletIcons) && design.bulletIcons.length
    ? design.bulletIcons
    : cardPoints(card).map((point, pointIndex) => ({ icon: icons[pointIndex % icons.length], query: point }));
  const quietIcons = (deck.designSystem?.iconMode || 'restrained') === 'minimal';
  const visualModel = visualModelForCard(card, design);
  const structuredVisual = renderVisualModel(visualModel);
  const templateVariant = template.variant || design.templateVariant || 'standard';
  const templateCategory = template.category || 'general';
  const context = { deck, design, layout, role, icons, bulletIcons, quietIcons, index, visualModel, structuredVisual };
  return `
    <section class="slide-card layout-${escapeHtml(layout)} role-${escapeHtml(role)} density-${escapeHtml(design.density || 'standard')} composition-${escapeHtml(design.composition || deck.designSystem?.composition || 'magazine')} slide-style-${escapeHtml(slideStyle)} template-${escapeHtml(templateVariant)} category-${escapeHtml(templateCategory)} ${index === state.selectedSlideIndex ? 'is-selected' : ''}" data-index="${index}" data-template="${escapeHtml(template.id || design.templateId || '')}" style="--card-accent:${escapeHtml(accent)};--deck-surface:${escapeHtml(slidePreset.surface || deck.theme?.surface || '#ffffff')};--deck-media:${escapeHtml(slidePreset.media || deck.theme?.media || '#efe7db')}">
      ${renderSlideTemplate(card, context)}
    </section>
  `;
}

function renderPresentView() {
  const cards = Array.isArray(state.deck.cards) ? state.deck.cards : [];
  if (!elements.presentView) {
    return;
  }
  if (!cards.length) {
    elements.presentView.innerHTML = '<p class="empty-state">Generate or open slides to present.</p>';
    return;
  }

  const index = Math.max(0, Math.min(state.selectedSlideIndex, cards.length - 1));
  elements.presentView.innerHTML = `
    <div class="present-topbar">
      <div>
        <strong>${escapeHtml(state.deck.title || 'Untitled file')}</strong>
        <span>${escapeHtml(index + 1)} / ${escapeHtml(cards.length)}</span>
      </div>
      <div class="present-actions">
        <button type="button" data-present-prev ${index <= 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" data-present-next ${index >= cards.length - 1 ? 'disabled' : ''}>Next</button>
        <button type="button" data-present-close>Exit</button>
      </div>
    </div>
    <div class="present-stage">
      ${renderSlideCard(cards[index], index)}
    </div>
  `;
}

function ensureDocumentSignatureBlocks(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  if (Array.isArray(documentModel.signature_blocks) && documentModel.signature_blocks.length) {
    return documentModel.signature_blocks;
  }
  const parties = Array.isArray(documentModel.parties) ? documentModel.parties : [];
  documentModel.signature_blocks = parties.length
    ? parties.map(party => ({
      party: party.name || party.role || 'Party',
      signatory_title: '[Authorized Signatory]'
    }))
    : [{ party: 'Signer', signatory_title: '[Authorized Signatory]' }];
  return documentModel.signature_blocks;
}

function ensureDocumentParties(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.parties = Array.isArray(documentModel.parties) ? documentModel.parties : [];
  return documentModel.parties;
}

function ensureDocumentSections(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.sections = Array.isArray(documentModel.sections) ? documentModel.sections : [];
  return documentModel.sections;
}

function ensureDocumentReviewNotes(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.review_notes = Array.isArray(documentModel.review_notes) ? documentModel.review_notes : [];
  return documentModel.review_notes;
}

function ensureDocumentComments(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.comments = Array.isArray(documentModel.comments) ? documentModel.comments : [];
  return documentModel.comments;
}

function ensureDocumentSharedWith(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.shared_with = Array.isArray(documentModel.shared_with) ? documentModel.shared_with : [];
  return documentModel.shared_with;
}

function signedDateForInput(block) {
  const value = block?.signed_date || block?.signed_at || '';
  if (!value) {
    return '';
  }
  return String(value).slice(0, 10);
}

function signatureImage(block) {
  const value = String(block?.signature_image || block?.signature_data_url || '');
  return /^data:image\/png;base64,/i.test(value) ? value : '';
}

function editableDocAttrs(attrs = '') {
  return `contenteditable="true" data-doc-edit="true" ${attrs} spellcheck="true"`;
}

function hiddenDocumentFields(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  documentModel.hidden_fields = Array.isArray(documentModel.hidden_fields) ? documentModel.hidden_fields : [];
  return documentModel.hidden_fields;
}

function documentFieldVisible(documentModel, field) {
  return hiddenDocumentFields(documentModel).indexOf(field) === -1;
}

function renderDocumentBreadcrumbs(deck, documentModel) {
  if (!state.documentEditor) {
    return '';
  }
  const matterId = currentMatterId();
  const params = new URLSearchParams(window.location.search);
  const matterName = params.get('matter_name') || params.get('workspace_name') || matterId || 'Workspace';
  const documentsLabel = matterId ? `${matterName} Documents` : 'Documents';
  const items = [{ label: documentsLabel, href: matterId ? `workspace-details.html?id=${encodeURIComponent(matterId)}&tab=documents` : 'workspaces.html' }];
  const fileId = currentDocumentFileId();
  if (fileId) {
    const fileName = params.get('file_name') || 'File Viewer';
    items.push({ label: fileName, href: `file-viewer.html?id=${encodeURIComponent(fileId)}` });
  }
  items.push({ label: documentModel.title || deck.title || 'Doc Studio' });
  return `<lex-breadcrumb class="doc-editor-breadcrumb" items="${escapeHtml(JSON.stringify(items))}"></lex-breadcrumb>`;
}

function renderDocumentHeaderChrome(deck) {
  const documentModel = deck.document && typeof deck.document === 'object' ? deck.document : null;
  const showDocChrome = state.view === 'doc' && state.documentEditor && documentModel;
  if (elements.standardHeader) {
    elements.standardHeader.classList.toggle('hidden', !!showDocChrome);
  }
  if (elements.docHeaderChrome) {
    elements.docHeaderChrome.classList.toggle('hidden', !showDocChrome);
  }
  if (!showDocChrome) {
    if (elements.docHeaderBreadcrumbs) {
      elements.docHeaderBreadcrumbs.innerHTML = '';
    }
    return;
  }
  if (elements.docHeaderBanner) {
    elements.docHeaderBanner.setAttribute('heading', documentModel.title || deck.title || 'Untitled file');
    const saveState = state.documentDirty ? 'Unsaved changes' : 'Saved';
    elements.docHeaderBanner.setAttribute('subtitle', `${saveState} · ${formatLastSaved(state.documentLastSavedAt)}`);
    const saveButton = elements.docHeaderChrome.querySelector('[data-save-document]');
    if (saveButton) {
      saveButton.textContent = state.presentationId ? 'Save document' : 'Save document copy';
    }
  }
  updateDocumentHistoryControls();
  if (elements.docHeaderBreadcrumbs) {
    elements.docHeaderBreadcrumbs.innerHTML = renderDocumentBreadcrumbs(deck, documentModel);
  }
}

function renderDocumentMeta(documentModel) {
  const fields = [
    { key: 'effective_date', label: 'Effective date', fallback: '[Effective Date]' },
    { key: 'jurisdiction', label: 'Governing law', fallback: '[Jurisdiction]' }
  ].filter(field => documentFieldVisible(documentModel, field.key));
  if (!fields.length) {
    return '';
  }
  return `
    <dl class="legal-doc-meta">
      ${fields.map(field => `
        <div class="legal-doc-meta-card">
          <button type="button" class="doc-meta-delete" data-doc-delete-meta="${escapeHtml(field.key)}" aria-label="Remove ${escapeHtml(field.label)}">Delete</button>
          <dt>${escapeHtml(field.label)}</dt>
          <dd ${editableDocAttrs(`data-doc-field="${field.key}"`)}>${escapeHtml(documentModel[field.key] || field.fallback)}</dd>
        </div>
      `).join('')}
    </dl>
  `;
}

function currentUserLabel() {
  try {
    const profile = JSON.parse(localStorage.getItem('user') || localStorage.getItem('lana_user') || 'null');
    return profile?.name || profile?.email || profile?.username || 'You';
  } catch (_error) {
    return 'You';
  }
}

function currentUserInitials() {
  const label = currentUserLabel();
  const parts = String(label || 'U').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return String(label || 'U').slice(0, 2).toUpperCase();
}

function renderDocPanelEmpty(message, description, icon = 'document') {
  return `
    <lex-empty
      class="doc-panel-empty"
      size="compact"
      icon="${escapeHtml(icon)}"
      message="${escapeHtml(message)}"
      description="${escapeHtml(description)}"
    ></lex-empty>
  `;
}

function renderDocumentComments(documentModel) {
  const fileId = currentDocumentFileId();
  const comments = fileId ? state.documentComments : ensureDocumentComments(documentModel);
  return `
    <section class="legal-doc-section doc-collaboration">
      <div class="section-heading-row">
        <h2>Comments</h2>
        ${fileId && !state.documentCollaborationLoaded ? '<small>Loading document comments...</small>' : ''}
      </div>
      <lex-document-comment-composer
        initials="${escapeHtml(currentUserInitials())}"
        placeholder="Add a comment... (type @ to mention teammates, # to reference documents)"
        submit-label="Post Comment"
      ></lex-document-comment-composer>
      <ul class="doc-comment-list">
        ${comments.length ? comments.map((comment, index) => `
          <li class="doc-comment">
            <div>
              <strong>${escapeHtml(comment.author || comment.user_name || comment.user_email || 'Comment')}</strong>
              <small>${escapeHtml(formatDate(comment.created_at))}</small>
            </div>
            <small>Location: ${escapeHtml(comment.location || comment.anchor_text || comment.metadata?.location || comment.metadata?.section || 'Document')}</small>
            <p>${escapeHtml(comment.body || comment.content || '')}</p>
            <lex-btn type="button" size="sm" variant="ghost" data-doc-delete-comment="${escapeHtml(comment.id || String(index))}">Delete</lex-btn>
          </li>
        `).join('') : ''}
      </ul>
      ${comments.length ? '' : renderDocPanelEmpty('No comments yet', 'Use comments to ask questions, tag teammates, or capture review notes for this document.', 'inbox')}
    </section>
  `;
}

function renderDocumentCollaboration(documentModel) {
  const fileId = currentDocumentFileId();
  const matterId = currentMatterId();
  const draftSharedWith = ensureDocumentSharedWith(documentModel);
  const collaboratorOptions = state.documentCollaborators
    .filter(user => !state.documentPermissions.some(permission => permission.user_id === user.id))
    .map(user => ({
      value: user.id,
      label: user.name || user.email || 'Matter coworker',
      description: user.email || ''
    }));
  return `
    <section class="legal-doc-section doc-share">
      <div class="section-heading-row">
        <h2>Collaborate</h2>
      </div>
      <div class="doc-share-composer">
        ${fileId && matterId ? `
          <lex-select
            data-doc-share-input
            placeholder="${collaboratorOptions.length ? 'Search matter coworkers' : 'No additional matter coworkers found'}"
            searchable
            clearable
            ${collaboratorOptions.length ? '' : 'disabled'}
            options="${escapeHtml(JSON.stringify(collaboratorOptions))}"
          ></lex-select>
        ` : '<input data-doc-share-input placeholder="Coworker name or email">'}
        <lex-btn type="button" variant="secondary" data-doc-add-share>${fileId ? 'Grant access' : 'Add coworker'}</lex-btn>
      </div>
      <div class="doc-share-list">
        ${fileId
          ? (state.documentPermissions.length ? state.documentPermissions.map(permission => {
            const label = permission.user_email || permission.username || permission.role_name || permission.permission || 'Access grant';
            const removableId = permission.user_id || '';
            return `
              <span class="doc-share-chip">
                ${escapeHtml(label)}
                ${removableId ? `<button type="button" data-doc-remove-share="${escapeHtml(removableId)}" aria-label="Remove ${escapeHtml(label)}">×</button>` : ''}
              </span>
            `;
          }).join('') : '')
          : (draftSharedWith.length ? draftSharedWith.map((recipient, index) => `
            <span class="doc-share-chip">
              ${escapeHtml(recipient)}
              <button type="button" data-doc-remove-share="${index}" aria-label="Remove ${escapeHtml(recipient)}">×</button>
            </span>
          `).join('') : '')}
      </div>
      ${(fileId ? state.documentPermissions.length : draftSharedWith.length) ? '' : renderDocPanelEmpty('No collaborators yet', 'Grant access to matter coworkers when this draft is ready for review or signature prep.', 'folder')}
    </section>
  `;
}

function ensureDocumentActivity(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  if (!Array.isArray(documentModel.activity_history)) {
    documentModel.activity_history = [];
  }
  return documentModel.activity_history;
}

function ensureDocumentVersions(documentModel) {
  if (!documentModel || typeof documentModel !== 'object') {
    return [];
  }
  if (!Array.isArray(documentModel.versions)) {
    documentModel.versions = [{
      version: 1,
      label: 'Initial draft',
      created_at: state.documentLastSavedAt || LanaTime.nowIso(),
      summary: 'Generated document draft',
      document: JSON.parse(JSON.stringify(documentModel))
    }];
  }
  return documentModel.versions;
}

function documentTextForDiff(documentModel) {
  if (!documentModel) {
    return '';
  }
  const lines = [
    documentModel.title || '',
    documentModel.subtitle || '',
    documentModel.effective_date ? `Effective date: ${documentModel.effective_date}` : '',
    documentModel.jurisdiction ? `Governing law: ${documentModel.jurisdiction}` : '',
    ...(Array.isArray(documentModel.parties) ? documentModel.parties.map(party => `${party.role || 'Party'}: ${party.name || ''} ${party.address || ''}`) : []),
    ...(Array.isArray(documentModel.sections) ? documentModel.sections.flatMap(section => [section.heading || '', section.body || '']) : []),
    ...(Array.isArray(documentModel.review_notes) ? documentModel.review_notes.map(note => `Review note: ${note}`) : [])
  ];
  return lines.map(line => String(line || '').trim()).filter(Boolean).join('\n');
}

function documentVersionSnapshot(documentModel) {
  const snapshot = JSON.parse(JSON.stringify(documentModel || {}));
  delete snapshot.versions;
  delete snapshot.activity_history;
  delete snapshot.comments;
  delete snapshot.shared_with;
  return snapshot;
}

function recordDocumentSaveActivity(kind = 'save') {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel) {
    return;
  }
  const versions = ensureDocumentVersions(documentModel);
  const nextVersion = versions.length
    ? Math.max(...versions.map(version => Number(version.version) || 0)) + 1
    : 1;
  const createdAt = LanaTime.nowIso();
  const summary = kind === 'autosave' ? 'Autosaved document edits' : 'Saved document edits';
  versions.push({
    version: nextVersion,
    label: summary,
    created_at: createdAt,
    summary,
    document: documentVersionSnapshot(documentModel)
  });
  if (versions.length > 30) {
    versions.splice(0, versions.length - 30);
  }
  ensureDocumentActivity(documentModel).push({
    action: kind === 'autosave' ? 'Autosaved document' : 'Saved document',
    summary,
    version: nextVersion,
    created_at: createdAt
  });
  if (documentModel.activity_history.length > 100) {
    documentModel.activity_history.splice(0, documentModel.activity_history.length - 100);
  }
  state.documentLastSavedAt = createdAt;
}

function renderSimpleDiff(fromText, toText) {
  const before = String(fromText || '').split('\n').filter(Boolean);
  const after = String(toText || '').split('\n').filter(Boolean);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const removed = before.filter(line => !afterSet.has(line));
  const added = after.filter(line => !beforeSet.has(line));
  if (!removed.length && !added.length) {
    return '<p class="doc-empty-row">No text differences from the current document.</p>';
  }
  return `
    <div class="doc-diff">
      ${removed.map(line => `<div class="diff-line removed">- ${escapeHtml(line)}</div>`).join('')}
      ${added.map(line => `<div class="diff-line added">+ ${escapeHtml(line)}</div>`).join('')}
    </div>
  `;
}

function renderDocumentSidePanel(deck) {
  if (!elements.docSidePanel) {
    return;
  }
  const documentModel = deck.document && typeof deck.document === 'object' ? deck.document : null;
  if (!documentModel) {
    elements.docSidePanel.innerHTML = '';
    return;
  }
  const activeTab = state.documentPanelTab || 'comments';
  const tabs = ['history', 'versions', 'comments', 'collaborate'];
  const activity = ensureDocumentActivity(documentModel).slice().reverse();
  const versions = ensureDocumentVersions(documentModel)
    .slice()
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 25);
  const selectedVersion = versions.find(version => String(version.version) === String(state.selectedDocumentVersion)) || versions[0];
  const commentsMarkup = renderDocumentComments(documentModel);
  const collaborateMarkup = renderDocumentCollaboration(documentModel);
  const historyMarkup = activity.length ? `
    <ol class="doc-history-list">
      ${activity.map(item => `
        <li>
          <strong>${escapeHtml(item.action || 'Document updated')}</strong>
          <span>${escapeHtml(item.summary || '')}</span>
          <small>${escapeHtml(formatDate(item.created_at))}${item.version ? ` · v${escapeHtml(item.version)}` : ''}</small>
        </li>
      `).join('')}
    </ol>
  ` : renderDocPanelEmpty('No history yet', 'Document edits, saves, exports, and collaboration activity will appear here.', 'document');
  const versionsMarkup = versions.length ? `
    <div class="doc-version-list">
      ${versions.map(version => `
        <button type="button" class="${selectedVersion?.version === version.version ? 'active' : ''}" data-doc-version="${escapeHtml(version.version)}">
          <strong>${escapeHtml(version.summary || version.label || 'Saved document version')}</strong>
          <span>Version ${escapeHtml(version.version)}</span>
          <small>${escapeHtml(formatDate(version.created_at))}</small>
        </button>
      `).join('')}
    </div>
    <div class="doc-version-diff">
      <h3>Changes from selected version</h3>
      ${renderSimpleDiff(documentTextForDiff(selectedVersion?.document), documentTextForDiff(documentModel))}
    </div>
  ` : renderDocPanelEmpty('No versions yet', 'Saved versions will appear here after the document is created or edited.', 'document');
  const panelBody = activeTab === 'history'
    ? historyMarkup
    : activeTab === 'versions'
      ? versionsMarkup
      : activeTab === 'collaborate'
        ? collaborateMarkup
        : commentsMarkup;
  elements.docSidePanel.innerHTML = `
    <lex-segmented class="doc-side-tabs" size="sm" value="${escapeHtml(activeTab)}" options='${escapeHtml(JSON.stringify(tabs.map(tab => ({ value: tab, label: tab === 'collaborate' ? 'Collaborate' : `${tab[0].toUpperCase()}${tab.slice(1)}` }))))}'></lex-segmented>
    <div class="doc-side-body">${panelBody}</div>
  `;
}

function renderDocumentView(deck) {
  const documentModel = deck.document && typeof deck.document === 'object' ? deck.document : null;
  if (documentModel) {
    const parties = ensureDocumentParties(documentModel);
    const sections = ensureDocumentSections(documentModel);
    const signatures = ensureDocumentSignatureBlocks(documentModel);
    const notes = ensureDocumentReviewNotes(documentModel);
    return `
      <header class="legal-doc-title-block">
        <p>${escapeHtml(String(documentModel.document_type || 'legal document').replace(/_/g, ' '))}</p>
        <h1 ${editableDocAttrs('data-doc-field="title"')}>${escapeHtml(documentModel.title || deck.title || 'Legal Document')}</h1>
        <span ${editableDocAttrs('data-doc-field="subtitle"')}>${escapeHtml(documentModel.subtitle || deck.subtitle || 'Generated working draft')}</span>
      </header>
      ${renderDocumentMeta(documentModel)}
      <section class="legal-doc-section">
        <div class="section-heading-row">
          <h2>Parties</h2>
          <button type="button" data-doc-add-party>Add party</button>
        </div>
        <ul>${parties.map((party, index) => `
          <li class="doc-list-row" data-doc-party="${index}">
            <span>
              <strong ${editableDocAttrs(`data-doc-field="party_role" data-doc-index="${index}"`)}>${escapeHtml(party.role || 'Party')}</strong>:
              <span ${editableDocAttrs(`data-doc-field="party_name" data-doc-index="${index}"`)}>${escapeHtml(party.name || '')}</span>
              <span class="party-address" ${editableDocAttrs(`data-doc-field="party_address" data-doc-index="${index}" data-placeholder=", address"`)}>${escapeHtml(party.address || '')}</span>
            </span>
            <button type="button" data-doc-delete-party="${index}" aria-label="Delete party ${escapeHtml(String(index + 1))}">Delete</button>
          </li>
        `).join('')}</ul>
      </section>
      ${sections.map((section, index) => `
        <section class="legal-doc-section">
          <div class="section-heading-row">
            <h2 ${editableDocAttrs(`data-doc-field="section_heading" data-doc-index="${index}"`)}>${escapeHtml(section.heading || '')}</h2>
            <button type="button" data-doc-delete-section="${index}">Delete section</button>
          </div>
          <p ${editableDocAttrs(`data-doc-field="section_body" data-doc-index="${index}"`)}>${escapeHtml(section.body || '')}</p>
        </section>
      `).join('')}
      <section class="legal-doc-section doc-add-section-row">
        <button type="button" data-doc-add-section>Add section</button>
      </section>
      <section class="legal-doc-section signature-section">
        <div class="section-heading-row">
          <h2>Signatures</h2>
          <button type="button" data-save-signatures>${state.presentationId ? 'Save signatures' : 'Save document copy'}</button>
        </div>
        <div class="signature-grid">
          ${signatures.map((block, index) => {
            const signatureText = block.signature_text || block.signature || '';
            const drawnSignature = signatureImage(block);
            const signedBy = block.signed_by || '';
            const signedTitle = block.signed_title || block.signatory_title || '';
            const signedDate = signedDateForInput(block);
            const isSigned = drawnSignature || signatureText || signedBy || signedDate;
            return `
            <div class="signature-card ${isSigned ? 'is-signed' : ''}" data-signature-index="${index}">
              <strong>${escapeHtml(block.party || 'Party')}</strong>
              <div class="signature-pad-shell">
                <canvas class="signature-pad" data-signature-pad="${index}" width="720" height="220" aria-label="Draw signature for ${escapeHtml(block.party || 'party')}"></canvas>
                ${drawnSignature ? `<img class="signature-preview" src="${escapeHtml(drawnSignature)}" alt="Saved drawn signature">` : ''}
              </div>
              <div class="signature-actions">
                <button type="button" data-signature-pad-use="${index}">Use drawing</button>
                <button type="button" data-signature-pad-erase="${index}">Erase drawing</button>
              </div>
              <label>
                <span>Signature</span>
                <textarea data-signature-field="signature_text" data-signature-index="${index}" rows="3" placeholder="Type legal signature">${escapeHtml(signatureText)}</textarea>
              </label>
              <label>
                <span>Name</span>
                <input data-signature-field="signed_by" data-signature-index="${index}" value="${escapeHtml(signedBy)}" placeholder="Authorized signer">
              </label>
              <label>
                <span>Title</span>
                <input data-signature-field="signed_title" data-signature-index="${index}" value="${escapeHtml(signedTitle)}" placeholder="${escapeHtml(block.signatory_title || '[Authorized Signatory]')}">
              </label>
              <label>
                <span>Date</span>
                <input type="date" data-signature-field="signed_date" data-signature-index="${index}" value="${escapeHtml(signedDate)}">
              </label>
              <div class="signature-actions">
                <button type="button" data-signature-sign="${index}">Sign</button>
                <button type="button" data-signature-clear="${index}">Clear</button>
              </div>
              ${isSigned ? `<small>Signed${signedDate ? ` on ${escapeHtml(signedDate)}` : ''}</small>` : '<small>Awaiting signature</small>'}
            </div>
          `;
          }).join('')}
        </div>
      </section>
      <section class="legal-doc-section review-notes">
        <div class="section-heading-row">
          <h2>Review Notes</h2>
          <button type="button" data-doc-add-review-note>Add note</button>
        </div>
        <ul>${notes.map((note, index) => `
          <li class="doc-list-row">
            <span ${editableDocAttrs(`data-doc-field="review_note" data-doc-index="${index}"`)}>${escapeHtml(note)}</span>
            <button type="button" data-doc-delete-review-note="${index}">Delete</button>
          </li>
        `).join('')}</ul>
      </section>
    `;
  }

  return `
    <h2>${escapeHtml(deck.title)}</h2>
    <p>${escapeHtml(deck.subtitle)}</p>
    ${deck.cards.map(card => `
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(card.body)}</p>
      <ul>${cardPoints(card).map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>
      ${card.image_url ? `<img src="${escapeHtml(card.image_url)}" alt="">` : ''}
    `).join('')}
  `;
}

function render() {
  const deck = state.deck;
  if (state.selectedSlideIndex >= deck.cards.length) {
    state.selectedSlideIndex = Math.max(0, deck.cards.length - 1);
  }
  document.documentElement.style.setProperty('--accent', deck.theme?.accent || '#2f6f73');
  document.documentElement.style.setProperty('--deck-bg', deck.theme?.background || '#f7f4ef');
  document.documentElement.style.setProperty('--deck-fg', deck.theme?.foreground || '#17201f');
  document.documentElement.style.setProperty('--deck-muted', deck.theme?.muted || '#66706c');
  document.documentElement.style.setProperty('--deck-surface', deck.theme?.surface || '#ffffff');
  document.documentElement.style.setProperty('--deck-media', deck.theme?.media || '#efe7db');
  document.documentElement.style.setProperty('--deck-radius', deck.theme?.radius || '6px');
  document.documentElement.style.setProperty('--deck-shadow', deck.theme?.shadow || '0 18px 44px rgba(23, 32, 31, 0.12)');
  const brand = activeBrandKitModel();
  document.documentElement.style.setProperty('--deck-font-family', deckFontFamilies[brand.typography.fontFamily] || deckFontFamilies.inter);
  document.body.dataset.deckStyle = activeDeckStyle();
  document.body.dataset.embedded = state.embedded ? 'true' : 'false';
  document.body.dataset.docStudioView = state.view || 'slides';
  document.body.dataset.composition = brand.preferences.composition;
  document.body.dataset.typeScale = deck.designSystem?.typeScale || deck.designSystem?.stylePreset?.typeScale || 'editorial';
  document.body.dataset.imageStyle = brand.preferences.imageStyle;
  elements.deckTitle.textContent = deck.title || 'Untitled file';
  elements.deckSubtitle.textContent = deck.subtitle || '';
  setInputValue(elements.metadataTitle, deck.title || 'Untitled file');
  setInputValue(elements.metadataSubtitle, deck.subtitle || '');
  setInputValue(elements.themeAccent, normalizeColor(deck.theme?.accent, '#2f6f73'));
  setInputValue(elements.themeBackground, normalizeColor(deck.theme?.background, '#f7f4ef'));
  setInputValue(elements.themeForeground, normalizeColor(deck.theme?.foreground, '#17201f'));
  setInputValue(elements.style, activeDeckStyle());
  renderDocumentHeaderChrome(deck);
  updateBrandKitControls();
  renderBrandKitControls();
  renderEditorTools();
  renderCriticPanel();

  elements.slidesView.innerHTML = deck.cards.map((card, index) => renderSlideCard(card, index)).join('');
  renderPresentView();

  elements.docView.innerHTML = renderDocumentView(deck);
  renderDocumentSidePanel(deck);

  elements.slidesView.classList.toggle('hidden', state.view !== 'slides');
  elements.presentView.classList.toggle('hidden', state.view !== 'present');
  elements.docEditorLayout.classList.toggle('hidden', state.view !== 'doc');
  elements.libraryView.classList.toggle('hidden', state.view !== 'library');
  elements.editorTools.classList.toggle('hidden', state.view !== 'slides');
  if (state.embedded) {
    elements.editorTools.classList.add('hidden');
  }
  elements.tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.view === state.view));
  const shell = document.getElementById('doc-studio-shell');
  if (shell) {
    shell.setAttribute('page-title', state.view === 'library' ? 'Doc Studio Library' : 'Doc Studio');
  }
  renderLibrary();
}

function renderEditorTools() {
  const deck = state.deck;
  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  const selectedCard = cards[state.selectedSlideIndex];
  elements.prevSlideBtn.disabled = state.selectedSlideIndex <= 0;
  elements.nextSlideBtn.disabled = !cards.length || state.selectedSlideIndex >= cards.length - 1;
  elements.duplicateSlideBtn.disabled = !cards.length;
  elements.removeSlideBtn.disabled = !cards.length;
  elements.moveSlideUpBtn.disabled = state.selectedSlideIndex <= 0;
  elements.moveSlideDownBtn.disabled = !cards.length || state.selectedSlideIndex >= cards.length - 1;
  elements.rewriteSlideBtn.disabled = !cards.length;
  elements.regenerateSlideBtn.disabled = !cards.length;
  const imageApiAvailable = state.libraryCapabilities.generateSlideImage && state.libraryCapabilities.imageAvailable;
  elements.generateSlideImageBtn.disabled = !cards.length || !imageApiAvailable;
  elements.generateSlideImageBtn.textContent = selectedCard?.image_url ? 'Replace image' : 'Generate image';
  elements.generateSlideImageBtn.title = imageApiAvailable
    ? 'Generate or replace this slide image'
    : 'OpenAI image generation is unavailable on this server';
  elements.removeSlideImageBtn.disabled = !cards.length || !selectedCard?.image_url;
  elements.removeSlideImageBtn.textContent = 'Remove image';
  elements.toggleTemplatesBtn.disabled = !cards.length;
  elements.sharePresentationBtn.disabled = !cards.length || !state.libraryCapabilities.share;
  elements.toggleTemplatesBtn.setAttribute('aria-expanded', state.templateGalleryOpen ? 'true' : 'false');
  elements.toggleTemplatesBtn.classList.toggle('active', state.templateGalleryOpen);
  elements.toggleTemplatesBtn.textContent = state.templateGalleryOpen ? 'Hide templates' : 'Templates';
  elements.saveMetadataBtn.disabled = !cards.length && !state.presentationId;
  elements.slidePicker.innerHTML = cards.length
    ? cards.map((card, index) => `<option value="${index}" ${index === state.selectedSlideIndex ? 'selected' : ''}>${index + 1}. ${escapeHtml(card.title || 'Untitled slide')}</option>`).join('')
    : '<option>No slides</option>';
  const selectedLayout = selectedCard?.design?.template?.layoutFamily || selectedCard?.design?.layout;
  elements.slideLayout.innerHTML = layoutOptions.map(layout => `<option value="${escapeHtml(layout)}" ${selectedLayout === layout ? 'selected' : ''}>${escapeHtml(layout.replace(/-/g, ' '))}</option>`).join('');
  elements.slideStyle.innerHTML = ['deck'].concat(styleOptions).map(style => {
    const active = style === 'deck' ? !selectedCard?.design?.style : selectedCard?.design?.style === style;
    const label = style === 'deck' ? `Deck (${activeDeckStyle()})` : style;
    return `<option value="${escapeHtml(style)}" ${active ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  elements.slideLayout.disabled = !selectedCard;
  elements.slideStyle.disabled = !selectedCard;

  const activeStyle = activeDeckStyle();
  elements.styleCompare.innerHTML = styleOptions.map(style => `
    <button type="button" class="style-chip ${style === activeStyle ? 'active' : ''}" data-apply-style="${escapeHtml(style)}">
      <span class="style-swatch style-${escapeHtml(style)}"></span>
      <span>${escapeHtml(style)}</span>
    </button>
  `).join('');

  if (!selectedCard) {
    elements.visualEditor.innerHTML = '<span class="empty-state">Generate or open a file to edit slide details.</span>';
    renderTemplateGallery();
    return;
  }

  const design = selectedCard.design || {};
  const icons = Array.isArray(design.icons) && design.icons.length ? design.icons : ['info'];
  const points = cardPoints(selectedCard);
  const bulletIcons = Array.isArray(design.bulletIcons) && design.bulletIcons.length
    ? design.bulletIcons
    : points.map((point, pointIndex) => ({ icon: icons[pointIndex % icons.length], query: point }));

  elements.visualEditor.innerHTML = `
    <label class="mini-field visual-label-field">
      <span>Visual label</span>
      <input id="visualLabelInput" value="${escapeHtml(visualLabel(selectedCard.visual, design.layout || 'statement'))}">
    </label>
    <label class="mini-field">
      <span>Image style</span>
      <select id="slideImageStyleInput">
        ${imageStyleOptions.map(style => `<option value="${escapeHtml(style)}" ${activeSlideImageStyle(selectedCard) === style ? 'selected' : ''}>${escapeHtml(style.replace(/-/g, ' '))}</option>`).join('')}
      </select>
    </label>
    <label class="mini-field image-prompt-field">
      <span>Image prompt</span>
      <textarea id="imagePromptInput" rows="3">${escapeHtml(selectedCard.image_prompt || '')}</textarea>
    </label>
    ${state.libraryCapabilities.imageAvailable ? '' : '<span class="image-unavailable">Image provider unavailable. Configure OPENAI_API_KEY to generate images.</span>'}
    <div class="bullet-icon-editor" aria-label="Bullet icons">
      ${points.map((point, pointIndex) => `
        <label class="bullet-icon-row">
          <span>${escapeHtml(String(pointIndex + 1))}</span>
          <select data-bullet-icon="${pointIndex}">
            ${iconNames.map(name => `<option value="${escapeHtml(name)}" ${(bulletIcons[pointIndex]?.icon || icons[pointIndex % icons.length]) === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}
          </select>
          <small>${escapeHtml(point)}</small>
        </label>
      `).join('')}
    </div>
  `;
  renderTemplateGallery();
}

function renderBrandKitControls() {
  if (!elements.brandKitSelect) {
    return;
  }

  const options = ['<option value="">Select saved kit</option>'].concat(
    state.brandKits.map(kit => `<option value="${escapeHtml(kit.id)}">${escapeHtml(kit.name)} · ${escapeHtml(kit.style || 'editorial')}</option>`)
  );
  elements.brandKitSelect.innerHTML = options.join('');
}

function renderCriticPanel() {
  if (!elements.criticPanel) {
    return;
  }

  const cards = Array.isArray(state.deck.cards) ? state.deck.cards : [];
  const critique = state.critique;
  const disabled = !cards.length || !state.libraryCapabilities.critique;
  const findings = Array.isArray(critique?.findings) ? critique.findings : [];
  const topFindings = findings.slice(0, 4);
  elements.criticPanel.innerHTML = `
    <div class="critic-header">
      <div>
        <strong>Quality review</strong>
        <span>${critique ? `${Number(critique.score || 0)} score · ${escapeHtml(critique.summary || 'Review complete')}` : 'Review clarity, repetition, density, layout, icons, and visual opportunity.'}</span>
      </div>
      <div class="critic-actions">
        <button id="analyzeDeckBtn" type="button" ${disabled ? 'disabled' : ''}>Analyze</button>
        <button id="polishDeckBtn" type="button" ${disabled || !state.libraryCapabilities.autoPolish ? 'disabled' : ''}>Auto-polish</button>
      </div>
    </div>
    ${critique ? `
      <div class="critic-score">
        <b>${Number(critique.score || 0)}</b>
        <span>${escapeHtml(critique.source || 'heuristic')}</span>
      </div>
      <div class="critic-findings">
        ${topFindings.length ? topFindings.map(finding => `
          <button type="button" data-critic-slide="${Number(finding.slide_index || 0)}">
            <strong>${escapeHtml(finding.category || 'finding')} · ${escapeHtml(finding.severity || 'note')}</strong>
            <span>${escapeHtml(finding.slide_title || `Slide ${Number(finding.slide_index || 0) + 1}`)}</span>
            <small>${escapeHtml(finding.suggestion || finding.message || '')}</small>
          </button>
        `).join('') : '<span class="empty-state">No major issues found.</span>'}
      </div>
    ` : ''}
  `;
}

function renderTemplateGallery() {
  if (!elements.templateGallery) {
    return;
  }

  elements.templateGallery.classList.toggle('collapsed', !state.templateGalleryOpen);
  const templates = availableTemplates();
  const card = selectedCard();
  if (!card) {
    elements.templateGallery.innerHTML = '<span class="empty-state">Generate or open a file to choose templates.</span>';
    return;
  }

  if (!templates.length) {
    elements.templateGallery.innerHTML = '<span class="empty-state">No templates available.</span>';
    return;
  }

  const activeTemplateId = selectedTemplateId(card);
  const groups = templates.reduce((acc, template) => {
    const category = template.category || 'general';
    acc[category] = acc[category] || [];
    acc[category].push(template);
    return acc;
  }, {});
  const categoryNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  elements.templateGallery.innerHTML = categoryNames.map(category => `
    <section class="template-group">
      <div class="template-group-title">
        <strong>${escapeHtml(category.replace(/-/g, ' '))}</strong>
        <span>${groups[category].length}</span>
      </div>
      <div class="template-grid">
        ${groups[category].map(template => {
          const active = activeTemplateId === template.id;
          const layout = template.layoutFamily || 'statement';
          return `
            <button type="button" class="template-tile ${active ? 'active' : ''}" data-template-id="${escapeHtml(template.id)}">
              <span class="template-thumb layout-${escapeHtml(layout)}">
                <span class="template-thumb-line primary"></span>
                <span class="template-thumb-line body"></span>
                <span class="template-thumb-line meta"></span>
              </span>
              <strong>${escapeHtml(template.name || template.id)}</strong>
              <small>${escapeHtml(layout.replace(/-/g, ' '))} · ${escapeHtml(template.variant || 'standard')}</small>
              <span>${escapeHtml(template.description || '')}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');
}

async function loadPresentationFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) {
    const requestedView = params.get('view');
    if (['slides', 'present', 'doc', 'library'].includes(requestedView)) {
      state.view = requestedView;
      if (state.view === 'library') {
        await loadLibrary();
      }
      render();
    }
    return;
  }

  try {
    setStatus('Loading file...');
    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(id)}`);
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }
    const payload = await response.json();
    clearDocumentDirty();
    state.deck = payload.deck;
    state.presentationId = payload.id || id;
    state.documentLastSavedAt = payload.updated_at || payload.created_at || LanaTime.nowIso();
    state.critique = null;
    state.selectedSlideIndex = 0;
    resetDocumentHistory();
    const requestedView = params.get('view');
    if (['slides', 'present', 'doc', 'library'].includes(requestedView)) {
      state.view = requestedView;
    } else if (state.deck.document && typeof state.deck.document === 'object') {
      state.view = 'doc';
    }
    setDocumentEditorMode(state.view === 'doc' && state.presentationId && state.deck.document && typeof state.deck.document === 'object');
    setStatus('File loaded.');
    render();
    if (state.view === 'doc' && currentDocumentFileId()) {
      await loadDocumentCollaboration();
      render();
    }
  } catch (error) {
    setStatus(`Load failed: ${error.message}`);
  }
}

async function loadDocumentCollaboration() {
  const fileId = currentDocumentFileId();
  if (!fileId) {
    return;
  }
  state.documentCollaborationLoaded = false;
  const matterId = currentMatterId();
  try {
    const params = new URLSearchParams({
      resource_type: 'document',
      resource_id: fileId,
      limit: '50',
      include_replies: 'true'
    });
    const commentsResponse = await apiFetch(`/api/v1/comments?${params.toString()}`);
    if (commentsResponse.ok) {
      const payload = await commentsResponse.json();
      state.documentComments = Array.isArray(payload?.data?.comments) ? payload.data.comments : [];
    }

    if (matterId) {
      const permissionsResponse = await apiFetch(`/api/v1/files/${encodeURIComponent(fileId)}/permissions?matter_id=${encodeURIComponent(matterId)}`);
      if (permissionsResponse.ok) {
        const payload = await permissionsResponse.json();
        state.documentPermissions = Array.isArray(payload.permissions) ? payload.permissions : [];
      }

      const usersResponse = await apiFetch(`/api/v1/matters/${encodeURIComponent(matterId)}/mentionable-users?limit=100`);
      if (usersResponse.ok) {
        const payload = await usersResponse.json();
        state.documentCollaborators = Array.isArray(payload.data) ? payload.data : [];
      }
    }
  } catch (error) {
    setStatus(`Document collaboration unavailable: ${error.message}`);
  } finally {
    state.documentCollaborationLoaded = true;
  }
}

function formatDate(value) {
  if (!value) {
    return 'Unknown date';
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

// Library row shaping is owned by the shared, pure window.DocumentLibraryMapper
// module (src/js/shared/document-library-mapper.js). Doc Studio and the
// Brainchild surface consume the same normalization contract so identical
// documents never drift between the two surfaces. Do NOT re-implement
// fileExtension / humanFileType / filename / row mapping here — extend the
// shared mapper instead.
function libraryItems() {
  const mapper = window.DocumentLibraryMapper;
  if (!mapper || typeof mapper.normalizeLibraryItems !== 'function') {
    return [];
  }
  return mapper.normalizeLibraryItems({
    documents: Array.isArray(state.libraryDocuments) ? state.libraryDocuments : [],
    presentations: Array.isArray(state.presentations) ? state.presentations : []
  }, 'org');
}

function presentationPreview(presentation) {
  const title = presentation.title || 'Untitled file';
  const subtitle = presentation.subtitle || '';
  const style = presentation.style || 'editorial';
  const accent = style === 'noir' || style === 'luxe' ? '#d8b56d' : style === 'blueprint' ? '#3f7f93' : '#2f6f73';
  const lines = [title, subtitle].filter(Boolean).slice(0, 2);
  return `
    <div class="library-preview preview-${escapeHtml(style)}" style="--preview-accent:${escapeHtml(accent)}">
      <span></span>
      <strong>${escapeHtml(lines[0] || title)}</strong>
      <small>${escapeHtml(lines[1] || `${Number(presentation.card_count || 0)} sections`)}</small>
      <i></i>
    </div>
  `;
}

function renderLibrary() {
  if (!elements.libraryList) {
    return;
  }

  const items = libraryItems();
  if (!items.length) {
    elements.libraryList.innerHTML = `
      <lex-empty
        icon="document"
        message="No documents yet"
        description="Generated Doc Studio files and uploaded matter documents will appear here."
      ></lex-empty>
    `;
    return;
  }

  elements.libraryList.innerHTML = `
    <lex-table
      id="docStudioLibraryTable"
      columns="filename,file_type,matter,is_template,created_at,updated_at"
      labels="Filename,File Type,Matter,Template,Created,Edited"
      searchable
      filterable
      column-filters
      compact
      limit="25"
      sort-by="updated_at"
      sort-dir="desc"
      empty-text="No saved documents"
    ></lex-table>
  `;
  const table = elements.libraryList.querySelector('#docStudioLibraryTable');
  if (!table || typeof table.setData !== 'function') {
    return;
  }
  table.setData(items);
  table.setCellRenderers({
    filename: (value, row) => {
      const subtitle = row._source?.subtitle || row._source?.document_type || row.file_type || '';
      return `
        <button type="button" class="library-table-title" data-open-library-item="${escapeHtml(row.id)}">
          <strong>${escapeHtml(value)}</strong>
          ${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}
        </button>
      `;
    },
    file_type: value => `<span class="doc-library-badge">${escapeHtml(value || 'Document')}</span>`,
    is_template: value => `<span class="doc-library-badge ${String(value).toLowerCase() === 'yes' ? 'is-template' : ''}">${escapeHtml(value || 'No')}</span>`
  });

  // Make the entire row clickable, not just the filename button. lex-table
  // emits row-click for any non-control click in the row; route through the
  // shared openLibraryItem dispatcher so storage files open the file viewer
  // and presentations open in-place in Doc Studio.
  if (!table.__rowClickWired) {
    table.addEventListener('row-click', (event) => {
      const rowId = event.detail && event.detail.id;
      if (rowId) openLibraryItem(rowId);
    });
    table.__rowClickWired = true;
  }
}

async function openLibraryItem(itemId) {
  const item = libraryItems().find(entry => entry.id === itemId);
  if (!item) return;
  if (item._kind === 'storage') {
    const params = new URLSearchParams({ id: item._fileId });
    if (item._matterId) {
      params.set('matter_id', item._matterId);
    }
    window.location.href = `../file-viewer.html?${params.toString()}`;
    return;
  }
  if (!confirmUnsavedDocumentChanges()) {
    return;
  }
  replaceClientUrl(`/doc-studio/?id=${encodeURIComponent(item._presentationId)}`);
  state.presentationId = item._presentationId;
  await loadPresentationFromUrl();
  render();
}

async function loadLibrary() {
  const errors = [];
  try {
    const response = await apiFetch('/api/v1/deck-studio/presentations?limit=100');
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const payload = await response.json();
    state.presentations = Array.isArray(payload.presentations) ? payload.presentations : [];
  } catch (error) {
    errors.push(`Doc Studio files: ${error.message}`);
  }

  try {
    const response = await apiFetch('/api/v1/storage/documents?page_size=200&sort_by=updated_at&sort_order=desc');
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const payload = await response.json();
    state.libraryDocuments = Array.isArray(payload.documents)
      ? payload.documents
      : Array.isArray(payload.files)
        ? payload.files
        : [];
  } catch (error) {
    state.libraryDocuments = [];
    errors.push(`stored documents: ${error.message}`);
  }

  renderLibrary();
  if (errors.length) {
    setStatus(`Library loaded with limited sources (${errors.join('; ')}).`);
  }
}

async function loadCapabilities() {
  try {
    const response = await apiFetch('/api/v1/deck-studio/capabilities');
    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    const capabilities = await response.json();
    state.libraryCapabilities = {
      duplicate: Boolean(capabilities.presentations?.duplicate),
      rename: Boolean(capabilities.presentations?.update_metadata),
      delete: Boolean(capabilities.presentations?.delete),
      updateMetadata: Boolean(capabilities.presentations?.update_metadata),
      rewriteSlide: Boolean(capabilities.presentations?.rewrite_slide),
      regenerateSlide: Boolean(capabilities.presentations?.regenerate_slide),
      generateSlideImage: Boolean(capabilities.presentations?.generate_slide_image),
      removeSlideImage: Boolean(capabilities.presentations?.remove_slide_image),
      critique: Boolean(capabilities.presentations?.critique),
      autoPolish: Boolean(capabilities.presentations?.auto_polish_preview),
      share: Boolean(capabilities.presentations?.share_viewer),
      imageAvailable: Boolean(capabilities.images?.available)
    };
    renderLibrary();
    renderCriticPanel();
  } catch (error) {
    setStatus(`Capabilities unavailable: ${error.message}`);
  }
}

async function saveCurrentPresentation(exportAs = 'pptx') {
  const response = await apiFetch('/api/v1/deck-studio/presentations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: state.deck, export_as: exportAs })
  });

  if (!response.ok) {
    throw new Error(`Save failed with ${response.status}`);
  }

  const saved = await response.json();
  state.presentationId = saved.presentation_id;
  await loadLibrary();
  return saved;
}

async function duplicatePresentation(id) {
  setStatus('Duplicating file...');
  const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!response.ok) {
    throw new Error(`Duplicate failed with ${response.status}`);
  }

  const saved = await response.json();
  await loadLibrary();
  setStatus('File duplicated.');
  return saved;
}

async function renamePresentation(id) {
  const current = state.presentations.find(presentation => presentation.id === id);
  const title = window.prompt('Rename file', current?.title || 'Untitled file');
  if (!title || !title.trim()) {
    return null;
  }

  setStatus('Renaming file...');
  const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim() })
  });
  if (!response.ok) {
    throw new Error(`Rename failed with ${response.status}`);
  }

  const updated = await response.json();
  if (state.presentationId === id) {
    state.deck.title = updated.title;
    render();
  }
  await loadLibrary();
  setStatus('File renamed.');
  return updated;
}

async function deletePresentation(id) {
  const current = state.presentations.find(presentation => presentation.id === id);
  const title = current?.title || 'this file';
  if (!window.confirm(`Delete "${title}"? This removes the saved file and generated exports.`)) {
    return null;
  }

  setStatus('Deleting file...');
  const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Delete failed with ${response.status}`);
  }

  const deleted = await response.json();
  if (state.presentationId === id) {
    state.presentationId = null;
    replaceClientUrl('/doc-studio/');
  }
  await loadLibrary();
  setStatus('File deleted.');
  return deleted;
}

function applyDeckStyle(style) {
  const preset = stylePreset(style);
  state.deck.style = style;
  state.deck.theme = {
    ...(state.deck.theme || {}),
    ...preset,
    style
  };
  elements.style.value = style;
  render();
}

function applyBrandKit(kitId) {
  const kit = state.brandKits.find(item => item.id === kitId);
  if (!kit) {
    return;
  }

  const style = styleOptions.includes(kit.style) ? kit.style : activeDeckStyle();
  const preset = stylePreset(style);
  state.deck.style = style;
  state.deck.theme = {
    ...(state.deck.theme || {}),
    ...preset,
    ...(kit.colors || {}),
    style
  };
  applyBrandPreferences(kit.preferences || {}, kit.identity || {}, kit.typography || {});
  setStatus(`Applied brand kit: ${kit.name}.`);
  render();
}

function saveBrandKit() {
  const kit = currentBrandKit();
  const existingIndex = state.brandKits.findIndex(item => item.name.toLowerCase() === kit.name.toLowerCase());
  if (existingIndex >= 0) {
    state.brandKits[existingIndex] = {
      ...state.brandKits[existingIndex],
      ...kit,
      id: state.brandKits[existingIndex].id
    };
  } else {
    state.brandKits.push(kit);
  }
  persistBrandKits();
  setStatus(`Saved brand kit: ${kit.name}.`);
  render();
}

function applyTemplateToSelectedSlide(templateId) {
  const card = selectedCard();
  const template = availableTemplates().find(item => item.id === templateId);
  if (!card || !template) {
    return;
  }

  card.design = {
    ...(card.design || {}),
    layout: template.layoutFamily || card.design?.layout || 'statement',
    templateId: template.id,
    template: { ...template },
    templateVariant: template.variant || 'standard'
  };
  setStatus(`Applied template: ${template.name || template.id}.`);
  render();
}

function updateDeckMetadataFromControls() {
  state.deck.title = elements.metadataTitle.value.trim() || 'Untitled file';
  state.deck.subtitle = elements.metadataSubtitle.value.trim();
  state.deck.theme = {
    ...(state.deck.theme || {}),
    accent: normalizeColor(elements.themeAccent.value, state.deck.theme?.accent || '#2f6f73'),
    background: normalizeColor(elements.themeBackground.value, state.deck.theme?.background || '#f7f4ef'),
    foreground: normalizeColor(elements.themeForeground.value, state.deck.theme?.foreground || '#17201f'),
    style: activeDeckStyle()
  };
}

function createSlide(index) {
  return {
    title: `New slide ${index + 1}`,
    body: 'Add a concise message for this slide.',
    points: ['Key point', 'Supporting detail', 'Next action'],
    visual: 'Structured content card',
    image_url: '',
    image_prompt: '',
    design: {
      layout: 'statement',
      semanticRole: index === 0 ? 'intro' : 'neutral',
      style: ''
    }
  };
}

function cloneSlide(card, index) {
  const clone = JSON.parse(JSON.stringify(card || createSlide(index)));
  clone.title = `${clone.title || `Slide ${index + 1}`} copy`;
  return clone;
}

function addSlide() {
  const insertAt = Math.min(state.selectedSlideIndex + 1, state.deck.cards.length);
  state.deck.cards.splice(insertAt, 0, createSlide(insertAt));
  state.selectedSlideIndex = insertAt;
  render();
  setStatus('Slide added.');
}

function duplicateSelectedSlide() {
  const card = selectedCard();
  if (!card) {
    return;
  }
  const insertAt = state.selectedSlideIndex + 1;
  state.deck.cards.splice(insertAt, 0, cloneSlide(card, insertAt));
  state.selectedSlideIndex = insertAt;
  render();
  setStatus('Slide duplicated.');
}

function removeSelectedSlide() {
  if (!state.deck.cards.length) {
    return;
  }
  state.deck.cards.splice(state.selectedSlideIndex, 1);
  state.selectedSlideIndex = Math.max(0, Math.min(state.selectedSlideIndex, state.deck.cards.length - 1));
  render();
  setStatus('Slide removed.');
}

function moveSelectedSlide(direction) {
  const nextIndex = state.selectedSlideIndex + direction;
  if (nextIndex < 0 || nextIndex >= state.deck.cards.length) {
    return;
  }
  const [card] = state.deck.cards.splice(state.selectedSlideIndex, 1);
  state.deck.cards.splice(nextIndex, 0, card);
  state.selectedSlideIndex = nextIndex;
  render();
}

function movePresentation(direction) {
  const cards = Array.isArray(state.deck.cards) ? state.deck.cards : [];
  if (!cards.length) {
    return;
  }

  const nextIndex = Math.max(0, Math.min(cards.length - 1, state.selectedSlideIndex + direction));
  if (nextIndex !== state.selectedSlideIndex) {
    state.selectedSlideIndex = nextIndex;
    render();
  }
}

function exitPresentation() {
  state.view = 'slides';
  render();
  document.querySelector(`[data-index="${state.selectedSlideIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function reviseSelectedSlide(action) {
  const card = selectedCard();
  if (!card) {
    return;
  }

  if (!state.presentationId) {
    const title = card.title || `Slide ${state.selectedSlideIndex + 1}`;
    const firstPoint = card.points?.[0] || 'Clarify the main idea';
    if (action === 'rewrite') {
      card.body = `${title}: ${firstPoint}. Add sharper supporting evidence before export.`;
      setStatus('Save the deck to use server rewrite. Applied a local placeholder rewrite.');
    } else {
      card.visual = `${card.design?.layout || 'statement'} visual direction`;
      card.image_prompt = '';
      card.image_url = '';
      setStatus('Save the deck to use server regeneration. Reset the slide visual placeholder.');
    }
    render();
    return;
  }

  const supported = action === 'rewrite'
    ? state.libraryCapabilities.rewriteSlide
    : state.libraryCapabilities.regenerateSlide;
  if (!supported) {
    setStatus(`Slide ${action} API is not available in this server build.`);
    return;
  }

  const button = action === 'rewrite' ? elements.rewriteSlideBtn : elements.regenerateSlideBtn;
  button.disabled = true;
  setStatus(action === 'rewrite' ? 'Rewriting slide with local llama.cpp...' : 'Regenerating slide with local llama.cpp...');

  try {
    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(state.presentationId)}/slides/${state.selectedSlideIndex}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        layout: card.design?.template?.layoutFamily || card.design?.layout,
        style: card.design?.style || activeDeckStyle(),
        instructions: elements.prompt.value.trim()
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Slide ${action} failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.deck) {
      state.deck = payload.deck;
    } else if (payload.slide) {
      state.deck.cards[state.selectedSlideIndex] = payload.slide;
    }
    await loadLibrary();
    render();
    setStatus(action === 'rewrite' ? 'Slide rewritten.' : 'Slide regenerated.');
  } catch (error) {
    setStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

async function ensurePresentationSaved() {
  if (state.presentationId) {
    await saveMetadata();
    return state.presentationId;
  }

  const saved = await saveCurrentPresentation('pptx');
  replaceClientUrl(saved.edit_path);
  return saved.presentation_id;
}

function viewerPathForPresentation(id) {
  return apiUrl(`/doc-studio/p/${encodeURIComponent(id)}`);
}

async function shareCurrentPresentation() {
  if (!state.deck.cards.length) {
    setStatus('Generate or open a file before sharing.');
    return;
  }

  try {
    elements.sharePresentationBtn.disabled = true;
    setStatus('Preparing viewer link...');
    const presentationId = await ensurePresentationSaved();
    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(presentationId)}/share`);
    const payload = response.ok
      ? await response.json()
      : { viewer_path: viewerPathForPresentation(presentationId) };
    const path = payload.viewer_url || payload.viewer_path || viewerPathForPresentation(presentationId);
    const url = new URL(path, window.location.origin).href;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      setStatus(`Viewer link copied: ${url}`);
    } else {
      window.prompt('Presentation viewer link', url);
      setStatus('Viewer link ready.');
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.sharePresentationBtn.disabled = false;
  }
}

async function generateSelectedSlideImage() {
  const card = selectedCard();
  if (!card) {
    return;
  }

  if (!state.libraryCapabilities.generateSlideImage) {
    setStatus('Slide image API is not available in this server build.');
    return;
  }

  if (!state.libraryCapabilities.imageAvailable) {
    setStatus('OpenAI image generation is unavailable. Configure OPENAI_API_KEY to generate or replace images.');
    return;
  }

  elements.generateSlideImageBtn.disabled = true;
  setStatus(card.image_url ? 'Replacing slide image with OpenAI...' : 'Generating slide image with OpenAI...');

  try {
    const presentationId = await ensurePresentationSaved();
    const imagePromptInput = document.getElementById('imagePromptInput');
    const prompt = imagePromptInput?.value.trim() || card.image_prompt || '';
    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(presentationId)}/slides/${state.selectedSlideIndex}/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        imageStyle: activeSlideImageStyle(card)
      })
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Slide image failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.deck) {
      state.deck = payload.deck;
    } else if (payload.slide) {
      state.deck.cards[state.selectedSlideIndex] = payload.slide;
    }
    await loadLibrary();
    render();
    if (payload.image_generation?.status && payload.image_generation.status !== 'completed') {
      setStatus(`Image ${payload.image_generation.status}: ${payload.image_generation.reason || 'provider unavailable'}.`);
    } else {
      setStatus(card.image_url ? 'Slide image replaced.' : 'Slide image generated.');
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.generateSlideImageBtn.disabled = false;
  }
}

async function removeSelectedSlideImage() {
  const card = selectedCard();
  if (!card) {
    return;
  }

  if (!state.presentationId) {
    delete card.image_url;
    delete card.image_prompt;
    delete card.image_b64;
    delete card.image_file;
    delete card.image_revised_prompt;
    delete card.image_model;
    delete card.image_generated_at;
    render();
    setStatus('Slide image removed.');
    return;
  }

  if (!state.libraryCapabilities.removeSlideImage) {
    setStatus('Slide image removal API is not available in this server build.');
    return;
  }

  elements.removeSlideImageBtn.disabled = true;
  setStatus('Removing slide image...');

  try {
    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(state.presentationId)}/slides/${state.selectedSlideIndex}/image`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Slide image removal failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.deck) {
      state.deck = payload.deck;
    } else if (payload.slide) {
      state.deck.cards[state.selectedSlideIndex] = payload.slide;
    }
    await loadLibrary();
    render();
    setStatus('Slide image removed.');
  } catch (error) {
    setStatus(error.message);
  } finally {
    elements.removeSlideImageBtn.disabled = false;
  }
}

async function saveMetadata() {
  updateDeckMetadataFromControls();
  if (!state.deck.cards.length) {
    setStatus('Add or generate slides before saving.');
    return;
  }

  try {
    setStatus('Saving file metadata...');
    if (!state.presentationId) {
      const saved = await saveCurrentPresentation('pptx');
      replaceClientUrl(saved.edit_path);
      setStatus('File saved.');
      return;
    }

    const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(state.presentationId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deck: state.deck })
    });
    if (!response.ok) {
      throw new Error(`Save failed with ${response.status}`);
    }
    const updated = await response.json();
    if (updated.deck) {
      state.deck = updated.deck;
    }
    await loadLibrary();
    render();
    setStatus('File metadata saved.');
  } catch (error) {
    setStatus(error.message);
  }
}

function ensureBulletIconModel(card) {
  card.design = card.design || {};
  const icons = Array.isArray(card.design.icons) && card.design.icons.length ? card.design.icons : ['info'];
  card.design.bulletIcons = cardPoints(card).map((point, index) => ({
    icon: card.design.bulletIcons?.[index]?.icon || icons[index % icons.length],
    query: card.design.bulletIcons?.[index]?.query || point
  }));
  return card.design.bulletIcons;
}

function syncEdits(event) {
  const editable = event.target.closest('[contenteditable="true"]');
  const cardNode = event.target.closest('.slide-card');
  if (!editable || !cardNode) {
    return;
  }

  const card = state.deck.cards[Number(cardNode.dataset.index)];
  if (!card) {
    return;
  }

  const field = editable.dataset.field;
  if (field === 'point') {
    const pointIndex = Number(editable.dataset.pointIndex);
    card.points = cardPoints(card);
    card.points[pointIndex] = editable.textContent.trim();
  } else {
    card[field] = editable.textContent.trim();
  }
  renderEditorTools();
}

async function importSourcesToPrompt() {
  const sourceText = elements.prompt.value.trim();
  const sourceUrl = elements.sourceUrl?.value.trim() || '';
  const files = Array.from(elements.sourceFiles?.files || []);
  if (!sourceText && !sourceUrl && !files.length) {
    setStatus('Add pasted text, a URL, or a markdown/text file first.');
    return;
  }

  const form = new FormData();
  if (sourceText) {
    form.append('source_text', sourceText);
  }
  if (sourceUrl) {
    form.append('source_url', sourceUrl);
  }
  files.forEach(file => form.append('files', file, file.name));

  elements.importSourceBtn.disabled = true;
  setStatus(files.length ? `Importing source files: ${sourceFileNames()}...` : 'Importing source...');
  try {
    const response = await apiFetch('/api/v1/deck-studio/source-text', {
      method: 'POST',
      body: form
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Source import failed with ${response.status}`);
    }
    const payload = await response.json();
    elements.prompt.value = payload.source_text || sourceText;
    setStatus(`Imported ${payload.sources?.length || 1} source${payload.sources?.length === 1 ? '' : 's'} (${Number(payload.total_chars || 0).toLocaleString()} chars).`);
  } catch (error) {
    setStatus(`Source import failed: ${error.message}`);
  } finally {
    elements.importSourceBtn.disabled = false;
  }
}

async function persistDeckPatch() {
  if (!state.presentationId) {
    return null;
  }
  const response = await apiFetch(`/api/v1/deck-studio/presentations/${encodeURIComponent(state.presentationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: state.deck })
  });
  if (!response.ok) {
    throw new Error(`Save failed with ${response.status}`);
  }
  return response.json();
}

function signatureBlockAt(index) {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel) {
    return null;
  }
  const blocks = ensureDocumentSignatureBlocks(documentModel);
  return blocks[index] || null;
}

function capturePendingSignatureDrawings() {
  elements.docView.querySelectorAll('[data-signature-pad][data-has-drawing="true"]').forEach(canvas => {
    captureSignaturePad(Number(canvas.dataset.signaturePad));
  });
}

async function saveDocumentSignatures() {
  if (!state.deck.document) {
    setStatus('Open a generated document before saving signatures.');
    return;
  }
  if (!state.presentationId) {
    const saved = await saveCurrentPresentation('pdf');
    state.presentationId = saved.presentation_id;
    replaceClientUrl(`${saved.edit_path}&view=doc`);
  }

  capturePendingSignatureDrawings();
  setStatus('Saving document signatures...');
  const updated = await persistDeckPatch();
  if (updated?.deck) {
    state.deck = updated.deck;
  }
  await loadLibrary();
  clearDocumentDirty();
  render();
  setStatus('Document signatures saved.');
}

async function saveDocumentEdits(options = {}) {
  if (!state.deck.document) {
    setStatus('Open a generated document before saving edits.');
    return;
  }
  if (!state.presentationId) {
    const saved = await saveCurrentPresentation('pdf');
    state.presentationId = saved.presentation_id;
    replaceClientUrl(`${saved.edit_path}&view=doc`);
  }

  window.clearTimeout(state.autosaveTimer);
  state.autosaving = true;
  if (!options.silent) {
    setStatus(options.autosave ? 'Autosaving document...' : 'Saving document edits...');
  }
  capturePendingSignatureDrawings();
  try {
    recordDocumentSaveActivity(options.autosave ? 'autosave' : 'save');
    const updated = await persistDeckPatch();
    if (updated?.deck) {
      state.deck = updated.deck;
    }
    await loadLibrary();
    clearDocumentDirty();
    pushDocumentHistorySnapshot();
    if (!options.silent) {
      render();
    } else {
      renderDocumentHeaderChrome(state.deck);
    }
    setStatus(options.autosave ? 'Document autosaved.' : 'Document edits saved.');
  } finally {
    state.autosaving = false;
  }
}

function addDocumentParty() {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel) {
    return;
  }
  const parties = ensureDocumentParties(documentModel);
  const signatures = ensureDocumentSignatureBlocks(documentModel);
  parties.push({ role: 'Party', name: '[Party Name]', address: '' });
  signatures.push({ party: '[Party Name]', signatory_title: '[Authorized Signatory]' });
  markDocumentDirty('Party added. Save document to persist.');
  render();
}

function deleteDocumentParty(index) {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const parties = documentModel ? ensureDocumentParties(documentModel) : [];
  if (!documentModel || !parties[index]) {
    return;
  }
  const label = parties[index].name || parties[index].role || `party ${index + 1}`;
  if (!window.confirm(`Delete ${label}? This also removes the matching signature block.`)) {
    return;
  }
  parties.splice(index, 1);
  const signatures = ensureDocumentSignatureBlocks(documentModel);
  signatures.splice(index, 1);
  markDocumentDirty('Party deleted. Save document to persist.');
  render();
}

function addDocumentSection() {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel) {
    return;
  }
  ensureDocumentSections(documentModel).push({
    heading: 'New Section',
    body: 'Add section text.'
  });
  markDocumentDirty('Section added. Save document to persist.');
  render();
}

function deleteDocumentSection(index) {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const sections = documentModel ? ensureDocumentSections(documentModel) : [];
  if (!documentModel || !sections[index]) {
    return;
  }
  if (!window.confirm(`Delete section "${sections[index].heading || index + 1}"?`)) {
    return;
  }
  sections.splice(index, 1);
  markDocumentDirty('Section deleted. Save document to persist.');
  render();
}

function deleteDocumentMetaField(field) {
  const labels = {
    effective_date: 'Effective date',
    jurisdiction: 'Governing law'
  };
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel || !labels[field]) {
    return;
  }
  if (!window.confirm(`Remove ${labels[field]} from this document layout?`)) {
    return;
  }
  const hidden = hiddenDocumentFields(documentModel);
  if (!hidden.includes(field)) {
    hidden.push(field);
  }
  markDocumentDirty(`${labels[field]} removed. Save document to persist.`);
  render();
}

function addDocumentReviewNote() {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!documentModel) {
    return;
  }
  ensureDocumentReviewNotes(documentModel).push('New review note');
  markDocumentDirty('Review note added. Save document to persist.');
  render();
}

function deleteDocumentReviewNote(index) {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const notes = documentModel ? ensureDocumentReviewNotes(documentModel) : [];
  if (!documentModel || index < 0 || index >= notes.length) {
    return;
  }
  if (!window.confirm('Delete this review note?')) {
    return;
  }
  notes.splice(index, 1);
  markDocumentDirty('Review note deleted. Save document to persist.');
  render();
}

async function addDocumentComment(bodyOverride = '') {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const composer = (elements.docSidePanel || elements.docView).querySelector('lex-document-comment-composer');
  const input = (elements.docSidePanel || elements.docView).querySelector('[data-doc-comment-input]');
  const body = String(bodyOverride || composer?.value || input?.value || '').trim();
  if (!documentModel || !body) {
    return;
  }
  const fileId = currentDocumentFileId();
  if (fileId) {
    const response = await apiFetch('/api/v1/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resource_type: 'document',
        resource_id: fileId,
        content: body,
        mentions: []
      })
    });
    if (!response.ok) {
      throw new Error(`Comment failed with ${response.status}`);
    }
    composer?.clear?.();
    await loadDocumentCollaboration();
    render();
    setStatus('Comment added.');
    return;
  }
  ensureDocumentComments(documentModel).push({
    author: currentUserLabel(),
    body,
    created_at: LanaTime.nowIso()
  });
  composer?.clear?.();
  markDocumentDirty('Comment added. Save document to persist.');
  render();
}

async function deleteDocumentComment(commentIdOrIndex) {
  const fileId = currentDocumentFileId();
  if (fileId) {
    const response = await apiFetch(`/api/v1/comments/${encodeURIComponent(commentIdOrIndex)}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Delete comment failed with ${response.status}`);
    }
    await loadDocumentCollaboration();
    render();
    setStatus('Comment deleted.');
    return;
  }
  const index = Number(commentIdOrIndex);
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const comments = documentModel ? ensureDocumentComments(documentModel) : [];
  if (!documentModel || index < 0 || index >= comments.length) {
    return;
  }
  if (!window.confirm('Delete this comment?')) {
    return;
  }
  comments.splice(index, 1);
  markDocumentDirty('Comment deleted. Save document to persist.');
  render();
}

async function addDocumentShareRecipient() {
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const input = (elements.docSidePanel || elements.docView).querySelector('[data-doc-share-input]');
  const value = input ? input.value.trim() : '';
  const fileId = currentDocumentFileId();
  const matterId = currentMatterId();
  if (fileId && matterId && value) {
    const response = await apiFetch(`/api/v1/files/${encodeURIComponent(fileId)}/permissions?matter_id=${encodeURIComponent(matterId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: value,
        permission: 'read'
      })
    });
    if (!response.ok) {
      throw new Error(`Share failed with ${response.status}`);
    }
    await loadDocumentCollaboration();
    render();
    setStatus('Document access granted.');
    return;
  }
  if (!documentModel || !value) {
    return;
  }
  const sharedWith = ensureDocumentSharedWith(documentModel);
  if (!sharedWith.some(item => item.toLowerCase() === value.toLowerCase())) {
    sharedWith.push(value);
  }
  markDocumentDirty('Share list updated. Save document to persist.');
  render();
}

async function removeDocumentShareRecipient(userIdOrIndex) {
  const fileId = currentDocumentFileId();
  const matterId = currentMatterId();
  if (fileId && matterId) {
    const response = await apiFetch(`/api/v1/files/${encodeURIComponent(fileId)}/permissions?matter_id=${encodeURIComponent(matterId)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userIdOrIndex,
        permission: 'read'
      })
    });
    if (!response.ok) {
      throw new Error(`Remove access failed with ${response.status}`);
    }
    await loadDocumentCollaboration();
    render();
    setStatus('Document access removed.');
    return;
  }
  const index = Number(userIdOrIndex);
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  const sharedWith = documentModel ? ensureDocumentSharedWith(documentModel) : [];
  if (!documentModel || index < 0 || index >= sharedWith.length) {
    return;
  }
  sharedWith.splice(index, 1);
  markDocumentDirty('Share recipient removed. Save document to persist.');
  render();
}

function syncDocumentEdits(event) {
  const editable = event.target.closest('[data-doc-edit="true"]');
  const documentModel = state.deck.document && typeof state.deck.document === 'object' ? state.deck.document : null;
  if (!editable || !documentModel) {
    return;
  }

  const value = editable.textContent.trim();
  const field = editable.dataset.docField;
  const index = Number(editable.dataset.docIndex);

  if (field === 'title' || field === 'subtitle' || field === 'effective_date' || field === 'jurisdiction') {
    documentModel[field] = value;
    if (field === 'title') {
      state.deck.title = value || state.deck.title;
      elements.deckTitle.textContent = state.deck.title || 'Untitled file';
    }
    if (field === 'subtitle') {
      state.deck.subtitle = value;
      elements.deckSubtitle.textContent = state.deck.subtitle || '';
    }
    markDocumentDirty();
    return;
  }

  if (field === 'party_name' || field === 'party_role' || field === 'party_address') {
    documentModel.parties = Array.isArray(documentModel.parties) ? documentModel.parties : [];
    documentModel.parties[index] = documentModel.parties[index] || { name: '', role: 'Party', address: '' };
    const partyField = field.replace('party_', '');
    documentModel.parties[index][partyField] = value;
    if (partyField === 'name') {
      const signatures = ensureDocumentSignatureBlocks(documentModel);
      if (signatures[index] && !signatures[index].signed_by) {
        signatures[index].party = value || documentModel.parties[index].role || 'Party';
      }
    }
    markDocumentDirty();
    return;
  }

  if (field === 'section_heading' || field === 'section_body') {
    documentModel.sections = Array.isArray(documentModel.sections) ? documentModel.sections : [];
    documentModel.sections[index] = documentModel.sections[index] || { heading: '', body: '' };
    documentModel.sections[index][field === 'section_heading' ? 'heading' : 'body'] = value;
    markDocumentDirty();
    return;
  }

  if (field === 'review_note') {
    documentModel.review_notes = Array.isArray(documentModel.review_notes) ? documentModel.review_notes : [];
    documentModel.review_notes[index] = value;
    markDocumentDirty();
  }
}

function prepareSignaturePad(canvas) {
  if (!canvas || canvas.dataset.prepared === 'true') {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.width = '100%';
  canvas.style.height = '110px';
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 2.2;
  context.strokeStyle = '#111614';
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  canvas.dataset.logicalWidth = String(width);
  canvas.dataset.logicalHeight = String(height);
  canvas.dataset.prepared = 'true';
}

function canvasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Number(canvas.dataset.logicalWidth || 720);
  const height = Number(canvas.dataset.logicalHeight || 220);
  return {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height
  };
}

function drawSignatureStroke(event) {
  const session = state.activeSignaturePad;
  if (!session || session.pointerId !== event.pointerId) {
    return;
  }
  const point = canvasPoint(event, session.canvas);
  const context = session.canvas.getContext('2d');
  context.beginPath();
  context.moveTo(session.x, session.y);
  context.lineTo(point.x, point.y);
  context.stroke();
  session.x = point.x;
  session.y = point.y;
  session.dirty = true;
  session.canvas.dataset.hasDrawing = 'true';
}

function finishSignatureStroke(event) {
  if (!state.activeSignaturePad || state.activeSignaturePad.pointerId !== event.pointerId) {
    return;
  }
  try {
    state.activeSignaturePad.canvas.releasePointerCapture(event.pointerId);
  } catch (error) {
    // Pointer capture may already be released by the browser.
  }
  if (state.activeSignaturePad.dirty) {
    markDocumentDirty('Signature drawing captured locally. Save signatures to persist.');
  }
  state.activeSignaturePad = null;
}

function captureSignaturePad(index) {
  const canvas = elements.docView.querySelector(`[data-signature-pad="${index}"]`);
  const block = signatureBlockAt(index);
  if (!canvas || !block) {
    return false;
  }
  prepareSignaturePad(canvas);
  block.signature_data_url = canvas.toDataURL('image/png');
  block.signature_image = block.signature_data_url;
  block.signed_date = block.signed_date || LanaTime.toLocalDateInputValue(LanaTime.nowDate());
  block.signed_at = LanaTime.nowIso();
  delete canvas.dataset.hasDrawing;
  return true;
}

function clearSignaturePad(index) {
  const canvas = elements.docView.querySelector(`[data-signature-pad="${index}"]`);
  const block = signatureBlockAt(index);
  if (!canvas || !block) {
    return;
  }
  prepareSignaturePad(canvas);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, Number(canvas.dataset.logicalWidth || 720), Number(canvas.dataset.logicalHeight || 220));
  delete block.signature_data_url;
  delete block.signature_image;
  delete canvas.dataset.hasDrawing;
}

async function critiqueCurrentDeck({ polish = false } = {}) {
  if (!state.deck.cards.length) {
    setStatus('Generate or open a file before running the critic.');
    return;
  }
  if (!state.libraryCapabilities.critique) {
    setStatus('Quality review is not available in this server build.');
    return;
  }

  setStatus(polish ? 'Auto-polishing file...' : 'Analyzing file...');
  try {
    const url = state.presentationId
      ? `/api/v1/deck-studio/presentations/${encodeURIComponent(state.presentationId)}/critic`
      : '/api/v1/deck-studio/critic';
    const body = state.presentationId
      ? { polish, useLlm: false }
      : { deck: state.deck, polish, useLlm: false };
    const response = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Critic failed with ${response.status}`);
    }

    const payload = await response.json();
    state.critique = payload;
    if (polish && payload.polish?.deck) {
      state.deck = payload.polish.deck;
      await persistDeckPatch();
      await loadLibrary();
      setStatus(`Auto-polished file. Review score: ${Number(payload.score || 0)}.`);
    } else {
      setStatus(`Review score: ${Number(payload.score || 0)}. ${payload.summary || ''}`.trim());
    }
    render();
  } catch (error) {
    setStatus(error.message);
  }
}

async function generateDeck() {
  if (!confirmUnsavedDocumentChanges()) {
    return;
  }
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    setStatus('Add source material first.');
    elements.prompt.focus();
    return;
  }

  elements.generateBtn.disabled = true;
  setStatus(elements.mode.value === 'document' ? 'Generating legal document with local llama.cpp...' : 'Generating with local llama.cpp...');

  try {
    const isLegalDocument = elements.mode.value === 'document';
    const response = await apiFetch(isLegalDocument ? '/api/v1/deck-studio/generate/legal-document' : '/api/v1/deck-studio/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: elements.mode.value,
        documentType: elements.documentType.value,
        audience: elements.audience.value,
        tone: elements.tone.value,
        style: elements.style.value,
        cardCount: elements.cardCount.value,
        useLlm: true,
        useLegalSidecar: isLegalDocument,
        generateImages: elements.generateImages.checked,
        imageProvider: elements.generateImages.checked ? 'openai' : undefined,
        imageStyle: activeBrandKitModel().preferences.imageStyle,
        prompt
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Request failed with ${response.status}`);
    }

    const payload = await response.json();
    clearDocumentDirty();
    state.deck = payload.deck;
    state.critique = null;
    applyBrandControlsToDeck();
    const saved = await saveCurrentPresentation('pptx');
    replaceClientUrl(saved.edit_path);
    state.view = isLegalDocument ? 'doc' : 'slides';
    setStatus(isLegalDocument ? `Generated and saved ${payload.document?.title || state.deck.title}.` : `Generated and saved ${state.deck.cards.length} sections.`);
    render();
  } catch (error) {
    setStatus(`Generation failed: ${error.message}`);
  } finally {
    elements.generateBtn.disabled = false;
  }
}

async function generateOutline() {
  const prompt = elements.prompt.value.trim();
  if (!prompt) {
    setStatus('Add source material first.');
    elements.prompt.focus();
    return;
  }

  elements.outlineBtn.disabled = true;
  setStatus('Building outline with local llama.cpp...');

  try {
    const response = await apiFetch('/api/v1/deck-studio/outline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audience: elements.audience.value,
        tone: elements.tone.value,
        style: elements.style.value,
        cardCount: elements.cardCount.value,
        prompt
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Outline failed with ${response.status}`);
    }

    const payload = await response.json();
    if (payload.deck) {
      state.deck = payload.deck;
      state.critique = null;
      applyBrandControlsToDeck();
      state.presentationId = null;
      render();
      setStatus(`Outline created ${state.deck.cards.length} editable draft sections. Review, then Save or Generate.`);
    } else {
      setStatus('Outline created.');
    }
  } catch (error) {
    setStatus(`Outline failed: ${error.message}`);
  } finally {
    elements.outlineBtn.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadCurrentStoredFile() {
  const fileId = currentDocumentFileId();
  if (!fileId) {
    setStatus('No stored matter file is attached to this document.');
    return;
  }
  const params = new URLSearchParams();
  const matterId = currentMatterId();
  if (matterId) {
    params.set('matter_id', matterId);
  }
  const response = await apiFetch(`/api/v1/storage/files/${encodeURIComponent(fileId)}/download${params.toString() ? `?${params}` : ''}`);
  if (!response.ok) {
    setStatus('File download failed.');
    return;
  }
  downloadBlob(await response.blob(), currentDocumentFileName());
  setStatus('File download started.');
}

function slug(value) {
  return String(value || 'deck').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck';
}

function visualLabel(value, fallback) {
  const text = String(value || '').trim();
  if (!text || text.length > 42 || /^icon set|^icons? featuring|^visual direction/i.test(text)) {
    return fallback;
  }
  return text;
}

async function exportPptx() {
  if (!state.deck.cards.length) {
    setStatus('Generate a file before exporting.');
    return;
  }

  setStatus('Preparing PPTX...');
  const response = await apiFetch('/api/v1/deck-studio/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deck: state.deck })
  });

  if (!response.ok) {
    setStatus('PPTX export failed.');
    return;
  }

  downloadBlob(await response.blob(), `${slug(state.deck.title)}.pptx`);
  setStatus('PPTX exported.');
}

async function exportPdf() {
  if (!state.deck.cards.length && !state.deck.document) {
    setStatus('Generate a file before exporting.');
    return;
  }

  setStatus('Preparing PDF...');
  const response = await apiFetch('/api/v1/deck-studio/export/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.presentationId ? { presentation_id: state.presentationId } : { deck: state.deck })
  });

  if (!response.ok) {
    setStatus('PDF export failed.');
    return;
  }

  downloadBlob(await response.blob(), `${slug(state.deck.title)}.pdf`);
  setStatus('PDF exported.');
}

function documentHtmlForExport() {
  const docClone = elements.docView.cloneNode(true);
  docClone.querySelectorAll('button, canvas, .signature-actions').forEach(node => node.remove());
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(state.deck.title || 'Document')}</title><style>
    body{font-family:Georgia,"Times New Roman",serif;color:#161b1a;margin:48px;line-height:1.55}
    h1{font-size:28px;margin:0 0 8px} h2{font-size:18px;margin:28px 0 10px}
    .legal-doc-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:20px 0}
    .legal-doc-meta-card{border:1px solid #d8d2c8;border-radius:6px;padding:12px}
    dt{font:700 11px Arial,sans-serif;text-transform:uppercase;color:#66706c} dd{margin:4px 0 0;font-weight:700}
    .legal-doc-title-block{border-bottom:2px solid #161b1a;padding-bottom:18px;margin-bottom:24px}
    .legal-doc-title-block p{font:700 12px Arial,sans-serif;text-transform:uppercase;color:#2f6f73;margin:0 0 8px}
  </style></head><body>${docClone.innerHTML}</body></html>`;
}

async function exportDocumentDocx() {
  if (!state.deck.document) {
    setStatus('Open a document before exporting DOCX.');
    return;
  }
  setStatus('Preparing DOCX...');
  const response = await apiFetch('/api/v1/deck-studio/export/docx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.presentationId ? { presentation_id: state.presentationId } : { deck: state.deck })
  });

  if (!response.ok) {
    setStatus('DOCX export failed.');
    return;
  }

  downloadBlob(await response.blob(), `${slug(state.deck.title)}.docx`);
  setStatus('DOCX exported.');
}

function exportHtml() {
  const deckStyle = state.deck.style || state.deck.theme?.style || 'editorial';
  const composition = state.deck.designSystem?.composition || state.deck.designSystem?.stylePreset?.composition || 'magazine';
  const typeScale = state.deck.designSystem?.typeScale || state.deck.designSystem?.stylePreset?.typeScale || 'editorial';
  const brand = activeBrandKitModel();
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(state.deck.title)}</title><link rel="stylesheet" href="./styles.css"></head><body data-deck-style="${escapeHtml(deckStyle)}" data-composition="${escapeHtml(composition)}" data-type-scale="${escapeHtml(typeScale)}" data-image-style="${escapeHtml(brand.preferences.imageStyle)}" style="--deck-font-family:${escapeHtml(deckFontFamilies[brand.typography.fontFamily] || deckFontFamilies.inter)}"><main class="workspace"><div class="slides-view">${elements.slidesView.innerHTML}</div></main></body></html>`;
  downloadBlob(new Blob([html], { type: 'text/html' }), `${slug(state.deck.title)}.html`);
  setStatus('HTML exported.');
}

const quickStartPrompts = {
  mutual_nda: {
    mode: 'document',
    documentType: 'mutual_nda',
    title: 'Mutual Non-Disclosure Agreement',
    audience: 'legal and business reviewers',
    tone: 'precise, balanced, attorney-review ready',
    prompt: 'Draft a mutual NDA between [Disclosing Party] and [Receiving Party] for evaluating a possible business relationship. Include confidential information definition, exclusions, use restrictions, care standard, compelled disclosure, term, return/destruction, no license, no obligation, equitable relief, governing law, and signature blocks. Make it balanced and suitable as a working draft for attorney review.'
  },
  settlement: {
    mode: 'document',
    documentType: 'settlement_agreement',
    title: 'Settlement Agreement and Mutual Release',
    audience: 'legal reviewers and client decision makers',
    tone: 'clear, careful, risk-aware',
    prompt: 'Draft a settlement agreement and mutual release for [Plaintiff] and [Defendant] in [Case Name], Case No. [Case Number]. Settlement amount is [$ Amount]. Include payment timing, dismissal deadline, mutual release, no admission of liability, confidentiality, non-disparagement, tax treatment, authority, governing law, enforcement, notices, counterparts, and signature blocks. Flag placeholders that require attorney review.'
  },
  sow: {
    mode: 'document',
    documentType: 'sow',
    title: 'Statement of Work',
    audience: 'client stakeholders and delivery team',
    tone: 'commercial, specific, implementation-ready',
    prompt: 'Draft a statement of work for [Provider] delivering [Project] to [Client]. Include background, scope, deliverables, timeline, assumptions, client responsibilities, acceptance criteria, fees, expenses, change control, confidentiality reference, IP ownership, termination, and signatures.'
  },
  pitch: {
    mode: 'presentation',
    documentType: 'contract_summary',
    title: 'Strategic Pitch Deck',
    audience: 'executive stakeholders',
    tone: 'clear, concise, polished',
    prompt: 'Create a polished executive presentation for [Product or Initiative]. Cover the problem, target users, current workflow, proposed solution, key benefits, risks, rollout plan, success metrics, business impact, and next steps.'
  }
};

function applyQuickStart(id) {
  const preset = quickStartPrompts[id];
  if (!preset) return;
  elements.mode.value = preset.mode;
  elements.documentType.value = preset.documentType;
  elements.metadataTitle.value = preset.title;
  elements.audience.value = preset.audience;
  elements.tone.value = preset.tone;
  elements.prompt.value = preset.prompt;
  state.deck.title = preset.title;
  elements.deckTitle.textContent = preset.title;
  setStatus(`${preset.title} starter loaded.`);
}

elements.generateBtn.addEventListener('click', generateDeck);
elements.outlineBtn.addEventListener('click', generateOutline);
elements.importSourceBtn.addEventListener('click', importSourcesToPrompt);
elements.quickStarts.forEach(button => {
  button.addEventListener('click', () => applyQuickStart(button.dataset.quickStart));
});
elements.sampleBtn.addEventListener('click', () => {
  if (elements.mode.value === 'document') {
    elements.prompt.value = 'Draft a mutual NDA for Brainchild Labs and Lana AI, Inc. for discussing a possible product integration. Use New York law. Keep it balanced, startup-friendly, and suitable as a working draft for attorney review.';
    elements.documentType.value = 'mutual_nda';
    elements.audience.value = 'legal and business reviewers';
    elements.tone.value = 'precise, balanced, attorney-review ready';
    return;
  }
  elements.prompt.value = 'Create a polished pitch deck for a local-first AI productivity platform for law firms. Cover the problem, target users, core workflow, product architecture, security posture, rollout plan, pricing, and next steps.';
});
elements.printBtn.addEventListener('click', exportPdf);
elements.pptxBtn.addEventListener('click', exportPptx);
elements.htmlBtn.addEventListener('click', exportHtml);
elements.metadataTitle.addEventListener('input', () => {
  state.deck.title = elements.metadataTitle.value;
  elements.deckTitle.textContent = state.deck.title || 'Untitled file';
});
elements.metadataSubtitle.addEventListener('input', () => {
  state.deck.subtitle = elements.metadataSubtitle.value;
  elements.deckSubtitle.textContent = state.deck.subtitle || '';
});
elements.themeAccent.addEventListener('input', () => {
  state.deck.theme = { ...(state.deck.theme || {}), accent: elements.themeAccent.value };
  render();
});
elements.themeBackground.addEventListener('input', () => {
  state.deck.theme = { ...(state.deck.theme || {}), background: elements.themeBackground.value };
  render();
});
elements.themeForeground.addEventListener('input', () => {
  state.deck.theme = { ...(state.deck.theme || {}), foreground: elements.themeForeground.value };
  render();
});
[
  elements.brandLogoUrl,
  elements.brandTextMark,
  elements.brandFontFamily,
  elements.brandIconMode,
  elements.brandImageStyle,
  elements.brandDensity,
  elements.brandComposition
].filter(Boolean).forEach(input => {
  input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
    applyBrandControlsToDeck();
    render();
  });
});
elements.saveBrandKitBtn.addEventListener('click', saveBrandKit);
elements.brandKitSelect.addEventListener('change', () => applyBrandKit(elements.brandKitSelect.value));
elements.style.addEventListener('change', () => applyDeckStyle(elements.style.value));
elements.slidesView.addEventListener('input', syncEdits);
elements.slidesView.addEventListener('click', event => {
  const cardNode = event.target.closest('.slide-card');
  if (!cardNode || event.target.closest('[contenteditable="true"], button, select, input')) {
    return;
  }

  const nextIndex = Number(cardNode.dataset.index);
  if (nextIndex !== state.selectedSlideIndex) {
    state.selectedSlideIndex = nextIndex;
    render();
  }
});
elements.presentView.addEventListener('click', event => {
  if (event.target.closest('[data-present-prev]')) {
    movePresentation(-1);
    return;
  }
  if (event.target.closest('[data-present-next]')) {
    movePresentation(1);
    return;
  }
  if (event.target.closest('[data-present-close]')) {
    exitPresentation();
    return;
  }
  if (event.target.closest('.present-stage')) {
    movePresentation(1);
  }
});
elements.slidePicker.addEventListener('change', () => {
  state.selectedSlideIndex = Number(elements.slidePicker.value) || 0;
  render();
  document.querySelector(`[data-index="${state.selectedSlideIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
elements.prevSlideBtn.addEventListener('click', () => {
  state.selectedSlideIndex = Math.max(0, state.selectedSlideIndex - 1);
  render();
});
elements.nextSlideBtn.addEventListener('click', () => {
  state.selectedSlideIndex = Math.min(Math.max(0, state.deck.cards.length - 1), state.selectedSlideIndex + 1);
  render();
});
elements.slideLayout.addEventListener('change', () => {
  const card = selectedCard();
  if (!card) {
    return;
  }
  card.design = { ...(card.design || {}), layout: elements.slideLayout.value };
  delete card.design.template;
  delete card.design.templateId;
  render();
});
elements.slideStyle.addEventListener('change', () => {
  const card = selectedCard();
  if (!card) {
    return;
  }
  card.design = { ...(card.design || {}) };
  if (elements.slideStyle.value === 'deck') {
    delete card.design.style;
    delete card.design.accent;
  } else {
    card.design.style = elements.slideStyle.value;
    card.design.accent = stylePreset(elements.slideStyle.value).accent;
  }
  render();
});
elements.addSlideBtn.addEventListener('click', addSlide);
elements.duplicateSlideBtn.addEventListener('click', duplicateSelectedSlide);
elements.removeSlideBtn.addEventListener('click', removeSelectedSlide);
elements.moveSlideUpBtn.addEventListener('click', () => moveSelectedSlide(-1));
elements.moveSlideDownBtn.addEventListener('click', () => moveSelectedSlide(1));
elements.rewriteSlideBtn.addEventListener('click', () => reviseSelectedSlide('rewrite'));
elements.regenerateSlideBtn.addEventListener('click', () => reviseSelectedSlide('regenerate'));
elements.generateSlideImageBtn.addEventListener('click', generateSelectedSlideImage);
elements.removeSlideImageBtn.addEventListener('click', removeSelectedSlideImage);
elements.toggleTemplatesBtn.addEventListener('click', () => {
  state.templateGalleryOpen = !state.templateGalleryOpen;
  renderEditorTools();
  if (state.templateGalleryOpen) {
    elements.templateGallery.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});
elements.sharePresentationBtn.addEventListener('click', shareCurrentPresentation);
elements.saveMetadataBtn.addEventListener('click', saveMetadata);
elements.styleCompare.addEventListener('click', event => {
  const button = event.target.closest('[data-apply-style]');
  if (!button) {
    return;
  }

  applyDeckStyle(button.dataset.applyStyle);
});
elements.criticPanel.addEventListener('click', event => {
  if (event.target.closest('#analyzeDeckBtn')) {
    critiqueCurrentDeck({ polish: false });
    return;
  }
  if (event.target.closest('#polishDeckBtn')) {
    critiqueCurrentDeck({ polish: true });
    return;
  }
  const finding = event.target.closest('[data-critic-slide]');
  if (finding) {
    state.selectedSlideIndex = Number(finding.dataset.criticSlide) || 0;
    render();
    document.querySelector(`[data-index="${state.selectedSlideIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
elements.visualEditor.addEventListener('input', event => {
  const card = state.deck.cards[state.selectedSlideIndex];
  if (!card) {
    return;
  }

  if (event.target.id === 'visualLabelInput') {
    card.visual = event.target.value.trim();
  }
  if (event.target.id === 'imagePromptInput') {
    card.image_prompt = event.target.value.trim();
  }
});
elements.visualEditor.addEventListener('change', event => {
  if (event.target.id === 'slideImageStyleInput') {
    const card = state.deck.cards[state.selectedSlideIndex];
    if (!card) {
      return;
    }
    card.design = { ...(card.design || {}), imageStyle: enumOption(event.target.value, imageStyleOptions, activeBrandKitModel().preferences.imageStyle) };
    return;
  }

  const select = event.target.closest('[data-bullet-icon]');
  const card = state.deck.cards[state.selectedSlideIndex];
  if (!select || !card) {
    return;
  }

  const bulletIcons = ensureBulletIconModel(card);
  const pointIndex = Number(select.dataset.bulletIcon);
  bulletIcons[pointIndex].icon = select.value;
  render();
});
elements.templateGallery.addEventListener('click', event => {
  const button = event.target.closest('[data-template-id]');
  if (!button) {
    return;
  }

  applyTemplateToSelectedSlide(button.dataset.templateId);
});
elements.libraryList.addEventListener('click', async event => {
  const libraryItemButton = event.target.closest('[data-open-library-item]');
  const openButton = event.target.closest('[data-open-presentation]');
  const duplicateButton = event.target.closest('[data-duplicate-presentation]');
  const renameButton = event.target.closest('[data-rename-presentation]');
  const deleteButton = event.target.closest('[data-delete-presentation]');
  if (!libraryItemButton && !openButton && !duplicateButton && !renameButton && !deleteButton) {
    return;
  }

  try {
    if (libraryItemButton) {
      await openLibraryItem(libraryItemButton.dataset.openLibraryItem);
      return;
    }
    if (openButton && !confirmUnsavedDocumentChanges()) {
      return;
    }
    if (duplicateButton) {
      await duplicatePresentation(duplicateButton.dataset.duplicatePresentation);
      return;
    }
    if (renameButton) {
      await renamePresentation(renameButton.dataset.renamePresentation);
      return;
    }
    if (deleteButton) {
      await deletePresentation(deleteButton.dataset.deletePresentation);
      return;
    }

    const id = openButton.dataset.openPresentation;
    replaceClientUrl(`/doc-studio/?id=${encodeURIComponent(id)}`);
    state.presentationId = id;
    await loadPresentationFromUrl();
    render();
  } catch (error) {
    setStatus(error.message);
  }
});
if (elements.docSidePanel) {
  elements.docSidePanel.addEventListener('lex-change', event => {
    state.documentPanelTab = event.detail?.value || 'comments';
    renderDocumentSidePanel(state.deck);
  });
  elements.docSidePanel.addEventListener('comment-submit', async event => {
    try {
      await addDocumentComment(event.detail?.content || '');
    } catch (error) {
      setStatus(error.message);
    }
  });
  elements.docSidePanel.addEventListener('click', async event => {
    const versionButton = event.target.closest('[data-doc-version]');
    const addCommentButton = event.target.closest('[data-doc-add-comment]');
    const deleteCommentButton = event.target.closest('[data-doc-delete-comment]');
    const addShareButton = event.target.closest('[data-doc-add-share]');
    const removeShareButton = event.target.closest('[data-doc-remove-share]');
    if (versionButton) {
      state.selectedDocumentVersion = versionButton.dataset.docVersion;
      renderDocumentSidePanel(state.deck);
      return;
    }
    try {
      if (addCommentButton) {
        await addDocumentComment();
        return;
      }
      if (deleteCommentButton) {
        await deleteDocumentComment(deleteCommentButton.dataset.docDeleteComment);
        return;
      }
      if (addShareButton) {
        await addDocumentShareRecipient();
        return;
      }
      if (removeShareButton) {
        await removeDocumentShareRecipient(removeShareButton.dataset.docRemoveShare);
      }
    } catch (error) {
      setStatus(error.message);
    }
  });
}
if (elements.docHeaderChrome) {
  elements.docHeaderChrome.addEventListener('click', async event => {
    const undoButton = event.target.closest('[data-doc-undo]');
    const redoButton = event.target.closest('[data-doc-redo]');
    const exportButton = event.target.closest('[data-doc-export]');
    const saveDocumentButton = event.target.closest('[data-save-document]');
    if (!undoButton && !redoButton && !exportButton && !saveDocumentButton) {
      return;
    }
    try {
      if (undoButton) {
        restoreDocumentHistory(state.documentHistoryIndex - 1);
        return;
      }
      if (redoButton) {
        restoreDocumentHistory(state.documentHistoryIndex + 1);
        return;
      }
      if (exportButton?.dataset.docExport === 'pdf') {
        await exportPdf();
        return;
      }
      if (exportButton?.dataset.docExport === 'docx') {
        await exportDocumentDocx();
        return;
      }
      await saveDocumentEdits();
    } catch (error) {
      setStatus(error.message);
    }
  });
}
elements.docView.addEventListener('input', event => {
  syncDocumentEdits(event);
  const input = event.target.closest('[data-signature-field]');
  if (!input) {
    return;
  }
  const block = signatureBlockAt(Number(input.dataset.signatureIndex));
  if (!block) {
    return;
  }
  block[input.dataset.signatureField] = input.value.trim();
  markDocumentDirty('Signature details changed. Save signatures to persist.');
});
elements.docView.addEventListener('pointerdown', event => {
  const canvas = event.target.closest('[data-signature-pad]');
  if (!canvas) {
    return;
  }
  prepareSignaturePad(canvas);
  const point = canvasPoint(event, canvas);
  state.activeSignaturePad = {
    canvas,
    pointerId: event.pointerId,
    x: point.x,
    y: point.y,
    dirty: false
  };
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
});
elements.docView.addEventListener('pointermove', event => {
  if (!state.activeSignaturePad) {
    return;
  }
  drawSignatureStroke(event);
  event.preventDefault();
});
elements.docView.addEventListener('pointerup', finishSignatureStroke);
elements.docView.addEventListener('pointercancel', finishSignatureStroke);
elements.docView.addEventListener('click', async event => {
  const saveDocumentButton = event.target.closest('[data-save-document]');
  const saveButton = event.target.closest('[data-save-signatures]');
  const addPartyButton = event.target.closest('[data-doc-add-party]');
  const deletePartyButton = event.target.closest('[data-doc-delete-party]');
  const addSectionButton = event.target.closest('[data-doc-add-section]');
  const deleteSectionButton = event.target.closest('[data-doc-delete-section]');
  const deleteMetaButton = event.target.closest('[data-doc-delete-meta]');
  const addReviewNoteButton = event.target.closest('[data-doc-add-review-note]');
  const deleteReviewNoteButton = event.target.closest('[data-doc-delete-review-note]');
  const addCommentButton = event.target.closest('[data-doc-add-comment]');
  const deleteCommentButton = event.target.closest('[data-doc-delete-comment]');
  const addShareButton = event.target.closest('[data-doc-add-share]');
  const removeShareButton = event.target.closest('[data-doc-remove-share]');
  const signButton = event.target.closest('[data-signature-sign]');
  const clearButton = event.target.closest('[data-signature-clear]');
  const useDrawingButton = event.target.closest('[data-signature-pad-use]');
  const eraseDrawingButton = event.target.closest('[data-signature-pad-erase]');
  if (!saveDocumentButton && !saveButton && !addPartyButton && !deletePartyButton && !addSectionButton && !deleteSectionButton && !deleteMetaButton && !addReviewNoteButton && !deleteReviewNoteButton && !addCommentButton && !deleteCommentButton && !addShareButton && !removeShareButton && !signButton && !clearButton && !useDrawingButton && !eraseDrawingButton) {
    return;
  }

  try {
    if (addPartyButton) {
      addDocumentParty();
      return;
    }

    if (deletePartyButton) {
      deleteDocumentParty(Number(deletePartyButton.dataset.docDeleteParty));
      return;
    }

    if (addSectionButton) {
      addDocumentSection();
      return;
    }

    if (deleteSectionButton) {
      deleteDocumentSection(Number(deleteSectionButton.dataset.docDeleteSection));
      return;
    }

    if (deleteMetaButton) {
      deleteDocumentMetaField(deleteMetaButton.dataset.docDeleteMeta);
      return;
    }

    if (addReviewNoteButton) {
      addDocumentReviewNote();
      return;
    }

    if (deleteReviewNoteButton) {
      deleteDocumentReviewNote(Number(deleteReviewNoteButton.dataset.docDeleteReviewNote));
      return;
    }

    if (addCommentButton) {
      await addDocumentComment();
      return;
    }

    if (deleteCommentButton) {
      await deleteDocumentComment(deleteCommentButton.dataset.docDeleteComment);
      return;
    }

    if (addShareButton) {
      await addDocumentShareRecipient();
      return;
    }

    if (removeShareButton) {
      await removeDocumentShareRecipient(removeShareButton.dataset.docRemoveShare);
      return;
    }

    if (saveDocumentButton) {
      await saveDocumentEdits();
      return;
    }

    if (saveButton) {
      await saveDocumentSignatures();
      return;
    }

    const index = Number(
      signButton?.dataset.signatureSign
      ?? clearButton?.dataset.signatureClear
      ?? useDrawingButton?.dataset.signaturePadUse
      ?? eraseDrawingButton?.dataset.signaturePadErase
    );
    const block = signatureBlockAt(index);
    if (!block) {
      return;
    }

    if (useDrawingButton) {
      if (captureSignaturePad(index)) {
        markDocumentDirty('Drawn signature captured. Save signatures to persist.');
        render();
        setStatus('Drawn signature captured. Save signatures to persist.');
      }
      return;
    }

    if (eraseDrawingButton) {
      clearSignaturePad(index);
      markDocumentDirty('Drawn signature erased. Save signatures to persist.');
      render();
      setStatus('Drawn signature erased. Save signatures to persist.');
      return;
    }

    if (clearButton) {
      delete block.signature_text;
      delete block.signature;
      delete block.signed_by;
      delete block.signed_title;
      delete block.signed_date;
      delete block.signed_at;
      delete block.signature_data_url;
      delete block.signature_image;
      markDocumentDirty('Signature cleared. Save signatures to persist.');
      render();
      setStatus('Signature cleared. Save signatures to persist.');
      return;
    }

    const signatureCanvas = elements.docView.querySelector(`[data-signature-pad="${index}"]`);
    if (signatureCanvas?.dataset.hasDrawing === 'true') {
      captureSignaturePad(index);
    }
    block.signature_text = block.signature_text || block.signed_by || block.party || 'Authorized Signature';
    block.signed_by = block.signed_by || block.signature_text;
    block.signed_title = block.signed_title || block.signatory_title || '[Authorized Signatory]';
    block.signed_date = block.signed_date || LanaTime.toLocalDateInputValue(LanaTime.nowDate());
    block.signed_at = LanaTime.nowIso();
    markDocumentDirty('Signature captured. Save signatures to persist.');
    render();
    setStatus('Signature captured. Save signatures to persist.');
  } catch (error) {
    setStatus(error.message);
  }
});
elements.tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.dataset.view !== state.view && !confirmUnsavedDocumentChanges()) {
      return;
    }
    state.view = tab.dataset.view;
    if (state.view === 'library') {
      loadLibrary();
    }
    render();
  });
});
document.addEventListener('keydown', event => {
  if (state.view !== 'present') {
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
    event.preventDefault();
    movePresentation(1);
  }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    movePresentation(-1);
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    exitPresentation();
  }
});
window.addEventListener('beforeunload', event => {
  if (!state.documentDirty) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});

loadBrandKits();
render();
loadTemplates();
loadCapabilities();
loadPresentationFromUrl();
loadLibrary();
