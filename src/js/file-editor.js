/* LANA File Editor page controller (file-editor.html).
   The single editing surface for real matter documents: the LANA Editor embed
   plus the server-backed review workflow (drafts, change history, versions,
   comments, releases) through the shared LanaDocumentReview datasource.
   The editor and its review workflow are owned by this page. Cross-page review
   semantics stay single-sourced in js/services/document-review-api.service.js.
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'lana:file-editor:local';
  var SERVER_DRAFT_AUTOSAVE_DELAY_MS = 1600;
  var DOC_AUTOSAVE_DELAY_MS = 1200;
  var DOC_HISTORY_LIMIT = 50;
  var DOC_BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,div';
  var DOC_UI_SELECTOR = [
    '.office-selection-toolbar',
    '.office-doc-toolbar',
    '.office-template-variable-menu',
    '.lana-editor-selection-toolbar',
    '.lana-editor-floating-toolbar',
    '.lex-selection-toolbar',
    '[data-lana-editor-ui]',
    '[data-selection-toolbar]',
    '[data-editor-toolbar]',
    '[role="toolbar"]',
    'button',
    'input',
    'select',
    'textarea'
  ].join(',');
  var DOC_UI_TEXT_ARTIFACT_PATTERN = /\s*\d?ReplaceDeleteInsert afterBIULinkFieldsApplyCancelAsk LANAAcceptReject\s*/g;
  var DOC_UI_TEXT_FRAGMENTS = [
    'ReplaceDeleteInsert after',
    'BIULinkFieldsApplyCancelAsk LANAAcceptReject',
    'ApplyCancelAsk LANAAcceptReject',
    'AcceptReject'
  ];
  var KIND_LABELS = { doc: 'Text document', sheet: 'Spreadsheet', deck: 'Slide deck' };
  var KIND_ICONS = { doc: 'file-text', sheet: 'table-2', deck: 'monitor' };
  var activePanel = 'editor';
  var activeFilter = 'all';
  var rightRailMode = 'review';
  var reviewRailTab = 'changes';
  var fileInfoMode = 'view';
  var selectedCell = 'A1';
  var activeSlide = 0;
  var state = null;
  var eventsBound = false;
  var editorImportMapBase = '';
  var editorModulePromise = null;
  var officeEditorInstance = null;
  var officeReviewFocus = null;
  var officeEditorFileId = '';
  var officeEditorHostEl = null;
  var embedToolbarSelectionRanges = null;
  var fallbackDocSelectionRange = null;
  var templateVariableMenuState = null;
  var mentionUserSearchSeq = 0;
  var mentionUserSearchCache = {};
  var docAutosaveTimers = {};
  var editorMountGeneration = 0;
  var initializedContentRoot = null;
  var editorLoadError = '';
  var editorRouteLoading = false;
  var editorReferrer = '';
  var leavingEditor = false;
  var officeEditorDocumentStats = {};
  var officeRemoteWorkflows = {};
  var shareModalState = null;
  var pendingLanaEditRequest = null;

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    if (window.Lex && Lex.Utils && Lex.Utils.escapeHtml) return Lex.Utils.escapeHtml(value);
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function documentDisplayFilename(file) {
    var value = file || {};
    return value.display_filename || value.original_filename || value.original_name ||
      value.title || value.filename || value.name || 'Document';
  }

  function icon(name) {
    if (window.Lex && Lex.Icons && Lex.Icons.has && Lex.Icons.has(name)) {
      return Lex.Icons.get({ name: name, size: 'small' });
    }
    return '';
  }

  function toolbarIcon(name, fallback) {
    var svg = icon(name);
    if (svg) return svg;
    return '<span class="office-toolbar-fallback">' + esc(fallback) + '</span>';
  }

  function hydrateIcons(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll('[data-icon]');
    for (var i = 0; i < nodes.length; i += 1) {
      nodes[i].innerHTML = icon(nodes[i].getAttribute('data-icon'));
    }
  }

  function sanitizeOfficeDocText(value) {
    var text = String(value == null ? '' : value).replace(DOC_UI_TEXT_ARTIFACT_PATTERN, ' ');
    DOC_UI_TEXT_FRAGMENTS.forEach(function (fragment) {
      text = text.split(fragment).join(' ');
    });
    return text.replace(/[ \t]{2,}/g, ' ');
  }

  function sanitizeOfficeDocElement(root) {
    if (!root || !root.querySelectorAll || typeof document === 'undefined') return root;
    root.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form').forEach(function (node) {
      node.remove();
    });
    root.querySelectorAll('*').forEach(function (node) {
      Array.prototype.slice.call(node.attributes || []).forEach(function (attribute) {
        var name = String(attribute.name || '').toLowerCase();
        var value = String(attribute.value || '').trim().toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcdoc' ||
            ((name === 'href' || name === 'src' || name === 'xlink:href') &&
              (value.indexOf('javascript:') === 0 || value.indexOf('data:text/html') === 0))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    root.querySelectorAll(DOC_UI_SELECTOR).forEach(function (node) {
      node.remove();
    });
    var nodeFilter = window.NodeFilter || { SHOW_TEXT: 4 };
    var walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
    var textNodes = [];
    var textNode;
    while ((textNode = walker.nextNode())) textNodes.push(textNode);
    textNodes.forEach(function (node) {
      var clean = sanitizeOfficeDocText(node.nodeValue);
      if (clean !== node.nodeValue) node.nodeValue = clean;
    });
    return root;
  }

  function sanitizeOfficeDocHtml(html) {
    if (!html) return '';
    if (typeof document === 'undefined') return sanitizeOfficeDocText(html);
    var wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');
    sanitizeOfficeDocElement(wrapper);
    return wrapper.innerHTML;
  }

  function cleanOfficeDocContent(html) {
    return sanitizeOfficeDocHtml(stripOfficeReviewMarksFromHtml(html || ''));
  }

  function writerTools() {
    return window.LanaFileEditorWriterTools || null;
  }

  function collaborationTools() {
    return window.LanaFileEditorCollaborationTools || null;
  }

  function sheetEngine() {
    return window.LanaFileEditorSheetEngine || null;
  }

  function contentApi() {
    var service = window.LanaFileEditorContentApi;
    if (!service || typeof service.getEditModel !== 'function' ||
        typeof service.saveEditModel !== 'function' || typeof service.exportDocument !== 'function') {
      return null;
    }
    return service;
  }

  function toolbarGroup(title, body) {
    return '<div class="office-toolbar-group" aria-label="' + esc(title) + '">' +
      '<span class="office-toolbar-group-title">' + esc(title) + '</span>' +
      '<span class="office-toolbar-controls">' + body + '</span></div>';
  }

  function templateVariableEntities() {
    var entities = [
      {
        key: 'activity',
        label: 'Activity',
        properties: [
          { key: 'type', label: 'Type' },
          { key: 'title', label: 'Title' },
          { key: 'subject', label: 'Subject' },
          { key: 'description', label: 'Description' },
          { key: 'notes', label: 'Notes' },
          { key: 'date', label: 'Date' },
          { key: 'status', label: 'Status' }
        ]
      },
      {
        key: 'calendar_event',
        label: 'Calendar event',
        properties: [
          { key: 'title', label: 'Title' },
          { key: 'subject', label: 'Subject' },
          { key: 'description', label: 'Description' },
          { key: 'starts_at', label: 'Start time' },
          { key: 'ends_at', label: 'End time' },
          { key: 'location', label: 'Location' },
          { key: 'attendees', label: 'Attendees' }
        ]
      },
      {
        key: 'contact',
        label: 'Contact',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'first_name', label: 'First name' },
          { key: 'last_name', label: 'Last name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'organization', label: 'Organization' },
          { key: 'title', label: 'Title' },
          { key: 'address', label: 'Address' }
        ]
      },
      {
        key: 'date',
        label: 'Date',
        properties: [
          { key: 'todays_date', label: "Today's date" },
          { key: 'custom_date', label: 'Custom date' }
        ]
      },
      {
        key: 'deal',
        label: 'Deal',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'title', label: 'Title' },
          { key: 'status', label: 'Status' },
          { key: 'pipeline_stage', label: 'Pipeline stage' },
          { key: 'value', label: 'Value' },
          { key: 'owner', label: 'Owner' },
          { key: 'close_date', label: 'Close date' }
        ]
      },
      {
        key: 'document',
        label: 'Document',
        properties: [
          { key: 'title', label: 'Title' },
          { key: 'filename', label: 'Filename' },
          { key: 'document_id', label: 'Document ID' },
          { key: 'document_type', label: 'Document type' },
          { key: 'content_type', label: 'Content type' },
          { key: 'uploaded_at', label: 'Uploaded date' },
          { key: 'updated_at', label: 'Updated date' },
          { key: 'summary', label: 'AI summary' }
        ]
      },
      {
        key: 'event',
        label: 'Event',
        properties: [
          { key: 'title', label: 'Title' },
          { key: 'subject', label: 'Subject' },
          { key: 'description', label: 'Description' },
          { key: 'starts_at', label: 'Start time' },
          { key: 'ends_at', label: 'End time' },
          { key: 'location', label: 'Location' },
          { key: 'attendees', label: 'Attendees' }
        ]
      },
      {
        key: 'matter',
        label: 'Matter / Workspace',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'title', label: 'Title' },
          { key: 'matter_id', label: 'Matter ID' },
          { key: 'number', label: 'Number' },
          { key: 'status', label: 'Status' },
          { key: 'type', label: 'Type' },
          { key: 'description', label: 'Description' },
          { key: 'created_at', label: 'Created date' },
          { key: 'updated_at', label: 'Updated date' }
        ]
      },
      {
        key: 'message',
        label: 'Message',
        properties: [
          { key: 'subject', label: 'Subject' },
          { key: 'body', label: 'Body' },
          { key: 'from', label: 'From' },
          { key: 'sender', label: 'Sender' },
          { key: 'recipient', label: 'Recipient' },
          { key: 'sent_at', label: 'Sent date' },
          { key: 'channel', label: 'Channel' }
        ]
      },
      {
        key: 'note',
        label: 'Note',
        properties: [
          { key: 'title', label: 'Title' },
          { key: 'content', label: 'Content' },
          { key: 'text', label: 'Text' },
          { key: 'author', label: 'Author' },
          { key: 'created_at', label: 'Created date' },
          { key: 'updated_at', label: 'Updated date' }
        ]
      },
      {
        key: 'opportunity',
        label: 'Opportunity',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'title', label: 'Title' },
          { key: 'status', label: 'Status' },
          { key: 'pipeline_stage', label: 'Pipeline stage' },
          { key: 'value', label: 'Value' },
          { key: 'owner', label: 'Owner' },
          { key: 'close_date', label: 'Close date' }
        ]
      },
      {
        key: 'organization',
        label: 'Organization',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'organization_id', label: 'Organization ID' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'address', label: 'Address' }
        ]
      },
      {
        key: 'participant',
        label: 'Participant',
        properties: [
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'organization', label: 'Organization' }
        ]
      },
      {
        key: 'task',
        label: 'Task',
        properties: [
          { key: 'title', label: 'Title' },
          { key: 'description', label: 'Description' },
          { key: 'status', label: 'Status' },
          { key: 'priority', label: 'Priority' },
          { key: 'assignee', label: 'Assignee' },
          { key: 'due_date', label: 'Due date' },
          { key: 'created_at', label: 'Created date' }
        ]
      }
    ];
    return entities.sort(function (a, b) {
      return String(a.label || a.key).localeCompare(String(b.label || b.key));
    });
  }

  function templateVariableEntity(key) {
    var normalized = String(key || '').toLowerCase();
    var entities = templateVariableEntities();
    for (var i = 0; i < entities.length; i += 1) {
      if (entities[i].key === normalized) return entities[i];
    }
    return null;
  }

  function dateVariableFormats() {
    return [
      { key: 'long', label: 'Month day, year', example: 'August 20, 2026' },
      { key: 'short', label: 'MM/DD/YYYY', example: '08/20/2026' },
      { key: 'iso', label: 'YYYY-MM-DD', example: '2026-08-20' },
      { key: 'month_day', label: 'Month day', example: 'August 20' },
      { key: 'abbrev_month_day_year', label: 'Mon day, year', example: 'Aug 20, 2026' },
      { key: 'day_month_year', label: 'Day month year', example: '20 August 2026' },
      { key: 'weekday_long', label: 'Weekday, month day, year', example: 'Thursday, August 20, 2026' }
    ];
  }

  function dateVariableSourceLabel(sourceKey) {
    if (sourceKey === 'todays_date') return "Today's date";
    if (sourceKey === 'custom_date') return 'Custom date';
    return sourceKey || 'Date';
  }

  function dateVariableFormat(key) {
    var formats = dateVariableFormats();
    for (var i = 0; i < formats.length; i += 1) {
      if (formats[i].key === key) return formats[i];
    }
    return null;
  }

  function filteredDateVariableFormats(query) {
    var value = String(query || '').toLowerCase();
    return dateVariableFormats().filter(function (format) {
      return !value ||
        format.key.indexOf(value) !== -1 ||
        String(format.label || '').toLowerCase().indexOf(value) !== -1 ||
        String(format.example || '').toLowerCase().indexOf(value) !== -1;
    });
  }

  function templateVariableLiteral(entityKey, propertyKey, formatKey) {
    var entity = String(entityKey || '').trim();
    var property = String(propertyKey || '').trim();
    var format = String(formatKey || '').trim();
    if (entity === 'date' && format) return '#{{' + entity + ':' + property + ':' + format + '}}';
    return '#{{' + entity + ':' + property + '}}';
  }

  function templateVariableTokenHtml(entityKey, propertyKey, formatKey) {
    var entity = templateVariableEntity(entityKey) || { key: entityKey, label: entityKey };
    var property = null;
    var properties = entity.properties || [];
    for (var i = 0; i < properties.length; i += 1) {
      if (properties[i].key === propertyKey) property = properties[i];
    }
    var format = entity.key === 'date' ? dateVariableFormat(formatKey) : null;
    var literal = templateVariableLiteral(entity.key || entityKey, propertyKey, formatKey);
    var label = (entity.label || entity.key || entityKey) + ' - ' + (property ? property.label : propertyKey) + (format ? ' - ' + format.label : '');
    return '<span class="office-template-variable" contenteditable="false" data-template-variable="true" data-entity="' +
      esc(entity.key || entityKey) + '" data-property-key="' + esc(propertyKey) + '" data-format-key="' + esc(formatKey || '') + '" title="' + esc(label) + '">' +
      esc(literal) + '</span>';
  }

  function mentionUserProperties() {
    return [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'username', label: 'Username' },
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'title', label: 'Title' },
      { key: 'role', label: 'Role' },
      { key: 'organization', label: 'Organization' },
      { key: 'department', label: 'Department' }
    ];
  }

  function currentUserRecord() {
    var user = window.api && window.api.user ? window.api.user : null;
    if (!user) {
      try {
        user = JSON.parse(localStorage.getItem('user') || 'null');
      } catch (_) {
        user = null;
      }
    }
    return user || null;
  }

  function initialsForName(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return parts.slice(0, 2).map(function (part) { return part.charAt(0); }).join('').toUpperCase();
  }

  function normalizeMentionUser(row) {
    if (!row) return null;
    if (row.share_eligible === false || row.kind === 'agent' || row.kind === 'contact') return null;
    var id = row.share_target_user_id || row.user_id || row.id || row.value || row.email || '';
    if (!id) return null;
    var first = row.first_name || row.firstName || '';
    var last = row.last_name || row.lastName || '';
    var full = [first, last].join(' ').trim();
    var name = row.label || row.name || row.full_name || row.fullName || row.display_name || row.displayName || full || row.username || row.email || 'User';
    var email = row.email || row.subtitle || row.username || '';
    return {
      id: String(id),
      label: String(name),
      email: String(email || ''),
      username: String(row.username || email || ''),
      first_name: String(first || ''),
      last_name: String(last || ''),
      title: String(row.title || row.role_name || ''),
      role: String(row.role || row.role_name || row.kind || 'User'),
      organization: String(row.organization_name || row.organization || ''),
      department: String(row.department_name || row.department || '')
    };
  }

  function collectMentionUsers(payload) {
    var rows = [];
    var seen = {};
    function add(row) {
      var user = normalizeMentionUser(row);
      if (!user || seen[user.id]) return;
      seen[user.id] = true;
      rows.push(user);
    }
    if (payload && Array.isArray(payload.groups)) {
      payload.groups.forEach(function (group) {
        (group.matches || []).forEach(add);
      });
    }
    if (payload && Array.isArray(payload.matches)) {
      payload.matches.forEach(add);
    }
    return rows;
  }

  function fallbackMentionUsers(query) {
    var current = normalizeMentionUser(currentUserRecord());
    var rows = current ? [current] : [];
    var value = String(query || '').toLowerCase();
    if (!value) return rows;
    return rows.filter(function (user) {
      return user.label.toLowerCase().indexOf(value) !== -1 || user.email.toLowerCase().indexOf(value) !== -1;
    });
  }

  function currentMentionMatterId() {
    var file = activeFile();
    return file && (file.matterId || file.matter_id || file.sourceMatterId || file.source_matter_id)
      ? String(file.matterId || file.matter_id || file.sourceMatterId || file.source_matter_id)
      : '';
  }

  function mentionSearchKey(query) {
    return currentMentionMatterId() + '::' + String(query || '').toLowerCase();
  }

  function requestMentionUsers(query) {
    var key = mentionSearchKey(query);
    if (mentionUserSearchCache[key] && mentionUserSearchCache[key].loading) return;
    if (mentionUserSearchCache[key] && mentionUserSearchCache[key].loaded) return;
    mentionUserSearchCache[key] = { loading: true, loaded: false, rows: fallbackMentionUsers(query) };
    var client = window.api;
    if (!client || typeof client.searchMentions !== 'function') {
      mentionUserSearchCache[key] = { loading: false, loaded: true, rows: fallbackMentionUsers(query) };
      return;
    }
    var seq = ++mentionUserSearchSeq;
    client.searchMentions({
      q: query || '',
      matter_id: currentMentionMatterId() || undefined,
      limit: 40
    }).then(function (payload) {
      var rows = collectMentionUsers(payload);
      mentionUserSearchCache[key] = { loading: false, loaded: true, rows: rows.length ? rows : fallbackMentionUsers(query) };
      if (seq === mentionUserSearchSeq && templateVariableMenuState && templateVariableMenuState.kind === 'mention') {
        renderTemplateVariableMenu();
      }
    }).catch(function () {
      mentionUserSearchCache[key] = { loading: false, loaded: true, rows: fallbackMentionUsers(query) };
      if (seq === mentionUserSearchSeq && templateVariableMenuState && templateVariableMenuState.kind === 'mention') {
        renderTemplateVariableMenu();
      }
    });
  }

  function filteredMentionUsers(query) {
    requestMentionUsers(query);
    var cached = mentionUserSearchCache[mentionSearchKey(query)];
    return cached && cached.rows ? cached.rows : fallbackMentionUsers(query);
  }

  function mentionUserById(id) {
    var target = String(id || '');
    var keys = Object.keys(mentionUserSearchCache);
    for (var k = 0; k < keys.length; k += 1) {
      var rows = mentionUserSearchCache[keys[k]].rows || [];
      for (var i = 0; i < rows.length; i += 1) {
        if (rows[i].id === target) return rows[i];
      }
    }
    var fallback = fallbackMentionUsers('');
    for (var j = 0; j < fallback.length; j += 1) {
      if (fallback[j].id === target) return fallback[j];
    }
    return null;
  }

  function mentionUserPropertyValue(user, propertyKey) {
    if (!user) return '';
    if (propertyKey === 'name') return user.label || '';
    var value = user[propertyKey];
    if (value) return value;
    if (propertyKey === 'first_name' || propertyKey === 'last_name') {
      var parts = String(user.label || '').trim().split(/\s+/);
      if (propertyKey === 'first_name') return parts[0] || '';
      return parts.length > 1 ? parts.slice(1).join(' ') : '';
    }
    return '';
  }

  function filteredMentionProperties(user, query) {
    var value = String(query || '').toLowerCase();
    return mentionUserProperties().filter(function (property) {
      var currentValue = mentionUserPropertyValue(user, property.key);
      return !value ||
        property.key.indexOf(value) !== -1 ||
        String(property.label || '').toLowerCase().indexOf(value) !== -1 ||
        String(currentValue || '').toLowerCase().indexOf(value) !== -1;
    });
  }

  function mentionUserLiteral(userId, propertyKey) {
    return '@{{' + String(userId || '').trim() + ':' + String(propertyKey || '').trim() + '}}';
  }

  function mentionUserTokenHtml(userId, propertyKey) {
    var user = mentionUserById(userId) || { id: userId, label: userId };
    var label = (user.label || user.id || userId) + ' - ' + propertyKey;
    return '<span class="office-user-mention" contenteditable="false" data-user-mention="true" data-user-id="' +
      esc(user.id || userId) + '" data-property-key="' + esc(propertyKey) + '" title="' + esc(label) + '">' +
      esc(mentionUserLiteral(user.id || userId, propertyKey)) + '</span>';
  }

  function normalizeBaseUrl(value) {
    value = String(value || '').trim();
    if (!value) return '';
    return value.replace(/\/+$/, '');
  }

  function getEditorServiceBase() {
    var fromWindow = normalizeBaseUrl(window.LANA_EDITOR_SERVICE);
    if (fromWindow) return fromWindow;

    var fromConfig = normalizeBaseUrl(window.LanaConfig && window.LanaConfig.LANA_EDITOR_SERVICE_URL);
    if (fromConfig) return fromConfig;

    try {
      var fromStorage = normalizeBaseUrl(window.localStorage && window.localStorage.getItem('lana-editor-service'));
      if (fromStorage) return fromStorage;
    } catch (_) {}

    return 'http://127.0.0.1:4710';
  }

  function isLanaEditorEnabled() {
    return !(window.LanaConfig && window.LanaConfig.LANA_EDITOR_ENABLED === false);
  }

  function currentReviewerName() {
    var user = window.api && window.api.user ? window.api.user : null;
    if (!user) {
      try {
        user = JSON.parse(localStorage.getItem('user') || 'null');
      } catch (_) {
        user = null;
      }
    }
    if (!user) return 'Reviewer';
    var fullName = [
      user.firstName || user.first_name || '',
      user.lastName || user.last_name || ''
    ].join(' ').trim();
    return user.full_name || user.fullName || user.display_name || user.displayName || fullName || user.email || 'Reviewer';
  }

  function currentReviewerIdentity() {
    var user = currentUserRecord() || {};
    return String(user.id || user.user_id || user.uuid || user.email || currentReviewerName());
  }

  function commentTimestamp(comment) {
    return comment && (comment.updated_at || comment.updatedAt || comment.date || comment.created_at || comment.createdAt) || null;
  }

  function normalizeServerReviewReply(reply, threadId) {
    if (!reply || !String(reply.text || '').trim()) return null;
    var createdAt = commentTimestamp(reply) || nowIso();
    return {
      id: String(reply.id || ('reply-' + Date.now().toString(36))),
      thread_id: String(reply.thread_id || reply.threadId || threadId || ''),
      parent_id: String(reply.parent_id || reply.parentId || threadId || ''),
      author: reply.author || 'Reviewer',
      author_id: String(reply.author_id || reply.authorId || ''),
      date: createdAt,
      created_at: reply.created_at || reply.createdAt || createdAt,
      updated_at: reply.updated_at || reply.updatedAt || createdAt,
      text: String(reply.text || '').trim()
    };
  }

  function normalizeServerReviewThread(comment) {
    if (!comment || !String(comment.text || '').trim()) return null;
    var id = String(comment.id || ('comment-' + Date.now().toString(36)));
    var createdAt = commentTimestamp(comment) || nowIso();
    var status = String(comment.status || (comment.resolved_at || comment.resolvedAt ? 'resolved' : 'open')).toLowerCase();
    if (status !== 'resolved') status = 'open';
    var rawAnchorStart = comment.anchor_start !== undefined ? comment.anchor_start : comment.anchorStart;
    var rawAnchorEnd = comment.anchor_end !== undefined ? comment.anchor_end : comment.anchorEnd;
    var anchorStart = rawAnchorStart === null || rawAnchorStart === undefined || rawAnchorStart === ''
      ? null
      : Number(rawAnchorStart);
    var anchorEnd = rawAnchorEnd === null || rawAnchorEnd === undefined || rawAnchorEnd === ''
      ? null
      : Number(rawAnchorEnd);
    if (!Number.isInteger(anchorStart) || anchorStart < 0) anchorStart = null;
    if (anchorStart === null || !Number.isInteger(anchorEnd) || anchorEnd <= anchorStart) anchorEnd = null;
    return {
      id: id,
      thread_id: String(comment.thread_id || comment.threadId || id),
      parent_id: '',
      author: comment.author || 'Reviewer',
      author_id: String(comment.author_id || comment.authorId || ''),
      date: createdAt,
      created_at: comment.created_at || comment.createdAt || createdAt,
      updated_at: comment.updated_at || comment.updatedAt || createdAt,
      text: String(comment.text || '').trim(),
      scope: String(comment.scope || (comment.anchor_text || comment.anchorText ? 'selection' : 'document')),
      anchor_text: String(comment.anchor_text || comment.anchorText || ''),
      anchor_id: String(comment.anchor_id || comment.anchorId || ''),
      anchor_start: anchorStart,
      anchor_end: anchorEnd,
      anchor_prefix: String(comment.anchor_prefix || comment.anchorPrefix || ''),
      anchor_suffix: String(comment.anchor_suffix || comment.anchorSuffix || ''),
      status: status,
      resolved_at: comment.resolved_at || comment.resolvedAt || null,
      resolved_by: comment.resolved_by || comment.resolvedBy || null,
      replies: (Array.isArray(comment.replies) ? comment.replies : []).map(function (reply) {
        return normalizeServerReviewReply(reply, id);
      }).filter(Boolean)
    };
  }

  function ensureEditorImportMap(baseUrl) {
    if (editorImportMapBase === baseUrl) return;

    var existing = document.getElementById('lana-editor-import-map');
    if (existing) {
      if (editorImportMapBase && editorImportMapBase !== baseUrl) {
        throw new Error('Editor service URL changed after editor modules loaded; reload the page to use the new service.');
      }
      editorImportMapBase = baseUrl;
      return;
    }

    if (window.HTMLScriptElement && typeof window.HTMLScriptElement.supports === 'function' &&
        !window.HTMLScriptElement.supports('importmap')) {
      throw new Error('This browser does not support import maps required by LANA Editor.');
    }

    var script = document.createElement('script');
    script.id = 'lana-editor-import-map';
    script.type = 'importmap';
    script.textContent = JSON.stringify({
      imports: {
        '@lana/ooxml-kernel/browser': baseUrl + '/kernel/browser.js',
        '@lana/editor': baseUrl + '/editor/index.js',
        '@lana/editor-embed': baseUrl + '/embed/index.js',
        'pdfjs-dist': baseUrl + '/pdfjs/pdf.min.mjs'
      }
    });
    document.head.appendChild(script);
    editorImportMapBase = baseUrl;
  }

  async function loadEditorModule(baseUrl) {
    ensureEditorImportMap(baseUrl);
    if (!editorModulePromise) editorModulePromise = import('@lana/editor-embed');
    return editorModulePromise;
  }

  function hasLanaEditorSource(file) {
    if (shouldUseDraftShell(file)) return false;
    return Boolean(file && file.kind === 'doc' && file.editorEngine === 'lana-editor' &&
      (file.sourceFile || file.sourceBlob || file.sourceBytes || file.sourceUrl));
  }

  function officeEditorModeForFile(file) {
    if (!file || file.kind !== 'doc') return 'view';
    if (isServerReviewFile(file)) {
      var review = serverReview(file);
      if (!review || review.loading || !review.loaded || review.loadFailed ||
          review.draftDetailFailed || !review.restored) {
        return 'view';
      }
    }
    return file.editorMode === 'view' ? 'view' : 'review';
  }

  function editorForFile(file) {
    if (!file || !officeEditorInstance || officeEditorFileId !== file.id) return null;
    return officeEditorInstance;
  }

  function currentAuthHeaders() {
    return window.api && window.api.token
      ? { Authorization: 'Bearer ' + window.api.token }
      : {};
  }

  function officeEditorReviewItemText(item) {
    if (!item) return '';
    return item.text || item.proposed_text || item.original_text || item.reviewer_notes || item.summary || '';
  }

  function officeEditorOriginalText(item) {
    if (!item) return '';
    var service = documentReviewService();
    var formatDetails = service && typeof service.formatChangeDetailsFromRevision === 'function'
      ? service.formatChangeDetailsFromRevision(item)
      : null;
    if (formatDetails) return formatDetails.originalText;
    var operation = String((item.operation || item.type || '')).toLowerCase();
    return item.original_text || (operation === 'delete' || operation === 'del' ? officeEditorReviewItemText(item) : '');
  }

  function officeEditorProposedText(item) {
    if (!item) return '';
    var service = documentReviewService();
    var formatDetails = service && typeof service.formatChangeDetailsFromRevision === 'function'
      ? service.formatChangeDetailsFromRevision(item)
      : null;
    if (formatDetails) return formatDetails.proposedText;
    var operation = String((item.operation || item.type || '')).toLowerCase();
    return item.proposed_text || (operation === 'insert' || operation === 'ins' ? officeEditorReviewItemText(item) : '');
  }

  function officeEditorChangeLabel(item, type) {
    if (type === 'comments') return 'Comment';
    var operation = String((item && (item.operation || item.type)) || '').toLowerCase();
    if (operation === 'replace') return 'Replacement';
    if (operation === 'delete' || operation === 'del') return 'Deletion';
    if (operation === 'insert' || operation === 'ins') return 'Insertion';
    if (operation === 'format' || operation === 'fmt' || operation === 'formatting') {
      var service = documentReviewService();
      return service && typeof service.changeLabel === 'function'
        ? service.changeLabel(item)
        : 'Formatting';
    }
    return 'Tracked change';
  }

  function officeEditorReviewChangesFromState(reviewState) {
    var source = reviewState || {};
    var revisions = Array.isArray(source.revisions) ? source.revisions.filter(Boolean) : [];
    var comments = Array.isArray(source.comments) ? source.comments.filter(Boolean) : [];
    var changes = revisions.map(function (item) {
      var before = officeEditorOriginalText(item);
      var after = officeEditorProposedText(item);
      return {
        type: officeEditorChangeLabel(item, 'changes'),
        status: item.status === 'accepted' ? 'Accepted' : item.status === 'rejected' ? 'Rejected' : 'Pending',
        text: officeEditorReviewItemText(item) || after || before || 'Tracked change from LANA Editor.',
        before: before,
        after: after || officeEditorReviewItemText(item),
        author: item.author || currentReviewerName(),
        createdAt: item.updated_at || item.created_at || nowIso()
      };
    });
    comments.forEach(function (item) {
      changes.push({
        type: 'Comment',
        status: item.status || 'Open',
        text: officeEditorReviewItemText(item) || 'Comment from LANA Editor.',
        author: item.author || currentReviewerName(),
        createdAt: item.updated_at || item.created_at || nowIso()
      });
    });
    return changes;
  }

  function syncOfficeEditorReviewState(file, reviewState) {
    if (!file || !reviewState) return;
    var changes = officeEditorReviewChangesFromState(reviewState);
    file.reviewChanges = changes;
    syncOfficeShowChangesControl(file);
    if (!changes.length) return;
    file.updatedAt = nowIso();
    saveState();
    renderChrome();
    renderFileList();
    renderReviewDock(file);
  }

  async function editorInputForFile(file) {
    if (file.sourceFile || file.sourceBlob || file.sourceBytes) {
      return file.sourceFile || file.sourceBlob || file.sourceBytes;
    }
    if (file.sourceUrl) {
      var response = await fetch(file.sourceUrl, {
        headers: currentAuthHeaders()
      });
      if (!response.ok) throw new Error('Unable to load document bytes for LANA Editor.');
      var bytes = await response.arrayBuffer();
      // The embed detects text/markdown mode from the File name and type;
      // naked bytes fall back to DOCX parsing, which fails for text files.
      return new File([bytes], file.filename || file.title || 'document', {
        type: file.contentType || ''
      });
    }
    return null;
  }

  function embedLanaFocusedContext(file, detail) {
    var context = detail && detail.context && typeof detail.context === 'object'
      ? Object.assign({}, detail.context)
      : {};
    var kind = String(context.kind || '').toLowerCase();
    var contextType = detail && detail.edit_intent
      ? 'document_edit'
      : kind === 'revision'
        ? 'editor_revision'
        : 'editor_selection';
    context.type = contextType;
    context.context_type = contextType;
    context.summary = contextType === 'document_edit'
      ? 'LANA-assisted edit for the selected document text'
      : kind === 'revision'
        ? 'Tracked change selected in LANA Editor'
        : 'Text selected in LANA Editor';
    if (kind === 'selection') {
      context.selection = {
        text: String(context.text || context.selection && context.selection.text || ''),
        ranges: Array.isArray(context.ranges)
          ? context.ranges.slice(0, 12)
          : (context.selection && Array.isArray(context.selection.ranges)
            ? context.selection.ranges.slice(0, 12)
            : [])
      };
    }
    if (kind === 'revision' && !context.revision) {
      context.revision = {
        type: context.changeType || context.change_type || 'revision',
        author: context.author || '',
        date: context.date || context.created_at || '',
        text: String(context.text || '')
      };
    }
    if (detail && detail.edit_intent) {
      context.edit_intent = Object.assign({}, detail.edit_intent);
      context.document_edit = {
        strategy: detail.edit_intent.strategy || 'insert_after',
        draft_text: String(detail.edit_intent.draft_text || ''),
        selection_text: String(context.text || '')
      };
    }
    return officeFileCardContext(file, context);
  }

  function parseLanaDocumentEditSuggestion(content) {
    var raw = String(content || '');
    function normalizedSuggestion(parsed) {
      if (parsed && parsed.name === 'document_edit_suggestion' && parsed.arguments) {
        parsed = typeof parsed.arguments === 'string'
          ? JSON.parse(parsed.arguments)
          : parsed.arguments;
      }
      var suggestedText = String(parsed && parsed.suggested_text || '').trim();
      if (!parsed || parsed.type !== 'document_edit_suggestion' || !suggestedText) return null;
      return {
        strategy: parsed.strategy === 'replace' ? 'replace' : 'insert_after',
        suggested_text: suggestedText,
        rationale: String(parsed.rationale || '').slice(0, 1000)
      };
    }
    // Prefer the documented ```lana-document-edit fence, but accept a JSON or
    // unlabeled fence because OpenAI-compatible local models commonly
    // normalize custom fence labels to `json`. The payload discriminator is
    // still mandatory, so unrelated code blocks can never stage an edit.
    var blockPattern = /```(?:lana-document-edit|json)?\s*\n([\s\S]*?)```/gi;
    var match;
    while ((match = blockPattern.exec(raw))) {
      try {
        var suggestion = normalizedSuggestion(JSON.parse(String(match[1] || '').trim()));
        if (suggestion) return suggestion;
      } catch (error) {
        console.warn('[file-editor] Unable to parse fenced LANA document edit suggestion:', error);
      }
    }
    // Some OpenAI-compatible local models serialize a requested structured
    // edit as a tool-call envelope even when the tool was not registered.
    // Treat only the exact document-edit discriminator as a staged suggestion;
    // arbitrary tool-call JSON remains inert.
    var toolCallPattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
    while ((match = toolCallPattern.exec(raw))) {
      try {
        suggestion = normalizedSuggestion(JSON.parse(String(match[1] || '').trim()));
        if (suggestion) return suggestion;
      } catch (error) {
        console.warn('[file-editor] Unable to parse LANA document edit tool-call envelope:', error);
      }
    }
    return null;
  }

  function handleLanaDocumentEditSuggestion(detail) {
    var pending = pendingLanaEditRequest;
    if (!pending) return;
    var suggestion = parseLanaDocumentEditSuggestion(detail && detail.content);
    if (!suggestion) return;
    pendingLanaEditRequest = null;
    var file = activeFile();
    var editor = file && editorForFile(file);
    if (!file || file.id !== pending.fileId || !editor || editor !== pending.editor ||
        typeof editor.stageSuggestedEdit !== 'function') {
      toast('The active document changed before the LANA suggestion could be staged.');
      return;
    }
    try {
      // An explicit originating UI intent controls replace vs insert. For a
      // general selection request, a fenced suggestion may declare the
      // operation, but it is still only staged until the user clicks Apply.
      editor.stageSuggestedEdit({
        text: suggestion.suggested_text,
        strategy: pending.strategy || suggestion.strategy
      });
      toast('LANA suggestion staged. Review it, then click Apply to add the tracked change.');
    } catch (error) {
      toast((error && error.message) || 'The LANA suggestion could not be staged.');
    }
  }

  function openLanaForEmbedContext(file, detail) {
    var dock = document.querySelector('lex-lana-dock');
    if (!dock || typeof dock.openWith !== 'function' || !detail) return;
    var editor = editorForFile(file);
    var focusedContext = embedLanaFocusedContext(file, detail);
    pendingLanaEditRequest = editor && detail.context && detail.context.kind === 'selection' ? {
      fileId: file.id,
      editor: editor,
      strategy: detail.edit_intent
        ? (detail.edit_intent.strategy === 'replace' ? 'replace' : 'insert_after')
        : null
    } : null;
    dock.openWith({
      contextType: 'document_chat',
      documentId: officeRealDocumentId(file) || null,
      documentName: file.filename || file.title || 'Document',
      matterId: officeConversationMatterId(file) || null,
      matterName: file.matterName || null,
      prefillPrompt: detail.prompt || 'Help me review this document selection.',
      cardContext: focusedContext
    });
  }

  async function mountLanaEditorForFile(file) {
    var host = el('officeLanaEditorHost');
    var status = el('officeEditorEngineStatus');
    var draftPage = el('officeDocPage');
    if (!host || !file || file.kind !== 'doc') return;
    var mountGeneration = ++editorMountGeneration;

    if (!isLanaEditorEnabled() || !hasLanaEditorSource(file)) {
      editorLoadError = 'This document cannot be opened by LANA Editor.';
      if (status) status.textContent = 'Read-only';
      host.hidden = true;
      if (draftPage) draftPage.hidden = false;
      syncOfficeHistoryControls(file);
      return;
    }

    var serverFile = isServerReviewFile(file);
    try {
      var baseUrl = getEditorServiceBase();
      var health = await fetch(baseUrl + '/v1/health', { method: 'GET' });
      if (!health.ok) throw new Error('editor service unavailable');
      if (mountGeneration !== editorMountGeneration) return;
      var mod = await loadEditorModule(baseUrl);
      if (!mod || !mod.LanaEditor || typeof mod.LanaEditor.mount !== 'function') {
        throw new Error('editor embed module unavailable');
      }
      if (mountGeneration !== editorMountGeneration) return;
      var input = await editorInputForFile(file);
      if (!input) throw new Error('document bytes unavailable');
      if (mountGeneration !== editorMountGeneration) return;

      // Remounting reloads the document bytes, which would drop edits made
      // since the last autosave; flush them to the server first.
      if (serverFile && editorForFile(file)) {
        var pendingReview = serverReview(file);
        if (pendingReview && pendingReview.dirty && !pendingReview.saving) {
          await saveServerDraft(file);
          if (mountGeneration !== editorMountGeneration) return;
        }
      }

      // renderDoc rebuilds the canvas HTML, so the mounted instance can be
      // bound to a node that is no longer in the document. Remount whenever
      // the host element changed, not only when the active file changed.
      var needsMount = officeEditorFileId !== file.id || officeEditorHostEl !== host || !officeEditorInstance;
      if (needsMount) {
        if (officeEditorInstance && typeof officeEditorInstance.shutdown === 'function') {
          officeEditorInstance.shutdown();
        }
        host.innerHTML = '';
        var mountedEditor = mod.LanaEditor.mount(host, {
          api: baseUrl,
          fontsUrl: baseUrl + '/editor-fonts',
          pdfWorkerUrl: baseUrl + '/pdfjs/pdf.worker.min.mjs',
          // Lock the editor until the server workflow and persisted draft have
          // loaded successfully. This prevents edits against a stale baseline.
          mode: serverFile ? 'view' : officeEditorModeForFile(file),
          author: currentReviewerName()
        });
        officeEditorInstance = mountedEditor;
        officeEditorFileId = file.id;
        officeEditorHostEl = host;
        if (typeof mountedEditor.on === 'function') {
          mountedEditor.on('document-loaded', function (event) {
            if (editorForFile(file) !== mountedEditor) return;
            // Every embed render (open, draft replay, typing commit, IME
            // commit, accept/reject) rebuilds the page DOM and ends in this
            // event; re-tag the baseline revision marks each time.
            applyOfficeBaselineRevisionTags(file);
            updateOfficeEditorDocumentStats(file, event && event.counts ? event.counts : null);
            syncOfficeHistoryControls(file, mountedEditor);
            if (isServerReviewFile(file)) return;
            syncOfficeEditorReviewState(file, event && event.reviewState ? event.reviewState : null);
          });
          mountedEditor.on('change-applied', function (event) {
            if (editorForFile(file) !== mountedEditor) return;
            syncOfficeHistoryControls(file, mountedEditor);
            if (isServerReviewFile(file)) {
              if (event && event.reviewState) handleServerEmbedEvent(file, event.reviewState);
              return;
            }
            syncOfficeEditorReviewState(file, event && event.reviewState ? event.reviewState : null);
          });
          mountedEditor.on('change-decision', function (event) {
            if (editorForFile(file) !== mountedEditor) return;
            syncOfficeHistoryControls(file, mountedEditor);
            if (isServerReviewFile(file)) {
              if (event && event.reviewState) handleServerEmbedEvent(file, event.reviewState);
              return;
            }
            syncOfficeEditorReviewState(file, event && event.reviewState ? event.reviewState : null);
          });
          mountedEditor.on('review-state-changed', function (reviewState) {
            if (editorForFile(file) !== mountedEditor) return;
            syncOfficeHistoryControls(file, mountedEditor);
            if (isServerReviewFile(file)) {
              handleServerEmbedEvent(file, reviewState || null);
              return;
            }
            syncOfficeEditorReviewState(file, reviewState || null);
          });
          mountedEditor.on('lana-context-requested', function (detail) {
            if (editorForFile(file) !== mountedEditor) return;
            openLanaForEmbedContext(file, detail);
          });
          mountedEditor.on('edit-rejected', function (detail) {
            if (editorForFile(file) !== mountedEditor) return;
            toast((detail && detail.message) || 'The edit could not be applied.');
          });
          mountedEditor.on('workspace-field-requested', function () {
            if (editorForFile(file) !== mountedEditor) return;
            var selection = window.getSelection ? window.getSelection() : null;
            var rect = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
            var anchor = rect && (rect.width || rect.height || rect.top || rect.left)
              ? { getBoundingClientRect: function () { return rect; } }
              : null;
            openTemplateVariablePicker(anchor);
          });
        }
      }
      var activeEditor = editorForFile(file);
      if (!activeEditor) return;
      await activeEditor.open_file(input);
      if (mountGeneration !== editorMountGeneration || editorForFile(file) !== activeEditor) {
        if (typeof activeEditor.shutdown === 'function') activeEditor.shutdown();
        return;
      }
      syncOfficeHistoryControls(file, activeEditor);
      if (typeof activeEditor.setMode === 'function') activeEditor.setMode(serverFile ? 'view' : officeEditorModeForFile(file));
      syncOfficeHistoryControls(file, activeEditor);
      host.hidden = false;
      if (draftPage) draftPage.hidden = true;
      editorLoadError = '';
      if (status) status.textContent = serverFile ? 'Loading saved draft...' : 'LANA Editor';

      if (serverFile && needsMount) {
        var review = ensureServerReview(file);
        review.embedFailed = false;
        review.session.reset();
        review.restored = false;
        var openedState = null;
        try { openedState = activeEditor.reviewState(); } catch (_) { openedState = null; }
        review.session.captureBaseline(openedState);
        // The open render's document-loaded fired before this baseline was
        // captured; tag the already-rendered marks now that the ids are known.
        applyOfficeBaselineRevisionTags(file);
        review.liveReviewState = openedState;
        await loadServerReview(file);
        if (mountGeneration !== editorMountGeneration || editorForFile(file) !== activeEditor) return;
        // Persisted edit scripts are review operations. Unlock review mode only
        // after the workflow and draft detail have loaded, then replay them.
        // Keeping the editor in view mode here makes applyEditScripts reject
        // every saved draft and incorrectly leaves the document read-only.
        if (!review.loadFailed && !review.draftDetailFailed && typeof activeEditor.setMode === 'function') {
          activeEditor.setMode('review');
          syncOfficeHistoryControls(file, activeEditor);
        }
        var restored = !review.loadFailed && !review.draftDetailFailed
          ? await restoreServerDraftWithRetry(file)
          : !review.currentDraftBatch;
        review.restoreFailed = !restored;
        if (typeof activeEditor.setMode === 'function') {
          activeEditor.setMode(officeEditorModeForFile(file));
          syncOfficeHistoryControls(file, activeEditor);
        }
        if (review.loadFailed || review.draftDetailFailed || review.restoreFailed) {
          editorLoadError = review.draftDetailFailed
            ? 'The saved draft details could not be loaded. Editing is disabled to protect the existing draft.'
            : review.restoreFailed
              ? 'The saved draft could not be restored. Editing is disabled to protect the existing draft.'
              : 'The review workflow could not be loaded. Editing is disabled.';
          if (status) status.textContent = 'Read-only - saved draft unavailable';
        } else if (status) {
          status.textContent = review.pendingReleaseBatch
            ? 'LANA Editor - editing a new draft while release approval is pending'
            : 'LANA Editor - Edit mode';
        }
        applyServerReviewToFile(file);
        // Release lineage arrives after the first document render. Re-tag the
        // already-mounted revision nodes now that the exact current-release
        // delta is known; otherwise Show changes is active while every
        // baseline mark remains visually accepted.
        applyOfficeBaselineRevisionTags(file);
        syncOfficeShowChangesControl(file);
        renderChrome();
        renderReviewDock(file);
      }
    } catch (error) {
      if (mountGeneration !== editorMountGeneration) return;
      console.warn('[file-editor] LANA Editor mount failed:', error && error.message ? error.message : error);
      editorLoadError = (error && error.message) || 'LANA Editor is unavailable.';
      host.hidden = true;
      if (draftPage) draftPage.hidden = false;
      syncOfficeHistoryControls(file);
      if (serverFile) {
        var failedReview = ensureServerReview(file);
        if (failedReview) failedReview.embedFailed = true;
        if (status) status.textContent = 'Read-only (LANA Editor unavailable)';
        if (draftPage) draftPage.setAttribute('contenteditable', 'false');
        if (draftPage && draftPage.parentElement && !el('officeEditorProblem')) {
          var problem = document.createElement('div');
          problem.id = 'officeEditorProblem';
          problem.className = 'file-editor-pending-approval';
          problem.setAttribute('role', 'alert');
          problem.innerHTML = '<strong>Editing is unavailable.</strong> ' + esc(editorLoadError) +
            ' <button type="button" data-action="retry-editor">Retry editor</button>';
          draftPage.parentElement.insertBefore(problem, draftPage);
        }
        loadServerReview(file).catch(function () {});
      } else if (status) {
        status.textContent = 'Read-only';
      }
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(kind) {
    return kind + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1000).toString(36);
  }

  function defaultState() {
    return {
      activeId: '',
      files: []
    };
  }

  function loadState() {
    // File Editor is a server-backed single-document surface. Older builds
    // cached the whole handoff (including Authorization headers) here; purge
    // that legacy record and always rebuild state from the URL/server.
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('[file-editor] Failed to purge legacy local state:', e);
    }
    return defaultState();
  }

  function saveState() {
    // Deliberately runtime-only. Document bytes, preview text, workflow state,
    // and credentials must never be copied into browser persistence.
  }

  // =========================================================================
  // Server-backed review (documents opened from File Viewer)
  //
  // These files are real matter documents. Their drafts, change history,
  // versions, and releases live on the server through the shared
  // LanaDocumentReview datasource; localStorage is never the system of record
  // for them. Office-native scratch files keep the local model.
  // =========================================================================

  var officeServerReview = {};
  var serverDraftSaveTimers = {};

  function documentReviewService() {
    return window.LanaDocumentReview || null;
  }

  function officeRealDocumentId(file) {
    if (!file) return '';
    return String(file.documentId || file.releasedDocumentId || file.sourceDocumentId || '');
  }

  // Chat's matter_id is the human/external matter key, not the storage UUID
  // used by document review routes. Sending the UUID makes conversation
  // creation fail with "Matter not found" before document retrieval begins.
  function officeConversationMatterId(file) {
    if (!file) return '';
    var metadata = file.metadata && typeof file.metadata === 'object' ? file.metadata : {};
    var candidates = [
      file.matterNumber,
      file.matter_number,
      file.externalMatterId,
      file.external_matter_id,
      file.clientMatterNumber,
      file.client_matter_number,
      metadata.matter_number,
      metadata.client_matter_number,
      metadata.external_matter_id
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = String(candidates[i] || '').trim();
      if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
    }
    return '';
  }

  function officeMatterRows(response) {
    if (!response) return [];
    if (Array.isArray(response.matters)) return response.matters;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.items)) return response.items;
    if (response.data && Array.isArray(response.data.matters)) return response.data.matters;
    if (response.data && Array.isArray(response.data.items)) return response.data.items;
    return [];
  }

  async function resolveOfficeConversationMatterContext(storageMatterId) {
    var storageId = String(storageMatterId || '').trim();
    if (!storageId || !window.api || typeof window.api.getMatters !== 'function') return null;
    try {
      var response = await window.api.getMatters(1, 250, {
        status: 'active',
        sort_by: 'updated_at',
        sort_order: 'desc'
      });
      var rows = officeMatterRows(response);
      var match = rows.find(function (matter) {
        return [matter.id, matter.uuid, matter.client_matter].some(function (candidate) {
          return String(candidate || '').trim() === storageId;
        });
      });
      if (!match) return null;
      return {
        matterId: String(match.matter_id || match.matter_number || match.client_matter_number || '').trim(),
        matterName: String(match.workspace_name || match.matter_name || match.name || match.title || '').trim()
      };
    } catch (error) {
      console.warn('[file-editor] Matter context lookup for LANA failed:', error && error.message ? error.message : error);
      return null;
    }
  }

  function isServerReviewFile(file) {
    // Any doc handed off with a real matter + source document identity is a
    // server-managed document, regardless of which surface created it
    // (File Viewer handoff, New Document creation, etc.).
    return Boolean(
      file &&
      file.kind === 'doc' &&
      file.sourceDocumentId &&
      file.matterId &&
      documentReviewService()
    );
  }

  function isServerOfficeFile(file) {
    return Boolean(file && (file.kind === 'sheet' || file.kind === 'deck') && officeRealDocumentId(file));
  }

  function isServerWorkflowFile(file) {
    return Boolean(file && officeRealDocumentId(file) && (isServerReviewFile(file) || isServerOfficeFile(file)));
  }

  function ensureOfficeEdit(file) {
    if (!isServerOfficeFile(file)) return null;
    if (!file.officeEdit || typeof file.officeEdit !== 'object') {
      file.officeEdit = {
        loading: false,
        loaded: false,
        dirty: false,
        saving: false,
        error: '',
        saveError: '',
        savedAt: file.lastSavedAt || file.updatedAt || '',
        changeVersion: 0,
        savePromise: null
      };
    }
    return file.officeEdit;
  }

  function serverReview(file) {
    return file && officeServerReview[file.id] ? officeServerReview[file.id] : null;
  }

  function pendingReleaseNeedsApprovalRestart(review) {
    if (!review || !review.pendingReleaseBatch) return false;
    if (!review.pendingApprovalId) return true;
    return Boolean(review.pendingApprovalStatus &&
      review.pendingApprovalStatus !== 'pending' &&
      review.pendingApprovalStatus !== 'approved');
  }

  function pendingReleaseButtonAction(review) {
    if (review && review.pendingApprovalId && review.pendingApprovalStatus === 'approved') {
      return 'complete-approved-release';
    }
    return pendingReleaseNeedsApprovalRestart(review) ? 'retry-release-approval' : 'view-release-approval';
  }

  function pendingReleaseButtonLabel(review) {
    if (review && review.pendingApprovalId && review.pendingApprovalStatus === 'approved') {
      return 'Complete Release';
    }
    return pendingReleaseNeedsApprovalRestart(review) ? 'Restart Release Approval' : 'View Pending Approval';
  }

  function ensureServerReview(file) {
    if (!isServerReviewFile(file)) return null;
    var entry = officeServerReview[file.id];
    if (!entry) {
      entry = officeServerReview[file.id] = {
        loading: false,
        loaded: false,
        loadFailed: false,
        matterId: String(file.matterId),
        documentId: officeRealDocumentId(file),
        sourceDocumentId: String(file.sourceDocumentId),
        currentDocumentIsRelease: false,
        currentBaseFileVersionId: '',
        releases: [],
        releaseChangeGroups: [],
        currentDraftBatch: null,
        pendingReleaseBatch: null,
        pendingApprovalId: '',
        pendingApprovalStatus: '',
        draftDetailFailed: false,
        pendingDetailFailed: false,
        session: documentReviewService().createReviewSession(),
        comments: [],
        liveReviewState: null,
        dirty: false,
        restoring: false,
        restored: false,
        restoreFailed: false,
        saving: false,
        savePromise: null,
        saveQueued: false,
        saveFailed: false,
        warnedRestoreFailed: false,
        releasing: false
      };
    }
    return entry;
  }

  function newestIso(a, b) {
    var timeA = a ? Date.parse(a) : NaN;
    var timeB = b ? Date.parse(b) : NaN;
    var validA = Number.isFinite(timeA);
    var validB = Number.isFinite(timeB);
    if (validA && validB) return timeA >= timeB ? a : b;
    if (validA) return a;
    if (validB) return b;
    return '';
  }

  async function loadServerReview(file) {
    var review = ensureServerReview(file);
    if (!review || review.loading) return review;
    var service = documentReviewService();
    review.loading = true;
    try {
      var workflow = await service.loadWorkflow({
        api: window.api,
        matterId: review.matterId,
        documentId: review.documentId
      });
      review.sourceDocumentId = workflow.sourceDocumentId;
      review.currentDocumentIsRelease = workflow.currentDocumentIsRelease === true;
      review.currentBaseFileVersionId = workflow.currentBaseFileVersionId || '';
      review.releases = workflow.releases;
      review.currentDraftBatch = workflow.currentDraftBatch;
      review.pendingReleaseBatch = workflow.pendingReleaseBatch;
      var releaseApproval = workflow.pendingReleaseBatch && workflow.pendingReleaseBatch.release_approval;
      review.pendingApprovalId = releaseApproval && releaseApproval.id ? String(releaseApproval.id) : '';
      review.pendingApprovalStatus = releaseApproval && releaseApproval.status ? String(releaseApproval.status) : '';
      review.draftDetailFailed = workflow.draftDetailFailed;
      review.pendingDetailFailed = workflow.pendingDetailFailed;
      review.releaseChangeGroups = await service.loadReleaseChangeGroups({
        api: window.api,
        matterId: review.matterId,
        releases: workflow.releases
      });
      var commentBatch = review.currentDraftBatch || review.pendingReleaseBatch;
      var persistedComments = commentBatch &&
        commentBatch.review_metadata &&
        Array.isArray(commentBatch.review_metadata.comments)
        ? commentBatch.review_metadata.comments.map(normalizeServerReviewThread).filter(Boolean)
        : [];
      // Merge instead of overwrite: comments added in this session may not
      // have reached the server yet when a reload lands.
      var mergedComments = persistedComments.slice();
      var seenCommentIds = {};
      mergedComments.forEach(function (comment) {
        if (comment && comment.id) seenCommentIds[String(comment.id)] = true;
      });
      (review.comments || []).forEach(function (comment) {
        if (!comment) return;
        if (comment.id && seenCommentIds[String(comment.id)]) return;
        mergedComments.push(comment);
      });
      review.comments = mergedComments;
      review.loaded = true;
      review.loadFailed = false;
    } catch (error) {
      console.warn('[file-editor] Review workflow load failed:', error && error.message ? error.message : error);
      review.loadFailed = true;
    } finally {
      review.loading = false;
    }
    applyServerReviewToFile(file);
    renderChrome();
    renderReviewDock(file);
    return review;
  }

  function serverPendingDisplayChanges(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service) return [];
    if (review.liveReviewState && (review.dirty || review.restored)) {
      return service.displayReviewChanges(review.session.normalizeChanges(review.liveReviewState));
    }
    if (review.currentDraftBatch && Array.isArray(review.currentDraftBatch.changes) && review.currentDraftBatch.changes.length) {
      return service.displayReviewChanges(review.currentDraftBatch.changes);
    }
    if (review.liveReviewState) {
      return service.displayReviewChanges(review.session.normalizeChanges(review.liveReviewState));
    }
    return [];
  }

  function serverPendingApprovalDisplayChanges(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service || !review.pendingReleaseBatch ||
        !Array.isArray(review.pendingReleaseBatch.changes)) return [];
    return service.displayReviewChanges(review.pendingReleaseBatch.changes);
  }

  function officeRowFromServerChange(change, index, options) {
    var service = documentReviewService();
    var status = service.changeStatus(change);
    var released = status.tone === 'released';
    var originalText = service.changeOriginalText(change);
    var proposedText = service.changeProposedText(change);
    var revisionIds = typeof service.revisionIdsForReviewChange === 'function'
      ? service.revisionIdsForReviewChange(change)
      : [];
    return {
      title: service.changeLabel(change),
      status: status.label,
      tone: released ? 'release' : 'draft',
      before: originalText === null || originalText === undefined ? '' : originalText,
      after: proposedText === null || proposedText === undefined ? '' : proposedText,
      body: released ? '' : (service.reviewItemText(change) || ''),
      isDeletion: service.isDeletionChange(change),
      isInsertion: service.isInsertionChange(change),
      meta: (change && change.metadata && change.metadata.author) || '',
      items: [],
      revisionIds: Array.isArray(revisionIds) ? revisionIds.map(String).filter(Boolean) : [],
      serverChange: change,
      serverSection: options && options.section ? options.section : 'unreleased',
      sourceIndex: index
    };
  }

  function serverReviewComments(file) {
    var review = serverReview(file);
    if (!review) return [];
    var comments = review.comments.map(normalizeServerReviewThread).filter(Boolean);
    var live = review.liveReviewState && Array.isArray(review.liveReviewState.comments)
      ? review.liveReviewState.comments.filter(Boolean)
      : [];
    live.forEach(function (comment) {
      comments.push(normalizeServerReviewThread({
        id: comment.id ? String(comment.id) : '',
        author: comment.author || null,
        date: comment.date || comment.updated_at || comment.created_at || null,
        text: comment.text || '',
        scope: comment.scope || 'document',
        anchor_text: comment.anchor_text || comment.anchorText || ''
      }));
    });
    var seen = {};
    return comments.filter(function (comment) {
      if (!comment || !comment.text) return false;
      var key = comment.id || (comment.text + ':' + comment.created_at);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function applyServerReviewToFile(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service || !isServerReviewFile(file)) return;

    var pendingRows = serverPendingDisplayChanges(file).map(function (change, index) {
      return officeRowFromServerChange(change, index, { section: 'unreleased' });
    });
    pendingRows.forEach(function (row) {
      row.status = 'Pending';
      row.tone = 'draft';
    });

    var pendingApprovalRows = serverPendingApprovalDisplayChanges(file).map(function (change, index) {
      var row = officeRowFromServerChange(change, index, { section: 'pending-approval' });
      row.status = 'Pending approval';
      row.tone = 'draft';
      return row;
    });

    var releasedRows = [];
    var editorBaselineReleaseId = String(file.editorBaselineReleaseId || '');
    review.releaseChangeGroups.forEach(function (group) {
      if (editorBaselineReleaseId && String(group && group.release && group.release.id || '') !== editorBaselineReleaseId) {
        return;
      }
      var releaseNumber = group && group.release ? group.release.release_number : null;
      service.displayReviewChanges(group && group.changes ? group.changes : []).forEach(function (change, index) {
        var row = officeRowFromServerChange(change, index, { section: 'released' });
        row.status = 'Released';
        row.tone = 'release';
        if (releaseNumber) row.title = 'Version ' + releaseNumber + ' - ' + row.title;
        releasedRows.push(row);
      });
    });

    var versions = [];
    if (review.pendingReleaseBatch) {
      versions.push({
        title: 'Release request',
        status: 'Pending approval',
        tone: 'draft',
        meta: review.pendingReleaseBatch.updated_at
          ? 'Requested ' + formatTimestamp(review.pendingReleaseBatch.updated_at)
          : 'Waiting for approval'
      });
    }
    if (!review.pendingReleaseBatch || review.currentDraftBatch || review.dirty) {
      versions.push({
        title: review.pendingReleaseBatch ? 'New draft' : 'Current draft',
        status: 'Draft',
        tone: 'draft',
        meta: review.currentDraftBatch && review.currentDraftBatch.updated_at
          ? 'Updated ' + formatTimestamp(review.currentDraftBatch.updated_at)
          : review.dirty
            ? 'Unsaved changes'
            : 'No saved draft yet'
      });
    }
    review.releases.forEach(function (release) {
      versions.push({
        title: release.released_document_filename || ('Version ' + (release.release_number || '')),
        status: release.status || 'Released',
        tone: 'release',
        meta: 'Version ' + (release.release_number || '') +
          (release.released_at ? ' - Released ' + formatTimestamp(release.released_at) : '')
      });
    });
    versions.push({
      title: 'Source file',
      status: 'Base',
      tone: 'draft',
      meta: file.createdAt ? 'Uploaded ' + formatTimestamp(file.createdAt) : 'Original document'
    });

    file.review = { versions: versions, changes: pendingRows.concat(pendingApprovalRows, releasedRows) };
    file.updatedAt = newestIso(
      service.latestActivityIso(
        { updated_at: file.documentUpdatedAt || null, created_at: file.createdAt || null },
        review.currentDraftBatch
      ),
      file.updatedAt
    ) || file.updatedAt;
  }

  function scheduleServerDraftSave(file) {
    if (!isServerReviewFile(file)) return;
    if (serverDraftSaveTimers[file.id]) clearTimeout(serverDraftSaveTimers[file.id]);
    serverDraftSaveTimers[file.id] = setTimeout(function () {
      delete serverDraftSaveTimers[file.id];
      saveServerDraft(file).catch(function () {});
    }, SERVER_DRAFT_AUTOSAVE_DELAY_MS);
    renderChrome();
  }

  async function saveServerDraft(file, options) {
    var opts = options || {};
    var review = serverReview(file);
    var service = documentReviewService();
    var editor = editorForFile(file);
    if (!review || !service || !editor) throw new Error('The active editor does not match this document.');
    if (!review.loaded || review.loadFailed || review.draftDetailFailed || review.restoreFailed) {
      throw new Error('The saved draft is unavailable. Editing and saving are disabled to protect it.');
    }
    if (review.saving) {
      review.saveQueued = true;
      return review.savePromise;
    }
    if (serverDraftSaveTimers[file.id]) {
      clearTimeout(serverDraftSaveTimers[file.id]);
      delete serverDraftSaveTimers[file.id];
    }
    // A sub-second typing buffer may still be un-committed; fold it into the
    // document before serializing (commit failures surface via edit-rejected).
    if (typeof editor.flushPendingEdits === 'function') await editor.flushPendingEdits();
    if (editorForFile(file) !== editor) throw new Error('The active document changed before it could be saved.');
    var reviewState = null;
    if (typeof editor.reviewState === 'function') {
      try { reviewState = editor.reviewState(); } catch (_) { reviewState = null; }
    }
    if (!reviewState) reviewState = review.liveReviewState || {};
    review.liveReviewState = reviewState;
    var changes = review.session.persistableChanges(reviewState);
    var persistedCount = review.currentDraftBatch && Array.isArray(review.currentDraftBatch.changes)
      ? review.currentDraftBatch.changes.length
      : 0;
    // A PATCH replaces the batch's whole change list. An editor that never
    // managed to load the persisted draft must not save at all: it would
    // silently discard the changes it failed to load.
    if (persistedCount > 0 && !review.restored) {
      review.saveFailed = true;
      if (!review.warnedRestoreFailed) {
        review.warnedRestoreFailed = true;
        toast('The saved draft could not be loaded into this editor session. Saving is paused so the draft is not overwritten; reload the document to continue editing.');
      }
      renderChrome();
      throw new Error('The saved draft was not restored, so saving is disabled to prevent data loss.');
    }
    if (!changes.length && !persistedCount && !review.comments.length) {
      review.dirty = false;
      renderChrome();
      return null;
    }

    var payload = {
      title: 'Review draft: ' + (file.filename || file.title || 'Document'),
      summary: changes.length + ' tracked change' + (changes.length === 1 ? '' : 's') + ' captured from File Editor.',
      status: 'draft',
      changes: changes,
      review_metadata: {
        source: 'file_editor',
        document_name: file.filename || file.title || null,
        comments: review.comments
      }
    };

    review.saving = true;
    renderChrome();
    renderReviewDock(file);
    var savePromise = (async function () {
      try {
        review.currentDraftBatch = await service.saveDraftBatch({
          api: window.api,
          matterId: review.matterId,
          documentId: review.documentId,
          batch: review.currentDraftBatch,
          payload: payload
        });
        review.dirty = false;
        review.saveFailed = false;
        review.restored = true;
        return review.currentDraftBatch;
      } catch (error) {
        review.saveFailed = true;
        console.warn('[file-editor] Draft save failed:', error && error.message ? error.message : error);
        if (!opts.silent) toast('Draft save failed. Your edits remain in this editor session.');
        throw error;
      } finally {
        review.saving = false;
        applyServerReviewToFile(file);
        renderChrome();
        renderReviewDock(file);
        if (review.saveQueued) {
          review.saveQueued = false;
          scheduleServerDraftSave(file);
        }
      }
    })();
    review.savePromise = savePromise;
    try {
      return await savePromise;
    } finally {
      if (review.savePromise === savePromise) review.savePromise = null;
    }
  }

  async function restoreServerDraftIntoEmbed(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    var editor = editorForFile(file);
    if (!review || !service || !editor || review.draftDetailFailed) return false;
    var batch = review.currentDraftBatch;
    if (!batch || !Array.isArray(batch.changes) || !batch.changes.length) {
      review.restored = true;
      return true;
    }
    if (typeof editor.applyEdits !== 'function' && typeof editor.applyEditScripts !== 'function') {
      return false;
    }
    var current = null;
    try { current = editor.reviewState(); } catch (_) { current = null; }
    if (current && Array.isArray(current.revisions) && current.revisions.length > 0) {
      // Skip the replay only when the live document carries revisions beyond
      // the opened-document baseline (for example this instance already
      // replayed the draft): replaying again would double them. Revisions
      // that are all baseline (for example a released redline embedded in
      // the opened bytes) are not draft content, so the persisted draft
      // still needs to be replayed on top of them. The batch is NOT marked
      // restored on the skip path: an editor that never loaded the draft
      // must not be allowed to empty it.
      if (review.session.unreleasedRevisions(current).length > 0) {
        review.liveReviewState = current;
        return false;
      }
    }
    var scripts = service.editScriptsFromBatch(batch);
    var ops = scripts.length ? [] : service.editOpsFromBatch(batch);
    for (var scriptIndex = 0; scriptIndex < scripts.length; scriptIndex++) {
      var scriptOps = Array.isArray(scripts[scriptIndex].ops) ? scripts[scriptIndex].ops : [];
      for (var opIndex = 0; opIndex < scriptOps.length; opIndex++) {
        if (scriptOps[opIndex]) ops.push(scriptOps[opIndex]);
      }
    }
    if (!ops.length) {
      review.restored = true;
      return true;
    }
    review.restoring = true;
    try {
      if (scripts.length && typeof editor.applyEditScripts === 'function') {
        // Persisted scripts were captured after successive user actions. Their
        // anchors therefore address the document state produced by the prior
        // script, not one shared original document. Replaying them as one
        // flattened request makes otherwise-valid sequences (for example a
        // delete followed by a replacement at the same visible offset) fail
        // the redline engine's disjoint-operation guard. Apply one script at a
        // time, in saved order, to reconstruct the exact editing session.
        for (var replayIndex = 0; replayIndex < scripts.length; replayIndex++) {
          await editor.applyEditScripts([scripts[replayIndex]]);
        }
      } else {
        await editor.applyEdits(ops);
      }
      if (editorForFile(file) !== editor) return false;
      // Replaying the saved draft establishes the session baseline; it is not
      // a user action in this browser session and must not enable Undo. New
      // edits made after restore still enter the normal editor history.
      if (typeof editor.clearHistory === 'function') editor.clearHistory();
      review.liveReviewState = editor.reviewState();
      review.dirty = false;
      review.restored = true;
      return true;
    } catch (error) {
      console.warn('[file-editor] Draft restore into editor failed:', error && error.message ? error.message : error);
      return false;
    } finally {
      review.restoring = false;
    }
  }

  async function restoreServerDraftWithRetry(file) {
    var attempts = 4;
    for (var attempt = 0; attempt < attempts; attempt++) {
      var restored = await restoreServerDraftIntoEmbed(file);
      if (restored) return true;
      await new Promise(function (resolve) {
        setTimeout(resolve, Math.max(40, Math.min(180, 40 * (attempt + 1))));
      });
    }
    return false;
  }

  function handleServerEmbedEvent(file, reviewState) {
    var review = serverReview(file);
    if (!review) return;
    if (reviewState) review.liveReviewState = reviewState;
    if (review.restoring || review.loadFailed ||
        review.draftDetailFailed || review.restoreFailed) return;
    review.dirty = true;
    applyServerReviewToFile(file);
    syncOfficeShowChangesControl(file);
    renderChrome();
    renderReviewDock(file);
    scheduleServerDraftSave(file);
  }

  async function revertServerReviewChange(file, row) {
    var review = serverReview(file);
    var service = documentReviewService();
    var change = row && row.serverChange;
    if (!review || !service || !change) throw new Error('This change is not available to revert.');
    var editor = editorForFile(file);
    if (!editor || typeof editor.decide !== 'function') {
      throw new Error('This editor session cannot revert draft changes yet.');
    }
    var revisionIds = service.revisionIdsForReviewChange(change);
    var liveState = null;
    try { liveState = editor.reviewState(); } catch (_) { liveState = null; }
    var liveById = {};
    ((liveState && Array.isArray(liveState.revisions)) ? liveState.revisions : []).forEach(function (revision) {
      if (revision && revision.id) liveById[String(revision.id)] = true;
    });
    var baselineById = {};
    review.session.baselineRevisionIds().forEach(function (id) { baselineById[String(id)] = true; });
    // Only a revision that is live in the embed AND is not part of the
    // opened-document baseline belongs to this draft change. A persisted
    // anchor id that happens to match a baseline revision is a numbering
    // coincidence; rejecting it would damage content that predates the draft.
    var decidableIds = revisionIds.filter(function (id) { return liveById[id] && !baselineById[id]; });
    var staleIds = revisionIds.filter(function (id) { return !liveById[id] || baselineById[id]; });

    if (decidableIds.length) {
      await editor.decide({
        decisions: decidableIds.map(function (id) {
          return { id: id, action: 'reject' };
        })
      });
      review.liveReviewState = editor.reviewState();
      review.dirty = true;
    }

    if (revisionIds.length && !staleIds.length) {
      // Every revision of this change was live: the existing flow persists
      // the removal by re-serializing the live document.
      applyServerReviewToFile(file);
      renderChrome();
      renderReviewDock(file);
      await saveServerDraft(file);
      toast('Draft change reverted.');
      return;
    }

    // Some or all of this change's revisions are not in the live document
    // (for example a persisted draft batch that was never replayed into this
    // session). decide() cannot revert those; remove the change from the
    // persisted batch instead, when this session holds the full change list.
    var removed = await removeServerReviewChangeFromDraftBatch(file, change);
    applyServerReviewToFile(file);
    renderChrome();
    renderReviewDock(file);
    if (removed) {
      toast('Draft change reverted.');
      return;
    }
    if (decidableIds.length) {
      await saveServerDraft(file);
      toast('Draft change reverted.');
      return;
    }
    throw new Error('This draft change is not loaded into the editor. Reload the document and try again.');
  }

  // Remove one display change's persisted rows from the current draft batch by
  // PATCHing the batch with those rows filtered out. Safe only when this
  // session loaded the batch detail with its FULL change list: the PATCH
  // replaces the whole list, so a partial copy would wipe changes this session
  // never saw. Returns false whenever that safety cannot be proven.
  async function removeServerReviewChangeFromDraftBatch(file, change) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service) return false;
    if (!review.loaded || review.draftDetailFailed || review.saving) return false;
    var batch = review.currentDraftBatch;
    if (!batch || !batch.id || !Array.isArray(batch.changes)) return false;
    if (!service.isActiveDraftBatch(batch)) return false;
    var removedKeys = {};
    service.sourceChangesForReviewChange(change).forEach(function (source) {
      if (source && source.change_key) removedKeys[String(source.change_key)] = true;
    });
    var matched = 0;
    var remaining = [];
    batch.changes.forEach(function (persisted) {
      if (persisted && persisted.change_key && removedKeys[String(persisted.change_key)]) {
        matched += 1;
        return;
      }
      remaining.push(persisted);
    });
    if (!matched) return false;
    review.saving = true;
    renderChrome();
    renderReviewDock(file);
    try {
      review.currentDraftBatch = await service.saveDraftBatch({
        api: window.api,
        matterId: review.matterId,
        documentId: review.documentId,
        batch: batch,
        payload: { changes: remaining.map(service.persistedDraftChangePayload).filter(Boolean) }
      });
      review.saveFailed = false;
      return true;
    } finally {
      review.saving = false;
      if (review.saveQueued) {
        review.saveQueued = false;
        scheduleServerDraftSave(file);
      }
    }
  }

  async function editServerReviewChange(file, row, nextText) {
    var review = serverReview(file);
    var service = documentReviewService();
    var change = row && row.serverChange;
    if (!review || !service || !change) throw new Error('This change is not available to edit.');
    var editor = editorForFile(file);
    if (!editor || typeof editor.decide !== 'function' || typeof editor.applyEdits !== 'function') {
      throw new Error('This editor session cannot edit draft changes yet.');
    }
    var reviewState = editor.reviewState();
    var revisionIds = service.revisionIdsForReviewChange(change);
    if (!revisionIds.length) {
      throw new Error('This draft change is not loaded into the editor. Reload the document and try again.');
    }
    var op = service.firstEditableDraftOpForChange(change, nextText, reviewState);
    if (!op) {
      throw new Error('This change cannot be edited directly. Revert it and create a new change instead.');
    }
    await editor.decide({
      decisions: revisionIds.map(function (id) {
        return { id: id, action: 'reject' };
      })
    });
    await editor.applyEdits([op]);
    review.liveReviewState = editor.reviewState();
    review.dirty = true;
    applyServerReviewToFile(file);
    renderChrome();
    renderReviewDock(file);
    await saveServerDraft(file);
    toast('Draft change updated.');
  }

  async function releaseServerVersion(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service) return;
    if (review.releasing) return;
    if (review.pendingReleaseBatch) {
      toast('This release is already awaiting approval.');
      return;
    }
    var editor = editorForFile(file);
    if (!editor || typeof editor.bytes !== 'function') {
      toast('LANA Editor is not ready to produce release bytes.');
      return;
    }
    var run = async function () {
      review.releasing = true;
      renderReviewDock(file);
      try {
        if (editorForFile(file) !== editor) throw new Error('The active document changed before release.');
        if (typeof editor.flushPendingEdits === 'function') {
          await editor.flushPendingEdits();
        }
        if (editorForFile(file) !== editor) throw new Error('The active document changed before release.');
        var liveState = typeof editor.reviewState === 'function' ? editor.reviewState() : null;
        if (liveState) {
          review.liveReviewState = liveState;
          review.dirty = true;
        }
        await saveServerDraft(file, { silent: true });
        if (review.dirty || review.saveFailed) {
          throw new Error('The latest draft could not be saved, so release was cancelled.');
        }
        if (!review.currentDraftBatch || !review.currentDraftBatch.id) {
          throw new Error('Make a tracked change so a draft is saved before releasing.');
        }
        var releasingBatchId = review.currentDraftBatch.id;
        var bytes = editor.bytes();
        if (!bytes) throw new Error('No document bytes are available to release.');
        var accepted = await service.acceptAllBytes({
          editorServiceBase: getEditorServiceBase(),
          bytes: bytes,
          contentType: file.contentType || service.DOCX_CONTENT_TYPE
        });
        var payload = service.buildReleasePayload({
          filename: file.filename || file.title,
          contentType: file.contentType || service.DOCX_CONTENT_TYPE,
          bytes: accepted,
          releaseNotes: 'Released from File Editor review workflow.'
        });
        var result = await service.releaseBatch({
          api: window.api,
          matterId: review.matterId,
          batchId: releasingBatchId,
          payload: payload
        });
        var releasedDocument = result && result.document;
        if (releasedDocument && releasedDocument.id) {
          toast('Version released.');
          if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
            leavingEditor = true;
            Lex.Nav.go('file-viewer.html', {
              params: { id: releasedDocument.id },
              context: { referrer: editorReferrer || 'document-library.html' }
            });
            return;
          }
        } else if (result && result.approval_required) {
          review.pendingApprovalId = result.approval_id || '';
          review.pendingApprovalStatus = 'pending';
          review.pendingReleaseBatch = result.batch || review.currentDraftBatch;
          review.currentDraftBatch = null;
          // Continue work from the exact bytes submitted for approval, but
          // start a fresh review baseline so the pending release's revisions
          // are not duplicated into the next draft batch.
          await editor.open_file(new File([accepted], file.filename || file.title || 'document.docx', {
            type: file.contentType || service.DOCX_CONTENT_TYPE
          }));
          review.session.reset();
          review.liveReviewState = editor.reviewState();
          review.session.captureBaseline(review.liveReviewState);
          review.restored = true;
          review.restoreFailed = false;
          review.dirty = false;
          if (typeof editor.setMode === 'function') editor.setMode('review');
          toast('Release approval requested. You can keep editing in a new draft.');
        } else {
          toast('Version released.');
        }
        if (!(result && result.approval_required)) {
          review.currentDraftBatch = result && result.batch ? result.batch : review.currentDraftBatch;
        }
        await loadServerReview(file);
      } catch (error) {
        console.warn('[file-editor] Release failed:', error && error.message ? error.message : error);
        toast((error && error.message) || 'Failed to release version.');
      } finally {
        review.releasing = false;
        renderReviewDock(file);
      }
    };
    var message = 'Release the saved draft for "' + (file.filename || file.title || 'this document') + '" as a new version?';
    if (window.Lex && Lex.Modal && typeof Lex.Modal.confirm === 'function') {
      Lex.Modal.confirm('Release Version', message, run, { confirmText: 'Release Version' });
    } else if (window.confirm(message)) {
      run();
    }
  }

  async function retryReleaseApproval(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service || !review.pendingReleaseBatch || review.releasing) return;
    review.releasing = true;
    renderReviewDock(file);
    try {
      var result = await service.releaseBatch({
        api: window.api,
        matterId: review.matterId,
        batchId: review.pendingReleaseBatch.id,
        payload: { retry_approval: true }
      });
      if (!result || !result.approval_required || !result.approval_id) {
        throw new Error('The release approval could not be restarted.');
      }
      review.pendingApprovalId = result.approval_id;
      review.pendingApprovalStatus = 'pending';
      review.pendingReleaseBatch = result.batch || review.pendingReleaseBatch;
      await loadServerReview(file);
      toast('Release approval restarted.');
    } catch (error) {
      console.warn('[file-editor] Release approval restart failed:', error && error.message ? error.message : error);
      toast((error && error.message) || 'Failed to restart release approval.');
    } finally {
      review.releasing = false;
      renderReviewDock(file);
    }
  }

  async function completeApprovedRelease(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service || !review.pendingReleaseBatch || !review.pendingApprovalId || review.releasing) return;
    if (review.pendingApprovalStatus !== 'approved') {
      toast('This release still needs approval.');
      return;
    }
    review.releasing = true;
    renderReviewDock(file);
    try {
      var result = await service.releaseBatch({
        api: window.api,
        matterId: review.matterId,
        batchId: review.pendingReleaseBatch.id,
        payload: {
          approved: true,
          approval_id: review.pendingApprovalId
        }
      });
      var releasedDocument = result && result.document;
      if (!releasedDocument || !releasedDocument.id) {
        throw new Error('The approved release did not create an immutable document version.');
      }
      toast('Version released.');
      review.pendingReleaseBatch = null;
      review.pendingApprovalId = '';
      review.pendingApprovalStatus = '';
      if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
        leavingEditor = true;
        Lex.Nav.go('file-viewer.html', {
          params: { id: releasedDocument.id },
          context: { referrer: editorReferrer || 'document-library.html' }
        });
        return;
      }
      await loadServerReview(file);
    } catch (error) {
      console.warn('[file-editor] Approved release completion failed:', error && error.message ? error.message : error);
      toast((error && error.message) || 'Failed to complete the approved release.');
    } finally {
      review.releasing = false;
      renderReviewDock(file);
    }
  }

  function officeHandoffFallbackContent(file) {
    var title = file && (file.title || file.filename) ? (file.title || file.filename) : 'Imported document';
    var summary = file && file.summary ? file.summary : 'Imported from File Viewer. LANA Editor will load the original file when available.';
    return '<h2>' + esc(title) + '</h2><p>' + esc(summary) + '</p>';
  }

  function shouldUseDraftShell(file) {
    if (!file || file.kind !== 'doc') return false;
    // Real matter documents edit through the LANA Editor embed so tracked
    // changes carry edit scripts the server draft can replay; the shell is
    // only a read-only fallback for them when the embed cannot mount.
    if (isServerReviewFile(file) && isLanaEditorEnabled() && file.sourceUrl) return false;
    return Boolean(
      file.preferDraftShell ||
      file.openedFromFileViewer ||
      file.sourceDocumentId ||
      (file.editorEngine === 'lana-editor' && file.sourceUrl)
    );
  }

  function staleEmbeddedEditorContent(html) {
    var value = String(html || '');
    return value.indexOf('lana-editor') !== -1 ||
      value.indexOf('lana-editor-viewer') !== -1 ||
      value.indexOf('officeLanaEditorHost') !== -1;
  }

  function plainTextToDocHtml(text, file) {
    var value = compactText(text);
    if (!value) return officeHandoffFallbackContent(file);
    var blocks = String(text || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n{2,}/)
      .map(function (part) {
        return part.split('\n').map(function (line) { return compactText(line); }).filter(Boolean);
      })
      .filter(function (lines) { return lines.length; });
    if (!blocks.length) blocks = [[value]];
    return blocks.map(function (lines, index) {
      var body = lines.map(function (line) { return esc(line); }).join('<br>');
      if (index === 0 && blocks.length > 1 && lines.length === 1 && lines[0].length < 90) return '<h2>' + body + '</h2>';
      return '<p>' + body + '</p>';
    }).join('');
  }

  function ensureEditableDocContent(file) {
    if (!file || file.kind !== 'doc') return false;
    var content = String(file.content || '');
    var cleanContent = cleanOfficeDocContent(content);
    var changed = false;
    if (cleanContent !== content) {
      file.content = cleanContent;
      content = cleanContent;
      changed = true;
    }
    var text = docPlainText(content);
    if (staleEmbeddedEditorContent(content)) {
      file.content = plainTextToDocHtml(text, file);
      return true;
    }
    if (!compactText(text)) {
      file.content = officeHandoffFallbackContent(file);
      return true;
    }
    return changed;
  }

  function isOfficeDraftChange(change) {
    if (!change) return false;
    if (change.officeDraftBatch) return true;
    var status = String(change.status || '').toLowerCase();
    var type = String(change.type || '').toLowerCase();
    return status === 'pending' && (
      type === 'local draft edits' ||
      type === 'replacement' ||
      type === 'insertion' ||
      type === 'deletion' ||
      type === 'formatting update' ||
      type === 'paragraph replacement' ||
      type === 'new paragraph' ||
      type === 'paragraph removed' ||
      type === 'paragraph break'
    );
  }

  function sanitizeOfficeReviewChange(change) {
    if (!change) return false;
    var changed = false;
    ['text', 'before', 'after', 'body'].forEach(function (key) {
      if (typeof change[key] !== 'string') return;
      var clean = sanitizeOfficeDocText(change[key]).trim();
      if (clean !== change[key]) {
        change[key] = clean;
        changed = true;
      }
    });
    if (Array.isArray(change.items)) {
      change.items.forEach(function (item) {
        if (sanitizeOfficeReviewChange(item)) changed = true;
      });
    }
    return changed;
  }

  function coalesceOfficeDraftChanges(file) {
    if (!file || file.kind !== 'doc') return false;
    var changes = Array.isArray(file.reviewChanges) ? file.reviewChanges : [];
    var changed = false;
    changes.forEach(function (change) {
      if (sanitizeOfficeReviewChange(change)) changed = true;
    });
    var draftChanges = changes.filter(function (change) {
      return isOfficeDraftChange(change);
    });
    if (draftChanges.length <= 1) return changed;
    var kept = false;
    file.reviewChanges = changes.filter(function (change) {
      if (!isOfficeDraftChange(change)) return true;
      if (!kept) {
        kept = true;
        change.officeDraftBatch = true;
        change.type = 'Local draft edits';
        change.text = change.text || 'Autosaved draft edits.';
        return true;
      }
      return false;
    });
    return true;
  }

  function normalizeLoadedState(nextState) {
    var changed = false;
    if (!nextState || !Array.isArray(nextState.files)) return nextState;
    nextState.files.forEach(function (file) {
      if (!file || file.kind !== 'doc') return;
      if (shouldUseDraftShell(file) && file.preferDraftShell !== true) {
        file.preferDraftShell = true;
        changed = true;
      }
      if (ensureEditableDocContent(file)) changed = true;
      if (coalesceOfficeDraftChanges(file)) changed = true;
    });
    return nextState;
  }

  function safeEditorReferrer(value) {
    var route = String(value || '').trim();
    if (!route || route.indexOf('://') !== -1 || route.indexOf('javascript:') === 0 || route.indexOf('data:') === 0) return '';
    return route;
  }

  function applyFileEditorContext(ctx) {
    var handoff = ctx && ctx.fileEditor ? ctx.fileEditor : null;
    var incoming = handoff && handoff.file ? handoff.file : null;
    if (!incoming || !incoming.id) return;
    if (incoming.kind && ['doc', 'sheet', 'deck'].indexOf(incoming.kind) === -1) {
      editorLoadError = 'This file format is not supported by File Editor.';
      return;
    }
    if ((incoming.kind === 'sheet' || incoming.kind === 'deck') && incoming.officeEditingSupported !== true) {
      editorLoadError = 'This Office format is read-only because the server did not report edit-model support.';
      return;
    }
    editorReferrer = safeEditorReferrer(handoff.referrer || (ctx && ctx.referrer)) ||
      ('file-viewer.html?id=' + encodeURIComponent(incoming.documentId || incoming.sourceDocumentId || ''));

    var file = null;
    for (var i = 0; i < state.files.length; i += 1) {
      if (state.files[i].id === incoming.id) {
        file = state.files[i];
        break;
      }
    }

    var isNewFile = false;
    if (!file) {
      isNewFile = true;
      file = {
        id: incoming.id,
        kind: incoming.kind === 'sheet' || incoming.kind === 'deck' ? incoming.kind : 'doc',
        title: incoming.title || incoming.filename || 'Imported Document',
        createdAt: incoming.createdAt || nowIso(),
        updatedAt: incoming.updatedAt || nowIso(),
        lastSavedAt: incoming.lastSavedAt || incoming.updatedAt || nowIso(),
        aiDrafts: 0,
        signers: [],
        activities: []
      };
      state.files.unshift(file);
    }

    file.kind = incoming.kind === 'sheet' || incoming.kind === 'deck' ? incoming.kind : 'doc';
    file.title = incoming.title || file.title;
    file.filename = incoming.filename || file.filename;
    file.sourceDocumentId = incoming.sourceDocumentId || file.sourceDocumentId;
    file.releasedDocumentId = incoming.releasedDocumentId || file.releasedDocumentId || '';
    file.editorBaselineReleaseId = incoming.editorBaselineReleaseId || file.editorBaselineReleaseId || '';
    file.editorBaselineReleaseNumber = incoming.editorBaselineReleaseNumber || file.editorBaselineReleaseNumber || null;
    file.documentId = incoming.documentId || file.documentId || file.releasedDocumentId || file.sourceDocumentId || '';
    file.matterId = incoming.matterId || file.matterId || '';
    file.matterNumber = incoming.matterNumber || incoming.matter_number || file.matterNumber || file.matter_number || '';
    file.matterName = incoming.matterName || file.matterName || '';
    file.contentType = incoming.contentType || file.contentType;
    file.fileSize = incoming.fileSize || file.fileSize;
    file.chunkCount = incoming.chunkCount != null ? incoming.chunkCount : file.chunkCount;
    file.lifecycleStatus = incoming.lifecycleStatus || file.lifecycleStatus || '';
    file.createdAt = incoming.createdAt || file.createdAt || nowIso();
    // The handoff carries the server's document dates; a newer local date
    // means unsynced local work and must never be clobbered by an older one.
    file.documentUpdatedAt = newestIso(incoming.documentUpdatedAt || incoming.updatedAt, file.documentUpdatedAt) || file.documentUpdatedAt || '';
    file.updatedAt = newestIso(incoming.updatedAt, file.updatedAt) || nowIso();
    file.lastSavedAt = newestIso(incoming.lastSavedAt, file.lastSavedAt) || file.updatedAt;
    file.metadata = incoming.metadata || file.metadata || {};
    var savedMargin = file.metadata.editor_margin_preset;
    file.marginPreset = savedMargin === 'narrow' || savedMargin === 'wide' ? savedMargin : 'normal';
    file.summary = incoming.summary || file.summary || '';
    file.summaryGeneratedAt = incoming.summaryGeneratedAt || file.summaryGeneratedAt || file.updatedAt;
    file.editorEngine = incoming.editorEngine || file.editorEngine;
    file.editorMode = incoming.editorMode || file.editorMode || 'review';
    file.preferDraftShell = incoming.preferDraftShell === true || file.preferDraftShell === true;
    file.openedFromFileViewer = handoff.source === 'file_viewer' || file.openedFromFileViewer;
    file.sourceUrl = incoming.sourceUrl || file.sourceUrl;
    if (file.kind === 'doc') {
      // The HTML preview from File Viewer is neither the editable source nor an
      // authoritative draft. Keep only an escaped fallback while the embed loads.
      file.content = officeHandoffFallbackContent(incoming);
      ensureEditableDocContent(file);
    } else {
      file.officeEditingSupported = true;
      file.formatCapabilities = incoming.formatCapabilities || file.formatCapabilities || {};
      ensureOfficeEdit(file);
    }
    file.showChanges = typeof file.showChanges === 'boolean' ? file.showChanges : incoming.showChanges !== false;
    file.reviewChanges = [];
    file.versions = [];
    ensureReviewBaseline(file);
    state.activeId = file.id;
    activePanel = 'editor';
    rightRailMode = 'review';
    fileInfoMode = 'view';
    reviewRailTab = 'changes';
    saveState();
  }

  function officeModelKind(model, fallback) {
    var value = String(model && (model.kind || model.type || model.format) || fallback || '').toLowerCase();
    if (value === 'sheet' || value === 'spreadsheet' || value === 'workbook' || value === 'csv' || value === 'xlsx') return 'sheet';
    if (value === 'deck' || value === 'presentation' || value === 'slides' || value === 'pptx') return 'deck';
    return '';
  }

  function applyOfficeDocument(file, documentRow) {
    if (!file || !documentRow || typeof documentRow !== 'object') return;
    var displayFilename = documentDisplayFilename(documentRow);
    file.documentId = String(documentRow.id || documentRow.document_id || file.documentId || '');
    file.storageFilename = documentRow.filename || file.storageFilename || displayFilename;
    file.original_filename = documentRow.original_filename || displayFilename;
    file.display_filename = documentRow.display_filename || displayFilename;
    file.filename = displayFilename || file.filename;
    file.title = displayFilename || file.title;
    file.contentType = documentRow.content_type || documentRow.mime_type || file.contentType;
    file.fileSize = documentRow.file_size != null ? documentRow.file_size : file.fileSize;
    file.documentUpdatedAt = documentRow.updated_at || file.documentUpdatedAt;
  }

  function applyOfficeEditModel(file, model, documentRow, options) {
    if (!file || !model || typeof model !== 'object') throw new Error('The server returned an invalid Office edit model.');
    var kind = officeModelKind(model, file.kind);
    if (kind !== file.kind) throw new Error('The server returned an edit model for a different Office format.');
    file.officeModel = model;
    applyOfficeDocument(file, documentRow);

    if (kind === 'sheet') {
      var cells = Array.isArray(model.cells) ? model.cells : (Array.isArray(model.grid) ? model.grid : null);
      if (!cells && Array.isArray(model.worksheets) && model.worksheets[0]) cells = model.worksheets[0].cells;
      if (!Array.isArray(cells)) throw new Error('The spreadsheet edit model did not contain cells.');
      file.cells = cells.map(function (row) { return Array.isArray(row) ? row.slice() : []; });
    } else {
      if (!Array.isArray(model.slides)) throw new Error('The presentation edit model did not contain slides.');
      file.slides = model.slides.map(function (slide) {
        var row = slide && typeof slide === 'object' ? slide : {};
        return {
          title: String(row.title || ''),
          body: String(row.body || ''),
          notes: String(row.notes || row.speaker_notes || row.speakerNotes || '')
        };
      });
      if (model.title) file.title = String(model.title);
    }

    var edit = ensureOfficeEdit(file);
    edit.loaded = true;
    edit.loading = false;
    edit.error = '';
    if (options && options.saved) {
      edit.savedAt = (documentRow && documentRow.updated_at) || nowIso();
      file.lastSavedAt = edit.savedAt;
      file.updatedAt = edit.savedAt;
    }
  }

  function officeEditModelForFile(file) {
    if (!isServerOfficeFile(file)) throw new Error('No server-managed Office file is open.');
    var model = Object.assign({}, file.officeModel || {});
    if (!model.kind && !model.type) model.kind = file.kind;
    model.title = file.title || model.title || '';
    if (file.kind === 'sheet') {
      var cells = (file.cells || []).map(function (row) { return Array.isArray(row) ? row.slice() : []; });
      model.cells = cells;
      if (Object.prototype.hasOwnProperty.call(model, 'grid')) model.grid = cells;
    } else {
      var sourceSlides = Array.isArray(file.officeModel && file.officeModel.slides) ? file.officeModel.slides : [];
      model.slides = (file.slides || []).map(function (slide, index) {
        var original = sourceSlides[index] && typeof sourceSlides[index] === 'object' ? sourceSlides[index] : {};
        var next = Object.assign({}, original, {
          title: String(slide && slide.title || ''),
          body: String(slide && slide.body || ''),
          notes: String(slide && slide.notes || '')
        });
        if (Object.prototype.hasOwnProperty.call(original, 'speaker_notes')) next.speaker_notes = next.notes;
        if (Object.prototype.hasOwnProperty.call(original, 'speakerNotes')) next.speakerNotes = next.notes;
        return next;
      });
    }
    return model;
  }

  async function loadOfficeEditModel(file) {
    var edit = ensureOfficeEdit(file);
    var service = contentApi();
    if (!edit || !service) throw new Error('The File Editor content service is unavailable.');
    if (edit.loading) return edit.loadPromise;
    edit.loading = true;
    edit.error = '';
    renderEditor();
    edit.loadPromise = service.getEditModel(officeRealDocumentId(file)).then(function (result) {
      applyOfficeEditModel(file, result.model, result.document);
      edit.dirty = false;
      edit.saveError = '';
      edit.savedAt = file.lastSavedAt || file.updatedAt || '';
      renderAll();
      return result;
    }).catch(function (error) {
      edit.loading = false;
      edit.loaded = false;
      edit.error = (error && error.message) || 'The Office edit model could not be loaded.';
      renderAll();
      throw error;
    }).finally(function () {
      edit.loadPromise = null;
    });
    return edit.loadPromise;
  }

  async function saveOfficeEditModel(file) {
    var edit = ensureOfficeEdit(file);
    var service = contentApi();
    if (!edit || !service) throw new Error('The File Editor content service is unavailable.');
    if (!edit.loaded) throw new Error(edit.error || 'The Office edit model is not loaded.');
    if (edit.saving && edit.savePromise) return edit.savePromise;
    var savedVersion = edit.changeVersion;
    var model = officeEditModelForFile(file);
    edit.saving = true;
    edit.saveError = '';
    renderChrome();
    edit.savePromise = service.saveEditModel(officeRealDocumentId(file), model).then(function (result) {
      if (edit.changeVersion === savedVersion) {
        applyOfficeEditModel(file, result.model, result.document, { saved: true });
        edit.dirty = false;
      } else {
        file.officeModel = result.model;
        applyOfficeDocument(file, result.document);
        edit.savedAt = (result.document && result.document.updated_at) || nowIso();
        file.lastSavedAt = edit.savedAt;
        edit.dirty = true;
      }
      edit.saveError = '';
      renderAll();
      return result;
    }).catch(function (error) {
      edit.saveError = (error && error.message) || 'The Office file could not be saved.';
      edit.dirty = true;
      renderChrome();
      throw error;
    }).finally(function () {
      edit.saving = false;
      edit.savePromise = null;
      renderChrome();
    });
    return edit.savePromise;
  }

  function activeFile() {
    var files = state && state.files ? state.files : [];
    for (var i = 0; i < files.length; i += 1) {
      if (files[i].id === state.activeId) return files[i];
    }
    return files[0] || null;
  }

  function remoteWorkflowForFile(file) {
    if (!file) return null;
    if (!officeRemoteWorkflows[file.id]) {
      officeRemoteWorkflows[file.id] = {
        loading: false,
        loaded: false,
        error: '',
        collaborators: [],
        signaturePackets: [],
        stagedSigners: [],
        selectedPacketId: ''
      };
    }
    return officeRemoteWorkflows[file.id];
  }

  function collaborationApi() {
    var service = window.LanaFileEditorCollaborationApi;
    if (!service || typeof service.listCollaborators !== 'function') return null;
    return service;
  }

  async function loadRemoteWorkflows(file, options) {
    var remote = remoteWorkflowForFile(file);
    var service = collaborationApi();
    var force = options && options.force;
    if (!remote || !isServerWorkflowFile(file) || !service) return remote;
    if (remote.loading || (remote.loaded && !force)) return remote;
    remote.loading = true;
    remote.error = '';
    renderRemotePanels(file);
    try {
      var documentId = officeRealDocumentId(file);
      var results = await Promise.all([
        service.listCollaborators(documentId),
        service.listSignaturePackets(documentId)
      ]);
      remote.collaborators = results[0].collaborators || [];
      remote.signaturePackets = results[1].signature_packets || [];
      if (!remote.selectedPacketId && remote.signaturePackets.length) {
        remote.selectedPacketId = remote.signaturePackets[0].id;
      }
      remote.loaded = true;
    } catch (error) {
      remote.error = (error && error.message) || 'Collaboration workflows could not be loaded.';
    } finally {
      remote.loading = false;
      renderChrome();
      renderRemotePanels(file);
    }
    return remote;
  }

  function setUpdated(file) {
    file.updatedAt = nowIso();
    file.lastSavedAt = file.lastSavedAt || file.updatedAt;
    if (isServerOfficeFile(file)) {
      var edit = ensureOfficeEdit(file);
      edit.dirty = true;
      edit.saveError = '';
      edit.changeVersion += 1;
    }
    saveState();
    renderChrome();
  }

  function docAutosavePending(file) {
    return Boolean(file && file.id && docAutosaveTimers[file.id]);
  }

  function savedStatusLabel(file) {
    if (!file) return '';
    if (isServerOfficeFile(file)) {
      var officeEdit = ensureOfficeEdit(file);
      if (officeEdit.loading) return 'Loading edit model...';
      if (officeEdit.saving) return 'Saving...';
      if (officeEdit.saveError) return 'Save failed';
      if (officeEdit.error) return 'Edit model unavailable';
      if (officeEdit.dirty) return 'Unsaved changes';
      var officeSavedAt = officeEdit.savedAt || file.lastSavedAt || file.updatedAt;
      return officeSavedAt ? 'Saved ' + formatTimestamp(officeSavedAt) : 'Not saved yet';
    }
    if (isServerReviewFile(file)) {
      var review = serverReview(file);
      if (review && (review.saving || serverDraftSaveTimers[file.id])) return 'Saving draft...';
      if (review && review.pendingReleaseBatch) return 'Release pending approval';
      if (review && review.saveFailed) return 'Draft save failed';
      if (review && (review.loadFailed || review.draftDetailFailed || review.restoreFailed)) return 'Read-only - saved draft unavailable';
      var draftSavedAt = review && review.currentDraftBatch && review.currentDraftBatch.updated_at;
      return draftSavedAt ? 'Draft saved ' + formatTimestamp(draftSavedAt) : 'No saved draft yet';
    }
    if (docAutosavePending(file)) return 'Autosaving...';
    var savedAt = file.lastSavedAt || file.updatedAt;
    return savedAt ? 'Last saved ' + formatTimestamp(savedAt) : 'Not saved yet';
  }

  function stripOfficeReviewMarksFromHtml(html) {
    if (!html || typeof document === 'undefined') return html || '';
    var wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');
    sanitizeOfficeDocElement(wrapper);
    wrapper.querySelectorAll('.office-review-delete, .le-rev[data-rev-type="del"], .le-rev--del').forEach(function (mark) {
      mark.remove();
    });
    wrapper.querySelectorAll('.office-review-insert, .office-review-mark, .le-rev[data-rev-type="ins"], .le-rev--ins').forEach(function (mark) {
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
    });
    wrapper.querySelectorAll('.office-review-change').forEach(function (mark) {
      mark.replaceWith(document.createTextNode(mark.textContent || ''));
    });
    sanitizeOfficeDocElement(wrapper);
    return wrapper.innerHTML;
  }

  function reviewMarkCandidates(file) {
    if (!file || file.showChanges === false || !Array.isArray(file.reviewChanges)) return [];
    var candidates = [];
    file.reviewChanges.forEach(function (change) {
      if (!change) return false;
      if (changeIsComment(change)) return false;
      if (!changeIsPending(change)) return false;
      if (Array.isArray(change.items) && change.items.length) {
        change.items.forEach(function (item) {
          if (item && Boolean(item.before || item.after || item.text)) candidates.push(item);
        });
        return;
      }
      if (change.before || change.after || change.text) candidates.push(change);
    });
    return sortReviewItemsByNewest(candidates).slice(0, 50);
  }

  function commitReleasedDocBody(file) {
    if (!file || file.kind !== 'doc') return;
    var page = fallbackDocPage();
    var clean = page ? cleanOfficeDocContent(page.innerHTML) : cleanOfficeDocContent(file.content || '');
    file.content = clean || file.content || '';
    file.reviewBaselineContent = file.content;
    file.lastSavedAt = nowIso();
    file.updatedAt = file.lastSavedAt;
    file.undoStack = [];
    file.redoStack = [];
    delete file.officeDraftBatchBaselineContent;
  }

  function reviewChangeOperationForRender(change) {
    var type = String(change && change.type || '').toLowerCase();
    if (type.indexOf('new paragraph') !== -1) return 'insert';
    if (type.indexOf('paragraph removed') !== -1) return 'delete';
    if (type.indexOf('delete') !== -1) return 'delete';
    if (type.indexOf('insert') !== -1) return 'insert';
    if (type.indexOf('format') !== -1) return 'format';
    if (change && change.before && change.after && change.before !== change.after) return 'replace';
    if (change && change.after) return 'insert';
    if (change && change.before) return 'delete';
    return 'replace';
  }

  function reviewChangeCurrentText(change) {
    if (!change) return '';
    var operation = reviewChangeOperationForRender(change);
    if (operation === 'delete') return '';
    return String(change.after || change.text || '').trim();
  }

  function reviewChangeOriginalText(change) {
    if (!change) return '';
    var operation = reviewChangeOperationForRender(change);
    if (operation === 'insert' && (!change.before || String(change.before).toLowerCase() === 'no previous text')) return '';
    return String(change.before || '').trim();
  }

  function buildOfficeReviewInline(change) {
    var operation = reviewChangeOperationForRender(change);
    var before = reviewChangeOriginalText(change);
    var after = reviewChangeCurrentText(change);
    var originalAttr = before ? ' data-office-original="' + esc(before) + '"' : '';
    var title = before ? ' title="Original: ' + esc(before) + '"' : '';
    if (operation === 'insert') {
      return '<span class="office-review-change office-review-change--insert"' + originalAttr + title + '>' +
        '<span class="office-review-insert">' + esc(after || change.text || '') + '</span></span>';
    }
    if (operation === 'delete') {
      return '<span class="office-review-change office-review-change--delete"' + originalAttr + title + '>' +
        '<span class="office-review-delete">' + esc(before || change.text || '') + '</span></span>';
    }
    return '<span class="office-review-change office-review-change--replace"' + originalAttr + title + '>' +
      (before ? '<span class="office-review-delete">' + esc(before) + '</span>' : '') +
      (after ? '<span class="office-review-insert">' + esc(after) + '</span>' : '') +
      '</span>';
  }

  function replaceFirstTextMatch(root, needle, html) {
    var target = String(needle || '').trim();
    if (!target) return false;
    var nodes = [];
    var walker = document.createTreeWalker(root, 4);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var text = node.nodeValue || '';
      var index = text.indexOf(target);
      if (index === -1) continue;
      var holder = document.createElement('span');
      holder.innerHTML = html;
      var before = document.createTextNode(text.slice(0, index));
      var after = document.createTextNode(text.slice(index + target.length));
      node.parentNode.insertBefore(before, node);
      while (holder.firstChild) node.parentNode.insertBefore(holder.firstChild, node);
      node.parentNode.insertBefore(after, node);
      node.parentNode.removeChild(node);
      return true;
    }
    return false;
  }

  function replaceFirstTextInHtml(html, needle, replacement) {
    var target = String(needle || '').trim();
    if (!target || typeof document === 'undefined') return { changed: false, html: html || '' };
    var wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');
    var nodes = [];
    var walker = document.createTreeWalker(wrapper, 4);
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var text = node.nodeValue || '';
      var index = text.indexOf(target);
      if (index === -1) continue;
      node.nodeValue = text.slice(0, index) + String(replacement || '') + text.slice(index + target.length);
      return { changed: true, html: wrapper.innerHTML };
    }
    return { changed: false, html: wrapper.innerHTML };
  }

  function appendParagraphToHtml(html, text) {
    if (typeof document === 'undefined') return (html || '') + '<p>' + esc(text) + '</p>';
    var wrapper = document.createElement('div');
    wrapper.innerHTML = String(html || '');
    var paragraph = document.createElement('p');
    paragraph.textContent = String(text || '');
    wrapper.appendChild(paragraph);
    return wrapper.innerHTML;
  }

  function revertReviewChangeAtIndex(file, index) {
    if (!file || file.kind !== 'doc' || !Array.isArray(file.reviewChanges)) return false;
    var change = file.reviewChanges[index];
    if (!change || !changeIsPending(change)) return false;
    syncActiveDocContent({ autosave: false });
    clearDocAutosave(file);

    if ((change.officeDraftBatch || isOfficeDraftChange(change)) && typeof file.officeDraftBatchBaselineContent === 'string') {
      file.content = cleanOfficeDocContent(file.officeDraftBatchBaselineContent || '');
      file.reviewChanges = file.reviewChanges.map(function (item, itemIndex) {
        if (itemIndex !== index && !(item && (item.officeDraftBatch || isOfficeDraftChange(item)) && changeIsPending(item))) return item;
        return Object.assign({}, item, {
          status: 'Reverted',
          officeDraftBatch: false,
          updatedAt: nowIso()
        });
      });
      file.reviewBaselineContent = file.content;
      delete file.officeDraftBatchBaselineContent;
      file.lastSavedAt = nowIso();
      file.updatedAt = file.lastSavedAt;
      file.activities = file.activities || [];
      file.activities.unshift('Autosaved draft batch reverted.');
      saveState();
      renderChrome();
      renderFileList();
      renderEditor();
      return true;
    }

    var operation = reviewChangeOperationForRender(change);
    var before = reviewChangeOriginalText(change);
    var after = reviewChangeCurrentText(change);
    var html = cleanOfficeDocContent(file.content || '');
    var result = { changed: false, html: html };

    if (operation === 'insert') {
      result = replaceFirstTextInHtml(html, after || change.text, '');
    } else if (operation === 'delete') {
      result = before ? { changed: true, html: appendParagraphToHtml(html, before) } : result;
    } else {
      result = replaceFirstTextInHtml(html, after || change.text, before || '');
    }

    if (!result.changed) return false;
    file.content = cleanOfficeDocContent(result.html);
    change.status = 'Reverted';
    change.officeDraftBatch = false;
    change.updatedAt = nowIso();
    file.reviewBaselineContent = file.content;
    file.lastSavedAt = nowIso();
    file.updatedAt = file.lastSavedAt;
    file.activities = file.activities || [];
    file.activities.unshift('Draft review change reverted.');
    saveState();
    renderChrome();
    renderFileList();
    renderEditor();
    return true;
  }

  function renderDocContentWithReviewMarks(file) {
    var html = cleanOfficeDocContent(file && file.content ? file.content : '');
    var changes = reviewMarkCandidates(file);
    if (!changes.length || typeof document === 'undefined') return html;
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    changes.forEach(function (change) {
      var operation = reviewChangeOperationForRender(change);
      var current = reviewChangeCurrentText(change);
      var original = reviewChangeOriginalText(change);
      var inline = buildOfficeReviewInline(change);
      if (operation === 'delete') {
        replaceFirstTextMatch(wrapper, original || change.text, inline);
        return;
      }
      if (!replaceFirstTextMatch(wrapper, current, inline) && original) {
        replaceFirstTextMatch(wrapper, original, inline);
      }
    });
    return wrapper.innerHTML;
  }

  function clearDocAutosave(file) {
    if (!file || !file.id || !docAutosaveTimers[file.id]) return;
    clearTimeout(docAutosaveTimers[file.id]);
    delete docAutosaveTimers[file.id];
  }

  function docPlainText(html) {
    html = cleanOfficeDocContent(html || '');
    var tools = writerTools();
    if (tools && typeof tools.htmlToPlainText === 'function') return tools.htmlToPlainText(html || '');
    var holder = document.createElement('div');
    holder.innerHTML = html || '';
    return sanitizeOfficeDocText(holder.textContent || '').trim();
  }

  function compactText(value) {
    return String(value || '')
      .split('\n').join(' ')
      .split('\r').join(' ')
      .split('\t').join(' ')
      .split(' ')
      .filter(Boolean)
      .join(' ');
  }

  function reviewWords(value) {
    var compact = compactText(value);
    return compact ? compact.split(' ') : [];
  }

  function docLines(html) {
    return docPlainText(html).split('\n').map(function (line) {
      return compactText(line);
    }).filter(Boolean);
  }

  function excerptWords(words, limit) {
    var max = limit || 28;
    if (!words.length) return '';
    var out = words.slice(0, max).join(' ');
    return words.length > max ? out + '...' : out;
  }

  function excerptLines(lines, limit) {
    var max = limit || 4;
    if (!lines.length) return '';
    var out = lines.slice(0, max).join(' / ');
    return lines.length > max ? out + '...' : out;
  }

  function excerptChars(value, limit) {
    var text = compactText(value);
    var max = limit || 180;
    return text.length > max ? text.slice(0, max) + '...' : text;
  }

  function charChangeSummary(beforeText, afterText) {
    var before = String(beforeText || '');
    var after = String(afterText || '');
    if (before === after) return null;

    var start = 0;
    while (start < before.length && start < after.length && before.charAt(start) === after.charAt(start)) {
      start += 1;
    }

    var beforeEnd = before.length - 1;
    var afterEnd = after.length - 1;
    while (beforeEnd >= start && afterEnd >= start && before.charAt(beforeEnd) === after.charAt(afterEnd)) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    var removed = excerptChars(before.slice(start, beforeEnd + 1), 180);
    var added = excerptChars(after.slice(start, afterEnd + 1), 180);
    if (!removed && !added) return null;

    return {
      type: removed && added ? 'Replacement' : added ? 'Insertion' : 'Deletion',
      before: removed || 'no previous text',
      after: added || 'text removed',
      text: added || removed || 'Document text changed.'
    };
  }

  function wordChangeSummary(beforeText, afterText) {
    var charSummary = charChangeSummary(beforeText, afterText);
    if (charSummary) return charSummary;
    var beforeWords = reviewWords(beforeText);
    var afterWords = reviewWords(afterText);
    var start = 0;
    while (start < beforeWords.length && start < afterWords.length && beforeWords[start] === afterWords[start]) {
      start += 1;
    }

    var beforeEnd = beforeWords.length - 1;
    var afterEnd = afterWords.length - 1;
    while (beforeEnd >= start && afterEnd >= start && beforeWords[beforeEnd] === afterWords[afterEnd]) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    var removedWords = beforeWords.slice(start, beforeEnd + 1);
    var addedWords = afterWords.slice(start, afterEnd + 1);
    var removed = excerptWords(removedWords, 30);
    var added = excerptWords(addedWords, 30);
    if (!removed && !added) return null;

    return {
      type: removed && added ? 'Replacement' : added ? 'Insertion' : 'Deletion',
      before: removed || 'no previous text',
      after: added || 'text removed',
      text: added || removed || 'Document text changed.'
    };
  }

  function lineChangeSummary(beforeLines, afterLines) {
    var start = 0;
    while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) {
      start += 1;
    }

    var beforeEnd = beforeLines.length - 1;
    var afterEnd = afterLines.length - 1;
    while (beforeEnd >= start && afterEnd >= start && beforeLines[beforeEnd] === afterLines[afterEnd]) {
      beforeEnd -= 1;
      afterEnd -= 1;
    }

    var removed = beforeLines.slice(start, beforeEnd + 1);
    var added = afterLines.slice(start, afterEnd + 1);
    if (!removed.length && !added.length) return null;
    if (removed.length === 1 && added.length === 1) {
      var inlineSummary = charChangeSummary(removed[0], added[0]) || wordChangeSummary(removed[0], added[0]);
      if (inlineSummary) return inlineSummary;
    }
    return {
      type: removed.length && added.length ? 'Paragraph replacement' : added.length ? 'New paragraph' : 'Paragraph removed',
      before: excerptLines(removed, 4) || 'no previous text',
      after: excerptLines(added, 4) || 'paragraph removed',
      text: excerptLines(added, 2) || excerptLines(removed, 2) || 'Paragraph structure changed.'
    };
  }

  function buildDocChangeSummary(beforeHtml, afterHtml) {
    beforeHtml = cleanOfficeDocContent(beforeHtml || '');
    afterHtml = cleanOfficeDocContent(afterHtml || '');
    var beforeText = docPlainText(beforeHtml);
    var afterText = docPlainText(afterHtml);
    var beforeCompact = compactText(beforeText);
    var afterCompact = compactText(afterText);
    var beforeLines = docLines(beforeHtml);
    var afterLines = docLines(afterHtml);

    if (beforeCompact === afterCompact) {
      if (String(beforeHtml || '') === String(afterHtml || '')) return null;
      if (beforeLines.join('\n') !== afterLines.join('\n')) {
        return {
          type: afterLines.length > beforeLines.length ? 'New paragraph' : 'Paragraph break',
          before: beforeLines.join(' / ') || 'single paragraph',
          after: afterLines.join(' / ') || 'paragraph removed',
          text: afterLines.length > beforeLines.length ? 'New paragraph break added.' : 'Paragraph structure changed.'
        };
      }
      return {
        type: 'Formatting update',
        before: 'same text',
        after: 'formatting changed',
        text: 'Formatting changed without text edits.'
      };
    }

    if (afterLines.length !== beforeLines.length) {
      return lineChangeSummary(beforeLines, afterLines);
    }

    return charChangeSummary(beforeText, afterText) || wordChangeSummary(beforeText, afterText);
  }

  function ensureReviewBaseline(file) {
    if (!file || file.kind !== 'doc') return;
    if (typeof file.reviewBaselineContent !== 'string') {
      file.reviewBaselineContent = cleanOfficeDocContent(file.content || '');
    } else {
      file.reviewBaselineContent = cleanOfficeDocContent(file.reviewBaselineContent || '');
    }
  }

  function upsertOfficeDraftBatchChange(file, summary, baselineContent, afterContent) {
    file.reviewChanges = file.reviewChanges || [];
    file.officeDraftBatchBaselineContent = file.officeDraftBatchBaselineContent || baselineContent || '';
    var existing = null;
    var existingIndex = -1;
    for (var i = 0; i < file.reviewChanges.length; i += 1) {
      if (file.reviewChanges[i] &&
          file.reviewChanges[i].officeDraftBatch &&
          String(file.reviewChanges[i].status || '').toLowerCase() === 'pending') {
        existing = file.reviewChanges[i];
        existingIndex = i;
        break;
      }
    }
    if (existing) {
      file.reviewChanges = file.reviewChanges.filter(function (change, index) {
        return !(change &&
          change.officeDraftBatch &&
          String(change.status || '').toLowerCase() === 'pending' &&
          index !== existingIndex);
      });
    }
    var itemPayload = {
      type: summary.type || 'Local draft edit',
      text: summary.text,
      before: summary.before,
      after: summary.after,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    var payload = {
      type: 'Local draft edits',
      status: 'Pending',
      text: '1 autosaved edit captured.',
      before: summary.before,
      after: summary.after,
      author: currentReviewerName(),
      createdAt: existing && existing.createdAt ? existing.createdAt : nowIso(),
      updatedAt: nowIso(),
      officeDraftBatch: true,
      items: [itemPayload]
    };
    if (existing) {
      var existingItems = Array.isArray(existing.items) ? existing.items.slice() : [];
      if (!existingItems.length && (existing.before || existing.after || existing.text)) {
        existingItems.push({
          type: existing.type || 'Local draft edit',
          text: existing.text || '',
          before: existing.before || '',
          after: existing.after || '',
          createdAt: existing.createdAt || nowIso(),
          updatedAt: existing.updatedAt || nowIso()
        });
      }
      var lastItem = existingItems[existingItems.length - 1] || null;
      if (!lastItem ||
          lastItem.type !== itemPayload.type ||
          lastItem.before !== itemPayload.before ||
          lastItem.after !== itemPayload.after ||
          lastItem.text !== itemPayload.text) {
        existingItems.push(itemPayload);
      }
      payload.items = existingItems.slice(-12);
      payload.text = payload.items.length + ' autosaved edit' + (payload.items.length === 1 ? '' : 's') + ' captured.';
      payload.before = payload.items[0] && payload.items[0].before ? payload.items[0].before : summary.before;
      payload.after = itemPayload.after;
      Object.assign(existing, payload);
    } else {
      file.reviewChanges.unshift(payload);
    }
    file.reviewBaselineContent = afterContent || '';
  }

  function captureSavedDocReviewChange(file) {
    if (!file || file.kind !== 'doc') return false;
    ensureReviewBaseline(file);
    file.content = cleanOfficeDocContent(file.content || '');
    var before = cleanOfficeDocContent(file.reviewBaselineContent || '');
    var after = cleanOfficeDocContent(file.content || '');
    file.officeDraftBatchBaselineContent = file.officeDraftBatchBaselineContent || before;
    var summary = buildDocChangeSummary(before, after);
    if (!summary) return false;

    upsertOfficeDraftBatchChange(file, summary, file.officeDraftBatchBaselineContent, after);
    file.activities = file.activities || [];
    if (!file.activities.length || file.activities[0] !== 'Local draft edits captured in Change History.') {
      file.activities.unshift('Local draft edits captured in Change History.');
    }
    return true;
  }

  function pendingDocReviewChanges(file) {
    if (!file || !Array.isArray(file.reviewChanges)) return [];
    return file.reviewChanges.filter(changeIsPending);
  }

  function docHasUnsavedDraftChanges(file) {
    if (!file || file.kind !== 'doc') return false;
    ensureReviewBaseline(file);
    var cleanContent = cleanOfficeDocContent(file.content || '');
    var baseline = cleanOfficeDocContent(file.reviewBaselineContent || '');
    return compactText(cleanContent) !== compactText(baseline) || cleanContent !== baseline;
  }

  function docHasActiveSavedDraft(file) {
    return pendingDocReviewChanges(file).length > 0;
  }

  function saveDocBatch(file, options) {
    var opts = options || {};
    if (!file || file.kind !== 'doc') return false;
    clearDocAutosave(file);
    if (opts.syncContent !== false) syncActiveDocContent({ autosave: false });
    if (!fallbackDocPage() && officeEditorInstance && typeof officeEditorInstance.reviewState === 'function') {
      try {
        syncOfficeEditorReviewState(file, officeEditorInstance.reviewState());
      } catch (_) {}
    }
    var captured = opts.captureReview === false ? false : captureSavedDocReviewChange(file);
    file.lastSavedAt = nowIso();
    file.updatedAt = file.lastSavedAt;
    saveState();
    renderChrome();
    renderFileList();
    renderReviewDock(file);
    return captured;
  }

  function scheduleDocAutosave(file) {
    if (!file || file.kind !== 'doc') return;
    ensureReviewBaseline(file);
    clearDocAutosave(file);
    file.updatedAt = nowIso();
    renderChrome();
    renderFileList();
    renderReviewDock(file);
    docAutosaveTimers[file.id] = setTimeout(function () {
      if (activeFile() && activeFile().id === file.id) {
        syncActiveDocContent({ autosave: false });
      }
      saveDocBatch(file, { syncContent: false });
    }, DOC_AUTOSAVE_DELAY_MS);
  }

  function formatTime(value) {
    if (window.Lex && Lex.Utils && Lex.Utils.timeAgo) {
      try { return Lex.Utils.timeAgo(value); } catch (e) { return 'just now'; }
    }
    return 'just now';
  }

  function formatTimestamp(value) {
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'unknown';
    try {
      return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    } catch (_) {
      return date.toLocaleString();
    }
  }

  function formatFileSize(bytes) {
    var value = Number(bytes || 0);
    if (!value || value < 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return Math.round(value * 100) / 100 + ' ' + units[index];
  }

  function officeFileMimeType(file) {
    if (!file) return 'application/octet-stream';
    if (file.contentType) return file.contentType;
    if (file.kind === 'sheet') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (file.kind === 'deck') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  function formatMimeType(mimeType) {
    var map = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word Document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel Spreadsheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint Presentation',
      'text/html': 'HTML Document',
      'text/plain': 'Text File'
    };
    return map[mimeType] || mimeType || 'Unknown';
  }

  function formatDocumentType(type) {
    var map = {
      contract: 'Contract',
      pleading: 'Pleading',
      deposition: 'Deposition',
      affidavit: 'Affidavit',
      spreadsheet: 'Spreadsheet',
      presentation: 'Presentation',
      other: 'Other'
    };
    return map[type] || type || '';
  }

  function officeFileMetadata(file) {
    if (!file) return {};
    if (!file.metadata || typeof file.metadata !== 'object') file.metadata = {};
    return file.metadata;
  }

  function officeDocumentType(file) {
    var metadata = officeFileMetadata(file);
    if (metadata.document_type) return metadata.document_type;
    if (file && file.kind === 'sheet') return 'spreadsheet';
    if (file && file.kind === 'deck') return 'presentation';
    var title = String(file && file.title || '').toLowerCase();
    var text = docPlainText(file && file.content || '').toLowerCase();
    if (title.indexOf('affidavit') !== -1 || text.indexOf('affidavit') !== -1) return 'affidavit';
    if (title.indexOf('nda') !== -1 || title.indexOf('agreement') !== -1 || text.indexOf('agreement') !== -1) return 'contract';
    return 'other';
  }

  function officeFileSize(file) {
    if (!file) return 0;
    var serverSize = Number(file.fileSize || file.file_size || 0);
    if (Number.isFinite(serverSize) && serverSize > 0) return serverSize;
    var payload = '';
    if (file.kind === 'sheet') payload = JSON.stringify(file.cells || []);
    else if (file.kind === 'deck') payload = JSON.stringify(file.slides || []);
    else payload = file.content || '';
    try {
      if (window.TextEncoder) return new TextEncoder().encode(payload).length;
    } catch (_) {}
    return payload.length;
  }

  function officeChunkCount(file) {
    if (!file || file.kind !== 'doc') return 1;
    var serverCount = Number(file.chunkCount || file.chunk_count);
    if (Number.isFinite(serverCount) && serverCount >= 0) return serverCount;
    var stats = writerTools() ? writerTools().getDocumentStats(file.content || '') : null;
    return Math.max(1, Math.ceil(Number(stats && stats.words || 0) / 400));
  }

  function officeAiSummary(file) {
    if (!file) return 'Summary unavailable.';
    if (file.summary) return file.summary;
    if (isServerReviewFile(file)) return 'No server-generated summary is available for this document.';
    if (file.kind === 'sheet') return 'Spreadsheet draft with local formulas, values, and export-ready table data.';
    if (file.kind === 'deck') return 'Slide deck draft with editable slide content, speaker notes, and presentation structure.';
    var text = compactText(docPlainText(file.content || ''));
    if (!text) return 'No document text available yet.';
    var words = text.split(' ');
    return 'This Office document is a local editable draft. It currently covers: ' + excerptWords(words, 52);
  }

  function renderTagPills(tags) {
    var raw = String(tags || '');
    var parts = raw.split(',');
    var html = '';
    for (var i = 0; i < parts.length; i += 1) {
      var tag = parts[i].trim();
      if (tag) html += '<span>' + esc(tag) + '</span>';
    }
    return html || '<em>No tags</em>';
  }

  function reviewTone(status) {
    var value = String(status || '').toLowerCase();
    if (value.indexOf('release') !== -1 || value.indexOf('version') !== -1) return 'release';
    if (value.indexOf('future') !== -1 || value.indexOf('batch') !== -1) return 'future';
    return 'draft';
  }

  function normalizeReviewVersionTitle(value) {
    return String(value || 'Draft version').replace(/^Verion\b/i, 'Version');
  }

  function reviewStatusValue(item) {
    return String(item && item.status || '').toLowerCase();
  }

  function changeIsReleased(change) {
    return reviewTone(change && change.status) === 'release';
  }

  function changeIsComment(change) {
    return String(change && (change.type || change.title) || '').toLowerCase() === 'comment';
  }

  function changeIsPending(change) {
    if (!change) return false;
    if (changeIsComment(change)) return false;
    if (changeIsReleased(change)) return false;
    var status = reviewStatusValue(change);
    return !status ||
      status === 'pending' ||
      status === 'open' ||
      status === 'draft' ||
      status === 'draft shell';
  }

  function docReviewModel(file) {
    var review = file && file.review ? file.review : {};
    var versions = Array.isArray(review.versions) && review.versions.length ? review.versions.slice() : [];
    var changes = Array.isArray(review.changes) && review.changes.length ? review.changes.slice() : [];
    // Server documents must never fall back to handoff/local placeholder
    // rows. Those rows are not authoritative and can create fake actions.
    if (isServerReviewFile(file)) {
      return { versions: versions, changes: changes };
    }
    if (!versions.length && file && Array.isArray(file.versions)) {
      versions = file.versions.map(function (version) {
        return {
          title: normalizeReviewVersionTitle(version.label || 'Draft version'),
          meta: version.time || 'File Editor draft shell',
          status: version.status || 'Draft shell',
          tone: reviewTone(version.status)
        };
      });
    }
    versions = versions.map(function (version) {
      return Object.assign({}, version, {
        title: normalizeReviewVersionTitle(version.title || version.label || 'Draft version')
      });
    });
    if (!changes.length && file && Array.isArray(file.reviewChanges)) {
      changes = file.reviewChanges.map(function (change) {
        var index = file.reviewChanges.indexOf(change);
        return {
          title: change.type || 'Local draft edit',
          body: change.text || 'Captured in the File Editor draft shell.',
          before: change.before || '',
          after: change.after || '',
          items: Array.isArray(change.items) ? change.items.slice() : [],
          meta: change.author || '',
          status: change.status || 'Draft shell',
          tone: reviewTone(change.status),
          sourceIndex: index
        };
      });
    }
    if (!versions.length) {
      versions.push({
        title: 'Current draft',
        meta: 'Draft shell - saved locally in this Office session',
        status: 'Draft shell',
        tone: 'draft'
      });
    }
    if (!changes.length) {
      changes.push({
        title: 'Local draft edits',
        body: 'File Editor captures draft content locally; no review batch is created from this shell.',
        status: 'Draft shell',
        tone: 'draft'
      });
    }
    return { versions: versions, changes: changes };
  }

  function docReviewSummary(file) {
    if (!file || file.kind !== 'doc') return '';
    var review = docReviewModel(file);
    var versionCount = review.versions.length;
    var changeCount = review.changes.length;
    return '<span class="office-file-review-metadata">' +
      '<span>' + esc(versionCount) + ' version affordance' + (versionCount === 1 ? '' : 's') + '</span>' +
      '<span>' + esc(changeCount) + ' change affordance' + (changeCount === 1 ? '' : 's') + '</span>' +
      '</span>';
  }

  function renderReviewItems(items, type) {
    return items.map(function (item) {
      var tone = item.tone === 'release' || item.tone === 'future' ? item.tone : 'draft';
      var body = type === 'changes' && item.body
        ? '<span class="office-review-body">' + esc(item.body) + '</span>'
        : '';
      return '<li class="office-review-item office-review-item--' + tone + '">' +
        '<span class="office-review-copy"><span class="office-review-title">' + esc(item.title) + '</span>' +
        '<span class="office-review-meta">' + esc(item.meta || '') + '</span>' + body + '</span>' +
      '<span class="office-review-status office-review-status--' + tone + '">' + esc(item.status || 'Draft shell') + '</span></li>';
    }).join('');
  }

  function officeReviewChangeLanaSummary(change) {
    if (!change) return 'Review this tracked change.';
    var title = change.title || change.type || 'Tracked change';
    var before = change.before || '';
    var after = change.after || change.body || change.text || '';
    if (before && after && before !== after) return title + ': replace "' + before + '" with "' + after + '".';
    if (before) return title + ': remove "' + before + '".';
    if (after) return title + ': add "' + after + '".';
    return title + ': ' + (change.body || change.text || 'No preview available.');
  }

  function officeReviewChangeLanaPrompt(change) {
    return officeReviewChangeLanaSummary(change) +
      ' Review whether this tracked change is well-grounded and whether it creates legal or factual risk.';
  }

  // Declarative dock trigger, same contract the File Viewer uses: the dock
  // opens with the document context and PREFILLS the composer so the user can
  // edit or extend the prompt before sending. Never auto-send.
  function officeReviewChangeLanaButton(file, change) {
    if (!change) return '';
    var documentId = officeRealDocumentId(file);
    var documentName = (file && (file.filename || file.title)) || 'Document';
    var matterId = officeConversationMatterId(file);
    var matterName = (file && file.matterName) || '';
    var summary = officeReviewChangeLanaSummary(change);
    var context = {
      type: 'tracked_change',
      context_type: 'tracked_change',
      name: change.title || change.type || 'Tracked change',
      ui_label: change.title || change.type || 'Tracked change',
      summary: summary,
      source: 'file_editor_review_rail',
      status: change.status || '',
      operation: reviewChangeOperationForRender(change),
      original_text: String(change.before || '').slice(0, 2000),
      proposed_text: String(change.after || change.body || change.text || '').slice(0, 2000)
    };
    return '<div class="office-review-history-row-lana">' +
      '<button type="button" class="lex-card-lana-talk office-review-history-row-lana-button" data-lana-dock-trigger' +
        ' data-lana-context-type="document_chat"' +
        (documentId ? ' data-lana-document-id="' + esc(documentId) + '"' : '') +
        ' data-lana-document-name="' + esc(documentName) + '"' +
        (matterId ? ' data-lana-matter-id="' + esc(matterId) + '"' : '') +
        (matterName ? ' data-lana-matter-name="' + esc(matterName) + '"' : '') +
        ' data-lana-prefill="' + esc(officeReviewChangeLanaPrompt(change)) + '"' +
        ' data-lana-card-context="' + esc(JSON.stringify(context)) + '">' +
        '<span class="lex-card-lana-icon" aria-hidden="true">' +
          '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M0 0L8 0M0 0L0 8"/></svg>' +
          '<svg width="8" height="8" viewBox="0 0 8 8"><path d="M8 8L0 8M8 8L8 0"/></svg>' +
        '</span>' +
        '<span>Talk about this.</span>' +
      '</button>' +
    '</div>';
  }

  function reviewChangeTimestamp(change) {
    var time = change && (change.updatedAt || change.updated_at || change.createdAt || change.created_at || change.date || change.time);
    var parsed = time ? Date.parse(time) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function sortReviewChangesByNewest(changes) {
    return (Array.isArray(changes) ? changes.slice() : []).sort(function (a, b) {
      return reviewChangeTimestamp(b) - reviewChangeTimestamp(a);
    });
  }

  function sortReviewItemsByOldest(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      return reviewChangeTimestamp(a) - reviewChangeTimestamp(b);
    });
  }

  function sortReviewItemsByNewest(items) {
    return (Array.isArray(items) ? items.slice() : []).sort(function (a, b) {
      return reviewChangeTimestamp(b) - reviewChangeTimestamp(a);
    });
  }

  function renderDocFileInfoRail(file, options) {
    var metadata = officeFileMetadata(file);
    var mode = fileInfoMode === 'edit' ? 'edit' : 'view';
    var mimeType = officeFileMimeType(file);
    var docType = officeDocumentType(file);
    var stats = file && file.kind === 'doc' && !isServerReviewFile(file) && writerTools()
      ? writerTools().getDocumentStats(file.content || '')
      : null;
    var summaryGenerated = file.summaryGeneratedAt || file.summary_generated_at || file.lastSavedAt || file.updatedAt;
    var lifecycle = isServerReviewFile(file)
      ? (file.lifecycleStatus || file.lifecycle_status || 'Server managed')
      : (docAutosavePending(file) ? 'Autosaving' : 'Local draft');
    var viewHtml =
      '<section class="office-file-info-fields">' +
      '<div><label>Document Type</label><p>' + esc(formatDocumentType(docType) || formatMimeType(mimeType)) + '</p></div>' +
      '<div><label>Tags</label><div class="office-file-info-tags">' + renderTagPills(metadata.tags) + '</div></div>' +
      '<div><label>Notes</label><p>' + esc(metadata.notes || 'No notes') + '</p></div>' +
      '<div class="office-file-info-summary"><label>' + toolbarIcon('file-text', 'Summary') + '<span>AI Summary</span></label>' +
      '<div class="office-file-info-summary-text">' + esc(officeAiSummary(file)) + '</div>' +
      '<p class="office-file-info-generated">Generated ' + esc(formatTimestamp(summaryGenerated)) + '</p></div>' +
      '</section>';
    var editHtml =
      '<section class="office-file-info-fields office-file-info-edit">' +
      '<label><span>Document Type</span><select id="officeMetaDocType">' +
      '<option value="contract"' + (docType === 'contract' ? ' selected' : '') + '>Contract</option>' +
      '<option value="affidavit"' + (docType === 'affidavit' ? ' selected' : '') + '>Affidavit</option>' +
      '<option value="pleading"' + (docType === 'pleading' ? ' selected' : '') + '>Pleading</option>' +
      '<option value="spreadsheet"' + (docType === 'spreadsheet' ? ' selected' : '') + '>Spreadsheet</option>' +
      '<option value="presentation"' + (docType === 'presentation' ? ' selected' : '') + '>Presentation</option>' +
      '<option value="other"' + (docType === 'other' ? ' selected' : '') + '>Other</option>' +
      '</select></label>' +
      '<label><span>Tags</span><input id="officeMetaTags" type="text" value="' + esc(metadata.tags || '') + '" placeholder="contract, nda, review"></label>' +
      '<label><span>Notes</span><textarea id="officeMetaNotes" rows="5" placeholder="Add file notes">' + esc(metadata.notes || '') + '</textarea></label>' +
      '<div class="office-file-info-actions"><button type="button" data-action="set-file-info-mode" data-file-info-mode="view">Cancel</button>' +
      '<button type="button" data-action="save-file-info">Save metadata</button></div>' +
      '</section>';
    var reviewState = isServerReviewFile(file) ? serverReview(file) : null;
    var workflowNotice = reviewState && reviewState.pendingReleaseBatch
      ? '<section class="office-file-info-workflow-notice" role="status"><strong>Release pending approval</strong>' +
        '<p>Editing continues in a new draft. Another release request is unavailable until this approval is resolved.</p></section>'
      : '';
    var detailsHtml = workflowNotice +
      '<div class="office-file-info-subhead"><h3>File Metadata</h3><div class="office-file-info-toggle" role="tablist" aria-label="File metadata mode">' +
      '<button class="' + (mode === 'view' ? 'is-active' : '') + '" type="button" data-action="set-file-info-mode" data-file-info-mode="view">View</button>' +
      '<button class="' + (mode === 'edit' ? 'is-active' : '') + '" type="button" data-action="set-file-info-mode" data-file-info-mode="edit">Edit</button></div></div>' +
      '<div class="office-file-info-body">' +
      '<section class="office-file-info-card">' +
      '<div><span>' + toolbarIcon('database', 'Size') + '<strong>Size</strong></span><b>' + esc(formatFileSize(officeFileSize(file))) + '</b></div>' +
      '<div><span>' + toolbarIcon('calendar-days', 'Uploaded') + '<strong>Uploaded</strong></span><b>' + esc(formatTimestamp(file.createdAt || file.updatedAt)) + '</b></div>' +
      '<div><span>' + toolbarIcon('archive', 'Chunks') + '<strong>Chunks</strong></span><b>' + esc(officeChunkCount(file)) + '</b></div>' +
      '<div><span>' + toolbarIcon('check', 'Lifecycle') + '<strong>Lifecycle</strong></span><b class="office-file-info-badge">' + esc(lifecycle) + '</b></div>' +
      '</section>' +
      (mode === 'edit' ? editHtml : viewHtml) +
      (stats ? '<section class="office-file-info-stats"><span>' + esc(stats.words) + ' words</span><span>' + esc(stats.characters) + ' characters</span><span>' + esc(stats.tokens) + ' tokens</span></section>' : '') +
      '</div>';
    if (options && options.drawer) {
      return '<div class="office-file-info-drawer-content">' + detailsHtml + '</div>';
    }
    return '<aside class="office-file-info-rail" role="complementary" aria-labelledby="officeFileInfoTitle" tabindex="-1">' +
      '<div class="office-review-rail-card">' +
      '<header class="office-file-info-header"><div><h2 id="officeFileInfoTitle">File Info</h2><p>' + esc(file.title || 'Office file') + '</p></div>' +
      '<button type="button" data-action="close-file-info" title="Close file info" aria-label="Close file info">' + toolbarIcon('x', 'Close') + '</button></header>' +
      detailsHtml + '</div></aside>';
  }

  function activeFileInfoDrawer() {
    return document.querySelector('lex-drawer[data-file-editor-info="true"]');
  }

  function refreshFileInfoDrawer(file) {
    var drawer = activeFileInfoDrawer();
    if (!drawer || !file) return false;
    var slot = drawer.querySelector('.lex-drawer-body slot-content');
    if (!slot) return false;
    slot.innerHTML = renderDocFileInfoRail(file, { drawer: true });
    hydrateIcons(slot);
    return true;
  }

  function openFileInfoDrawer(file) {
    if (!file) return;
    var existing = activeFileInfoDrawer();
    if (existing) {
      if (typeof existing.focus === 'function') existing.focus();
      return;
    }
    if (!window.Lex || !Lex.Drawer || typeof Lex.Drawer.open !== 'function') {
      rightRailMode = 'file-info';
      renderReviewDock(file);
      return;
    }
    rightRailMode = 'review';
    renderReviewDock(file);
    var drawer = Lex.Drawer.open({
      heading: 'File Info',
      subtitle: file.filename || file.title || 'Office file',
      side: 'right',
      width: 'md',
      closeOnOverlay: true,
      content: renderDocFileInfoRail(file, { drawer: true })
    });
    drawer.dataset.fileEditorInfo = 'true';
    hydrateIcons(drawer);
  }

  async function saveServerFileMetadata(file, metadata) {
    if (!isServerWorkflowFile(file) || !window.api || typeof window.api.patch !== 'function') {
      throw new Error('Server metadata is unavailable for this document.');
    }
    var documentId = officeRealDocumentId(file);
    var response = await window.api.patch('/api/v1/storage/files/' + encodeURIComponent(documentId) + '/metadata', metadata);
    if (!response || (response.success !== true && response.status !== 'success')) {
      throw new Error((response && (response.error || response.detail || response.message)) || 'Metadata could not be saved.');
    }
    file.metadata = Object.assign({}, officeFileMetadata(file), metadata);
    file.updatedAt = nowIso();
    return response;
  }

  function renderDocReviewRail(file) {
    var review = docReviewModel(file);
    var tab = reviewRailTab === 'versions' || reviewRailTab === 'comments' ? reviewRailTab : 'changes';
    var pendingApprovalChanges = sortReviewChangesByNewest(review.changes.filter(function (change) {
      return change && change.serverSection === 'pending-approval';
    }));
    var pendingChanges = sortReviewChangesByNewest(review.changes.filter(function (change) {
      return changeIsPending(change) && (!change.serverSection || change.serverSection !== 'pending-approval');
    }));
    var releasedChanges = sortReviewChangesByNewest(review.changes.filter(function (change) {
      return !changeIsComment(change) && changeIsReleased(change);
    }));
    var serverFile = isServerReviewFile(file);
    var serverState = serverFile ? serverReview(file) : null;
    var canReleaseVersion = serverFile
      ? Boolean(serverState && !serverState.releasing && !serverState.embedFailed && !serverState.pendingReleaseBatch &&
          serverState.loaded && !serverState.loadFailed && !serverState.draftDetailFailed && !serverState.restoreFailed &&
          (pendingChanges.length || (serverState.currentDraftBatch && serverState.currentDraftBatch.id)))
      : docHasActiveSavedDraft(file);
    var hasPendingApproval = Boolean(serverState && serverState.pendingReleaseBatch);
    var pendingApprovalAction = pendingReleaseButtonAction(serverState);
    var pendingApprovalLabel = pendingReleaseButtonLabel(serverState);
    var isRequestingRelease = Boolean(serverState && serverState.releasing);
    var refreshButton = el('officeReviewRefreshButton');
    if (refreshButton) {
      refreshButton.hidden = !hasPendingApproval;
      refreshButton.disabled = false;
      refreshButton.setAttribute('aria-disabled', 'false');
      refreshButton.title = hasPendingApproval ? 'Refresh the current release approval status' : '';
    }
    var releaseButton = el('officeReviewReleaseButton');
    if (releaseButton) {
      var releaseButtonEnabled = !isRequestingRelease && (hasPendingApproval || canReleaseVersion);
      releaseButton.dataset.action = hasPendingApproval ? pendingApprovalAction : 'release-review-version';
      releaseButton.disabled = !releaseButtonEnabled;
      releaseButton.setAttribute('aria-disabled', releaseButtonEnabled ? 'false' : 'true');
      releaseButton.title = hasPendingApproval
        ? (pendingApprovalAction === 'retry-release-approval'
          ? 'Restart the expired or closed approval request'
          : pendingApprovalAction === 'complete-approved-release'
            ? 'Create the immutable version authorized by this approval'
            : 'Open pending approval')
        : 'Release this version';
      releaseButton.textContent = isRequestingRelease
        ? 'Requesting Release...'
        : hasPendingApproval
          ? pendingApprovalLabel
          : 'Release Version';
    }
    var versions = review.versions.length ? review.versions : [{
      title: 'Current draft',
      meta: 'Saved locally',
      status: 'Draft shell',
      tone: 'draft'
    }];
    var renderChangeHistoryRow = function (change) {
      var status = change.status || 'Pending';
      var before = change.before || (change.isInsertion ? 'no previous text' : 'previous draft text');
      var after = change.after || change.body || (change.isDeletion ? 'text removed' : 'Captured local edit');
      var canRevert = changeIsPending(change) && Number.isFinite(Number(change.sourceIndex)) &&
        change.serverSection !== 'pending-approval';
      var revisionIds = Array.isArray(change.revisionIds) ? change.revisionIds.filter(Boolean) : [];
      var actionButtons = revisionIds.length
        ? '<button type="button" data-action="locate-review-change" data-review-revision-ids="' + esc(revisionIds.join(',')) + '">Locate</button>'
        : '';
      if (canRevert) {
        if (serverFile && change.serverChange && serverState && documentReviewService() &&
            documentReviewService().canEditDraftReviewChange(change.serverChange, serverState.liveReviewState)) {
          actionButtons += '<button type="button" data-action="edit-review-change" data-review-change-index="' + esc(change.sourceIndex) + '">Edit</button>';
        }
        actionButtons += '<button type="button" data-action="revert-review-change" data-review-change-index="' + esc(change.sourceIndex) + '">Revert</button>';
      }
      var actions = actionButtons
        ? '<span class="office-review-history-row-actions">' + actionButtons + '</span>'
        : '';
      var batchItems = sortReviewItemsByNewest(Array.isArray(change.items) ? change.items.filter(Boolean) : []);
      var diffHtml = batchItems.length
        ? batchItems.map(function (item, itemIndex) {
          return '<div class="office-review-diff-item"><span class="office-review-diff-label">' + esc((itemIndex + 1) + '. ' + (item.type || 'Edit')) + '</span>' +
            '<span class="office-review-diff-remove">- ' + esc(item.before || 'no previous text') + '</span>' +
            '<span class="office-review-diff-add">+ ' + esc(item.after || item.text || 'text removed') + '</span></div>';
        }).join('')
        : (change.isInsertion ? '' : '<span class="office-review-diff-remove">- ' + esc(before) + '</span>') +
          (change.isDeletion ? '' : '<span class="office-review-diff-add">+ ' + esc(after) + '</span>');
      var rowClass = 'office-review-history-row' + (batchItems.length ? ' office-review-history-row--batch' : '');
      return '<div class="' + rowClass + '">' +
        '<div class="office-review-history-row-heading"><span class="office-review-history-row-title">' + esc(change.title || 'Replacement') + '</span>' +
        '<span class="office-review-status office-review-status--' + (change.tone || 'draft') + '">' + esc(status) + '</span>' + actions + '</div>' +
        '<div class="office-review-diff">' + diffHtml + '</div>' +
        officeReviewChangeLanaButton(file, change) + '</div>';
    };
    var pendingChangesHtml = pendingChanges.map(renderChangeHistoryRow).join('');
    var pendingApprovalChangesHtml = pendingApprovalChanges.map(renderChangeHistoryRow).join('');
    var releasedChangesHtml = releasedChanges.map(renderChangeHistoryRow).join('');
    var releasedHistoryVersions = versions.filter(function (version) {
      return reviewTone(version.status) === 'release';
    });
    var unreleasedHtml = pendingChanges.length
      ? '<section class="office-review-history-group office-review-history-group--unreleased">' +
        '<header class="office-review-history-header"><h5>' + esc(hasPendingApproval ? 'New draft' : 'Unreleased') + '</h5><span>' + esc(pendingChanges.length) + ' change' + (pendingChanges.length === 1 ? '' : 's') + '</span></header>' +
        '<div class="office-review-history-rows">' + pendingChangesHtml + '</div></section>'
      : '';
    var pendingApprovalHtml = pendingApprovalChanges.length
      ? '<section class="office-review-history-group office-review-history-group--pending-approval">' +
        '<header class="office-review-history-header"><h5>Pending approval</h5><span>' + esc(pendingApprovalChanges.length) + ' change' + (pendingApprovalChanges.length === 1 ? '' : 's') + '</span></header>' +
        '<div class="office-review-history-rows">' + pendingApprovalChangesHtml + '</div></section>'
      : '';
    var releasedChangesHistoryHtml = releasedChanges.length
      ? '<section class="office-review-history-group">' +
        '<header class="office-review-history-header"><h5>Released changes</h5><span>' + esc(releasedChanges.length) + ' change' + (releasedChanges.length === 1 ? '' : 's') + '</span></header>' +
        '<div class="office-review-history-rows">' + releasedChangesHtml + '</div></section>'
      : '';
    var releasedHistoryHtml = releasedHistoryVersions.map(function (version) {
      return '<section class="office-review-history-group">' +
        '<header class="office-review-history-header"><h5>' + esc(version.title) + '</h5><span>1 change</span></header>' +
        '<div class="office-review-history-rows"><div class="office-review-history-row"><div class="office-review-history-row-heading"><span class="office-review-history-row-title">Version released</span><span class="office-review-status office-review-status--' + (version.tone || 'release') + '">' + esc(version.status || 'Released') + '</span></div><div class="office-review-diff"><span class="office-review-diff-add">+ ' + esc(version.meta || 'Released version') + '</span></div></div></div></section>';
    }).join('');
    var changeHistoryHtml = unreleasedHtml + pendingApprovalHtml + releasedChangesHistoryHtml + releasedHistoryHtml;
    var commentItems = serverFile
      ? serverReviewComments(file)
      : (file.reviewChanges || []).filter(function (change) {
          return String(change.type || '').toLowerCase() === 'comment';
        });
    var commentsHtml = commentItems.length
      ? commentItems.map(function (comment) {
        var status = String(comment.status || 'open').toLowerCase() === 'resolved' ? 'Resolved' : 'Open';
        var scope = comment.scope === 'selection' && comment.anchor_text
          ? 'Selection: “' + comment.anchor_text + '”'
          : 'Document comment';
        var replies = Array.isArray(comment.replies) ? comment.replies : [];
        var repliesHtml = replies.map(function (reply) {
          return '<div class="office-review-comment-reply" data-comment-reply-id="' + esc(reply.id || '') + '">' +
            '<div class="office-review-comment-meta"><strong>' + esc(reply.author || 'Reviewer') + '</strong><span>' + esc(formatTimestamp(commentTimestamp(reply))) + '</span></div>' +
            '<div class="office-review-comment-text">' + esc(reply.text || '') + '</div></div>';
        }).join('');
        var locateAction = comment.scope === 'selection' && comment.anchor_text
          ? '<button type="button" data-action="locate-review-comment" data-comment-id="' + esc(comment.id || '') + '">Locate</button>'
          : '';
        var serverActions = serverFile
          ? '<div class="office-review-comment-actions">' + locateAction +
            '<button type="button" data-action="reply-review-comment" data-comment-id="' + esc(comment.id || '') + '">Reply</button>' +
            '<button type="button" data-action="' + (status === 'Resolved' ? 'reopen-review-comment' : 'resolve-review-comment') + '" data-comment-id="' + esc(comment.id || '') + '">' + (status === 'Resolved' ? 'Reopen' : 'Resolve') + '</button></div>'
          : '';
        return '<article class="office-review-history-row office-review-comment-thread" data-comment-thread-id="' + esc(comment.id || '') + '" data-comment-status="' + esc(status.toLowerCase()) + '">' +
          '<div class="office-review-history-row-heading"><span class="office-review-history-row-title">Comment</span>' +
          '<span class="office-review-status office-review-status--' + (status === 'Resolved' ? 'release' : 'draft') + '">' + esc(status) + '</span></div>' +
          '<div class="office-review-comment-meta"><strong>' + esc(comment.author || 'Reviewer') + '</strong><span>' + esc(formatTimestamp(commentTimestamp(comment))) + '</span></div>' +
          '<div class="office-review-comment-scope">' + esc(scope) + '</div>' +
          '<div class="office-review-comment-text">' + esc(comment.text || '') + '</div>' +
          (repliesHtml ? '<div class="office-review-comment-replies">' + repliesHtml + '</div>' : '') +
          serverActions + '</article>';
      }).join('')
      : '<div class="office-review-empty"><h5>No comments yet</h5><p>Add a document-level review comment.</p></div>';
    var bodyHtml = tab === 'versions'
      ? versions.map(function (version) {
        return '<section class="office-review-history-group"><header class="office-review-history-header"><h5>' + esc(version.title) + '</h5><span>' + esc(version.status || 'Draft') + '</span></header>' +
          '<div class="office-review-history-rows"><div class="office-review-history-row"><div class="office-review-diff"><span class="office-review-diff-add">+ ' + esc(version.meta || 'Saved version') + '</span></div></div></div></section>';
      }).join('')
      : tab === 'comments'
        ? '<section class="office-review-comments-panel"><button type="button" data-action="dock-comment"' +
          '>' +
          toolbarIcon('message-square-plus', 'Com') + '<span>Add comment</span></button><div class="office-review-history-rows">' + commentsHtml + '</div></section>'
        : changeHistoryHtml;
    return '<aside class="office-review-rail" aria-label="Review rail">' +
      '<div class="office-review-rail-card">' +
      '<header class="office-review-rail-header"><div><h2>' + icon('file-text') + '<span>Review</span></h2>' +
      '<p>Review / Redline active</p></div></header>' +
      '<div class="office-review-tabs" role="tablist" aria-label="Review views">' +
      '<button role="tab" aria-selected="' + (tab === 'changes' ? 'true' : 'false') + '" class="' + (tab === 'changes' ? 'is-active' : '') + '" type="button" data-action="set-review-tab" data-review-tab="changes">Change History</button>' +
      '<button role="tab" aria-selected="' + (tab === 'versions' ? 'true' : 'false') + '" class="' + (tab === 'versions' ? 'is-active' : '') + '" type="button" data-action="set-review-tab" data-review-tab="versions">Versions</button>' +
      '<button role="tab" aria-selected="' + (tab === 'comments' ? 'true' : 'false') + '" class="' + (tab === 'comments' ? 'is-active' : '') + '" type="button" data-action="set-review-tab" data-review-tab="comments">Comments</button></div>' +
      '<div class="office-review-history">' + bodyHtml + '</div>' +
      '</div></aside>';
  }

  function createFile(kind) {
    var file = {
      id: makeId(kind),
      kind: kind,
      title: kind === 'doc' ? 'Untitled Document' : kind === 'sheet' ? 'Untitled Sheet' : 'Untitled Deck',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastSavedAt: nowIso(),
      aiDrafts: 0,
      signers: [],
      activities: ['Created in LANA Document Library.']
    };

    if (kind === 'doc') {
      file.content = '<h2>Untitled Document</h2><p>Start drafting here.</p>';
      file.marginPreset = 'normal';
      file.reviewChanges = [{ type: 'Draft', status: 'Open', text: 'Initial local draft created.' }];
      file.versions = [
        { label: 'Original', status: 'Base', time: 'Created locally' },
        { label: 'Current draft', status: 'Draft', time: 'Updated just now' }
      ];
    } else if (kind === 'sheet') {
      file.cells = [
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', ''],
        ['', '', '', '']
      ];
    } else {
      file.slides = [{ title: 'Untitled Slide', body: 'Add slide copy.', notes: '' }];
    }

    state.files.unshift(file);
    state.activeId = file.id;
    saveState();
    renderAll();
  }

  function officeFooterStats(file) {
    if (!file || (file.kind !== 'sheet' && file.kind !== 'deck')) return null;
    if (file.kind === 'sheet') {
      var rows = Array.isArray(file.cells) ? file.cells : [];
      var columns = rows.reduce(function (max, row) { return Math.max(max, Array.isArray(row) ? row.length : 0); }, 0);
      var populated = 0;
      var formulas = 0;
      rows.forEach(function (row) {
        (Array.isArray(row) ? row : []).forEach(function (cell) {
          var value = String(cell === undefined || cell === null ? '' : cell);
          if (value !== '') populated += 1;
          if (value.charAt(0) === '=') formulas += 1;
        });
      });
      return ['Rows ' + rows.length, 'Columns ' + columns, 'Cells ' + populated, 'Formulas ' + formulas];
    }
    var slides = Array.isArray(file.slides) ? file.slides : [];
    var text = slides.map(function (slide) { return [slide.title, slide.body, slide.notes].join(' '); }).join(' ').trim();
    var words = text ? text.split(/\s+/).length : 0;
    var notes = slides.filter(function (slide) { return String(slide.notes || '').trim(); }).length;
    return ['Slides ' + slides.length, 'Words ' + words, 'Characters ' + text.length, 'Notes ' + notes];
  }

  function renderChrome() {
    var file = activeFile();
    if (!file) return;

    var titleInput = el('officeFileTitle');
    var meta = el('officeFileMeta');
    if (titleInput && titleInput.value !== file.title) titleInput.value = file.title || '';
    var officeEdit = ensureOfficeEdit(file);
    if (titleInput) titleInput.disabled = Boolean(officeEdit && (officeEdit.loading || officeEdit.saving || officeEdit.error));
    var saveButton = document.querySelector('[data-action="save"]');
    if (saveButton) saveButton.disabled = Boolean(officeEdit && (officeEdit.loading || officeEdit.saving || officeEdit.error));
    if (meta) {
      meta.textContent = KIND_LABELS[file.kind] + ' - Updated ' + formatTime(file.updatedAt) + ' - ' + savedStatusLabel(file);
    }
    var infoButton = document.querySelector('.office-editor-bar [data-action="show-review-details"]');
    if (infoButton) {
      var infoTitle = isServerReviewFile(file) && serverReview(file) && serverReview(file).pendingReleaseBatch
        ? 'Release pending approval. Editing continues in a new draft; only another release request is unavailable until this approval is resolved.'
        : 'Open file info';
      infoButton.title = infoTitle;
      infoButton.setAttribute('aria-label', infoTitle);
    }

    var totalDrafts = 0;
    var packets = 0;
    for (var i = 0; i < state.files.length; i += 1) {
      totalDrafts += Number(state.files[i].aiDrafts || 0);
      if (state.files[i].signers && state.files[i].signers.length) packets += 1;
    }

    if (el('officeStatFiles')) el('officeStatFiles').textContent = String(state.files.length);
    var remote = remoteWorkflowForFile(file);
    if (el('officeStatCollaborators')) {
      el('officeStatCollaborators').textContent = remote && remote.loaded ? String(remote.collaborators.length) : '—';
    }
    if (el('officeStatPackets')) el('officeStatPackets').textContent = String(packets);
    if (el('officeStatDrafts')) el('officeStatDrafts').textContent = String(totalDrafts);
    if (remote && remote.loaded) {
      if (el('officeStatPackets')) el('officeStatPackets').textContent = String(remote.signaturePackets.length);
      if (el('officeStatDrafts')) {
        var review = serverReview(file);
        el('officeStatDrafts').textContent = String(review && review.currentDraftBatch ? 1 : 0);
      }
    }
    if (el('officeSaveStatus')) el('officeSaveStatus').textContent = savedStatusLabel(file);
    var stats = officeEditorDocumentStats[file.id] || null;
    if (stats) {
      setOfficeDocumentFooterStats(stats);
    } else {
      var officeStats = officeFooterStats(file);
      if (officeStats) {
        if (el('officePageCount')) el('officePageCount').textContent = officeStats[0];
        if (el('officeWordCount')) el('officeWordCount').textContent = officeStats[1];
        if (el('officeCharacterCount')) el('officeCharacterCount').textContent = officeStats[2];
        if (el('officeTokenCount')) el('officeTokenCount').textContent = officeStats[3];
        if (el('officeParagraphCount')) el('officeParagraphCount').hidden = true;
        if (el('officeReadingTime')) el('officeReadingTime').hidden = true;
      }
    }
  }

  function renderFileList() {
    var list = el('officeFileList');
    var search = el('officeSearch');
    if (!list) return;
    var term = search ? search.value.trim().toLowerCase() : '';
    var html = '';

    for (var i = 0; i < state.files.length; i += 1) {
      var file = state.files[i];
      if (activeFilter !== 'all' && file.kind !== activeFilter) continue;
      if (term && String(file.title || '').toLowerCase().indexOf(term) === -1) continue;
      var active = file.id === state.activeId ? ' is-active' : '';
      html += '<button class="office-file-item' + active + '" type="button" data-file-id="' + esc(file.id) + '">' +
        '<span class="office-file-icon">' + icon(KIND_ICONS[file.kind]) + '</span>' +
        '<span><span class="office-file-title">' + esc(file.title) + '</span>' +
        '<span class="office-file-subtitle">' + esc(KIND_LABELS[file.kind]) + ' - ' + esc(savedStatusLabel(file)) + '</span>' +
        docReviewSummary(file) + '</span>' +
        '</button>';
    }

    list.innerHTML = html || '<div class="office-section-card"><h2>No files found</h2><p class="office-file-subtitle">Try another search or create a new file.</p></div>';
  }

  function renderEditor() {
    var file = activeFile();
    var panel = el('officeEditorPanel');
    var contextToolbar = el('officeContextToolbarHost');
    if (!file || !panel) {
      if (contextToolbar) contextToolbar.innerHTML = '';
      renderReviewDock(null);
      if (panel) {
        var emptyTitle = editorRouteLoading ? 'Loading document...' : (editorLoadError ? 'Document unavailable' : 'Open a document to edit');
        var emptyBody = editorRouteLoading
          ? 'Fetching the latest document metadata and review workflow from the server.'
          : (editorLoadError || 'File Editor opens server documents from File Viewer or Document Library.');
        panel.innerHTML = '<div class="' + (editorLoadError ? 'file-editor-error-state' : 'file-editor-empty-state') + '">' +
          '<h2>' + esc(emptyTitle) + '</h2>' +
          '<p>' + esc(emptyBody) + '</p>' +
          '<div class="file-editor-state-actions">' +
            (editorLoadError ? '<button class="office-btn" type="button" data-action="retry-editor-route">Retry</button>' : '') +
            '<button class="office-btn" type="button" data-action="back-to-viewer">Return</button>' +
          '</div></div>';
      }
      return;
    }
    if (file.kind !== 'doc' && contextToolbar) contextToolbar.innerHTML = '';
    renderReviewDock(file);
    if (isServerOfficeFile(file)) {
      var officeEdit = ensureOfficeEdit(file);
      if (officeEdit.loading || !officeEdit.loaded || officeEdit.error) {
        var officeTitle = officeEdit.loading ? 'Loading Office file...' : (officeEdit.error ? 'Office file unavailable' : 'Preparing Office editor...');
        var officeBody = officeEdit.loading
          ? 'Fetching the editable model from the server.'
          : (officeEdit.error || 'The editable model has not loaded yet.');
        panel.innerHTML = '<div class="' + (officeEdit.error ? 'file-editor-error-state' : 'file-editor-empty-state') + '">' +
          '<h2>' + esc(officeTitle) + '</h2><p>' + esc(officeBody) + '</p>' +
          (officeEdit.error ? '<div class="file-editor-state-actions"><button class="office-btn" type="button" data-action="retry-office-model">Retry</button></div>' : '') +
          '</div>';
        return;
      }
    }
    if (file.kind === 'doc') renderDoc(file, panel);
    if (file.kind === 'sheet') {
      if (el('officeEditorEngineStatus')) el('officeEditorEngineStatus').textContent = 'LANA Sheet Editor';
      renderSheet(file, panel);
    }
    if (file.kind === 'deck') {
      if (el('officeEditorEngineStatus')) el('officeEditorEngineStatus').textContent = 'LANA Slide Editor';
      renderDeck(file, panel);
    }
  }

  function renderReviewDock(file) {
    var workspace = document.querySelector('.office-workspace');
    var host = el('officeReviewRailHost');
    var show = !!(file && (rightRailMode === 'file-info' || (activePanel === 'editor' && file.kind === 'doc')));
    var footerAction = el('officeReviewFooterAction');
    if (footerAction) footerAction.hidden = !(show && rightRailMode !== 'file-info');
    syncLanaDockContext(file);
    if (workspace) workspace.classList.toggle('has-review-dock', show);
    if (!host) return;
    host.classList.toggle('is-hidden', !show);
    host.innerHTML = show ? (rightRailMode === 'file-info' ? renderDocFileInfoRail(file) : renderDocReviewRail(file)) : '';
  }

  function syncLanaDockContext(file) {
    var dock = document.querySelector('lex-lana-dock');
    if (!dock || typeof dock.setPageContext !== 'function') return;
    if (!file) {
      dock.setPageContext(null);
      return;
    }
    dock.setPageContext({
      documentId: officeRealDocumentId(file) || null,
      documentName: file.filename || file.title || 'Office file',
      matterId: officeConversationMatterId(file) || null,
      matterName: file.matterName || null
    });
  }

  function applyOfficeTrackedChangesDisplay(file) {
    var host = el('officeLanaEditorHost');
    if (!host) return;
    var comparisonMode = officeTrackedChangesMode(file);
    var canShow = comparisonMode !== 'none';
    var active = canShow && file && file.showChanges !== false;
    host.classList.toggle('office-lana-editor-host--final', Boolean(!canShow || (file && file.showChanges === false)));
    host.classList.toggle('office-lana-editor-host--release-compare', Boolean(active && comparisonMode === 'release'));
    host.classList.toggle('office-lana-editor-host--draft-compare', Boolean(active && comparisonMode === 'draft'));
  }

  function officeHasUnreleasedChanges(file) {
    if (!file || file.kind !== 'doc') return false;
    if (isServerReviewFile(file)) {
      var review = serverReview(file);
      if (!review) return false;
      // Persisted rows are not a usable visual comparison until they have
      // been reconstructed into this editor DOM. On a load/restore failure,
      // keep Show Changes disabled instead of advertising changes that the
      // document cannot locate or render.
      if (review.loadFailed || review.draftDetailFailed || review.restoreFailed) return false;
      if (review.session && review.liveReviewState && typeof review.session.unreleasedRevisions === 'function') {
        try {
          if (review.session.unreleasedRevisions(review.liveReviewState).length > 0) return true;
        } catch (_) {}
      }
      return Boolean(
        review.currentDraftBatch
        && Array.isArray(review.currentDraftBatch.changes)
        && review.currentDraftBatch.changes.length
      );
    }
    return pendingDocReviewChanges(file).length > 0 || docHasUnsavedDraftChanges(file);
  }

  function officeHasReleaseComparison(file) {
    if (!isServerReviewFile(file)) return false;
    var review = serverReview(file);
    return Boolean(review && officeReleaseDeltaRevisionIds(file).length);
  }

  function officeReleaseDeltaRevisionIds(file) {
    var review = serverReview(file);
    var service = documentReviewService();
    if (!review || !service || typeof service.revisionIdsForReviewChange !== 'function') return [];
    var releaseId = String(file && file.editorBaselineReleaseId || '');
    var releasedDocumentId = String(file && file.releasedDocumentId || '');
    var ids = [];
    (review.releaseChangeGroups || []).forEach(function (group) {
      var release = group && group.release ? group.release : {};
      var matchesRelease = releaseId && String(release.id || '') === releaseId;
      var matchesDocument = releasedDocumentId && String(release.released_document_id || '') === releasedDocumentId;
      if (!matchesRelease && !matchesDocument) return;
      (group.changes || []).forEach(function (change) {
        service.revisionIdsForReviewChange(change).forEach(function (id) {
          if (id !== null && id !== undefined && String(id)) ids.push(String(id));
        });
      });
    });
    var seen = {};
    return ids.filter(function (id) {
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function officeTrackedChangesMode(file) {
    if (officeHasUnreleasedChanges(file)) return 'draft';
    if (officeHasReleaseComparison(file)) return 'release';
    return 'none';
  }

  function officeShowChangesTitle(mode) {
    if (mode === 'release') return 'Show or hide this release against the previous release';
    if (mode === 'draft') return 'Show or hide unreleased changes against the previous release';
    return 'Available when this document has a release comparison or unreleased changes';
  }

  function officeChangesComparisonLabel(mode) {
    if (mode === 'release') return 'Current release vs previous release';
    if (mode === 'draft') return 'Unreleased vs last release';
    return '';
  }

  function syncOfficeShowChangesControl(file) {
    var button = document.querySelector('[data-action="toggle-show-changes"]');
    if (!button) return;
    var comparisonMode = officeTrackedChangesMode(file);
    var available = comparisonMode !== 'none';
    var active = available && file && file.showChanges !== false;
    button.disabled = !available;
    button.setAttribute('aria-disabled', available ? 'false' : 'true');
    button.classList.toggle('is-active', Boolean(active));
    button.title = officeShowChangesTitle(comparisonMode);
    var legend = el('officeChangesLegend');
    if (legend) {
      legend.hidden = !active;
      var comparison = legend.querySelector('[data-change-comparison]');
      if (comparison) comparison.textContent = officeChangesComparisonLabel(comparisonMode);
    }
    applyOfficeTrackedChangesDisplay(file);
  }

  function applyOfficeReviewFocusTags(file) {
    var host = el('officeLanaEditorHost');
    if (!host) return [];
    var ids = officeReviewFocus && officeReviewFocus.fileId === file.id
      ? officeReviewFocus.revisionIds
      : [];
    var wanted = {};
    ids.forEach(function (id) { wanted[String(id)] = true; });
    var matched = [];
    host.querySelectorAll('.le-rev[data-rev-id]').forEach(function (mark) {
      var focused = wanted[mark.getAttribute('data-rev-id')] === true;
      mark.classList.toggle('lee-rev-review-focus', focused);
      if (focused) matched.push(mark);
    });
    return matched;
  }

  function locateOfficeReviewChange(file, revisionIds) {
    if (!file || !Array.isArray(revisionIds) || !revisionIds.length) {
      toast('This history entry has no document location.');
      return;
    }
    file.showChanges = true;
    officeReviewFocus = { fileId: file.id, revisionIds: revisionIds.map(String) };
    syncOfficeShowChangesControl(file);
    var matched = applyOfficeReviewFocusTags(file);
    if (!matched.length) {
      toast('This change belongs to another released version. Open that version to locate it in the document.');
      return;
    }
    matched[0].scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    toast('Change located and highlighted in the document.');
  }

  // Tag the embed's revision marks that belong to the opened document's
  // baseline (redlines released in earlier versions, embedded in the document
  // bytes) so CSS always renders them as final, accepted text. "Show changes"
  // then only toggles the unreleased draft redlines; full cross-version
  // comparison stays in the File Viewer. Marks are re-tagged after every embed
  // render because each render rebuilds the page DOM.
  function applyOfficeBaselineRevisionTags(file) {
    var host = el('officeLanaEditorHost');
    if (!host) return;
    var review = serverReview(file);
    var baselineById = {};
    var releaseDeltaById = {};
    if (review && review.session && typeof review.session.baselineRevisionIds === 'function') {
      review.session.baselineRevisionIds().forEach(function (id) {
        baselineById[String(id)] = true;
      });
    }
    officeReleaseDeltaRevisionIds(file).forEach(function (id) {
      releaseDeltaById[String(id)] = true;
    });
    // A page-boundary split clones a mark onto the continuation page, so one
    // revision id can match several elements; tag (or clear) every one.
    host.querySelectorAll('.le-rev[data-rev-id]').forEach(function (mark) {
      var revisionId = mark.getAttribute('data-rev-id');
      mark.classList.toggle('lee-rev-baseline', baselineById[revisionId] === true);
      mark.classList.toggle('lee-rev-release-delta', releaseDeltaById[revisionId] === true);
    });
    applyOfficeReviewFocusTags(file);
  }

  function setOfficeDocumentFooterStats(stats) {
    var values = stats || {};
    var mappings = [
      ['officePageCount', 'Pages ' + (values.pages === undefined ? '\u2014' : values.pages)],
      ['officeWordCount', 'Words ' + (values.words === undefined ? '\u2014' : values.words)],
      ['officeCharacterCount', 'Characters ' + (values.characters === undefined ? '\u2014' : values.characters)],
      ['officeTokenCount', 'Tokens ' + (values.tokens === undefined ? '\u2014' : values.tokens)],
      ['officeParagraphCount', 'Paragraphs ' + (values.paragraphs === undefined ? '\u2014' : values.paragraphs)],
      ['officeReadingTime', 'Reading time ' + (values.readingMinutes === undefined ? '\u2014' : values.readingMinutes + ' min')]
    ];
    mappings.forEach(function (mapping) {
      var node = el(mapping[0]);
      if (!node) return;
      node.hidden = false;
      node.textContent = mapping[1];
    });
  }

  function updateOfficeEditorDocumentStats(file, renderCounts) {
    if (!file) return;
    var editor = editorForFile(file);
    var stats = null;
    if (editor && typeof editor.documentStats === 'function') {
      try { stats = editor.documentStats(); } catch (_) { stats = null; }
    }
    var host = el('officeLanaEditorHost');
    if (!stats && host) {
      var text = '';
      host.querySelectorAll('.le-t').forEach(function (run) {
        text += run.textContent || '';
      });
      var words = text.trim() ? (text.trim().match(/\S+/g) || []).length : 0;
      var paragraphs = renderCounts && Number.isFinite(Number(renderCounts.paragraphs))
        ? Number(renderCounts.paragraphs)
        : new Set(Array.prototype.map.call(host.querySelectorAll('[data-p]'), function (node) {
          return node.getAttribute('data-p');
        })).size;
      var pages = renderCounts && Number.isFinite(Number(renderCounts.pages))
        ? Number(renderCounts.pages)
        : host.querySelectorAll('.le-page--boxed').length;
      stats = {
        pages: pages || 1,
        words: words,
        characters: text.length,
        tokens: Math.ceil(text.length / 4),
        paragraphs: paragraphs,
        readingMinutes: words ? Math.max(1, Math.ceil(words / 200)) : 0
      };
    }
    stats = Object.assign({ pages: 1, words: 0, characters: 0, tokens: 0, paragraphs: 0, readingMinutes: 0 }, stats || {});
    officeEditorDocumentStats[file.id] = stats;
    var statsHost = el('officeDocStats');
    if (statsHost) {
      Object.keys(stats).forEach(function (key) {
        var value = statsHost.querySelector('[data-doc-stat="' + key + '"]');
        if (value) value.textContent = String(stats[key]);
      });
    }
    setOfficeDocumentFooterStats(stats);
  }

  function officeHistoryAvailability(file, editor) {
    if (!file || file.kind !== 'doc') return { undo: false, redo: false };
    if (!isServerReviewFile(file)) {
      return {
        undo: Boolean(Array.isArray(file.undoStack) && file.undoStack.length),
        redo: Boolean(Array.isArray(file.redoStack) && file.redoStack.length)
      };
    }
    var currentHost = el('officeLanaEditorHost');
    var activeEditor = editor || editorForFile(file);
    // renderDoc replaces the host before the async remount completes. Never
    // expose history from an instance still attached to the discarded host.
    if (!activeEditor || officeEditorHostEl !== currentHost) return { undo: false, redo: false };
    var reviewMode = true;
    if (typeof activeEditor.editorMode === 'function') {
      try { reviewMode = activeEditor.editorMode() === 'review'; } catch (_) { reviewMode = false; }
    }
    function available(capability, action) {
      if (!reviewMode || typeof activeEditor[action] !== 'function' || typeof activeEditor[capability] !== 'function') return false;
      try { return activeEditor[capability]() === true; } catch (_) { return false; }
    }
    return {
      undo: available('canUndo', 'undo'),
      redo: available('canRedo', 'redo')
    };
  }

  function syncOfficeHistoryControls(file, editor) {
    var current = activeFile();
    if (!file || !current || current.id !== file.id) return;
    var availability = officeHistoryAvailability(file, editor);
    ['undo', 'redo'].forEach(function (command) {
      document.querySelectorAll('.office-doc-toolbar [data-format="' + command + '"]').forEach(function (button) {
        var enabled = availability[command] === true;
        button.disabled = !enabled;
        button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      });
    });
  }

  function renderDoc(file, panel) {
    ensureReviewBaseline(file);
    if (el('officeEditorEngineStatus')) el('officeEditorEngineStatus').textContent = 'Loading LANA Editor...';
    file.content = cleanOfficeDocContent(file.content || '');
    if (!docPlainText(file.content || '').trim()) {
      file.content = officeHandoffFallbackContent(file);
      saveState();
    }
    var tools = writerTools();
    var stats = !isServerReviewFile(file) && tools ? tools.getDocumentStats(file.content || '') : null;
    var marginPreset = file.marginPreset === 'narrow' || file.marginPreset === 'wide' ? file.marginPreset : 'normal';
    var comparisonMode = officeTrackedChangesMode(file);
    var canShowChanges = comparisonMode !== 'none';
    var showChanges = canShowChanges && file.showChanges !== false;
    var docContent = renderDocContentWithReviewMarks(file);
    // Tracked documents edit through the LANA Editor embed. The prototype
    // toolbar is the product surface, so every control remains visible and
    // routes to a live embed operation.
    var embedManaged = isServerReviewFile(file);
    var embedBlockedAttrs = '';
    function ctrlTitle(title) {
      return ' title="' + title + '"';
    }
    var toolbarHtml =
      toolbarGroup('History',
        '<button type="button" data-command="undo" data-format="undo" title="Undo" disabled aria-disabled="true">' + toolbarIcon('undo-2', 'Undo') + '</button>' +
        '<button type="button" data-command="redo" data-format="redo" title="Redo" disabled aria-disabled="true">' + toolbarIcon('redo-2', 'Redo') + '</button>') +
      toolbarGroup('Style',
        '<select class="office-format-select" data-command="formatBlock" aria-label="Paragraph style"' + embedBlockedAttrs + '>' +
        '<option value="p">Normal</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option><option value="subheading">Subheading</option><option value="blockquote">Quote</option><option value="pre">Code</option><option value="caption">Caption</option><option value="footnote">Footnote</option></select>' +
        '<select class="office-format-select" data-command="fontName" aria-label="Font family"' + embedBlockedAttrs + '>' +
        '<option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Times New Roman">Times</option><option value="Courier New">Mono</option></select>' +
        '<select class="office-format-select office-format-select-narrow" data-command="fontSize" aria-label="Font size"' + embedBlockedAttrs + '>' +
        '<option value="2">Small</option><option value="3" selected>Body</option><option value="4">Large</option><option value="5">Title</option><option value="6">Hero</option></select>') +
      toolbarGroup('Marks',
        '<button type="button" data-command="bold" title="Bold">B</button>' +
        '<button type="button" data-command="italic" title="Italic">I</button>' +
        '<button type="button" data-command="underline" title="Underline">U</button>' +
        '<button type="button" data-command="strikeThrough"' + ctrlTitle('Strikethrough') + '>S</button>' +
        '<button type="button" data-command="superscript"' + ctrlTitle('Superscript') + '>x^2</button>' +
        '<button type="button" data-command="subscript"' + ctrlTitle('Subscript') + '>x_2</button>') +
      toolbarGroup('Color',
        '<label class="office-color-control" title="Text color"><span>A</span><input type="color" data-command="foreColor" value="#111111" aria-label="Text color"' + embedBlockedAttrs + '></label>' +
        '<label class="office-color-control" title="Highlight"><span>' + toolbarIcon('highlighter', 'HL') + '</span><input type="color" data-command="hiliteColor" value="#fff3a3" aria-label="Highlight color"' + embedBlockedAttrs + '></label>') +
      toolbarGroup('Lists',
        '<button type="button" data-command="insertUnorderedList"' + ctrlTitle('Bullets') + '>' + toolbarIcon('list', 'Bullets') + '</button>' +
        '<button type="button" data-command="insertOrderedList"' + ctrlTitle('Numbered list') + '>' + toolbarIcon('list-ordered', '1.') + '</button>' +
        '<button type="button" data-command="outdent"' + ctrlTitle('Outdent') + '>' + toolbarIcon('outdent', 'Out') + '</button>' +
        '<button type="button" data-command="indent"' + ctrlTitle('Indent') + '>' + toolbarIcon('indent', 'In') + '</button>') +
      toolbarGroup('Align',
        '<button type="button" data-command="justifyLeft"' + ctrlTitle('Align left') + '>' + toolbarIcon('align-left', 'Left') + '</button>' +
        '<button type="button" data-command="justifyCenter"' + ctrlTitle('Align center') + '>' + toolbarIcon('align-center', 'Ctr') + '</button>' +
        '<button type="button" data-command="justifyRight"' + ctrlTitle('Align right') + '>' + toolbarIcon('align-right', 'Right') + '</button>' +
        '<button type="button" data-command="justifyFull"' + ctrlTitle('Justify') + '>' + toolbarIcon('align-justify', 'Just') + '</button>') +
      toolbarGroup('Insert',
        '<button type="button" data-command="createLink"' + ctrlTitle('Insert link') + '>' + toolbarIcon('link', 'Link') + '</button>' +
        '<button type="button" data-command="unlink"' + ctrlTitle('Remove link') + '>' + toolbarIcon('unlink', 'Unlink') + '</button>' +
        '<button type="button" data-command="insertHorizontalRule"' + ctrlTitle('Horizontal rule') + '>' + toolbarIcon('minus', 'Rule') + '</button>' +
        '<button type="button" data-action="insert-template-variable" title="Insert variable" aria-label="Insert variable">' + toolbarIcon('braces', '{}') + '</button>' +
        '<button type="button" data-command="removeFormat"' + ctrlTitle('Clear formatting') + '>' + toolbarIcon('eraser', 'Clear') + '</button>');

    var marginActionsHtml =
      '<button class="' + (marginPreset === 'narrow' ? 'is-active' : '') + '" type="button" data-action="set-doc-margin" data-margin="narrow">Narrow</button>' +
        '<button class="' + (marginPreset === 'normal' ? 'is-active' : '') + '" type="button" data-action="set-doc-margin" data-margin="normal">Normal</button>' +
        '<button class="' + (marginPreset === 'wide' ? 'is-active' : '') + '" type="button" data-action="set-doc-margin" data-margin="wide">Wide</button>';
    if (embedManaged) stats = officeEditorDocumentStats[file.id] || null;
    stats = Object.assign({ pages: 1, words: 0, characters: 0, tokens: 0, paragraphs: 0, readingMinutes: 0 }, stats || {});
    officeEditorDocumentStats[file.id] = stats;
    var contextToolbar = el('officeContextToolbarHost');
    if (contextToolbar) {
      contextToolbar.innerHTML = '<div class="office-doc-toolbar" role="toolbar" aria-label="Text formatting">' + toolbarHtml + '</div>' +
        '<div class="office-doc-ruler office-doc-ruler-' + marginPreset + '" aria-label="Document margins">' +
        '<div class="office-ruler-actions">' + marginActionsHtml +
        '<button class="office-show-changes-toggle' + (showChanges ? ' is-active' : '') + '" type="button" data-action="toggle-show-changes"' +
          (canShowChanges ? ' aria-disabled="false" title="' + esc(officeShowChangesTitle(comparisonMode)) + '"' : ' disabled aria-disabled="true" title="' + esc(officeShowChangesTitle('none')) + '"') + '>' +
          toolbarIcon('circle-dot', 'Show changes') + '<span>Show changes</span></button>' +
        '<div id="officeChangesLegend" class="office-changes-legend"' + (showChanges ? '' : ' hidden') + '>' +
          '<span class="office-changes-comparison" data-change-comparison>' + esc(officeChangesComparisonLabel(comparisonMode)) + '</span>' +
          '<span class="office-change-key office-change-key--insert">Added</span>' +
          '<span class="office-change-key office-change-key--delete">Removed</span>' +
          '<span class="office-change-key office-change-key--format">Formatting</span>' +
        '</div></div>' +
        '<div class="office-ruler-track" aria-hidden="true"><span class="office-ruler-paper"></span><span class="office-ruler-margin office-ruler-margin-left"></span><span class="office-ruler-margin office-ruler-margin-right"></span></div></div>';
    }
    setOfficeDocumentFooterStats(stats);

    panel.innerHTML = '<div class="office-doc-canvas">' +
      '<div class="office-doc-frame office-margin-' + marginPreset + '"><div class="office-doc-main-row"><div class="office-doc-viewport"><div class="office-doc-stage">' +
      '<article id="officeDocPage" class="office-doc-page" contenteditable="' + (isServerReviewFile(file) ? 'false' : 'true') + '" spellcheck="true">' + docContent + '</article>' +
      '<div id="officeLanaEditorHost" class="office-lana-editor-host' + (showChanges ? '' : ' office-lana-editor-host--final') + '" hidden></div>' +
      '<div id="officeSelectionToolbar" class="office-selection-toolbar" hidden aria-label="Selection tools">' +
      '<button type="button" data-command="bold" title="Bold" aria-label="Bold">B</button>' +
      '<button type="button" data-command="italic" title="Italic" aria-label="Italic">I</button>' +
      '<button type="button" data-action="add-selection-comment" title="Comment" aria-label="Comment">' + toolbarIcon('message-square-plus', 'Comment') + '</button>' +
      '<button type="button" data-action="ask-lana-selection" title="Ask Lana" aria-label="Ask Lana">' + toolbarIcon('sparkles', 'Ask') + '</button>' +
      '<button type="button" data-command="removeFormat" title="Clear formatting" aria-label="Clear formatting">' + toolbarIcon('eraser', 'Clear') + '</button>' +
      '</div></div></div></div>' +
      '</div>' +
      '</div>';
    syncOfficeHistoryControls(file);
    mountLanaEditorForFile(file);
  }

  function cellRef(row, col) {
    var engine = sheetEngine();
    if (engine) return engine.cellRef(row, col);
    return String.fromCharCode(65 + col) + String(row + 1);
  }

  function parseCellRef(ref) {
    var engine = sheetEngine();
    if (engine) return engine.parseCellRef(ref);
    var value = String(ref || '').toUpperCase();
    var col = value.charCodeAt(0) - 65;
    var row = Number(value.slice(1)) - 1;
    if (col < 0 || col > 25 || !Number.isFinite(row) || row < 0) return null;
    return { row: row, col: col };
  }

  function rawCell(file, ref) {
    var parsed = parseCellRef(ref);
    if (!parsed || !file.cells || !file.cells[parsed.row]) return '';
    return file.cells[parsed.row][parsed.col] || '';
  }

  function numberCell(file, ref) {
    var raw = rawCell(file, ref);
    if (String(raw).charAt(0) === '=') return Number(evaluateFormula(file, raw)) || 0;
    return Number(raw) || 0;
  }

  function rangeValues(file, range) {
    var parts = String(range || '').split(':');
    var start = parseCellRef(parts[0]);
    var end = parseCellRef(parts[1] || parts[0]);
    var values = [];
    if (!start || !end) return values;
    for (var row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
      for (var col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
        values.push(numberCell(file, cellRef(row, col)));
      }
    }
    return values;
  }

  function evaluateFormula(file, formula) {
    var engine = sheetEngine();
    if (engine) return engine.evaluateFormula(file.cells || [], formula).value;
    var body = String(formula || '').trim();
    if (body.charAt(0) !== '=') return body;
    body = body.slice(1).trim().toUpperCase();

    if (body.indexOf('SUM(') === 0 && body.charAt(body.length - 1) === ')') {
      var sumValues = rangeValues(file, body.slice(4, -1));
      return sumValues.reduce(function (a, b) { return a + b; }, 0);
    }
    if (body.indexOf('AVG(') === 0 && body.charAt(body.length - 1) === ')') {
      var avgValues = rangeValues(file, body.slice(4, -1));
      if (!avgValues.length) return 0;
      return avgValues.reduce(function (a, b) { return a + b; }, 0) / avgValues.length;
    }

    var operator = ['+', '-', '*', '/'].find(function (op) { return body.indexOf(op) > 0; });
    if (operator) {
      var parts = body.split(operator);
      var left = numberCell(file, parts[0]);
      var right = numberCell(file, parts[1]);
      if (operator === '+') return left + right;
      if (operator === '-') return left - right;
      if (operator === '*') return left * right;
      if (operator === '/') return right === 0 ? 0 : left / right;
    }

    return numberCell(file, body);
  }

  function renderSheet(file, panel) {
    var engine = sheetEngine();
    var rows = engine ? engine.normalizeGrid(file.cells || [], 8, 6) : (file.cells || []);
    file.cells = rows;
    var maxCols = rows.reduce(function (max, row) { return Math.max(max, row.length); }, 4);
    var table = '<div class="office-sheet-canvas">' +
      '<div class="office-sheet-actions"><button class="office-btn" type="button" data-action="export-csv">' + icon('download') + '<span>Export CSV</span></button>' +
      '<button class="office-btn" type="button" data-action="import-csv">' + icon('upload') + '<span>Import CSV</span></button></div>' +
      '<div class="office-formula-row"><div id="officeSelectedCell" class="office-cell-ref">' + esc(selectedCell) + '</div>' +
      '<input id="officeFormulaInput" class="office-formula-input" type="text" value="' + esc(rawCell(file, selectedCell)) + '" aria-label="Formula"></div>' +
      '<div class="office-sheet-wrap"><table class="office-grid"><thead><tr><th></th>';

    for (var col = 0; col < maxCols; col += 1) table += '<th>' + esc(String.fromCharCode(65 + col)) + '</th>';
    table += '</tr></thead><tbody>';

    for (var row = 0; row < rows.length; row += 1) {
      table += '<tr><th>' + String(row + 1) + '</th>';
      for (col = 0; col < maxCols; col += 1) {
        var ref = cellRef(row, col);
        var raw = rows[row][col] === undefined || rows[row][col] === null ? '' : rows[row][col];
        var computed = engine ? engine.displayCell(rows, row, col) : (String(raw).charAt(0) === '=' ? evaluateFormula(file, raw) : raw);
        table += '<td><input data-cell="' + esc(ref) + '" value="' + esc(raw) + '" title="' + esc(String(computed)) + '"></td>';
      }
      table += '</tr>';
    }
    table += '</tbody></table></div></div>';
    panel.innerHTML = table;
  }

  function renderDeck(file, panel) {
    var slides = file.slides || [];
    if (activeSlide >= slides.length) activeSlide = 0;
    var slide = slides[activeSlide] || { title: '', body: '' };
    var html = '<div class="office-deck-canvas"><div class="office-deck-layout"><div class="office-slide-list">';
    for (var i = 0; i < slides.length; i += 1) {
      html += '<button class="office-slide-row' + (i === activeSlide ? ' is-active' : '') + '" type="button" data-slide-index="' + i + '">' +
        '<div class="office-slide-thumb">' + esc(slides[i].title || ('Slide ' + (i + 1))) + '</div>' +
        '<span class="office-file-subtitle">Slide ' + (i + 1) + '</span></button>';
    }
    html += '<button class="office-btn" type="button" data-action="add-slide">' + icon('plus') + '<span>Add Slide</span></button></div>' +
      '<div><div class="office-slide-stage">' +
      '<input id="officeSlideTitle" class="office-slide-title" value="' + esc(slide.title) + '" aria-label="Slide title">' +
      '<textarea id="officeSlideBody" class="office-slide-body" aria-label="Slide body">' + esc(slide.body) + '</textarea>' +
      '</div><div class="office-slide-tools"><button class="office-btn" type="button" data-action="duplicate-slide">' + icon('copy') + '<span>Duplicate</span></button>' +
      '<button class="office-btn" type="button" data-action="delete-slide">' + icon('trash') + '<span>Delete</span></button></div>' +
      '<label class="office-notes-label" for="officeSlideNotes">Speaker notes</label>' +
      '<textarea id="officeSlideNotes" class="office-slide-notes" aria-label="Speaker notes">' + esc(slide.notes || '') + '</textarea></div></div></div>';
    panel.innerHTML = html;
  }

  function workflowEmpty(message) {
    return '<div class="office-data-placeholder">' + esc(message) + '</div>';
  }

  function renderCollaboratorRows(remote) {
    if (!remote.loaded) return workflowEmpty(remote.loading ? 'Loading collaborators...' : (remote.error || 'Collaboration data is unavailable.'));
    if (!remote.collaborators.length) return workflowEmpty('No collaborators have been granted access.');
    return '<ul class="office-signer-list">' + remote.collaborators.map(function (collaborator) {
      var permissions = collaborator.permission ||
        (collaborator.permissions && collaborator.permissions.indexOf('write') !== -1 ? 'write' : 'read');
      var targetLabel = collaborator.target_type === 'workspace' ? 'Workspace' : 'Person';
      return '<li><span><strong>' + esc(collaborator.name) + '</strong>' +
        (collaborator.email ? '<br><span>' + esc(collaborator.email) + '</span>' : '') + '</span>' +
        '<span class="office-pill">' + esc(targetLabel + ' · ' + permissions) + '</span>' +
        '<button class="office-icon-btn" type="button" data-action="remove-collaborator" data-collaborator-id="' + esc(collaborator.id) + '" aria-label="Remove ' + esc(collaborator.name) + '" title="Remove collaborator">' + toolbarIcon('x', 'Remove') + '</button></li>';
    }).join('') + '</ul>';
  }

  function renderCollaborationPanel(file, remote) {
    var panel = el('officeCollabPanel');
    if (!panel || !file) return;
    var review = docReviewModel(file);
    var activity = [];
    remote.collaborators.forEach(function (collaborator) {
      var permission = collaborator.permission ||
        (collaborator.permissions && collaborator.permissions.indexOf('write') !== -1 ? 'write' : 'read');
      activity.push({ text: collaborator.name + (collaborator.target_type === 'workspace' ? ' workspace' : '') + ' was granted ' + permission + ' access.', at: collaborator.shared_at });
    });
    remote.signaturePackets.forEach(function (packet) {
      activity.push({ text: 'Signature packet "' + (packet.title || file.title) + '" is ' + packet.status + '.', at: packet.updated_at || packet.created_at });
    });
    var activityHtml = activity.length
      ? '<ul class="office-activity">' + activity.map(function (item) {
        return '<li><span>' + esc(item.text) + '</span><span>' + esc(item.at ? formatTimestamp(item.at) : '') + '</span></li>';
      }).join('') + '</ul>'
      : workflowEmpty(remote.loaded ? 'No collaboration activity yet.' : 'Loading activity...');
    var versionsHtml = review.versions && review.versions.length
      ? '<ul class="office-activity">' + review.versions.map(function (version) {
        return '<li><span>' + esc(version.title || version.label || 'Version') + '</span><span class="office-pill">' + esc(version.status || 'Draft') + '</span></li>';
      }).join('') + '</ul>'
      : workflowEmpty('No saved versions yet.');
    var changes = review.changes || [];
    var changesHtml = changes.length
      ? '<ul class="office-activity">' + changes.slice(0, 20).map(function (change) {
        return '<li><span>' + esc(change.title || change.type || 'Tracked change') + '</span><span class="office-pill">' + esc(change.status || 'Pending') + '</span></li>';
      }).join('') + '</ul>'
      : workflowEmpty('No tracked changes yet.');
    panel.innerHTML = '<div class="office-panel-placeholder-grid">' +
      '<section class="office-section-card"><h2>Document access</h2>' + renderCollaboratorRows(remote) +
        '<div class="office-inline-actions"><button class="office-btn" type="button" data-action="share">' + toolbarIcon('user-plus', 'Add') + '<span>Add collaborator</span></button></div></section>' +
      '<section class="office-section-card"><h2>Activity</h2>' + activityHtml + '</section>' +
      '<section class="office-section-card"><h2>Versions</h2>' + versionsHtml +
        '<div class="office-inline-actions office-inline-actions--release-only"><button class="office-btn" type="button" data-action="' +
          (serverReview(file) && serverReview(file).pendingReleaseBatch ? pendingReleaseButtonAction(serverReview(file)) : 'release-review-version') + '">' +
          (serverReview(file) && serverReview(file).pendingReleaseBatch ? pendingReleaseButtonLabel(serverReview(file)) : 'Release Version') + '</button></div></section>' +
      '<section class="office-section-card"><h2>Changes</h2>' + changesHtml + '</section>' +
      '<section class="office-section-card"><h2>Collaboration Model</h2><ul class="office-scope-list">' +
        '<li><span>Access source</span><span>Server-managed document shares</span></li>' +
        '<li><span>Permissions</span><span>Read, write, and reshare grants</span></li>' +
        '<li><span>Autosave</span><span>' + esc(savedStatusLabel(file)) + '</span></li></ul></section>' +
      '<section class="office-section-card"><h2>AI Context</h2><ul class="office-scope-list">' +
        '<li><span>Document</span><span>' + esc(file.filename || file.title) + '</span></li>' +
        '<li><span>Workspace</span><span>' + esc(file.matterName || file.matterId || 'Not assigned') + '</span></li>' +
        '<li><span>LANA context</span><span>Document and review state</span></li></ul></section>' +
      '</div>';
  }

  function signaturePacketById(remote, packetId) {
    if (!remote || !packetId) return null;
    for (var i = 0; i < remote.signaturePackets.length; i += 1) {
      if (remote.signaturePackets[i].id === packetId) return remote.signaturePackets[i];
    }
    return null;
  }

  function selectedSignaturePacket(remote) {
    if (remote.selectedPacketId === 'new') return null;
    var selected = signaturePacketById(remote, remote.selectedPacketId);
    if (selected) return selected;
    return remote.signaturePackets[0] || null;
  }

  function renderSignaturePanel(file, remote) {
    var panel = el('officeSignaturePanel');
    if (!panel || !file) return;
    var packet = selectedSignaturePacket(remote);
    var consentDisclosure = packet && typeof packet.signature_consent_disclosure === 'string'
      ? packet.signature_consent_disclosure
      : null;
    var hasConsentDisclosure = typeof consentDisclosure === 'string' && Boolean(consentDisclosure.trim());
    var consentDisclosureHtml = packet
      ? '<div class="office-signature-consent" role="note">' +
        (hasConsentDisclosure
          ? '<strong>Electronic signature disclosure</strong><div data-signature-consent-disclosure>' + esc(consentDisclosure) + '</div>'
          : '<strong>Electronic signature disclosure unavailable</strong><div data-signature-consent-missing>Signing is unavailable because this packet does not include the server-provided disclosure.</div>') +
        '</div>'
      : '';
    var signers = packet ? packet.signers : remote.stagedSigners;
    var currentUser = currentUserRecord() || {};
    var currentEmail = String(currentUser.email || currentUser.username || '').toLowerCase();
    var signerHtml = signers.length
      ? '<ul class="office-signer-list">' + signers.map(function (signer, index) {
        var status = packet
          ? signer.status + (signer.delivery_status ? ' · ' + signer.delivery_status.replaceAll('_', ' ') : '')
          : 'Draft';
        var canRespond = packet && currentEmail && signer.email.toLowerCase() === currentEmail &&
          ['signed', 'declined'].indexOf(signer.status) === -1 && ['cancelled', 'completed'].indexOf(packet.status) === -1;
        var responseActions = canRespond
          ? '<span class="office-inline-actions"><button class="office-btn" type="button" data-action="sign-packet-signer" data-packet-id="' + esc(packet.id) + '" data-signer-id="' + esc(signer.id) + '"' +
            (hasConsentDisclosure ? '' : ' disabled aria-disabled="true" title="Electronic signature disclosure unavailable"') +
            '>Sign</button><button class="office-btn" type="button" data-action="decline-packet-signer" data-packet-id="' + esc(packet.id) + '" data-signer-id="' + esc(signer.id) + '">Decline</button></span>'
          : '';
        return '<li><span><strong>' + esc(signer.name) + '</strong><br><span>' + esc(signer.email) + '</span></span>' +
          '<span class="office-pill">' + esc(status) + '</span>' +
          (packet ? responseActions : '<button class="office-icon-btn" type="button" data-action="remove-staged-signer" data-signer-index="' + index + '" aria-label="Remove signer">' + toolbarIcon('x', 'Remove') + '</button>') + '</li>';
      }).join('') + '</ul>'
      : workflowEmpty(remote.loaded ? 'Add at least one signer to prepare a packet.' : 'Loading signature packets...');
    var packetHistory = remote.signaturePackets.length
      ? '<section class="office-section-card"><h2>Packet History</h2><ul class="office-activity">' + remote.signaturePackets.map(function (item) {
        return '<li><button class="office-btn" type="button" data-action="select-signature-packet" data-packet-id="' + esc(item.id) + '">' + esc(item.title || file.title) + '</button><span class="office-pill">' + esc(item.status) + '</span></li>';
      }).join('') + '</ul></section>'
      : '';
    var packetActions = packet
      ? '<div class="office-inline-actions">' +
        (packet.status !== 'completed' && packet.status !== 'cancelled'
          ? '<button class="office-btn" type="button" data-action="resend-signature-packet" data-packet-id="' + esc(packet.id) + '">Resend</button>' +
            '<button class="office-btn" type="button" data-action="cancel-signature-packet" data-packet-id="' + esc(packet.id) + '">Cancel packet</button>'
          : '') +
        '<button class="office-btn" type="button" data-action="new-signature-packet">Prepare another packet</button></div>'
      : '';
    panel.innerHTML = '<div class="office-signature-grid">' +
      '<section class="office-sign-preview"><h2>' + esc(file.filename || file.title) + '</h2>' +
        '<p>' + (packet ? 'Packet status: <strong>' + esc(packet.status) + '</strong>' : 'Prepare a persisted signature request for this document.') + '</p>' +
        consentDisclosureHtml + '<span class="office-sign-field">Signature</span><span class="office-sign-field">Date signed</span>' + packetActions + '</section>' +
      '<div><section class="office-section-card"><h2>Signers</h2>' + signerHtml +
        (packet ? '' : '<form id="officeSignerForm" class="office-signer-form"><label for="officeSignerName">Name</label><input id="officeSignerName" name="name" type="text" autocomplete="name" required><label for="officeSignerEmail">Email</label><input id="officeSignerEmail" name="email" type="email" autocomplete="email" required><button class="office-btn" type="button" data-action="add-signer">Add signer</button><button class="office-btn office-btn-primary" type="button" data-action="send-signature-packet"' + (remote.stagedSigners.length ? '' : ' disabled aria-disabled="true"') + '>Send packet</button></form>') +
        '</section>' + packetHistory + '</div></div>';
  }

  function renderRemotePanels(file) {
    if (!file) return;
    var remote = remoteWorkflowForFile(file);
    renderCollaborationPanel(file, remote);
    renderSignaturePanel(file, remote);
    hydrateIcons(el('officeCollabPanel'));
    hydrateIcons(el('officeSignaturePanel'));
  }

  function applyActivePanel() {
    var names = ['editor', 'collaboration', 'signatures'];
    names.forEach(function (name) {
      var tab = document.querySelector('[data-panel="' + name + '"]');
      var panel = el(name === 'editor' ? 'officeEditorPanel' : name === 'collaboration' ? 'officeCollabPanel' : 'officeSignaturePanel');
      var selected = name === activePanel;
      if (tab) {
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.setAttribute('tabindex', selected ? '0' : '-1');
      }
      if (panel) {
        panel.hidden = !selected;
        panel.classList.toggle('is-active', selected);
      }
    });
    var contextToolbar = el('officeContextToolbarHost');
    if (contextToolbar) contextToolbar.hidden = activePanel !== 'editor';
    renderReviewDock(activeFile());
  }

  function renderPanels() {
    var file = activeFile();
    renderEditor();
    if (file) {
      renderRemotePanels(file);
      loadRemoteWorkflows(file);
    }
    applyActivePanel();
  }

  function renderAll() {
    renderChrome();
    renderPanels();
    hydrateIcons(document);
  }

  function toast(message) {
    if (window.Lex && Lex.Toast && Lex.Toast.success) {
      Lex.Toast.success(message);
      return;
    }
    console.log('[file-editor] ' + message);
  }

  function downloadPayload(payload) {
    if (!payload) return;
    if (!window.Blob || !window.URL || !document.createElement) {
      toast('Export payload is ready.');
      console.log('[file-editor export]', payload);
      return;
    }
    var blob = new Blob([payload.content || ''], { type: payload.mimeType || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = payload.filename || 'lana-office-export.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function downloadBlob(blob, filename) {
    if (!blob) return;
    if (!window.URL || !document.createElement) {
      toast('Export bytes are ready.');
      return;
    }
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'lana-office-export';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function slugFilename(title, extension) {
    var text = String(title || 'office-file').toLowerCase();
    var out = '';
    var lastDash = false;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      var ok = code >= 97 && code <= 122 || code >= 48 && code <= 57;
      if (ok) {
        out += text.charAt(i);
        lastDash = false;
      } else if (!lastDash && out) {
        out += '-';
        lastDash = true;
      }
    }
    if (out.charAt(out.length - 1) === '-') out = out.slice(0, -1);
    return (out || 'office-file') + '.' + extension;
  }

  function officeDefaultExportFormat(file) {
    if (file && file.kind === 'deck') return 'pptx';
    var filename = String(file && file.filename || '').toLowerCase();
    var contentType = String(file && file.contentType || '').toLowerCase();
    return filename.endsWith('.csv') || contentType === 'text/csv' ? 'csv' : 'xlsx';
  }

  function officeExportFilename(file, format) {
    var filename = String(file && file.filename || '');
    return filename.toLowerCase().endsWith('.' + format) ? filename : slugFilename(file && file.title, format);
  }

  async function exportActiveFile(format) {
    var file = activeFile();
    if (!file) return;
    var payload = null;
    if (isServerOfficeFile(file)) {
      var service = contentApi();
      if (!service) throw new Error('The File Editor content service is unavailable.');
      var edit = ensureOfficeEdit(file);
      if (!edit.loaded) throw new Error(edit.error || 'The Office edit model is not loaded.');
      if (edit.dirty || edit.saving) await saveOfficeEditModel(file);
      var officeFormat = format || officeDefaultExportFormat(file);
      if (file.kind === 'deck' && officeFormat !== 'pptx') throw new Error('Presentations can only be exported as PPTX.');
      if (file.kind === 'sheet' && officeFormat !== 'csv' && officeFormat !== 'xlsx') {
        throw new Error('Spreadsheets can only be exported as CSV or XLSX.');
      }
      var exported = await service.exportDocument(officeRealDocumentId(file), officeFormat);
      downloadBlob(exported.blob, exported.filename || officeExportFilename(file, officeFormat));
      toast('Current Office file downloaded.');
      return;
    }
    if (file.kind === 'doc') {
      if (isServerReviewFile(file)) {
        var editor = editorForFile(file);
        if (!editor || typeof editor.bytes !== 'function') throw new Error('LANA Editor is not ready to download this document.');
        if (typeof editor.flushPendingEdits === 'function') await editor.flushPendingEdits();
        if (editorForFile(file) !== editor) throw new Error('The active document changed before download.');
        var currentBytes = editor.bytes();
        if (!currentBytes) throw new Error('No current document bytes are available.');
        payload = {
          filename: file.filename || file.title || 'document.docx',
          mimeType: file.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: currentBytes
        };
        downloadPayload(payload);
        toast('Current document downloaded.');
        return;
      }
      var tools = writerTools();
      payload = tools
        ? tools.buildExportPayload(file, { format: format === 'html' ? 'html' : 'txt' })
        : { filename: slugFilename(file.title, 'html'), mimeType: 'text/html;charset=utf-8', content: file.content || '' };
    }
    downloadPayload(payload);
    toast('Download prepared.');
  }

  function readTextFile(file) {
    if (file && typeof file.text === 'function') return file.text();
    return new Promise(function (resolve, reject) {
      if (!window.FileReader) {
        reject(new Error('CSV import is unavailable in this client.'));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('The CSV file could not be read.')); };
      reader.readAsText(file);
    });
  }

  async function importCsvFile(file, csvFile) {
    if (!file || file.kind !== 'sheet' || !csvFile) return;
    if (Number(csvFile.size || 0) > 10 * 1024 * 1024) throw new Error('CSV imports must be 10 MB or smaller.');
    var engine = sheetEngine();
    if (!engine || typeof engine.parseCsv !== 'function') throw new Error('CSV import is unavailable.');
    var cells = engine.parseCsv(await readTextFile(csvFile));
    if (!Array.isArray(cells) || !cells.length) throw new Error('The CSV file did not contain any rows.');
    file.cells = cells;
    selectedCell = 'A1';
    setUpdated(file);
    renderEditor();
    toast('CSV imported. Save to persist these changes.');
  }

  function addDeckSlide(file) {
    if (!file || file.kind !== 'deck') return;
    file.slides = Array.isArray(file.slides) ? file.slides : [];
    file.slides.push({ title: '', body: '', notes: '' });
    activeSlide = file.slides.length - 1;
    setUpdated(file);
    renderEditor();
  }

  function duplicateDeckSlide(file) {
    if (!file || file.kind !== 'deck') return;
    var slide = Array.isArray(file.slides) ? file.slides[activeSlide] : null;
    if (!slide) return;
    file.slides.splice(activeSlide + 1, 0, {
      title: String(slide.title || ''),
      body: String(slide.body || ''),
      notes: String(slide.notes || '')
    });
    activeSlide += 1;
    setUpdated(file);
    renderEditor();
  }

  function deleteDeckSlide(file) {
    if (!file || file.kind !== 'deck' || !Array.isArray(file.slides)) return;
    if (file.slides.length <= 1) {
      toast('A presentation must keep at least one slide.');
      return;
    }
    file.slides.splice(activeSlide, 1);
    activeSlide = Math.min(activeSlide, file.slides.length - 1);
    setUpdated(file);
    renderEditor();
  }

  function lanaContextType(file) {
    if (!file) return 'full_chat';
    if (file.kind === 'sheet') return 'data_chat';
    if (file.kind === 'doc') return 'document_chat';
    return 'full_chat';
  }

  function officeDataInsertionContext() {
    return {
      template_variable_syntax: '#{{entity:property_key}}',
      date_variable_syntax: '#{{date:todays_date:format}}',
      user_mention_syntax: '@{{user_id:property_key}}',
      template_entities: templateVariableEntities().map(function (entity) {
        return {
          key: entity.key,
          label: entity.label,
          properties: (entity.properties || []).map(function (property) {
            return { key: property.key, label: property.label };
          })
        };
      }),
      date_formats: dateVariableFormats().map(function (format) {
        return { key: format.key, label: format.label, example: format.example };
      }),
      user_mention_properties: mentionUserProperties().map(function (property) {
        return { key: property.key, label: property.label };
      })
    };
  }

  function officeFileCardContext(file, focusedContext) {
    if (!file) return null;
    var tools = writerTools();
    var managed = isServerReviewFile(file);
    var managedReview = managed ? serverReview(file) : null;
    var stats = file.kind === 'doc' && !managed && tools ? tools.getDocumentStats(file.content || '') : null;
    var reviewRows = file.review && Array.isArray(file.review.changes) ? file.review.changes : [];
    var pendingChanges = managed
      ? reviewRows.filter(function (change) { return change.serverSection === 'unreleased'; })
      : (file.kind === 'doc' ? pendingDocReviewChanges(file) : []);
    var releasedChanges = managed
      ? reviewRows.filter(function (change) { return change.serverSection === 'released'; })
      : (Array.isArray(file.reviewChanges) ? file.reviewChanges.filter(changeIsReleased) : []);
    var sourceDocumentId = officeRealDocumentId(file);
    var context = {
      type: 'office_file',
      context_type: 'office_document',
      source: 'file_editor',
      file_id: file.id,
      document_id: sourceDocumentId || null,
      file_title: file.title || 'Document',
      file_kind: file.kind || 'doc',
      summary: (file.title || 'Document') + ' in File Editor',
      document: {
        id: sourceDocumentId || null,
        local_id: file.id || null,
        name: file.title || file.filename || 'Document',
        kind: file.kind || 'doc',
        content_type: file.contentType || file.content_type || ''
      },
      review: {
        last_saved_at: managedReview && managedReview.currentDraftBatch
          ? managedReview.currentDraftBatch.updated_at || null
          : file.lastSavedAt || null,
        pending_change_count: pendingChanges.length,
        released_change_count: releasedChanges.length,
        has_unsaved_draft_changes: managed ? Boolean(managedReview && managedReview.dirty) : (file.kind === 'doc' ? docHasUnsavedDraftChanges(file) : false),
        has_active_saved_draft: managed ? Boolean(managedReview && managedReview.currentDraftBatch) : (file.kind === 'doc' ? docHasActiveSavedDraft(file) : false),
        pending_approval: Boolean(managedReview && managedReview.pendingReleaseBatch),
        change_summaries: (managed ? reviewRows : (file.reviewChanges || [])).slice(0, 12).map(function (change) {
          return {
            type: change.type || change.title || 'Change',
            status: change.status || '',
            before: change.before || '',
            after: change.after || '',
            text: change.text || change.body || ''
          };
        })
      },
      data_insertions: officeDataInsertionContext(),
      stats: stats || null
    };
    if (focusedContext) {
      context.focus = focusedContext;
      context.type = focusedContext.type || context.type;
      context.context_type = focusedContext.context_type || context.context_type;
      context.summary = focusedContext.summary || context.summary;
      ['selection', 'revision', 'edit_intent', 'document_edit', 'editor_mode', 'document_mode'].forEach(function (key) {
        if (focusedContext[key] !== undefined) context[key] = focusedContext[key];
      });
    }
    return context;
  }

  function openLanaDockWithActiveFile(prompt, focusedContext) {
    var file = activeFile();
    var dock = document.querySelector('lex-lana-dock');
    if (!dock || typeof dock.openWith !== 'function') {
      toast('LANA dock is not ready yet.');
      return false;
    }
    var documentId = officeRealDocumentId(file);
    // Prefill the composer instead of auto-sending: the user decides when to
    // send and can extend the prompt first (same behavior as File Viewer).
    dock.openWith({
      contextType: lanaContextType(file),
      documentId: documentId || null,
      documentName: file && (file.filename || file.title) ? (file.filename || file.title) : 'Office file',
      matterId: officeConversationMatterId(file) || null,
      matterName: (file && file.matterName) || null,
      cardContext: officeFileCardContext(file, focusedContext),
      prefillPrompt: prompt || 'Help me work on this document.'
    });
    return true;
  }

  function fallbackDocPage() {
    var page = el('officeDocPage');
    return page && !page.hidden ? page : null;
  }

  function selectionInsideDoc() {
    var page = fallbackDocPage();
    var selection = window.getSelection ? window.getSelection() : null;
    if (!page || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    var anchor = selection.anchorNode;
    var focus = selection.focusNode;
    if (!anchor || !focus) return null;
    if (!page.contains(anchor) || !page.contains(focus)) return null;
    fallbackDocSelectionRange = selection.getRangeAt(0).cloneRange();
    return selection;
  }

  function selectedDocText() {
    var selection = selectionInsideDoc();
    return selection ? String(selection.toString() || '').trim() : '';
  }

  function savedDocText() {
    var text = selectedDocText();
    if (text || !fallbackDocSelectionRange) return text;
    return String(fallbackDocSelectionRange.toString() || '').trim();
  }

  function restoreDocSelection() {
    var page = fallbackDocPage();
    var selection = window.getSelection ? window.getSelection() : null;
    if (!page || !selection || !fallbackDocSelectionRange) return false;
    var container = fallbackDocSelectionRange.commonAncestorContainer;
    if (!page.contains(container)) return false;
    if (typeof page.focus === 'function') page.focus();
    selection.removeAllRanges();
    selection.addRange(fallbackDocSelectionRange);
    return true;
  }

  function currentDocRange() {
    var page = fallbackDocPage();
    var selection = window.getSelection ? window.getSelection() : null;
    if (!page || !selection || !selection.rangeCount) return null;
    var range = selection.getRangeAt(0);
    var container = range.commonAncestorContainer;
    if (!page.contains(container)) return null;
    return range.cloneRange();
  }

  function endOfDocRange() {
    var page = fallbackDocPage();
    if (!page || !document.createRange) return null;
    var range = document.createRange();
    range.selectNodeContents(page);
    range.collapse(false);
    return range;
  }

  function rangeFromTextOffsets(root, start, end) {
    if (!root || !document.createRange) return null;
    var range = document.createRange();
    var walker = document.createTreeWalker(root, 4);
    var node = null;
    var count = 0;
    var started = false;
    while (walker.nextNode()) {
      node = walker.currentNode;
      var length = (node.nodeValue || '').length;
      if (!started && start <= count + length) {
        range.setStart(node, Math.max(0, start - count));
        started = true;
      }
      if (started && end <= count + length) {
        range.setEnd(node, Math.max(0, end - count));
        return range;
      }
      count += length;
    }
    return null;
  }

  function templateVariableMenu() {
    var menu = el('officeTemplateVariableMenu');
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'officeTemplateVariableMenu';
    menu.className = 'office-template-variable-menu';
    menu.hidden = true;
    document.body.appendChild(menu);
    return menu;
  }

  function hideTemplateVariableMenu() {
    var menu = el('officeTemplateVariableMenu');
    if (menu) menu.hidden = true;
    templateVariableMenuState = null;
  }

  function templateVariableTrigger() {
    var page = fallbackDocPage();
    var range = currentDocRange();
    if (!page || !range || !range.collapsed) return null;

    var beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(page);
    beforeRange.setEnd(range.endContainer, range.endOffset);
    var before = beforeRange.toString();
    var start = before.lastIndexOf('#{{');
    if (start === -1) return null;
    var raw = before.slice(start);
    if (raw.indexOf('}}') !== -1 || raw.length > 96 || /[\n\r]/.test(raw)) return null;
    var inner = raw.slice(3);
    if (!/^[a-zA-Z0-9_:-]*$/.test(inner)) return null;
    var replaceRange = rangeFromTextOffsets(page, start, before.length);
    if (!replaceRange) return null;
    var colon = inner.indexOf(':');
    var entityQuery = colon === -1 ? inner : inner.slice(0, colon);
    var propertyQuery = colon === -1 ? '' : inner.slice(colon + 1);
    var dateSourceKey = '';
    var formatQuery = '';
    if (entityQuery === 'date' && propertyQuery.indexOf(':') !== -1) {
      var dateParts = propertyQuery.split(':');
      dateSourceKey = dateParts.shift();
      formatQuery = dateParts.join(':');
      propertyQuery = dateSourceKey;
    }
    return {
      range: replaceRange,
      raw: raw,
      entityQuery: entityQuery,
      propertyQuery: propertyQuery,
      dateSourceKey: dateSourceKey,
      formatQuery: formatQuery,
      propertyMode: colon !== -1
    };
  }

  function mentionUserTrigger() {
    var page = fallbackDocPage();
    var range = currentDocRange();
    if (!page || !range || !range.collapsed) return null;

    var beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(page);
    beforeRange.setEnd(range.endContainer, range.endOffset);
    var before = beforeRange.toString();
    var braceStart = before.lastIndexOf('@{{');
    var atStart = before.lastIndexOf('@');
    var start = braceStart !== -1 ? braceStart : atStart;
    if (start === -1) return null;
    if (start > 0 && /[A-Za-z0-9_}]/.test(before.charAt(start - 1))) return null;
    var raw = before.slice(start);
    if (raw.indexOf('}}') !== -1 || raw.length > 96 || /[\n\r]/.test(raw)) return null;
    var query = raw.indexOf('@{{') === 0 ? raw.slice(3) : raw.slice(1);
    if (!/^[a-zA-Z0-9_ .:-]*$/.test(query)) return null;
    var replaceRange = rangeFromTextOffsets(page, start, before.length);
    if (!replaceRange) return null;
    var colon = query.indexOf(':');
    return {
      range: replaceRange,
      raw: raw,
      userQuery: colon === -1 ? query.trim() : query.slice(0, colon).trim(),
      propertyQuery: colon === -1 ? '' : query.slice(colon + 1).trim(),
      propertyMode: colon !== -1
    };
  }

  function filteredTemplateEntities(query) {
    var value = String(query || '').toLowerCase();
    return templateVariableEntities().filter(function (entity) {
      return !value || entity.key.indexOf(value) !== -1 || String(entity.label || '').toLowerCase().indexOf(value) !== -1;
    });
  }

  function filteredTemplateProperties(entity, query) {
    var value = String(query || '').toLowerCase();
    return (entity && entity.properties ? entity.properties : []).filter(function (property) {
      return !value || property.key.indexOf(value) !== -1 || String(property.label || '').toLowerCase().indexOf(value) !== -1;
    });
  }

  function positionTemplateVariableMenu(anchorRect) {
    var menu = templateVariableMenu();
    var rect = anchorRect || { left: 24, top: 100, bottom: 124, width: 0 };
    menu.hidden = false;
    var width = menu.offsetWidth || 260;
    var left = rect.left + ((rect.width || 0) / 2) - (width / 2);
    var top = rect.bottom + 8;
    var height = menu.offsetHeight || 280;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    if (top + height > window.innerHeight - 12 && rect.top - height - 8 > 12) {
      top = rect.top - height - 8;
    }
    top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  }

  function renderTemplateVariableMenu() {
    var state = templateVariableMenuState;
    var menu = templateVariableMenu();
    if (!state) {
      menu.hidden = true;
      return;
    }
    var isMention = state.kind === 'mention';
    var entity = !isMention && state.entityKey ? templateVariableEntity(state.entityKey) : null;
    var user = isMention && state.userId ? mentionUserById(state.userId) : null;
    var isDateEntity = Boolean(entity && entity.key === 'date');
    var options = isMention
      ? user
        ? filteredMentionProperties(user, state.propertyQuery)
        : filteredMentionUsers(state.userQuery)
      : isDateEntity && state.dateSourceKey
        ? filteredDateVariableFormats(state.formatQuery)
        : entity
          ? filteredTemplateProperties(entity, state.propertyQuery)
          : filteredTemplateEntities(state.entityQuery);
    state.activeIndex = Math.max(0, Math.min(state.activeIndex || 0, Math.max(0, options.length - 1)));
    var title = isMention
      ? (user ? user.label + ' properties' : 'People')
      : isDateEntity && state.dateSourceKey
        ? dateVariableSourceLabel(state.dateSourceKey) + ' formats'
        : (entity ? entity.label + ' properties' : 'Template variables');
    var hint = isMention
      ? (user ? '@{{' + user.id + ':property_key}}' : '@{{user_id:property_key}}')
      : isDateEntity && state.dateSourceKey
        ? '#{{date:' + state.dateSourceKey + ':format}}'
        : (entity ? '#{{' + entity.key + ':property_key}}' : '#{{entity:property_key}}');
    var searchValue = isMention
      ? (user ? state.propertyQuery : state.userQuery)
      : isDateEntity && state.dateSourceKey
        ? state.formatQuery
        : (entity ? state.propertyQuery : state.entityQuery);
    var searchPlaceholder = isMention
      ? (user ? 'Search values...' : 'Search people...')
      : isDateEntity && state.dateSourceKey
        ? 'Search formats...'
        : (entity ? 'Search properties...' : 'Search entities...');
    var canGoBack = Boolean((isMention && user) || (!isMention && (entity || state.dateSourceKey)));
    var rows = options.map(function (option, index) {
      var active = index === state.activeIndex ? ' is-active' : '';
      if (isMention && user) {
        var value = mentionUserPropertyValue(user, option.key);
        return '<button class="office-template-variable-option' + active + '" type="button" data-mention-property="' + esc(option.key) + '">' +
          '<span>' + esc(option.label) + '</span><code>' + esc(value || mentionUserLiteral(user.id, option.key)) + '</code></button>';
      }
      if (isMention) {
        return '<button class="office-template-variable-option office-template-variable-person' + active + '" type="button" data-mention-user="' + esc(option.id) + '">' +
          '<span class="office-template-variable-avatar">' + esc(initialsForName(option.label)) + '</span>' +
          '<span class="office-template-variable-person-copy"><strong>' + esc(option.label) + '</strong><code>' + esc(option.email || option.username || option.id) + '</code></span></button>';
      }
      if (isDateEntity && state.dateSourceKey) {
        return '<button class="office-template-variable-option' + active + '" type="button" data-template-date-format="' + esc(option.key) + '">' +
          '<span>' + esc(option.label) + '</span><code>' + esc(option.example || templateVariableLiteral('date', state.dateSourceKey, option.key)) + '</code></button>';
      }
      if (isDateEntity) {
        return '<button class="office-template-variable-option' + active + '" type="button" data-template-date-source="' + esc(option.key) + '">' +
          '<span>' + esc(option.label) + '</span><code>' + esc(templateVariableLiteral('date', option.key, 'format')) + '</code></button>';
      }
      if (entity) {
        return '<button class="office-template-variable-option' + active + '" type="button" data-template-variable-property="' + esc(option.key) + '">' +
          '<span>' + esc(option.label) + '</span><code>' + esc(templateVariableLiteral(entity.key, option.key)) + '</code></button>';
      }
      return '<button class="office-template-variable-option' + active + '" type="button" data-template-variable-entity="' + esc(option.key) + '">' +
        '<span>' + esc(option.label) + '</span><code>' + esc(option.key) + '</code></button>';
    }).join('');
    menu.innerHTML = '<div class="office-template-variable-menu-head">' +
      '<div class="office-template-variable-menu-title">' +
      (canGoBack ? '<button class="office-template-variable-back" type="button" data-template-variable-back title="Back">' + toolbarIcon('arrow-left', 'Back') + '</button>' : '') +
      '<span><strong>' + esc(title) + '</strong><code>' + esc(hint) + '</code></span></div>' +
      '<input class="office-template-variable-search" type="search" data-template-variable-search placeholder="' + esc(searchPlaceholder) + '" value="' + esc(searchValue || '') + '" autocomplete="off">' +
      '</div>' +
      '<div class="office-template-variable-options">' + (rows || '<div class="office-template-variable-empty">No matching fields</div>') + '</div>';
    positionTemplateVariableMenu(state.anchorRect);
  }

  function updateTemplateVariableAutocomplete() {
    var mentionTrigger = mentionUserTrigger();
    if (mentionTrigger) {
      var mentionRect = mentionTrigger.range.getBoundingClientRect();
      var mentionUser = mentionTrigger.propertyMode ? mentionUserById(mentionTrigger.userQuery) : null;
      templateVariableMenuState = {
        kind: 'mention',
        range: mentionTrigger.range,
        userQuery: mentionTrigger.userQuery,
        userId: mentionUser ? mentionUser.id : '',
        propertyQuery: mentionTrigger.propertyQuery,
        activeIndex: 0,
        anchorRect: mentionRect && (mentionRect.width || mentionRect.height) ? mentionRect : null
      };
      renderTemplateVariableMenu();
      return;
    }
    var trigger = templateVariableTrigger();
    if (!trigger) {
      hideTemplateVariableMenu();
      return;
    }
    var rangeRect = trigger.range.getBoundingClientRect();
    var entity = trigger.propertyMode ? templateVariableEntity(trigger.entityQuery) : null;
    templateVariableMenuState = {
      kind: 'template',
      range: trigger.range,
      entityQuery: trigger.entityQuery,
      entityKey: entity ? entity.key : '',
      propertyQuery: trigger.propertyQuery,
      dateSourceKey: entity && entity.key === 'date' && trigger.dateSourceKey ? trigger.dateSourceKey : '',
      formatQuery: trigger.formatQuery || '',
      activeIndex: 0,
      anchorRect: rangeRect && (rangeRect.width || rangeRect.height) ? rangeRect : null
    };
    renderTemplateVariableMenu();
  }

  function officeEmbedFieldTarget() {
    var file = activeFile();
    return isServerReviewFile(file) && officeEditorInstance && !fallbackDocPage() ? officeEditorInstance : null;
  }

  function openTemplateVariablePicker(anchor) {
    var embed = officeEmbedFieldTarget();
    // Capture the embed caret BEFORE the dropdown interaction (search box
    // focus) moves the document selection out of the editor surface.
    var embedCaret = embed && typeof embed.caretPoint === 'function' ? embed.caretPoint() : null;
    var range = embed ? null : (currentDocRange() || endOfDocRange());
    var rect = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    templateVariableMenuState = {
      kind: 'template',
      range: range,
      embedTarget: Boolean(embed),
      embedCaret: embedCaret,
      entityQuery: '',
      entityKey: '',
      propertyQuery: '',
      dateSourceKey: '',
      formatQuery: '',
      activeIndex: 0,
      anchorRect: rect,
      anchorMode: 'toolbar'
    };
    renderTemplateVariableMenu();
  }

  function setSelectionAfterNode(node) {
    var selection = window.getSelection ? window.getSelection() : null;
    if (!selection || !document.createRange || !node) return;
    var range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertEmbedFieldToken(token) {
    var embed = officeEmbedFieldTarget();
    var caret = templateVariableMenuState && templateVariableMenuState.embedCaret ? templateVariableMenuState.embedCaret : null;
    hideTemplateVariableMenu();
    if (!embed || !token) return;
    Promise.resolve(embed.insertWorkspaceField(token, caret)).catch(function (error) {
      toast((error && error.message) || 'The field could not be inserted.');
    });
  }

  function insertTemplateVariableToken(entityKey, propertyKey, formatKey) {
    var file = activeFile();
    if (!file || !entityKey || !propertyKey) return;
    if (officeEmbedFieldTarget()) {
      insertEmbedFieldToken(templateVariableLiteral(entityKey, propertyKey, formatKey));
      return;
    }
    var page = fallbackDocPage();
    if (!page) return;
    var range = templateVariableMenuState && templateVariableMenuState.range ? templateVariableMenuState.range : currentDocRange();
    if (!range) range = endOfDocRange();
    if (!range) return;
    pushDocUndoSnapshot(file, currentCleanDocHtml());
    var wrapper = document.createElement('span');
    wrapper.innerHTML = templateVariableTokenHtml(entityKey, propertyKey, formatKey) + ' ';
    var lastInserted = null;
    range.deleteContents();
    while (wrapper.firstChild) {
      var child = wrapper.firstChild;
      range.insertNode(child);
      range.setStartAfter(child);
      lastInserted = child;
    }
    setSelectionAfterNode(lastInserted);
    hideTemplateVariableMenu();
    if (typeof page.focus === 'function') page.focus();
    syncActiveDocContent();
    syncDocumentToolbarState();
  }

  function insertMentionUserToken(userId, propertyKey) {
    var file = activeFile();
    var page = fallbackDocPage();
    if (!file || !page || !userId || !propertyKey) return;
    var range = templateVariableMenuState && templateVariableMenuState.range ? templateVariableMenuState.range : currentDocRange();
    if (!range) range = endOfDocRange();
    if (!range) return;
    pushDocUndoSnapshot(file, currentCleanDocHtml());
    var wrapper = document.createElement('span');
    wrapper.innerHTML = mentionUserTokenHtml(userId, propertyKey) + ' ';
    var lastInserted = null;
    range.deleteContents();
    while (wrapper.firstChild) {
      var child = wrapper.firstChild;
      range.insertNode(child);
      range.setStartAfter(child);
      lastInserted = child;
    }
    setSelectionAfterNode(lastInserted);
    hideTemplateVariableMenu();
    if (typeof page.focus === 'function') page.focus();
    syncActiveDocContent();
    syncDocumentToolbarState();
  }

  function handleTemplateVariableOption(option) {
    if (!option || !templateVariableMenuState) return;
    if (option.dataset.templateVariableBack !== undefined) {
      if (templateVariableMenuState.kind === 'mention') {
        templateVariableMenuState.userId = '';
        templateVariableMenuState.propertyQuery = '';
      } else if (templateVariableMenuState.dateSourceKey) {
        templateVariableMenuState.dateSourceKey = '';
        templateVariableMenuState.formatQuery = '';
      } else {
        templateVariableMenuState.entityKey = '';
        templateVariableMenuState.propertyQuery = '';
      }
      templateVariableMenuState.activeIndex = 0;
      renderTemplateVariableMenu();
      return;
    }
    var mentionUserId = option.dataset.mentionUser;
    var mentionPropertyKey = option.dataset.mentionProperty;
    if (mentionUserId) {
      templateVariableMenuState.kind = 'mention';
      templateVariableMenuState.userId = mentionUserId;
      templateVariableMenuState.propertyQuery = '';
      templateVariableMenuState.activeIndex = 0;
      renderTemplateVariableMenu();
      return;
    }
    if (mentionPropertyKey && templateVariableMenuState.userId) {
      insertMentionUserToken(templateVariableMenuState.userId, mentionPropertyKey);
      return;
    }
    var entityKey = option.dataset.templateVariableEntity;
    var propertyKey = option.dataset.templateVariableProperty;
    var dateSourceKey = option.dataset.templateDateSource;
    var dateFormatKey = option.dataset.templateDateFormat;
    if (entityKey) {
      templateVariableMenuState.entityKey = entityKey;
      templateVariableMenuState.propertyQuery = '';
      templateVariableMenuState.dateSourceKey = '';
      templateVariableMenuState.formatQuery = '';
      templateVariableMenuState.activeIndex = 0;
      renderTemplateVariableMenu();
      return;
    }
    if (dateSourceKey && templateVariableMenuState.entityKey === 'date') {
      templateVariableMenuState.dateSourceKey = dateSourceKey;
      templateVariableMenuState.propertyQuery = dateSourceKey;
      templateVariableMenuState.formatQuery = '';
      templateVariableMenuState.activeIndex = 0;
      renderTemplateVariableMenu();
      return;
    }
    if (dateFormatKey && templateVariableMenuState.entityKey === 'date' && templateVariableMenuState.dateSourceKey) {
      insertTemplateVariableToken('date', templateVariableMenuState.dateSourceKey, dateFormatKey);
      return;
    }
    if (propertyKey && templateVariableMenuState.entityKey) {
      insertTemplateVariableToken(templateVariableMenuState.entityKey, propertyKey);
    }
  }

  function handleTemplateVariableKeydown(event) {
    var menu = el('officeTemplateVariableMenu');
    if (!templateVariableMenuState || !menu || menu.hidden) return false;
    var options = menu.querySelectorAll('.office-template-variable-option');
    if (event.key === 'Escape') {
      hideTemplateVariableMenu();
      return true;
    }
    if (!options.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      var delta = event.key === 'ArrowDown' ? 1 : -1;
      templateVariableMenuState.activeIndex = (templateVariableMenuState.activeIndex + delta + options.length) % options.length;
      renderTemplateVariableMenu();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      handleTemplateVariableOption(options[templateVariableMenuState.activeIndex || 0]);
      return true;
    }
    return false;
  }

  function syncActiveDocContent(options) {
    var opts = options || {};
    var file = activeFile();
    var page = fallbackDocPage();
    if (file && page) {
      var raw = page.innerHTML;
      var clean = cleanOfficeDocContent(raw);
      file.content = clean;
      file.updatedAt = nowIso();
      if (raw !== clean && /ReplaceDeleteInsert after|BIULinkFieldsApplyCancelAsk|office-selection-toolbar|lana-editor-selection-toolbar/.test(raw)) {
        page.innerHTML = renderDocContentWithReviewMarks(file);
      }
      if (opts.autosave !== false) {
        scheduleDocAutosave(file);
      } else {
        renderChrome();
      }
    }
  }

  function currentCleanDocHtml() {
    var page = fallbackDocPage();
    return page ? cleanOfficeDocContent(page.innerHTML) : '';
  }

  function pushDocUndoSnapshot(file, html) {
    if (!file || file.kind !== 'doc') return;
    var snapshot = typeof html === 'string' ? html : currentCleanDocHtml();
    if (!snapshot) return;
    file.undoStack = Array.isArray(file.undoStack) ? file.undoStack : [];
    if (file.undoStack[file.undoStack.length - 1] === snapshot) return;
    file.undoStack.push(snapshot);
    if (file.undoStack.length > DOC_HISTORY_LIMIT) file.undoStack.shift();
    file.redoStack = [];
  }

  function restoreDocHistorySnapshot(file, html) {
    var page = fallbackDocPage();
    if (!file || !page || typeof html !== 'string') return false;
    file.content = html;
    page.innerHTML = renderDocContentWithReviewMarks(file);
    file.updatedAt = nowIso();
    scheduleDocAutosave(file);
    syncDocumentToolbarState();
    renderChrome();
    renderFileList();
    renderReviewDock(file);
    return true;
  }

  function runNativeHistoryCommand(command) {
    var page = fallbackDocPage();
    if (!page) return false;
    var before = cleanOfficeDocContent(page.innerHTML);
    try {
      document.execCommand(command, false, null);
    } catch (_) {
      return false;
    }
    var after = cleanOfficeDocContent(page.innerHTML);
    if (after === before) return false;
    syncActiveDocContent();
    syncDocumentToolbarState();
    return true;
  }

  function applyDocHistoryCommand(command) {
    var file = activeFile();
    if (!file || file.kind !== 'doc') return false;
    if (runNativeHistoryCommand(command)) return true;
    var undo = command === 'undo';
    var source = undo ? file.undoStack : file.redoStack;
    var target = Array.isArray(source) ? source.pop() : null;
    if (typeof target !== 'string') return false;
    var current = currentCleanDocHtml();
    if (undo) {
      file.redoStack = Array.isArray(file.redoStack) ? file.redoStack : [];
      file.redoStack.push(current);
    } else {
      file.undoStack = Array.isArray(file.undoStack) ? file.undoStack : [];
      file.undoStack.push(current);
    }
    return restoreDocHistorySnapshot(file, target);
  }

  function unwrapNode(node) {
    var parent = node && node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
  }

  function clearFallbackSelectionMarks() {
    var page = fallbackDocPage();
    var selection = window.getSelection ? window.getSelection() : null;
    if (!page || !selection || selection.rangeCount === 0) return;
    var range = selection.getRangeAt(0);
    var marks = page.querySelectorAll('.office-comment-mark');
    for (var i = 0; i < marks.length; i += 1) {
      if (range.intersectsNode && range.intersectsNode(marks[i])) unwrapNode(marks[i]);
    }
  }

  function queryCommandState(command) {
    try {
      return document.queryCommandState(command);
    } catch (_) {
      return false;
    }
  }

  function queryCommandValue(command) {
    try {
      return String(document.queryCommandValue(command) || '').replace(/^<|>$/g, '').replaceAll('"', '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function officeParagraphStyleForBlock(block) {
    if (!block) return 'p';
    if (block.classList && block.classList.contains('office-doc-subheading')) return 'subheading';
    if (block.classList && block.classList.contains('office-doc-caption')) return 'caption';
    if (block.classList && block.classList.contains('office-doc-footnote')) return 'footnote';
    var tag = String(block.tagName || '').toLowerCase();
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'blockquote' || tag === 'pre') return tag;
    return 'p';
  }

  function closestDocBlock(node, page) {
    var current = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (current && current !== page) {
      if (current.matches && current.matches(DOC_BLOCK_SELECTOR)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function selectedDocBlocks() {
    var page = fallbackDocPage();
    var selection = window.getSelection ? window.getSelection() : null;
    if (!page || !selection || selection.rangeCount === 0) return [];
    var range = selection.getRangeAt(0);
    var blocks = [];
    var allBlocks = page.querySelectorAll(DOC_BLOCK_SELECTOR);
    for (var i = 0; i < allBlocks.length; i += 1) {
      var block = allBlocks[i];
      if (range.intersectsNode && range.intersectsNode(block)) blocks.push(block);
    }
    if (!blocks.length) {
      var anchorBlock = closestDocBlock(selection.anchorNode, page);
      if (anchorBlock) blocks.push(anchorBlock);
    }
    return blocks;
  }

  function replacementTagForParagraphStyle(style) {
    if (style === 'h1' || style === 'h2' || style === 'h3' || style === 'h4' || style === 'blockquote' || style === 'pre') return style;
    return 'p';
  }

  function classForParagraphStyle(style) {
    if (style === 'subheading') return 'office-doc-subheading';
    if (style === 'caption') return 'office-doc-caption';
    if (style === 'footnote') return 'office-doc-footnote';
    return '';
  }

  function replaceBlockTag(block, style) {
    var tag = replacementTagForParagraphStyle(style);
    var next = document.createElement(tag);
    next.innerHTML = block.innerHTML;
    var className = classForParagraphStyle(style);
    if (className) next.className = className;
    if (tag === 'pre') next.textContent = block.textContent || '';
    block.parentNode.replaceChild(next, block);
    return next;
  }

  function applyParagraphStyle(style) {
    var page = fallbackDocPage();
    var file = activeFile();
    if (!page) return false;
    if (typeof page.focus === 'function') page.focus();
    var blocks = selectedDocBlocks();
    if (!blocks.length) {
      try {
        document.execCommand('formatBlock', false, '<' + replacementTagForParagraphStyle(style) + '>');
      } catch (_) {}
      blocks = selectedDocBlocks();
    }
    if (!blocks.length) return false;
    pushDocUndoSnapshot(file, currentCleanDocHtml());
    var selection = window.getSelection ? window.getSelection() : null;
    var firstReplacement = null;
    blocks.forEach(function (block) {
      var replacement = replaceBlockTag(block, style);
      if (!firstReplacement) firstReplacement = replacement;
    });
    if (selection && firstReplacement) {
      var range = document.createRange();
      range.selectNodeContents(firstReplacement);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    syncActiveDocContent();
    syncDocumentToolbarState();
    return true;
  }

  function syncDocumentToolbarState() {
    var page = el('officeDocPage');
    var toolbars = document.querySelectorAll('.office-doc-toolbar, .office-selection-toolbar');
    if (!page || !toolbars.length) return;
    var file = activeFile();
    var embed = file && editorForFile(file);
    syncOfficeHistoryControls(file, embed);
    if (file && isServerReviewFile(file) && embed && typeof embed.selectionFormatState === 'function') {
      var embedState = null;
      try { embedState = embed.selectionFormatState(); } catch (_) { embedState = null; }
      if (embedState) {
        var embedCommands = {
          bold: embedState.bold,
          italic: embedState.italic,
          underline: embedState.underline,
          strikeThrough: embedState.strike,
          superscript: embedState.superscript,
          subscript: embedState.subscript,
          insertUnorderedList: embedState.list && embedState.list !== 'mixed' && embedState.list.kind === 'bullet',
          insertOrderedList: embedState.list && embedState.list !== 'mixed' && embedState.list.kind === 'ordered',
          justifyLeft: embedState.align === 'left',
          justifyCenter: embedState.align === 'center',
          justifyRight: embedState.align === 'right',
          justifyFull: embedState.align === 'both'
        };
        Object.keys(embedCommands).forEach(function (command) {
          document.querySelectorAll('[data-command="' + command + '"]').forEach(function (node) {
            var active = embedCommands[command] === true;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-pressed', active ? 'true' : 'false');
          });
        });
        var styleSelect = document.querySelector('.office-doc-toolbar select[data-command="formatBlock"]');
        if (styleSelect && embedState.style !== 'mixed') {
          var styleValues = {
            Heading1: 'h1', Heading2: 'h2', Heading3: 'h3', Heading4: 'h4',
            Subtitle: 'subheading', Quote: 'blockquote', Code: 'pre', Caption: 'caption', FootnoteText: 'footnote'
          };
          styleSelect.value = styleValues[embedState.style] || 'p';
        }
        return;
      }
    }
    var activeCommands = [
      'bold',
      'italic',
      'underline',
      'strikeThrough',
      'superscript',
      'subscript',
      'insertUnorderedList',
      'insertOrderedList',
      'justifyLeft',
      'justifyCenter',
      'justifyRight',
      'justifyFull'
    ];
    activeCommands.forEach(function (command) {
      var nodes = document.querySelectorAll('.office-doc-toolbar [data-command="' + command + '"], .office-selection-toolbar [data-command="' + command + '"]');
      for (var i = 0; i < nodes.length; i += 1) {
        nodes[i].classList.toggle('is-active', queryCommandState(command));
      }
    });

    var blockSelect = document.querySelector('.office-doc-toolbar select[data-command="formatBlock"]');
    if (blockSelect) {
      var blocks = selectedDocBlocks();
      var normalized = blocks.length ? officeParagraphStyleForBlock(blocks[0]) : queryCommandValue('formatBlock');
      if (normalized.indexOf('heading') === 0) normalized = 'h' + normalized.replace(/[^0-9]/g, '');
      if (normalized === 'div' || normalized === '') normalized = 'p';
      if (blockSelect.querySelector('option[value="' + normalized + '"]')) blockSelect.value = normalized;
    }
    var fontSelect = document.querySelector('.office-doc-toolbar select[data-command="fontName"]');
    if (fontSelect) {
      var font = queryCommandValue('fontName');
      for (var f = 0; f < fontSelect.options.length; f += 1) {
        if (fontSelect.options[f].value.toLowerCase() === font) {
          fontSelect.value = fontSelect.options[f].value;
          break;
        }
      }
    }
    var sizeSelect = document.querySelector('.office-doc-toolbar select[data-command="fontSize"]');
    var size = queryCommandValue('fontSize');
    if (sizeSelect && sizeSelect.querySelector('option[value="' + size + '"]')) sizeSelect.value = size;
  }

  function updateSelectionToolbar() {
    var toolbar = el('officeSelectionToolbar');
    if (!toolbar) return;
    var selection = selectionInsideDoc();
    var text = selection ? String(selection.toString() || '').trim() : '';
    if (!text || !selection.rangeCount) {
      toolbar.hidden = true;
      toolbar.style.left = '';
      toolbar.style.top = '';
      syncDocumentToolbarState();
      return;
    }

    var rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) {
      toolbar.hidden = true;
      syncDocumentToolbarState();
      return;
    }

    toolbar.hidden = false;
    var width = toolbar.offsetWidth || 220;
    var height = toolbar.offsetHeight || 42;
    var gap = 10;
    var left = rect.left + (rect.width / 2) - (width / 2);
    var top = rect.top - height - gap;

    if (top < 8) top = rect.bottom + gap;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));

    toolbar.style.left = Math.round(left) + 'px';
    toolbar.style.top = Math.round(top) + 'px';
    syncDocumentToolbarState();
  }

  function addSelectionComment() {
    var file = activeFile();
    var text = savedDocText();
    if (!file || !text) return;
    restoreDocSelection();
    try {
      document.execCommand('insertHTML', false, '<span class="office-comment-mark" data-office-comment="true">' + esc(text) + '</span>');
      fallbackDocSelectionRange = null;
      syncActiveDocContent({ autosave: false });
    } catch (_) {}
    file.reviewBaselineContent = file.content || '';
    file.reviewChanges = file.reviewChanges || [];
    file.reviewChanges.unshift({
      type: 'Comment',
      status: 'Open',
      text: text.slice(0, 180)
    });
    file.activities = file.activities || [];
    file.activities.unshift('Comment added to selected text.');
    file.lastSavedAt = nowIso();
    file.updatedAt = file.lastSavedAt;
    saveState();
    renderChrome();
    renderFileList();
    renderReviewDock(file);
    toast('Selection comment added.');
  }

  function askLanaAboutSelection() {
    var text = savedDocText();
    var prompt = text
      ? 'Review this selected text and suggest a safer draft:\n\n' + text
      : 'Review this document and suggest improvements.';
    openLanaDockWithActiveFile(prompt, text ? {
      type: 'office_selection',
      context_type: 'editor_selection',
      summary: 'Selected text from the Office document',
      selection: {
        text: text,
        length: text.length
      }
    } : {
      type: 'office_document_review',
      context_type: 'office_document',
      summary: 'Review the active Office document'
    });
  }

  function selectedServerReviewAnchor() {
    var root = document.querySelector('#officeLanaEditorHost .lana-editor-viewer');
    var selection = window.getSelection ? window.getSelection() : null;
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    var anchor = selection.anchorNode;
    var focus = selection.focusNode;
    if (!anchor || !focus || !root.contains(anchor) || !root.contains(focus)) return null;
    var rawSelectionText = String(selection.toString() || '');
    var selectedText = rawSelectionText.trim().slice(0, 500);
    if (!selectedText) return null;
    var result = { text: selectedText };
    var tools = collaborationTools();
    if (!tools || typeof tools.buildCommentAnchor !== 'function') return result;
    try {
      var range = selection.getRangeAt(0);
      var prefixRange = document.createRange();
      prefixRange.selectNodeContents(root);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      var start = prefixRange.toString().length + Math.max(0, rawSelectionText.indexOf(selectedText));
      var persisted = tools.buildCommentAnchor(root.textContent || '', start, start + selectedText.length, selectedText);
      if (persisted) Object.assign(result, persisted);
    } catch (_) {}
    return result;
  }

  function promptAddServerReviewComment(file) {
    var review = serverReview(file);
    if (!review) return;
    // Capture the anchor before opening the modal because moving focus to the
    // textarea collapses the browser selection inside the embedded editor.
    var anchor = selectedServerReviewAnchor();
    var anchorText = anchor ? anchor.text : '';
    var add = function (text) {
      var value = String(text || '').trim();
      if (!value) return;
      var id = 'comment-' + Date.now().toString(36);
      review.comments.push(normalizeServerReviewThread({
        id: id,
        thread_id: id,
        author: currentReviewerName(),
        author_id: currentReviewerIdentity(),
        date: nowIso(),
        text: value,
        scope: anchorText ? 'selection' : 'document',
        anchor_text: anchorText,
        anchor_id: anchorText ? 'anchor-' + id : '',
        anchor_start: anchor && anchor.anchor_start,
        anchor_end: anchor && anchor.anchor_end,
        anchor_prefix: anchor && anchor.anchor_prefix,
        anchor_suffix: anchor && anchor.anchor_suffix,
        status: 'open',
        replies: []
      }));
      applyServerReviewToFile(file);
      renderReviewDock(file);
      scheduleServerDraftSave(file);
    };
    if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') {
      var modal = Lex.Modal.open({
        heading: 'Add Comment',
        size: 'sm',
        content: '<div class="office-edit-change-modal">' +
          '<label for="officeReviewCommentText">Comment</label>' +
          '<textarea id="officeReviewCommentText" rows="4" placeholder="Add a review comment"></textarea>' +
        '</div>',
        confirmText: 'Add Comment',
        cancelText: 'Cancel',
        onConfirm: function () {
          var input = document.getElementById('officeReviewCommentText');
          add(input && typeof input.value === 'string' ? input.value : '');
        }
      });
      setTimeout(function () {
        var input = modal && modal.querySelector ? modal.querySelector('#officeReviewCommentText') : document.getElementById('officeReviewCommentText');
        if (input && typeof input.focus === 'function') input.focus();
      }, 0);
      return;
    }
    var fallback = window.prompt('Add a review comment', '');
    if (fallback !== null) add(fallback);
  }

  function serverReviewThreadById(file, commentId) {
    var review = serverReview(file);
    var id = String(commentId || '');
    if (!review || !id) return null;
    for (var index = 0; index < review.comments.length; index += 1) {
      var normalized = normalizeServerReviewThread(review.comments[index]);
      if (!normalized) continue;
      review.comments[index] = normalized;
      if (normalized.id === id) return normalized;
    }
    return null;
  }

  function textBoundaryAtOffset(root, offset) {
    if (!root || !Number.isInteger(offset) || offset < 0) return null;
    var nodeFilter = window.NodeFilter || { SHOW_TEXT: 4 };
    var walker = document.createTreeWalker(root, nodeFilter.SHOW_TEXT);
    var consumed = 0;
    var node;
    var last = null;
    while ((node = walker.nextNode())) {
      last = node;
      var length = String(node.nodeValue || '').length;
      if (offset <= consumed + length) return { node: node, offset: offset - consumed };
      consumed += length;
    }
    if (last && offset === consumed) return { node: last, offset: String(last.nodeValue || '').length };
    return null;
  }

  function clearOfficeReviewCommentFocus(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.office-review-comment-focus').forEach(function (node) {
      node.classList.remove('office-review-comment-focus');
      delete node.dataset.reviewCommentAnchor;
    });
  }

  function locateOfficeReviewComment(file, commentId) {
    var thread = serverReviewThreadById(file, commentId);
    if (!thread || thread.scope !== 'selection' || !thread.anchor_text) {
      toast('This comment has no document selection to locate.');
      return;
    }
    var root = document.querySelector('#officeLanaEditorHost .lana-editor-viewer') || fallbackDocPage();
    var tools = collaborationTools();
    if (!root || !tools || typeof tools.resolveCommentAnchor !== 'function') {
      toast('The document location is not available yet.');
      return;
    }
    var location = tools.resolveCommentAnchor(root.textContent || '', thread);
    if (!location) {
      toast('The commented text is no longer present in this draft.');
      return;
    }
    var start = textBoundaryAtOffset(root, location.start);
    var end = textBoundaryAtOffset(root, location.end);
    if (!start || !end) {
      toast('The comment location could not be mapped into this document view.');
      return;
    }
    var range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch (_) {
      toast('The comment location could not be selected.');
      return;
    }
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    clearOfficeReviewCommentFocus(root);
    var focusNode = start.node.parentElement && start.node.parentElement.closest
      ? start.node.parentElement.closest('.le-p,p,h1,h2,h3,h4,h5,h6,blockquote,pre,li,div')
      : start.node.parentElement;
    if (!focusNode || !root.contains(focusNode)) focusNode = start.node.parentElement || root;
    focusNode.classList.add('office-review-comment-focus');
    focusNode.dataset.reviewCommentAnchor = thread.anchor_id || thread.id;
    focusNode.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    setTimeout(function () {
      if (focusNode && focusNode.classList) focusNode.classList.remove('office-review-comment-focus');
    }, 4000);
    toast(location.strategy === 'persisted-range'
      ? 'Comment located at its saved selection.'
      : 'Comment located by matching its selected text.');
  }

  function commitServerReviewCommentUpdate(file, message) {
    var review = serverReview(file);
    if (!review) return;
    review.dirty = true;
    applyServerReviewToFile(file);
    renderReviewDock(file);
    scheduleServerDraftSave(file);
    if (message) toast(message);
  }

  function promptReplyServerReviewComment(file, commentId) {
    var thread = serverReviewThreadById(file, commentId);
    if (!thread) {
      toast('The comment thread is no longer available.');
      return;
    }
    var addReply = function (text) {
      var value = String(text || '').trim();
      if (!value) return;
      var timestamp = nowIso();
      thread.replies.push(normalizeServerReviewReply({
        id: 'reply-' + Date.now().toString(36),
        thread_id: thread.id,
        parent_id: thread.id,
        author: currentReviewerName(),
        author_id: currentReviewerIdentity(),
        date: timestamp,
        text: value
      }, thread.id));
      thread.updated_at = timestamp;
      commitServerReviewCommentUpdate(file, 'Reply added.');
    };
    if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') {
      var modal = Lex.Modal.open({
        heading: 'Reply to Comment',
        size: 'sm',
        content: '<div class="office-edit-change-modal">' +
          '<p class="office-review-comment-quote">' + esc(thread.text) + '</p>' +
          '<label for="officeReviewCommentReplyText">Reply</label>' +
          '<textarea id="officeReviewCommentReplyText" rows="4" placeholder="Add a reply"></textarea>' +
        '</div>',
        confirmText: 'Add Reply',
        cancelText: 'Cancel',
        onConfirm: function () {
          var input = document.getElementById('officeReviewCommentReplyText');
          addReply(input && typeof input.value === 'string' ? input.value : '');
        }
      });
      setTimeout(function () {
        var input = modal && modal.querySelector ? modal.querySelector('#officeReviewCommentReplyText') : document.getElementById('officeReviewCommentReplyText');
        if (input && typeof input.focus === 'function') input.focus();
      }, 0);
      return;
    }
    var fallback = window.prompt('Reply to comment', '');
    if (fallback !== null) addReply(fallback);
  }

  function setServerReviewCommentResolved(file, commentId, resolved) {
    var thread = serverReviewThreadById(file, commentId);
    if (!thread) {
      toast('The comment thread is no longer available.');
      return;
    }
    var timestamp = nowIso();
    thread.status = resolved ? 'resolved' : 'open';
    thread.resolved_at = resolved ? timestamp : null;
    thread.resolved_by = resolved ? currentReviewerIdentity() : null;
    thread.updated_at = timestamp;
    commitServerReviewCommentUpdate(file, resolved ? 'Comment resolved.' : 'Comment reopened.');
  }

  function serverReviewRowAtIndex(file, index) {
    if (!file || !file.review || !Array.isArray(file.review.changes) || !Number.isFinite(Number(index))) return null;
    for (var i = 0; i < file.review.changes.length; i++) {
      var row = file.review.changes[i];
      if (row && row.serverSection === 'unreleased' && Number(row.sourceIndex) === Number(index)) return row;
    }
    return null;
  }

  function promptEditServerReviewChange(file, row) {
    var currentText = String(row.after || '');
    var run = function (nextText) {
      editServerReviewChange(file, row, nextText).catch(function (error) {
        toast((error && error.message) || 'Failed to edit review change.');
      });
    };
    if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') {
      var modal = Lex.Modal.open({
        heading: 'Edit Draft Change',
        size: 'md',
        content: '<div class="office-edit-change-modal">' +
          '<p>Edit the proposed text for this unreleased change. The pending tracked change is replaced with a new tracked change at the same document location.</p>' +
          '<label for="officeEditChangeText">Proposed text</label>' +
          '<textarea id="officeEditChangeText" rows="6">' + esc(currentText) + '</textarea>' +
        '</div>',
        confirmText: 'Update Change',
        cancelText: 'Cancel',
        onConfirm: function () {
          var input = document.getElementById('officeEditChangeText');
          run(input && typeof input.value === 'string' ? input.value : currentText);
        }
      });
      setTimeout(function () {
        var input = modal && modal.querySelector ? modal.querySelector('#officeEditChangeText') : document.getElementById('officeEditChangeText');
        if (input && typeof input.focus === 'function') input.focus();
      }, 0);
      return;
    }
    var fallback = window.prompt('Edit proposed text', currentText);
    if (fallback !== null) run(fallback);
  }

  var EMBED_MARK_COMMANDS = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strikeThrough: 'strike',
    superscript: 'superscript',
    subscript: 'subscript'
  };

  function embedEditorReady(file) {
    return Boolean(officeEditorInstance && officeEditorFileId === file.id &&
      typeof officeEditorInstance.applyEdits === 'function');
  }

  function handleEmbedToolbarCommand(file, command, value) {
    var ranges = embedToolbarSelectionRanges;
    embedToolbarSelectionRanges = null;
    if (command === 'undo' || command === 'redo') {
      applyEmbedHistoryCommand(file, command);
      return;
    }
    if (EMBED_MARK_COMMANDS[command]) {
      applyEmbedMarkCommand(file, EMBED_MARK_COMMANDS[command], ranges);
      return;
    }
    if (command === 'foreColor' || command === 'hiliteColor' || command === 'fontName' || command === 'fontSize') {
      var sizeMap = { 2: 10, 3: 12, 4: 16, 5: 24, 6: 32 };
      var marks = command === 'foreColor'
        ? { color: value || '#111111' }
        : command === 'hiliteColor'
          ? { highlight: value || '#fff3a3' }
          : command === 'fontName'
            ? { font: value || 'Arial' }
            : { size: sizeMap[value] || Number(value) || 12 };
      applyEmbedTextFormat(file, marks, ranges);
      return;
    }
    var paragraphSet = null;
    if (command === 'formatBlock') {
      var styleMap = {
        p: null,
        h1: 'Heading1',
        h2: 'Heading2',
        h3: 'Heading3',
        h4: 'Heading4',
        subheading: 'Subtitle',
        blockquote: 'Quote',
        pre: 'Code',
        caption: 'Caption',
        footnote: 'FootnoteText'
      };
      paragraphSet = { style: Object.prototype.hasOwnProperty.call(styleMap, value) ? styleMap[value] : null };
    } else if (command === 'insertUnorderedList') {
      paragraphSet = { list: { kind: 'bullet', level: 0 } };
    } else if (command === 'insertOrderedList') {
      paragraphSet = { list: { kind: 'ordered', level: 0 } };
    } else if (command === 'outdent' || command === 'indent') {
      paragraphSet = { indent: command === 'outdent' ? -1 : 1 };
    } else if (command === 'justifyLeft' || command === 'justifyCenter' || command === 'justifyRight' || command === 'justifyFull') {
      paragraphSet = { align: {
        justifyLeft: 'left',
        justifyCenter: 'center',
        justifyRight: 'right',
        justifyFull: 'both'
      }[command] };
    }
    if (paragraphSet) {
      applyEmbedParagraphFormat(file, paragraphSet, ranges);
      return;
    }
    if (command === 'createLink') {
      var href = window.prompt ? window.prompt('Paste a URL') : '';
      if (href) applyEmbedLinkCommand(file, href, ranges);
      return;
    }
    if (command === 'unlink') {
      applyEmbedLinkCommand(file, null, ranges);
      return;
    }
    if (command === 'insertHorizontalRule') {
      applyEmbedHorizontalRule(file, ranges);
      return;
    }
    if (command === 'removeFormat') {
      clearEmbedFormatting(file, ranges);
    }
  }

  async function applyEmbedHistoryCommand(file, command) {
    if (!embedEditorReady(file) || typeof officeEditorInstance[command] !== 'function') {
      syncOfficeHistoryControls(file);
      toast(command === 'undo' ? 'Undo is not available for this document yet.' : 'Redo is not available for this document yet.');
      return;
    }
    try {
      var changed = await officeEditorInstance[command]();
      if (!changed) {
        toast(command === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.');
        return;
      }
      var reviewState = null;
      try { reviewState = officeEditorInstance.reviewState(); } catch (_) {}
      handleServerEmbedEvent(file, reviewState);
    } catch (error) {
      toast((error && error.message) || 'The action could not be completed.');
    } finally {
      syncOfficeHistoryControls(file, officeEditorInstance);
    }
  }

  async function applyEmbedMarkCommand(file, mark, ranges) {
    if (!embedEditorReady(file)) {
      toast('Formatting requires the LANA Editor connection.');
      return;
    }
    try {
      if (typeof officeEditorInstance.flushPendingEdits === 'function') {
        await officeEditorInstance.flushPendingEdits();
      }
      if (typeof officeEditorInstance.toggleSelectionMark !== 'function') {
        throw new Error('The connected LANA Editor does not support tracked formatting yet.');
      }
      await officeEditorInstance.toggleSelectionMark(mark, ranges || undefined);
    } catch (error) {
      toast((error && error.message) || 'The formatting change could not be applied.');
    }
  }

  async function applyEmbedTextFormat(file, marks, ranges) {
    if (!embedEditorReady(file) || typeof officeEditorInstance.formatSelection !== 'function') {
      toast('Formatting requires the LANA Editor connection.');
      return;
    }
    try {
      await officeEditorInstance.formatSelection(marks, ranges || undefined);
    } catch (error) {
      toast((error && error.message) || 'The formatting change could not be applied.');
    }
  }

  async function applyEmbedParagraphFormat(file, set, ranges) {
    if (!embedEditorReady(file) || typeof officeEditorInstance.formatParagraphs !== 'function') {
      toast('Paragraph formatting requires the LANA Editor connection.');
      return;
    }
    try {
      await officeEditorInstance.formatParagraphs(set, ranges || undefined);
    } catch (error) {
      toast((error && error.message) || 'The paragraph formatting could not be applied.');
    }
  }

  async function applyEmbedLinkCommand(file, href, ranges) {
    if (!embedEditorReady(file)) return;
    if (href) {
      try {
        var parsedHref = new URL(href);
        if (['http:', 'https:', 'mailto:'].indexOf(parsedHref.protocol) === -1) throw new Error('Unsupported link protocol.');
        href = parsedHref.href;
      } catch (_) {
        toast('Enter a valid http, https, or mailto URL.');
        return;
      }
    }
    var selected = ranges || (typeof officeEditorInstance.selectionRanges === 'function' ? officeEditorInstance.selectionRanges() : []);
    if (!selected.length) {
      toast('Select the text to link first.');
      return;
    }
    try {
      if (typeof officeEditorInstance.linkSelection === 'function') {
        await officeEditorInstance.linkSelection(href, selected);
        return;
      }
      var ops = selected.map(function (range) {
        return {
          op: 'replaceText',
          range: { paragraph: range.paragraph, start: range.start, end: range.end },
          text: range.text,
          runs: [{ text: range.text, href: href || undefined }]
        };
      });
      await officeEditorInstance.applyEdits(ops);
    } catch (error) {
      toast((error && error.message) || 'The link change could not be applied.');
    }
  }

  async function applyEmbedHorizontalRule(file, ranges) {
    applyEmbedParagraphFormat(file, { horizontalRule: true }, ranges);
  }

  async function clearEmbedFormatting(file, ranges) {
    if (!embedEditorReady(file)) return;
    try {
      if (typeof officeEditorInstance.linkSelection === 'function') {
        await officeEditorInstance.linkSelection(null, ranges || undefined);
      }
      if (typeof officeEditorInstance.formatSelection === 'function') {
        await officeEditorInstance.formatSelection({
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          superscript: false,
          subscript: false,
          color: 'auto',
          highlight: 'none',
          font: null,
          size: null
        }, ranges || undefined);
      }
      if (typeof officeEditorInstance.formatParagraphs === 'function') {
        await officeEditorInstance.formatParagraphs({ style: null, align: null, list: null, indent: null, horizontalRule: null }, ranges || undefined);
      }
    } catch (error) {
      toast((error && error.message) || 'Formatting could not be cleared.');
    }
  }

  function activateOfficePanel(name, options) {
    var allowed = ['editor', 'collaboration', 'signatures'];
    activePanel = allowed.indexOf(name) === -1 ? 'editor' : name;
    if (activePanel === 'signatures' && options && options.newPacket) {
      var signatureRemote = remoteWorkflowForFile(activeFile());
      if (signatureRemote) signatureRemote.selectedPacketId = 'new';
    }
    renderRemotePanels(activeFile());
    applyActivePanel();
  }

  async function renameServerDocument(file, nextName) {
    var name = String(nextName || '').trim();
    if (!file || !name) throw new Error('A file name is required.');
    if (!isServerWorkflowFile(file)) {
      file.title = name;
      file.filename = name;
      setUpdated(file);
      return;
    }
    if (!window.api || typeof window.api.post !== 'function') throw new Error('The API client is unavailable.');
    var documentId = officeRealDocumentId(file);
    var response = await window.api.post('/api/v1/files/' + encodeURIComponent(documentId) + '/rename', { new_filename: name });
    if (!response || response.success === false) {
      throw new Error((response && (response.error || response.message || response.detail)) || 'The file could not be renamed.');
    }
    file.title = name;
    file.filename = name;
    file.updatedAt = nowIso();
    renderChrome();
    renderFileList();
    renderRemotePanels(file);
  }

  async function addCollaboratorFromQuery(file, query, permissions) {
    var search = String(query || '').trim();
    if (!search) throw new Error('Enter a collaborator name or email.');
    if (!window.api || typeof window.api.searchMentions !== 'function') {
      throw new Error('The user directory is unavailable.');
    }
    var payload = await window.api.searchMentions({ q: search, matter_id: file.matterId || undefined, limit: 40 });
    var candidates = collectMentionUsers(payload);
    var lower = search.toLowerCase();
    var user = candidates.find(function (candidate) {
      return candidate.id === search || candidate.email.toLowerCase() === lower || candidate.label.toLowerCase() === lower;
    }) || (candidates.length === 1 ? candidates[0] : null);
    if (!user) throw new Error(candidates.length ? 'Choose a more specific name or email.' : 'No eligible user matched that search.');
    var service = collaborationApi();
    if (!service) throw new Error('The collaboration service is unavailable.');
    await service.addCollaborator(officeRealDocumentId(file), {
      user_id: user.id,
      permissions: permissions
    });
    await loadRemoteWorkflows(file, { force: true });
    toast('Document access granted to ' + user.label + '.');
  }

  async function addWorkspaceCollaborator(file, workspaceId, permissions) {
    var id = String(workspaceId || '').trim();
    if (!id) throw new Error('Choose a workspace.');
    var service = collaborationApi();
    if (!service) throw new Error('The collaboration service is unavailable.');
    var collaborator = await service.addCollaborator(officeRealDocumentId(file), {
      target_type: 'workspace',
      workspace_id: id,
      permissions: permissions
    });
    await loadRemoteWorkflows(file, { force: true });
    toast('Document access granted to ' + (collaborator.name || 'the workspace') + '.');
  }

  async function loadShareWorkspaceOptions(file) {
    var select = el('officeShareWorkspace');
    if (!select || !window.api || typeof window.api.getMatters !== 'function') return;
    try {
      var response = await window.api.getMatters(1, 250, {
        status: 'active',
        sort_by: 'updated_at',
        sort_order: 'desc'
      });
      var currentMatter = String(file && (file.matterId || file.matter_id) || '');
      var rows = officeMatterRows(response).map(function (row) {
        return {
          id: String(row.id || row.uuid || row.client_matter || ''),
          name: String(row.workspace_name || row.matter_name || row.name || row.title || row.matter_id || 'Workspace')
        };
      }).filter(function (row) {
        return row.id && row.id !== currentMatter;
      });
      select.innerHTML = '<option value="">Choose a workspace</option>' + rows.map(function (row) {
        return '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>';
      }).join('');
      select.disabled = rows.length === 0;
      if (!rows.length) select.innerHTML = '<option value="">No other active workspaces</option>';
    } catch (error) {
      select.innerHTML = '<option value="">Workspaces unavailable</option>';
      select.disabled = true;
    }
  }

  function syncShareTargetFields() {
    var type = el('officeShareTargetType');
    var value = type ? type.value : 'user';
    var userFields = el('officeShareUserFields');
    var workspaceFields = el('officeShareWorkspaceFields');
    if (userFields) userFields.hidden = value !== 'user';
    if (workspaceFields) workspaceFields.hidden = value !== 'workspace';
  }

  function openShareDialog(file) {
    if (!file || !isServerWorkflowFile(file)) {
      toast('Sharing requires a server-managed document.');
      return;
    }
    var submit = function () {
      var input = el('officeShareUserQuery');
      var targetType = el('officeShareTargetType');
      var workspace = el('officeShareWorkspace');
      var permission = el('officeSharePermission');
      var operation = targetType && targetType.value === 'workspace'
        ? addWorkspaceCollaborator(file, workspace ? workspace.value : '', permission ? [permission.value] : ['read'])
        : addCollaboratorFromQuery(file, input ? input.value : '', permission ? [permission.value] : ['read']);
      operation.catch(function (error) {
        toast((error && error.message) || 'The collaborator could not be added.');
      });
    };
    if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') {
      Lex.Modal.open({
        heading: 'Share Document',
        size: 'sm',
        content: '<div class="office-signer-form"><label for="officeShareTargetType">Share with</label>' +
          '<select id="officeShareTargetType" class="office-format-select"><option value="user">Person</option><option value="workspace">Workspace</option></select>' +
          '<div id="officeShareUserFields"><label for="officeShareUserQuery">User name or email</label><input id="officeShareUserQuery" type="search" autocomplete="off" placeholder="person@example.com"></div>' +
          '<div id="officeShareWorkspaceFields" hidden><label for="officeShareWorkspace">Workspace</label><select id="officeShareWorkspace" class="office-format-select" disabled><option value="">Loading workspaces...</option></select></div>' +
          '<label for="officeSharePermission">Permission</label><select id="officeSharePermission" class="office-format-select"><option value="read">Can view</option><option value="write">Can edit</option></select></div>',
        confirmText: 'Grant access',
        cancelText: 'Cancel',
        onConfirm: submit
      });
      setTimeout(function () {
        var input = el('officeShareUserQuery');
        if (input) input.focus();
        var type = el('officeShareTargetType');
        if (type) type.addEventListener('change', syncShareTargetFields);
        loadShareWorkspaceOptions(file);
      }, 0);
      return;
    }
    var query = window.prompt ? window.prompt('Collaborator name or email') : '';
    if (query) addCollaboratorFromQuery(file, query, ['read']).catch(function (error) { toast(error.message); });
  }

  async function removeCollaborator(file, collaboratorId) {
    var service = collaborationApi();
    if (!service) throw new Error('The collaboration service is unavailable.');
    await service.removeCollaborator(officeRealDocumentId(file), collaboratorId);
    await loadRemoteWorkflows(file, { force: true });
    toast('Collaborator access removed.');
  }

  function confirmRemoveCollaborator(file, collaboratorId) {
    var remote = remoteWorkflowForFile(file);
    var id = String(collaboratorId || '');
    var collaborator = remote && remote.collaborators.find(function (row) {
      return String(row.id || '') === id;
    });
    if (!collaborator) {
      toast('That collaborator grant is no longer available.');
      return;
    }
    var remove = function () {
      removeCollaborator(file, id).catch(function (error) {
        toast((error && error.message) || 'Collaborator access could not be removed.');
      });
    };
    if (window.Lex && Lex.Modal && typeof Lex.Modal.open === 'function') {
      Lex.Modal.open({
        heading: 'Remove Document Access',
        size: 'sm',
        content: '<div class="office-edit-change-modal"><p>Remove <strong>' + esc(collaborator.name) +
          '</strong> from this document? The document and its review history will not be deleted.</p></div>',
        confirmText: 'Remove access',
        cancelText: 'Keep access',
        destructive: true,
        onConfirm: remove
      });
      return;
    }
    if (window.confirm && window.confirm('Remove ' + collaborator.name + ' from this document?')) remove();
  }

  async function sendSignaturePacket(file) {
    var remote = remoteWorkflowForFile(file);
    var service = collaborationApi();
    if (!service || !remote || !remote.stagedSigners.length) throw new Error('Add at least one signer first.');
    var packet = await service.createSignaturePacket(officeRealDocumentId(file), {
      title: file.filename || file.title,
      signers: remote.stagedSigners.map(function (signer, index) {
        return { name: signer.name, email: signer.email, signing_order: index + 1 };
      })
    });
    remote.stagedSigners = [];
    remote.selectedPacketId = packet.id;
    await loadRemoteWorkflows(file, { force: true });
    var deliveryMessage = packet.status === 'sent'
      ? 'Signature packet sent.'
      : packet.status === 'partially_sent'
        ? 'Signature packet created; some deliveries require attention.'
        : packet.status === 'delivery_failed'
          ? 'Signature packet created, but delivery failed or is unavailable.'
          : 'Signature packet created with status: ' + packet.status.replaceAll('_', ' ') + '.';
    toast(deliveryMessage);
  }

  async function runSignaturePacketAction(file, packetId, action) {
    var service = collaborationApi();
    if (!service) throw new Error('The signature service is unavailable.');
    var documentId = officeRealDocumentId(file);
    if (action === 'cancel') await service.cancelSignaturePacket(documentId, packetId, {});
    else await service.resendSignaturePacket(documentId, packetId, {});
    await loadRemoteWorkflows(file, { force: true });
    toast(action === 'cancel' ? 'Signature packet cancelled.' : 'Signature packet resent.');
  }

  async function respondToSignaturePacket(file, packetId, signerId, status) {
    var service = collaborationApi();
    if (!service) throw new Error('The signature service is unavailable.');
    var details = {};
    if (status === 'signed') {
      var packet = signaturePacketById(remoteWorkflowForFile(file), packetId);
      var consentDisclosure = packet && packet.signature_consent_disclosure;
      if (typeof consentDisclosure !== 'string' || !consentDisclosure.trim()) {
        throw new Error('This signature packet does not include the server-provided electronic signature disclosure. Signing is unavailable.');
      }
      var current = currentUserRecord() || {};
      var defaultSignature = current.full_name || current.fullName || current.display_name ||
        [current.first_name || '', current.last_name || ''].join(' ').trim();
      var signatureText = window.prompt ? window.prompt('Type your legal signature to confirm consent', defaultSignature || '') : '';
      if (!signatureText) return;
      if (!window.confirm || !window.confirm(consentDisclosure + '\n\nApply the typed signature "' + signatureText + '"?')) return;
      details = {
        consent: true,
        consent_disclosure: consentDisclosure,
        signature_text: signatureText,
        signature_method: 'typed'
      };
    } else {
      var reason = window.prompt ? window.prompt('Reason for declining (optional)', '') : '';
      if (reason === null) return;
      details = { decline_reason: reason || undefined };
    }
    await service.updateSignerStatus(officeRealDocumentId(file), packetId, signerId, status, details);
    await loadRemoteWorkflows(file, { force: true });
    toast(status === 'signed' ? 'Signature recorded.' : 'Signature request declined.');
  }

  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    document.addEventListener('lex-lana-response-end', function (event) {
      handleLanaDocumentEditSuggestion(event && event.detail ? event.detail : {});
    });

    function applyDocumentCommand(commandTarget) {
      if (!commandTarget) return;
      var command = commandTarget.dataset.command;
      if (!command) return;
      var value = commandTarget.dataset.value || commandTarget.value || null;
      var commandFile = activeFile();
      if (commandFile && isServerReviewFile(commandFile)) {
        handleEmbedToolbarCommand(commandFile, command, value);
        return;
      }
      var isSelectionToolbarCommand = Boolean(commandTarget.closest && commandTarget.closest('#officeSelectionToolbar'));
      if (isSelectionToolbarCommand) restoreDocSelection();
      if ((command === 'undo' || command === 'redo') && applyDocHistoryCommand(command)) {
        return;
      }
      if (command === 'formatBlock') {
        applyParagraphStyle(value || 'p');
        return;
      }
      if (command === 'createLink') {
        value = window.prompt ? window.prompt('Paste a URL') : '';
        if (!value) return;
      }
      var page = fallbackDocPage();
      if (page && typeof page.focus === 'function') page.focus();
      try {
        document.execCommand(command, false, value);
        if (command === 'removeFormat') {
          document.execCommand('unlink', false, null);
          clearFallbackSelectionMarks();
        }
      } catch (e) {
        if (command === 'hiliteColor') document.execCommand('backColor', false, value);
      }
      if (command !== 'undo' && command !== 'redo') selectionInsideDoc();
      syncActiveDocContent();
    }

    document.addEventListener('topbar-back-click', function (event) {
      if (!el('officeEditorPanel')) return;
      event.preventDefault();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      navigateBackFromEditor();
    }, true);

    window.addEventListener('beforeunload', function (event) {
      if (leavingEditor || !activeServerReviewHasPendingWork()) return;
      event.preventDefault();
      event.returnValue = '';
    });

    document.addEventListener('click', function (event) {
      var variableTarget = event.target.closest('[data-template-variable-entity], [data-template-variable-property], [data-template-date-source], [data-template-date-format], [data-mention-user], [data-mention-property], [data-template-variable-back]');
      var actionTarget = event.target.closest('[data-action]');
      var filterTarget = event.target.closest('[data-filter]');
      var fileTarget = event.target.closest('[data-file-id]');
      var panelTarget = event.target.closest('[data-panel]');
      var slideTarget = event.target.closest('[data-slide-index]');
      var file = activeFile();

      if (variableTarget) {
        handleTemplateVariableOption(variableTarget);
        return;
      }

      if (templateVariableMenuState &&
          !(event.target.closest && event.target.closest('#officeTemplateVariableMenu')) &&
          !(actionTarget && actionTarget.dataset.action === 'insert-template-variable')) {
        hideTemplateVariableMenu();
      }

      if (filterTarget) {
        activeFilter = filterTarget.dataset.filter || 'all';
        document.querySelectorAll('.office-kind-filter button').forEach(function (btn) {
          btn.classList.toggle('is-active', btn.dataset.filter === activeFilter);
        });
        renderFileList();
        return;
      }

      if (fileTarget) {
        state.activeId = fileTarget.dataset.fileId;
        activeSlide = 0;
        selectedCell = 'A1';
        rightRailMode = 'review';
        fileInfoMode = 'view';
        saveState();
        renderAll();
        return;
      }

      if (panelTarget) {
        activateOfficePanel(panelTarget.dataset.panel || 'editor');
        return;
      }

      if (slideTarget && file && file.kind === 'deck') {
        activeSlide = Number(slideTarget.dataset.slideIndex) || 0;
        renderEditor();
        return;
      }

      if (!actionTarget) return;
      var action = actionTarget.dataset.action;
      if (action === 'back-to-viewer') {
        navigateBackFromEditor();
        return;
      }
      if (action === 'retry-editor-route') {
        state = loadState();
        editorLoadError = '';
        editorRouteLoading = true;
        renderAll();
        loadFileEditorRouteContext().then(function () {
          var routedFile = activeFile();
          if (isServerOfficeFile(routedFile)) return loadOfficeEditModel(routedFile);
          return null;
        }).then(function () {
          editorRouteLoading = false;
          renderAll();
        }).catch(function (error) {
          editorRouteLoading = false;
          editorLoadError = (error && error.message) || 'The document could not be loaded.';
          renderAll();
        });
        return;
      }
      if (action === 'retry-editor' && file) {
        editorLoadError = '';
        var reviewForRetry = serverReview(file);
        if (reviewForRetry) reviewForRetry.embedFailed = false;
        renderEditor();
        return;
      }
      if (action === 'retry-office-model' && file && isServerOfficeFile(file)) {
        var retryEdit = ensureOfficeEdit(file);
        retryEdit.error = '';
        loadOfficeEditModel(file).catch(function () {});
        return;
      }
      if (action === 'export-csv' && file && file.kind === 'sheet') {
        exportActiveFile('csv').catch(function (error) {
          toast((error && error.message) || 'The spreadsheet could not be exported.');
        });
        return;
      }
      if (action === 'import-csv' && file && file.kind === 'sheet') {
        var csvInput = el('officeCsvImport');
        if (!csvInput) {
          toast('CSV import is unavailable.');
          return;
        }
        csvInput.value = '';
        csvInput.click();
        return;
      }
      if (action === 'add-slide' && file && file.kind === 'deck') {
        addDeckSlide(file);
        return;
      }
      if (action === 'duplicate-slide' && file && file.kind === 'deck') {
        duplicateDeckSlide(file);
        return;
      }
      if (action === 'delete-slide' && file && file.kind === 'deck') {
        deleteDeckSlide(file);
        return;
      }
      if (action === 'new-file') createFile(actionTarget.dataset.kind || 'doc');
      if (action === 'ai-assist') {
        openLanaDockWithActiveFile('Help me work on this document.', {
          type: 'office_document_review',
          context_type: 'office_document',
          summary: 'Review the active Office file, its draft changes, and available data insertion fields.'
        });
        return;
      }
      if (action === 'share') {
        openShareDialog(file);
        return;
      }
      if (action === 'sign') {
        activateOfficePanel('signatures', { newPacket: true });
        return;
      }
      if (action === 'remove-collaborator' && file) {
        confirmRemoveCollaborator(file, actionTarget.dataset.collaboratorId);
        return;
      }
      if (action === 'add-signer' && file) {
        var signerName = el('officeSignerName');
        var signerEmail = el('officeSignerEmail');
        var name = signerName ? signerName.value.trim() : '';
        var email = signerEmail ? signerEmail.value.trim() : '';
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast('Enter a signer name and valid email address.');
          return;
        }
        var signerRemote = remoteWorkflowForFile(file);
        var signerTools = collaborationTools();
        if (signerTools && typeof signerTools.hasDuplicateSigner === 'function' &&
            signerTools.hasDuplicateSigner(signerRemote.stagedSigners, email)) {
          toast('That signer has already been added to this packet.');
          return;
        }
        signerRemote.stagedSigners.push({ name: name, email: email });
        signerRemote.selectedPacketId = 'new';
        renderSignaturePanel(file, signerRemote);
        return;
      }
      if (action === 'remove-staged-signer' && file) {
        var stagedRemote = remoteWorkflowForFile(file);
        stagedRemote.stagedSigners.splice(Number(actionTarget.dataset.signerIndex), 1);
        renderSignaturePanel(file, stagedRemote);
        return;
      }
      if (action === 'send-signature-packet' && file) {
        sendSignaturePacket(file).catch(function (error) {
          toast((error && error.message) || 'The signature packet could not be sent.');
        });
        return;
      }
      if (action === 'select-signature-packet' && file) {
        var packetRemote = remoteWorkflowForFile(file);
        packetRemote.selectedPacketId = actionTarget.dataset.packetId || '';
        renderSignaturePanel(file, packetRemote);
        return;
      }
      if (action === 'new-signature-packet' && file) {
        var newPacketRemote = remoteWorkflowForFile(file);
        newPacketRemote.selectedPacketId = 'new';
        renderSignaturePanel(file, newPacketRemote);
        return;
      }
      if ((action === 'cancel-signature-packet' || action === 'resend-signature-packet') && file) {
        runSignaturePacketAction(file, actionTarget.dataset.packetId, action === 'cancel-signature-packet' ? 'cancel' : 'resend').catch(function (error) {
          toast((error && error.message) || 'The signature packet could not be updated.');
        });
        return;
      }
      if ((action === 'sign-packet-signer' || action === 'decline-packet-signer') && file) {
        respondToSignaturePacket(
          file,
          actionTarget.dataset.packetId,
          actionTarget.dataset.signerId,
          action === 'sign-packet-signer' ? 'signed' : 'declined'
        ).catch(function (error) {
          toast((error && error.message) || 'The signature response could not be recorded.');
        });
        return;
      }
      if (action === 'save' && file) {
        if (isServerOfficeFile(file)) {
          saveOfficeEditModel(file).then(function () {
            toast('Office file saved.');
          }).catch(function (error) {
            toast((error && error.message) || 'Office file save failed.');
          });
          return;
        }
        if (isServerReviewFile(file)) {
          saveServerDraft(file).then(function (batch) {
            toast(batch ? 'Draft saved to the review workflow.' : 'No tracked changes to save yet.');
          }).catch(function (error) {
            toast((error && error.message) || 'Draft save failed.');
          });
          return;
        }
        if (file.kind !== 'doc') {
          toast('This Office file is not connected to the server edit model.');
          return;
        }
        var capturedReviewChange = saveDocBatch(file);
        toast(capturedReviewChange ? 'Saved and added to Change History.' : 'No document changes to save.');
      }
      if (action === 'export') {
        exportActiveFile().catch(function (error) {
          toast((error && error.message) || 'The document could not be downloaded.');
        });
        return;
      }
      if (action === 'add-selection-comment') {
        addSelectionComment();
        return;
      }
      if (action === 'ask-lana-selection') {
        askLanaAboutSelection();
        return;
      }
      if (action === 'insert-template-variable') {
        openTemplateVariablePicker(actionTarget);
        return;
      }
      if (action === 'show-review-details') {
        fileInfoMode = 'view';
        openFileInfoDrawer(file);
        return;
      }
      if (action === 'close-file-info') {
        rightRailMode = 'review';
        fileInfoMode = 'view';
        renderReviewDock(file);
        var headerInfoButton = document.querySelector('.office-editor-bar [data-action="show-review-details"]');
        if (headerInfoButton && typeof headerInfoButton.focus === 'function') headerInfoButton.focus();
        return;
      }
      if (action === 'set-file-info-mode') {
        fileInfoMode = actionTarget.dataset.fileInfoMode === 'edit' ? 'edit' : 'view';
        if (!refreshFileInfoDrawer(file)) renderReviewDock(file);
        return;
      }
      if (action === 'save-file-info' && file) {
        var docTypeInput = el('officeMetaDocType');
        var tagsInput = el('officeMetaTags');
        var notesInput = el('officeMetaNotes');
        var nextMetadata = {
          document_type: docTypeInput ? docTypeInput.value : officeDocumentType(file),
          tags: tagsInput ? tagsInput.value.trim() : '',
          notes: notesInput ? notesInput.value.trim() : ''
        };
        actionTarget.disabled = true;
        saveServerFileMetadata(file, nextMetadata).then(function () {
          fileInfoMode = 'view';
          renderChrome();
          if (!refreshFileInfoDrawer(file)) renderReviewDock(file);
          toast('File metadata saved.');
        }).catch(function (error) {
          actionTarget.disabled = false;
          toast((error && error.message) || 'File metadata could not be saved.');
        });
        return;
      }
      if (action === 'refresh-review-workflow' && file && isServerReviewFile(file)) {
        actionTarget.disabled = true;
        actionTarget.setAttribute('aria-disabled', 'true');
        var originalRefreshLabel = actionTarget.textContent;
        actionTarget.textContent = 'Refreshing...';
        loadServerReview(file).then(function () {
          var refreshed = serverReview(file);
          var editor = editorForFile(file);
          if (editor && typeof editor.setMode === 'function') editor.setMode(officeEditorModeForFile(file));
          renderChrome();
          if (!refreshFileInfoDrawer(file)) renderReviewDock(file);
          toast(refreshed && refreshed.pendingReleaseBatch ? 'Approval is still pending.' : 'Review status refreshed.');
        }).catch(function (error) {
          actionTarget.disabled = false;
          actionTarget.setAttribute('aria-disabled', 'false');
          actionTarget.textContent = originalRefreshLabel;
          toast((error && error.message) || 'Review status could not be refreshed.');
        });
        return;
      }
      if (action === 'view-release-approval' && file) {
        var approvalReview = serverReview(file);
        if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') {
          if (approvalReview && approvalReview.pendingApprovalId) {
            Lex.Nav.go('approval-detail.html', { params: { id: approvalReview.pendingApprovalId } });
          } else {
            Lex.Nav.go('approvals.html', { params: { status: 'pending' } });
          }
        }
        return;
      }
      if (action === 'retry-release-approval' && file) {
        retryReleaseApproval(file);
        return;
      }
      if (action === 'complete-approved-release' && file) {
        completeApprovedRelease(file);
        return;
      }
      if (action === 'set-review-tab') {
        var nextReviewTab = actionTarget.dataset.reviewTab || 'changes';
        reviewRailTab = nextReviewTab === 'versions' || nextReviewTab === 'comments' ? nextReviewTab : 'changes';
        renderReviewDock(file);
        return;
      }
      if (action === 'revert-review-change' && file) {
        var changeIndex = Number(actionTarget.dataset.reviewChangeIndex);
        if (isServerReviewFile(file)) {
          var revertRow = serverReviewRowAtIndex(file, changeIndex);
          if (!revertRow) {
            toast('Unable to revert this change automatically.');
            return;
          }
          revertServerReviewChange(file, revertRow).catch(function (error) {
            toast((error && error.message) || 'Unable to revert this change automatically.');
          });
          return;
        }
        if (!Number.isFinite(changeIndex) || !revertReviewChangeAtIndex(file, changeIndex)) {
          toast('Unable to revert this change automatically.');
          return;
        }
        toast('Draft change reverted.');
        return;
      }
      if (action === 'edit-review-change' && file && isServerReviewFile(file)) {
        var editRow = serverReviewRowAtIndex(file, Number(actionTarget.dataset.reviewChangeIndex));
        if (!editRow) {
          toast('Unable to edit this change directly.');
          return;
        }
        promptEditServerReviewChange(file, editRow);
        return;
      }
      if (action === 'dock-comment') {
        if (isServerReviewFile(file)) {
          promptAddServerReviewComment(file);
          return;
        }
        if (selectedDocText()) {
          addSelectionComment();
        } else {
          toast('Select text to add a comment.');
        }
        return;
      }
      if (action === 'reply-review-comment' && file && isServerReviewFile(file)) {
        promptReplyServerReviewComment(file, actionTarget.dataset.commentId);
        return;
      }
      if ((action === 'resolve-review-comment' || action === 'reopen-review-comment') && file && isServerReviewFile(file)) {
        setServerReviewCommentResolved(file, actionTarget.dataset.commentId, action === 'resolve-review-comment');
        return;
      }
      if (action === 'release-review-version' && file) {
        if (isServerReviewFile(file)) {
          releaseServerVersion(file);
          return;
        }
        toast('Only server-managed documents can be released.');
        return;
      }
      if (action === 'set-doc-margin' && file && file.kind === 'doc') {
        var margin = actionTarget.dataset.margin || 'normal';
        file.marginPreset = margin === 'narrow' || margin === 'wide' ? margin : 'normal';
        var frame = document.querySelector('.office-doc-frame');
        var ruler = document.querySelector('.office-doc-ruler');
        ['narrow', 'normal', 'wide'].forEach(function (preset) {
          if (frame) frame.classList.toggle('office-margin-' + preset, preset === file.marginPreset);
          if (ruler) ruler.classList.toggle('office-doc-ruler-' + preset, preset === file.marginPreset);
        });
        document.querySelectorAll('.office-ruler-actions [data-action="set-doc-margin"]').forEach(function (button) {
          button.classList.toggle('is-active', button.dataset.margin === file.marginPreset);
        });
        if (isServerReviewFile(file)) {
          saveServerFileMetadata(file, { editor_margin_preset: file.marginPreset }).then(function () {
            toast('Document margin view saved.');
          }).catch(function (error) {
            toast((error && error.message) || 'The margin setting could not be saved.');
          });
        } else {
          setUpdated(file);
        }
        return;
      }
      if (action === 'toggle-show-changes' && file && file.kind === 'doc') {
        if (officeTrackedChangesMode(file) === 'none') {
          syncOfficeShowChangesControl(file);
          return;
        }
        if (isServerReviewFile(file) && officeEditorInstance && !fallbackDocPage()) {
          // Embed-backed file: flip the display class on the LANA Editor host
          // (mirrors the File Viewer toggle). Re-rendering here would remount
          // the embed and reload the document bytes for a display-only change.
          file.showChanges = file.showChanges === false;
          if (file.showChanges === false) officeReviewFocus = null;
          saveState();
          syncOfficeShowChangesControl(file);
        } else {
          syncActiveDocContent({ autosave: false });
          file.showChanges = file.showChanges === false;
          if (file.showChanges === false) officeReviewFocus = null;
          setUpdated(file);
          renderEditor();
        }
        return;
      }
      if (action === 'locate-review-change' && file && file.kind === 'doc') {
        var revisionIds = String(actionTarget.dataset.reviewRevisionIds || '').split(',').filter(Boolean);
        locateOfficeReviewChange(file, revisionIds);
        return;
      }
      if (action === 'locate-review-comment' && file && file.kind === 'doc') {
        locateOfficeReviewComment(file, actionTarget.dataset.commentId || '');
        return;
      }
    });

    document.addEventListener('input', function (event) {
      var searchTarget = event.target.closest && event.target.closest('[data-template-variable-search]');
      if (!searchTarget || !templateVariableMenuState) return;
      var value = searchTarget.value || '';
      if (templateVariableMenuState.kind === 'mention') {
        if (templateVariableMenuState.userId) {
          templateVariableMenuState.propertyQuery = value;
        } else {
          templateVariableMenuState.userQuery = value;
        }
      } else if (templateVariableMenuState.entityKey === 'date' && templateVariableMenuState.dateSourceKey) {
        templateVariableMenuState.formatQuery = value;
      } else if (templateVariableMenuState.entityKey) {
        templateVariableMenuState.propertyQuery = value;
      } else {
        templateVariableMenuState.entityQuery = value;
      }
      templateVariableMenuState.activeIndex = 0;
      renderTemplateVariableMenu();
      var nextSearch = el('officeTemplateVariableMenu') && el('officeTemplateVariableMenu').querySelector('[data-template-variable-search]');
      if (nextSearch && typeof nextSearch.focus === 'function') {
        nextSearch.focus();
        try {
          nextSearch.setSelectionRange(nextSearch.value.length, nextSearch.value.length);
        } catch (_) {}
      }
    });

    document.addEventListener('input', function (event) {
      var file = activeFile();
      if (!file) return;

      if (event.target.id === 'officeSearch') {
        renderFileList();
        return;
      }

      if (event.target.id === 'officeFileTitle') {
        file.title = event.target.value;
        setUpdated(file);
        renderFileList();
        return;
      }

      if (event.target.id === 'officeDocPage') {
        syncActiveDocContent();
        syncDocumentToolbarState();
        updateTemplateVariableAutocomplete();
      }

      if (event.target.dataset && event.target.dataset.cell && file.kind === 'sheet') {
        var parsed = parseCellRef(event.target.dataset.cell);
        if (!parsed) return;
        selectedCell = event.target.dataset.cell;
        file.cells[parsed.row][parsed.col] = event.target.value;
        setUpdated(file);
        var formula = el('officeFormulaInput');
        var selected = el('officeSelectedCell');
        if (formula) formula.value = event.target.value;
        if (selected) selected.textContent = selectedCell;
      }

      if (event.target.id === 'officeFormulaInput' && file.kind === 'sheet') {
        var cell = parseCellRef(selectedCell);
        if (!cell) return;
        file.cells[cell.row][cell.col] = event.target.value;
        setUpdated(file);
        renderSheet(file, el('officeEditorPanel'));
      }

      if ((event.target.id === 'officeSlideTitle' || event.target.id === 'officeSlideBody' || event.target.id === 'officeSlideNotes') && file.kind === 'deck') {
        var slide = file.slides[activeSlide];
        if (!slide) return;
        if (event.target.id === 'officeSlideTitle') slide.title = event.target.value;
        if (event.target.id === 'officeSlideBody') slide.body = event.target.value;
        if (event.target.id === 'officeSlideNotes') slide.notes = event.target.value;
        setUpdated(file);
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && rightRailMode === 'file-info') {
        rightRailMode = 'review';
        fileInfoMode = 'view';
        renderReviewDock(activeFile());
        var infoTrigger = document.querySelector('.office-editor-bar [data-action="show-review-details"]');
        if (infoTrigger && typeof infoTrigger.focus === 'function') infoTrigger.focus();
        event.preventDefault();
        return;
      }
      var officeTab = event.target && event.target.closest ? event.target.closest('.office-mode-tabs [role="tab"]') : null;
      if (officeTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) !== -1) {
        var tabs = Array.prototype.slice.call(document.querySelectorAll('.office-mode-tabs [role="tab"]'));
        var currentIndex = tabs.indexOf(officeTab);
        var nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 :
          (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        activateOfficePanel(tabs[nextIndex].dataset.panel || 'editor');
        tabs[nextIndex].focus();
        return;
      }
      if (event.target && event.target.id === 'officeDocPage' && handleTemplateVariableKeydown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (event.target && event.target.closest && event.target.closest('[data-template-variable-search]') && handleTemplateVariableKeydown(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    });

    document.addEventListener('change', function (event) {
      if (event.target && event.target.id === 'officeCsvImport') {
        var csvFile = activeFile();
        var selectedFile = event.target.files && event.target.files[0];
        importCsvFile(csvFile, selectedFile).catch(function (error) {
          toast((error && error.message) || 'The CSV file could not be imported.');
        });
        return;
      }
      if (event.target && event.target.id === 'officeFileTitle') {
        var titleFile = activeFile();
        renameServerDocument(titleFile, event.target.value).catch(function (error) {
          if (titleFile) event.target.value = titleFile.filename || titleFile.title || '';
          toast((error && error.message) || 'The file could not be renamed.');
        });
        return;
      }
      var commandTarget = event.target.closest('[data-command]');
      if (commandTarget && commandTarget.matches('select, input[type="color"]')) {
        applyDocumentCommand(commandTarget);
        syncDocumentToolbarState();
      }
    });

    document.addEventListener('focusin', function (event) {
      if (event.target.dataset && event.target.dataset.cell) {
        selectedCell = event.target.dataset.cell;
        var selected = el('officeSelectedCell');
        var formula = el('officeFormulaInput');
        if (selected) selected.textContent = selectedCell;
        if (formula) formula.value = event.target.value;
      }
      updateSelectionToolbar();
    });

    document.addEventListener('click', function (event) {
      var commandTarget = event.target.closest('[data-command]');
      if (!commandTarget || commandTarget.matches('select, input[type="color"]')) return;
      applyDocumentCommand(commandTarget);
      syncDocumentToolbarState();
      updateSelectionToolbar();
    });

    document.addEventListener('selectionchange', updateSelectionToolbar);

    document.addEventListener('keyup', function (event) {
      if (event.target && event.target.id === 'officeDocPage') {
        updateSelectionToolbar();
        updateTemplateVariableAutocomplete();
      }
    });

    document.addEventListener('mouseup', function (event) {
      if (event.target && event.target.closest && event.target.closest('#officeDocPage')) updateSelectionToolbar();
    });

    document.addEventListener('mousedown', function (event) {
      if (event.target && event.target.closest && event.target.closest('#officeSelectionToolbar')) {
        event.preventDefault();
      }
      if (event.target && event.target.closest) {
        var embedCommandTarget = event.target.closest('.office-doc-toolbar [data-command], #officeSelectionToolbar [data-command]');
        if (embedCommandTarget) {
          // Capture model coordinates before a select/color control takes
          // focus and destroys the browser selection. Buttons keep the live
          // selection as well so their active/toggle state remains accurate.
          var embedGuardFile = activeFile();
          var embed = embedGuardFile && editorForFile(embedGuardFile);
          if (embedGuardFile && isServerReviewFile(embedGuardFile) && embed && typeof embed.selectionRanges === 'function') {
            try { embedToolbarSelectionRanges = embed.selectionRanges(); } catch (_) { embedToolbarSelectionRanges = null; }
            if (embedCommandTarget.matches('button')) event.preventDefault();
          }
        }
      }
      if (event.target && event.target.closest && event.target.closest('[data-action="insert-template-variable"]')) {
        // Keep the document caret/selection (shell or embed) and any pending
        // embed typing session alive so the picker can capture the insertion
        // point when the click handler opens it.
        event.preventDefault();
      }
      if (event.target &&
          event.target.closest &&
          event.target.closest('#officeTemplateVariableMenu') &&
          !event.target.closest('[data-template-variable-search]')) {
        event.preventDefault();
      }
    });
  }

  function routeParams() {
    if (window.Lex && Lex.Nav && typeof Lex.Nav.getParams === 'function') return Lex.Nav.getParams();
    return new URLSearchParams(window.location.search || '');
  }

  function officeKindForRouteFile(file) {
    var contentType = String(file && (file.content_type || file.contentType) || '').toLowerCase();
    var name = String(file && file.filename || '').toLowerCase();
    if (contentType === 'text/csv' ||
        contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        name.endsWith('.csv') || name.endsWith('.xlsx')) return 'sheet';
    if (contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || name.endsWith('.pptx')) return 'deck';
    return 'doc';
  }

  function officeCapabilitySupportsEditing(capabilities) {
    var value = capabilities && typeof capabilities === 'object' ? capabilities : {};
    return value.editable === true || value.edit_model_supported === true ||
      Boolean(value.file_editor && value.file_editor.editable === true);
  }

  function routeSupportsEditing(file, capabilities) {
    var contentType = String(file && (file.content_type || file.contentType) || '').toLowerCase();
    var name = String(file && file.filename || '').toLowerCase();
    var kind = officeKindForRouteFile(file);
    if (kind === 'sheet' || kind === 'deck') return officeCapabilitySupportsEditing(capabilities);
    return contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      contentType === 'text/plain' || contentType === 'text/markdown' ||
      name.endsWith('.docx') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown');
  }

  async function loadFileEditorRouteContext() {
    var params = routeParams();
    var documentId = String(params.get('id') || '').trim();
    var matterId = String(params.get('matter_id') || '').trim();
    if (!documentId) return false;
    if (!window.api || typeof window.api.get !== 'function') throw new Error('The API client is unavailable.');
    var path = '/api/v1/storage/files/' + encodeURIComponent(documentId);
    if (matterId) path += '?matter_id=' + encodeURIComponent(matterId);
    var response = await window.api.get(path);
    var file = response && response.data ? response.data : response;
    if (!file || !file.id) throw new Error('The requested document was not found.');
    var displayFilename = documentDisplayFilename(file);
    matterId = matterId || String(file.client_matter || file.matter_id || '').trim();
    var conversationMatter = await resolveOfficeConversationMatterContext(matterId);
    var kind = officeKindForRouteFile(file);
    var capabilities = file.format_capabilities || file.formatCapabilities || null;
    if ((kind === 'sheet' || kind === 'deck') && matterId) {
      var capabilityResponse = await window.api.get(
        '/api/v1/matters/' + encodeURIComponent(matterId) + '/documents/' + encodeURIComponent(file.id) + '/format-capabilities'
      );
      capabilities = capabilityResponse && capabilityResponse.data ? capabilityResponse.data : capabilityResponse;
    }
    if (!routeSupportsEditing(file, capabilities)) {
      throw new Error(kind === 'doc'
        ? 'This format is read-only. Convert it to DOCX before opening File Editor.'
        : 'This Office format is read-only because the server did not report edit-model support.');
    }
    if (kind === 'doc' && !matterId) {
      throw new Error('This document is not associated with a workspace, so review drafts cannot be saved.');
    }
    var sourceUrl = kind === 'doc' && window.api && typeof window.api.getFileDownloadUrl === 'function'
      ? window.api.getFileDownloadUrl(file.id, matterId)
      : kind === 'doc'
        ? String(window.api.baseUrl || '') + '/api/v1/storage/files/' + encodeURIComponent(file.id) + '/download?matter_id=' + encodeURIComponent(matterId)
        : '';
    applyFileEditorContext({
      fileEditor: {
        source: 'deep_link',
        referrer: 'file-viewer.html?id=' + encodeURIComponent(file.id),
        file: {
          id: 'file-editor-' + String(file.id),
          documentId: String(file.id),
          sourceDocumentId: String(file.id),
          matterId: matterId,
          matterNumber: conversationMatter && conversationMatter.matterId ? conversationMatter.matterId : '',
          matterName: conversationMatter && conversationMatter.matterName
            ? conversationMatter.matterName
            : (file.matter_name || file.client_matter_name || ''),
          kind: kind,
          title: displayFilename,
          filename: displayFilename,
          storageFilename: file.filename || displayFilename,
          original_filename: file.original_filename || displayFilename,
          display_filename: file.display_filename || displayFilename,
          contentType: file.content_type || file.mime_type || '',
          fileSize: file.file_size,
          chunkCount: file.chunk_count,
          createdAt: file.created_at,
          documentUpdatedAt: file.updated_at || file.created_at,
          updatedAt: file.updated_at || file.created_at,
          metadata: file.metadata || {},
          summary: file.summary || '',
          summaryGeneratedAt: file.summary_generated_at || '',
          editorEngine: kind === 'doc' ? 'lana-editor' : 'server-edit-model',
          editorMode: kind === 'doc' ? 'review' : 'edit',
          officeEditingSupported: kind === 'sheet' || kind === 'deck',
          formatCapabilities: capabilities || {},
          sourceUrl: sourceUrl
        }
      }
    });
    return true;
  }

  function activeServerReviewHasPendingWork() {
    var file = activeFile();
    var officeEdit = file && ensureOfficeEdit(file);
    if (officeEdit && (officeEdit.dirty || officeEdit.saving)) return true;
    var review = file && serverReview(file);
    return Boolean(file && review &&
      (review.dirty || review.saving || review.saveFailed || serverDraftSaveTimers[file.id]));
  }

  async function flushActiveServerDraft() {
    var file = activeFile();
    var officeEdit = file && ensureOfficeEdit(file);
    if (officeEdit) {
      if (officeEdit.saving && officeEdit.savePromise) await officeEdit.savePromise;
      if (officeEdit.dirty) await saveOfficeEditModel(file);
      return;
    }
    var review = file && serverReview(file);
    var editor = file && editorForFile(file);
    if (!file || !review) return;
    if (editor && typeof editor.flushPendingEdits === 'function') await editor.flushPendingEdits();
    if (review.saving && review.savePromise) await review.savePromise;
    if (review.dirty || serverDraftSaveTimers[file.id]) await saveServerDraft(file, { silent: true });
  }

  function shutdownEditorInstance(instance) {
    var target = instance || officeEditorInstance;
    if (target && typeof target.shutdown === 'function') target.shutdown();
    if (target === officeEditorInstance) {
      officeEditorInstance = null;
      officeEditorFileId = '';
      officeEditorHostEl = null;
      var file = activeFile();
      if (file) syncOfficeHistoryControls(file);
    }
  }

  async function navigateBackFromEditor() {
    try {
      await flushActiveServerDraft();
    } catch (error) {
      toast((error && error.message) || 'The latest draft could not be saved.');
      return;
    }
    leavingEditor = true;
    var file = activeFile();
    var target = safeEditorReferrer(editorReferrer) ||
      (file ? 'file-viewer.html?id=' + encodeURIComponent(officeRealDocumentId(file)) : 'document-library.html');
    if (window.Lex && Lex.Nav && typeof Lex.Nav.go === 'function') Lex.Nav.go(target);
    else window.location.href = target;
  }

  async function onEnter() {
    var contentRoot = el('officeEditorPanel');
    if (!contentRoot || initializedContentRoot === contentRoot) return;
    initializedContentRoot = contentRoot;
    leavingEditor = false;
    editorLoadError = '';
    state = loadState();
    bindEvents();
    var ctx = window.Lex && Lex.Nav && typeof Lex.Nav.consume === 'function' ? Lex.Nav.consume() : null;
    applyFileEditorContext(ctx);
    if (!activeFile()) {
      editorRouteLoading = Boolean(routeParams().get('id'));
      renderAll();
      try {
        await loadFileEditorRouteContext();
      } catch (error) {
        editorLoadError = (error && error.message) || 'The document could not be loaded.';
      } finally {
        editorRouteLoading = false;
      }
    }
    var officeFile = activeFile();
    if (isServerOfficeFile(officeFile)) {
      try {
        await loadOfficeEditModel(officeFile);
      } catch (_) {}
    }
    renderAll();
  }

  function onLeave() {
    initializedContentRoot = null;
    leavingEditor = true;
    editorMountGeneration += 1;
    var fileInfoDrawer = activeFileInfoDrawer();
    if (fileInfoDrawer) fileInfoDrawer.dispatchEvent(new CustomEvent('lex-close', { bubbles: true }));
    var departingEditor = officeEditorInstance;
    var save = activeServerReviewHasPendingWork()
      ? flushActiveServerDraft().catch(function (error) {
          console.warn('[file-editor] Draft save during navigation failed:', error && error.message ? error.message : error);
        })
      : Promise.resolve();
    save.finally(function () { shutdownEditorInstance(departingEditor); });
  }

  function init() {
    if (window.LexRouter && typeof LexRouter.registerView === 'function') {
      LexRouter.registerView({ onLeave: onLeave });
    }
    onEnter().catch(function (error) {
      editorRouteLoading = false;
      editorLoadError = (error && error.message) || 'File Editor could not start.';
      renderAll();
    });
  }

  if (window.LexRouter && typeof LexRouter.registerPageInit === 'function') {
    LexRouter.registerPageInit('file-editor.html', init);
  } else {
    init();
  }
})();
