/**
 * workspace-artifacts-view.js - Reusable workspace artifact review surface.
 *
 * Hosts provide matter identity, API, formatting, navigation, and refresh
 * callbacks. This module owns artifact list rendering, list controls, detail
 * drawer rendering, and the approval-gated Save to Documents action.
 */
(function (global) {
  'use strict';

  function fallbackEscape(value) {
    return String(value == null ? '' : value)
      .split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;')
      .split("'").join('&#39;');
  }

  // Markdown parser for artifact content. Artifact drafts are LLM-generated
  // and therefore untrusted, so raw HTML in the markdown renders as escaped
  // text, links are restricted to http(s)/mailto, and images render as their
  // alt text. Falls back to null when the vendored marked library is absent.
  var _safeMarked = null;
  function getSafeMarked() {
    if (_safeMarked) return _safeMarked;
    if (!global.marked || typeof global.marked.Marked !== 'function') return null;
    _safeMarked = new global.marked.Marked({
      renderer: {
        html: function (token) {
          return fallbackEscape(token && token.text ? token.text : '');
        },
        link: function (token) {
          var href = String((token && token.href) || '');
          var label = this.parser.parseInline((token && token.tokens) || []);
          if (/^(https?:|mailto:)/i.test(href)) {
            var title = token && token.title ? ' title="' + fallbackEscape(token.title) + '"' : '';
            return '<a href="' + fallbackEscape(href) + '"' + title + ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
          }
          return label;
        },
        image: function (token) {
          return fallbackEscape((token && (token.text || token.title)) || '');
        }
      }
    });
    return _safeMarked;
  }

  function renderMarkdownContent(content) {
    if (!content) return '<p class="text-sm text-gray-500">No preview available</p>';
    var parser = getSafeMarked();
    if (parser) {
      try {
        return parser.parse(String(content));
      } catch (error) {
        console.warn('[WorkspaceArtifacts] Markdown render failed, falling back to text:', error);
      }
    }
    return '<pre class="text-sm text-gray-700 whitespace-pre-wrap">' + fallbackEscape(content) + '</pre>';
  }

  function extractArtifactList(result) {
    var payload = result && (result.artifacts || result.data || result.items || result);
    if (Array.isArray(payload)) return { artifacts: payload, pagination: null };
    if (payload && Array.isArray(payload.artifacts)) {
      return {
        artifacts: payload.artifacts,
        pagination: payload.pagination || null
      };
    }
    if (payload && Array.isArray(payload.items)) {
      return {
        artifacts: payload.items,
        pagination: payload.pagination || null
      };
    }
    return { artifacts: [], pagination: null };
  }

  function unwrapMatterArtifactResponse(result) {
    if (!result) return null;
    if (result.artifact) return result.artifact;
    if (result.data && result.data.artifact) return result.data.artifact;
    return result;
  }

  function getArtifactId(artifact) {
    if (!artifact || typeof artifact !== 'object') return '';
    var helper = global.Lex && global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
    return helper && helper.getArtifactId
      ? helper.getArtifactId(artifact)
      : (artifact.artifact_id || artifact.id || '');
  }

  function getArtifactTitle(artifact) {
    return artifact.artifact_name || artifact.title || artifact.name || artifact.label || 'Generated artifact';
  }

  function getArtifactPersistence(artifact) {
    var helper = global.Lex && global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
    if (helper && helper.getPersistenceView) return helper.getPersistenceView(artifact);
    var persistence = artifact && artifact.persistence;
    if (persistence && persistence.status) {
      return {
        status: persistence.status,
        tone: persistence.status === 'promoted' ? 'success' : 'neutral',
        message: persistence.message || persistence.status
      };
    }
    return { status: 'unknown', tone: 'neutral', message: 'Status unavailable' };
  }

  function getArtifactPromotionAction(artifact) {
    var helper = global.Lex && global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
    if (helper && helper.getSaveToDocumentsAction) return helper.getSaveToDocumentsAction(artifact);
    var actions = artifact && Array.isArray(artifact.actions) ? artifact.actions : [];
    for (var i = 0; i < actions.length; i++) {
      if (actions[i] && actions[i].id === 'save_to_documents') return actions[i];
    }
    return null;
  }

  function getArtifactDocument(artifact) {
    return artifact && (artifact.document || artifact.canonical_document || null);
  }

  function buildQuery(params) {
    var parts = [];
    Object.keys(params).forEach(function (key) {
      if (params[key] === null || params[key] === undefined || params[key] === '') return;
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key])));
    });
    return parts.join('&');
  }

  function WorkspaceArtifactsView(options) {
    options = options || {};
    this.container = options.container || null;
    this.api = options.api || global.api || null;
    this.Lex = options.Lex || global.Lex || {};
    this.toast = options.toast || (this.Lex && this.Lex.Toast) || null;
    this.confirm = options.confirm || (this.Lex && this.Lex.Modal && this.Lex.Modal.confirm) || null;
    this.drawer = options.drawer || (this.Lex && this.Lex.Drawer) || null;
    this.escapeHtml = options.escapeHtml || fallbackEscape;
    this.formatDate = options.formatDate || function (value) { return value || ''; };
    this.getMatterId = options.getMatterId || function (matter) { return matter && (matter.matter_id || matter.id || null); };
    this.onOpenDocument = options.onOpenDocument || function () {};
    this.onPromoted = options.onPromoted || function () {};
    this.matter = options.matter || null;
    this.artifacts = [];
    this.pagination = null;
    this.offset = 0;
    this.limit = options.limit || 25;
    this.search = '';
    this.sortBy = 'updated_at';
    this.sortDir = 'desc';
    this._drawerEl = null;
    this._activeArtifact = null;
    this._onClick = this._handleClick.bind(this);
    this._onInput = this._handleInput.bind(this);
    this._onChange = this._handleChange.bind(this);
    if (this.container) this._bind();
  }

  WorkspaceArtifactsView.prototype._bind = function () {
    this.container.addEventListener('click', this._onClick);
    this.container.addEventListener('input', this._onInput);
    this.container.addEventListener('change', this._onChange);
  };

  WorkspaceArtifactsView.prototype.destroy = function () {
    if (this.container) {
      this.container.removeEventListener('click', this._onClick);
      this.container.removeEventListener('input', this._onInput);
      this.container.removeEventListener('change', this._onChange);
    }
    clearTimeout(this._searchTimer);
    if (this._drawerEl) this._drawerEl.removeEventListener('click', this._onClick);
    if (this._drawerEl && typeof this._drawerEl.remove === 'function') this._drawerEl.remove();
    this._drawerEl = null;
    this.container = null;
  };

  WorkspaceArtifactsView.prototype.render = async function (matter) {
    if (matter) this.matter = matter;
    if (!this.container) return;
    var matterId = this.getMatterId(this.matter);
    if (!matterId) {
      this.container.innerHTML = '<lex-empty icon="document" message="No workspace loaded" description="Artifacts appear after a workspace is loaded"></lex-empty>';
      return;
    }

    this.container.innerHTML =
      '<div class="space-y-4">' +
        '<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">' +
          '<div>' +
            '<h4 class="text-sm font-semibold text-gray-900">Workspace artifacts</h4>' +
            '<p class="text-xs text-gray-500 mt-0.5">Review LANA-generated work product before saving it as an official document.</p>' +
          '</div>' +
          '<div class="flex flex-wrap gap-2">' +
            '<input type="search" class="px-3 py-2 border border-gray-200 rounded-lg text-sm" placeholder="Search artifacts" data-artifacts-search value="' + this.escapeHtml(this.search) + '">' +
            '<select class="px-3 py-2 border border-gray-200 rounded-lg text-sm" data-artifacts-sort>' +
              this._renderSortOptions() +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div id="matterArtifactsList">' +
          '<div class="text-center py-8"><lex-spinner></lex-spinner></div>' +
        '</div>' +
      '</div>';

    await this.refresh();
  };

  WorkspaceArtifactsView.prototype.refresh = async function () {
    var matterId = this.getMatterId(this.matter);
    if (!this.api || !matterId) return;
    var query = buildQuery({
      limit: this.limit,
      offset: this.offset,
      search: this.search,
      sort_by: this.sortBy,
      sort_dir: this.sortDir
    });
    var result = await this.api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/artifacts?' + query);
    var extracted = extractArtifactList(result);
    this.artifacts = extracted.artifacts;
    this.pagination = extracted.pagination;
    this._renderList();
  };

  WorkspaceArtifactsView.prototype._renderSortOptions = function () {
    var options = [
      ['updated_at', 'Updated'],
      ['created_at', 'Created'],
      ['artifact_name', 'Name'],
      ['artifact_type', 'Type'],
      ['promotion_status', 'Status'],
      ['version', 'Version']
    ];
    var html = '';
    for (var i = 0; i < options.length; i++) {
      html += '<option value="' + options[i][0] + '"' + (this.sortBy === options[i][0] ? ' selected' : '') + '>' + options[i][1] + '</option>';
    }
    return html;
  };

  WorkspaceArtifactsView.prototype._renderList = function () {
    var list = this.container && this.container.querySelector('#matterArtifactsList');
    if (!list) return;

    if (!this.artifacts.length) {
      list.innerHTML = '<lex-empty icon="document" message="No artifacts yet" description="LANA-generated drafts and proposed work product will appear here for review"></lex-empty>';
      return;
    }

    list.innerHTML =
      '<div class="overflow-hidden border border-gray-200 rounded-lg bg-white">' +
        this.artifacts.map(this._renderRow.bind(this)).join('') +
      '</div>' +
      this._renderPager();
  };

  WorkspaceArtifactsView.prototype._renderRow = function (artifact) {
    var artifactId = getArtifactId(artifact);
    var status = getArtifactPersistence(artifact);
    var documentRecord = getArtifactDocument(artifact);
    var canPromote = !!getArtifactPromotionAction(artifact);
    var type = artifact.artifact_type || artifact.type || 'artifact';
    var version = artifact.version || artifact.current_version || 1;
    var createdAt = artifact.created_at || artifact.createdAt || '';
    var statusClass = status.tone === 'success'
      ? 'bg-green-50 text-green-700 border-green-200'
      : status.tone === 'error'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-gray-50 text-gray-700 border-gray-200';

    return '<div class="flex flex-col gap-3 px-4 py-3 border-b border-gray-100 last:border-b-0 md:flex-row md:items-center md:justify-between" data-artifact-row="' + this.escapeHtml(artifactId) + '">' +
      '<div class="min-w-0 flex-1">' +
        '<div class="flex flex-wrap items-center gap-2">' +
          '<button type="button" class="text-sm font-semibold text-gray-900 truncate hover:lex-text-accent" data-artifact-action="view" data-artifact-id="' + this.escapeHtml(artifactId) + '">' + this.escapeHtml(getArtifactTitle(artifact)) + '</button>' +
          '<span class="inline-flex px-2 py-0.5 rounded border text-xs font-medium ' + statusClass + '">' + this.escapeHtml(status.message || status.status || 'Status unavailable') + '</span>' +
        '</div>' +
        '<div class="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">' +
          '<span>' + this.escapeHtml(type) + '</span>' +
          '<span>Version ' + this.escapeHtml(String(version)) + '</span>' +
          (createdAt ? '<span>' + this.escapeHtml(this.formatDate(createdAt)) + '</span>' : '') +
        '</div>' +
        this._renderApprovalMeta(artifact) +
      '</div>' +
      '<div class="flex flex-wrap items-center gap-2">' +
        '<button type="button" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50" data-artifact-action="view" data-artifact-id="' + this.escapeHtml(artifactId) + '">View</button>' +
        (canPromote ? '<button type="button" class="px-3 py-1.5 rounded-lg text-xs font-medium text-white lex-bg-accent hover:lex-bg-accent" data-artifact-action="promote" data-artifact-id="' + this.escapeHtml(artifactId) + '">Save to Documents</button>' : '') +
        (documentRecord && documentRecord.id ? '<button type="button" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50" data-artifact-action="open-document" data-document-id="' + this.escapeHtml(documentRecord.id) + '">Open Document</button>' : '') +
      '</div>' +
    '</div>';
  };

  WorkspaceArtifactsView.prototype._renderPager = function () {
    if (!this.pagination) return '';
    var total = Number(this.pagination.total || 0);
    var start = total === 0 ? 0 : this.offset + 1;
    var end = Math.min(this.offset + this.artifacts.length, total);
    var hasPrev = this.offset > 0;
    var hasNext = this.pagination.has_more === true;
    return '<div class="flex items-center justify-between gap-3 mt-3 text-xs text-gray-500">' +
      '<span>' + this.escapeHtml(String(start)) + '-' + this.escapeHtml(String(end)) + ' of ' + this.escapeHtml(String(total)) + '</span>' +
      '<div class="flex gap-2">' +
        '<button type="button" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 disabled:opacity-50" data-artifact-action="prev-page"' + (hasPrev ? '' : ' disabled') + '>Previous</button>' +
        '<button type="button" class="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 disabled:opacity-50" data-artifact-action="next-page"' + (hasNext ? '' : ' disabled') + '>Next</button>' +
      '</div>' +
    '</div>';
  };

  WorkspaceArtifactsView.prototype._renderApprovalMeta = function (artifact) {
    var approvals = artifact && artifact.approvals && typeof artifact.approvals === 'object' ? artifact.approvals : {};
    var created = approvals.created && typeof approvals.created === 'object' ? approvals.created : null;
    var promoted = approvals.promoted && typeof approvals.promoted === 'object' ? approvals.promoted : null;
    var inclusions = Array.isArray(artifact && artifact.inclusions) ? artifact.inclusions : [];
    var parts = [];
    if (created) parts.push('Created by ' + (created.user_name || created.user_id || 'LANA'));
    if (promoted) parts.push('Approved by ' + (promoted.user_name || promoted.user_id || 'reviewer'));
    if (inclusions.length > 0) parts.push('Includes ' + inclusions.length + ' source' + (inclusions.length === 1 ? '' : 's'));
    if (!parts.length) return '';
    return '<div class="flex flex-wrap gap-1 mt-2">' + parts.map(function (part) {
      return '<span class="inline-flex max-w-full px-2 py-0.5 rounded border border-gray-200 text-xs text-gray-500 truncate">' + this.escapeHtml(part) + '</span>';
    }, this).join('') + '</div>';
  };

  WorkspaceArtifactsView.prototype._handleInput = function (event) {
    if (!event.target || !event.target.matches('[data-artifacts-search]')) return;
    this.search = String(event.target.value || '').trim();
    this.offset = 0;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(function () {
      this.refresh().catch(this._showError.bind(this));
    }.bind(this), 250);
  };

  WorkspaceArtifactsView.prototype._handleChange = function (event) {
    if (!event.target || !event.target.matches('[data-artifacts-sort]')) return;
    this.sortBy = event.target.value || 'updated_at';
    this.offset = 0;
    this.refresh().catch(this._showError.bind(this));
  };

  WorkspaceArtifactsView.prototype._handleClick = function (event) {
    var button = event.target && event.target.closest('[data-artifact-action]');
    var inContainer = this.container && this.container.contains(button);
    var inDrawer = this._drawerEl && this._drawerEl.contains(button);
    if (!button || (!inContainer && !inDrawer)) return;
    var action = button.getAttribute('data-artifact-action');
    var artifactId = button.getAttribute('data-artifact-id') || '';
    var matterId = this.getMatterId(this.matter);
    if (action === 'view') {
      this.openDrawer(matterId, artifactId);
    } else if (action === 'promote') {
      this.promote(matterId, artifactId);
    } else if (action === 'open-document') {
      this.onOpenDocument(button.getAttribute('data-document-id') || '');
    } else if (action === 'prev-page' && this.offset > 0) {
      this.offset = Math.max(0, this.offset - this.limit);
      this.refresh().catch(this._showError.bind(this));
    } else if (action === 'next-page' && this.pagination && this.pagination.has_more) {
      this.offset = this.pagination.next_offset == null ? this.offset + this.limit : Number(this.pagination.next_offset);
      this.refresh().catch(this._showError.bind(this));
    }
  };

  WorkspaceArtifactsView.prototype.openDrawer = async function (matterId, artifactId) {
    if (!matterId || !artifactId || !this.drawer || !this.drawer.open) return;
    if (this._drawerEl && typeof this._drawerEl.remove === 'function') {
      this._drawerEl.removeEventListener('click', this._onClick);
      this._drawerEl.remove();
      this._drawerEl = null;
    }
    this._drawerEl = this.drawer.open({
      heading: 'Artifact',
      subtitle: 'Review generated work product, approvals, and included sources',
      width: 'xl',
      content: '<div data-artifact-drawer-body><div class="text-center py-8"><lex-spinner></lex-spinner></div></div>',
      onClose: function () { this._drawerEl = null; }.bind(this)
    });
    if (this._drawerEl && this._drawerEl.addEventListener) {
      this._drawerEl.addEventListener('click', this._onClick);
    }
    try {
      var result = await this.api.get('/api/v1/matters/' + encodeURIComponent(matterId) + '/artifacts/' + encodeURIComponent(artifactId));
      var artifact = unwrapMatterArtifactResponse(result);
      this._activeArtifact = artifact;
      var body = this._drawerEl && this._drawerEl.querySelector('[data-artifact-drawer-body]');
      if (!body || !artifact) return;
      body.innerHTML = this._renderDrawerContent(artifact);
    } catch (error) {
      this._showDrawerError(error);
    }
  };

  WorkspaceArtifactsView.prototype.openArtifact = async function (artifactId) {
    var matterId = this.getMatterId(this.matter);
    return this.openDrawer(matterId, artifactId);
  };

  WorkspaceArtifactsView.prototype._renderDrawerContent = function (artifact) {
    var artifactId = getArtifactId(artifact);
    var status = getArtifactPersistence(artifact);
    var documentRecord = getArtifactDocument(artifact);
    var canPromote = !!getArtifactPromotionAction(artifact);
    var content = artifact.content || artifact.preview || artifact.text || '';
    var approvals = artifact.approvals && typeof artifact.approvals === 'object' ? artifact.approvals : {};
    var inclusions = Array.isArray(artifact.inclusions) ? artifact.inclusions : [];
    var versions = Array.isArray(artifact.version_history) ? artifact.version_history : [];
    return '<div class="space-y-5">' +
      '<div>' +
        '<h3 class="text-lg font-semibold text-gray-900">' + this.escapeHtml(getArtifactTitle(artifact)) + '</h3>' +
        '<div class="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">' +
          '<span>' + this.escapeHtml(artifact.artifact_type || artifact.type || 'artifact') + '</span>' +
          '<span>' + this.escapeHtml(status.message || status.status || 'Status unavailable') + '</span>' +
          (artifact.created_at ? '<span>' + this.escapeHtml(this.formatDate(artifact.created_at)) + '</span>' : '') +
        '</div>' +
        this._renderApprovalMeta(artifact) +
      '</div>' +
      '<div class="flex flex-wrap gap-2">' +
        (canPromote ? '<button type="button" class="px-3 py-2 rounded-lg text-sm font-medium text-white lex-bg-accent hover:lex-bg-accent" data-artifact-action="promote" data-artifact-id="' + this.escapeHtml(artifactId) + '">Save to Documents</button>' : '') +
        (documentRecord && documentRecord.id ? '<button type="button" class="px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50" data-artifact-action="open-document" data-document-id="' + this.escapeHtml(documentRecord.id) + '">Open Document</button>' : '') +
      '</div>' +
      '<div class="grid gap-4 md:grid-cols-2">' +
        '<div class="border border-gray-200 rounded-lg p-4"><h4 class="text-sm font-semibold text-gray-900 mb-3">Approvals</h4>' + this._renderApprovals(approvals) + '</div>' +
        '<div class="border border-gray-200 rounded-lg p-4"><h4 class="text-sm font-semibold text-gray-900 mb-3">Included sources</h4>' + this._renderInclusions(inclusions) + '</div>' +
      '</div>' +
      '<div class="border border-gray-200 rounded-lg p-4"><h4 class="text-sm font-semibold text-gray-900 mb-3">Content</h4><div class="prose prose-sm max-w-none text-gray-700 max-h-[420px] overflow-auto">' + renderMarkdownContent(content) + '</div></div>' +
      (versions.length ? '<div class="border border-gray-200 rounded-lg p-4"><h4 class="text-sm font-semibold text-gray-900 mb-3">Version history</h4>' + this._renderVersions(versions) + '</div>' : '') +
    '</div>';
  };

  WorkspaceArtifactsView.prototype._renderApprovals = function (approvals) {
    var rows = [];
    if (approvals.created) rows.push({ label: 'Created', value: approvals.created });
    if (approvals.promoted) rows.push({ label: 'Approved', value: approvals.promoted });
    if (!rows.length) return '<p class="text-sm text-gray-500">No approval records yet.</p>';
    return rows.map(function (row) {
      var value = row.value || {};
      return '<div class="py-2 border-b border-gray-100 last:border-b-0">' +
        '<div class="text-xs font-medium text-gray-500">' + this.escapeHtml(row.label) + '</div>' +
        '<div class="text-sm text-gray-900">' + this.escapeHtml(value.user_name || value.user_id || 'Unknown') + '</div>' +
        (value.at ? '<div class="text-xs text-gray-500">' + this.escapeHtml(this.formatDate(value.at)) + '</div>' : '') +
      '</div>';
    }, this).join('');
  };

  WorkspaceArtifactsView.prototype._renderInclusions = function (inclusions) {
    if (!inclusions.length) return '<p class="text-sm text-gray-500">No included sources recorded.</p>';
    return '<div class="space-y-2">' + inclusions.map(function (item) {
      var approval = item.approval && typeof item.approval === 'object' ? item.approval : null;
      return '<div class="rounded border border-gray-200 p-2">' +
        '<div class="text-sm font-medium text-gray-900">' + this.escapeHtml(item.label || item.id || item.type || 'Source') + '</div>' +
        '<div class="text-xs text-gray-500">' + this.escapeHtml(item.type || 'source') + (item.id ? ' - ' + this.escapeHtml(item.id) : '') + '</div>' +
        (item.reason ? '<div class="text-xs text-gray-500 mt-1">' + this.escapeHtml(item.reason) + '</div>' : '') +
        (approval ? '<div class="text-xs text-gray-500 mt-1">Approved with artifact by ' + this.escapeHtml(approval.user_name || approval.approved_by || 'reviewer') + (approval.at ? ' on ' + this.escapeHtml(this.formatDate(approval.at)) : '') + '</div>' : '') +
      '</div>';
    }, this).join('') + '</div>';
  };

  WorkspaceArtifactsView.prototype._renderVersions = function (versions) {
    return '<div class="space-y-2">' + versions.map(function (version) {
      return '<div class="flex items-center justify-between gap-3 text-sm border-b border-gray-100 last:border-b-0 py-2">' +
        '<span class="text-gray-900">Version ' + this.escapeHtml(String(version.version || version.artifact_version || '')) + '</span>' +
        '<span class="text-xs text-gray-500">' + this.escapeHtml(this.formatDate(version.created_at || version.createdAt || '')) + '</span>' +
      '</div>';
    }, this).join('') + '</div>';
  };

  WorkspaceArtifactsView.prototype.promote = function (matterId, artifactId) {
    var artifact = null;
    for (var i = 0; i < this.artifacts.length; i++) {
      if (String(getArtifactId(this.artifacts[i])) === String(artifactId)) {
        artifact = this.artifacts[i];
        break;
      }
    }
    if (!artifact && this._activeArtifact && String(getArtifactId(this._activeArtifact)) === String(artifactId)) {
      artifact = this._activeArtifact;
    }
    var action = getArtifactPromotionAction(artifact);
    if (!artifact || !action) {
      this._showError(new Error('Save action is unavailable for this artifact'));
      return;
    }
    if (!this.confirm) {
      this._showError(new Error('Artifact approval support is unavailable.'));
      return;
    }
    this.confirm(
      'Save Artifact',
      'Save this artifact to Documents as approved workspace material?',
      async function () {
        try {
          var helper = global.Lex && global.Lex.Chat && global.Lex.Chat.ArtifactPromotion;
          if (!helper || !helper.getPromotionRequest || !helper.normalizePromotionResponse) {
            throw new Error('Artifact promotion support is unavailable.');
          }
          var request = helper.getPromotionRequest(action);
          var response = await this.api.post(request.endpoint, request.body);
          var promotion = helper.normalizePromotionResponse(response);
          if (this.toast && this.toast.success) this.toast.success('Artifact saved to Documents');
          await this.refresh();
          if (promotion && promotion.document && promotion.document.id && this._drawerEl) {
            await this.openDrawer(matterId, artifactId);
          }
          this.onPromoted({ matterId: matterId, artifactId: artifactId, promotion: promotion });
        } catch (error) {
          this._showError(error);
        }
      }.bind(this)
    );
  };

  WorkspaceArtifactsView.prototype._showError = function (error) {
    if (this.toast && this.toast.error) this.toast.error(error.message || 'Artifact action failed');
  };

  WorkspaceArtifactsView.prototype._showDrawerError = function (error) {
    var body = this._drawerEl && this._drawerEl.querySelector('[data-artifact-drawer-body]');
    if (body) {
      body.innerHTML = '<lex-empty icon="alert" message="Failed to load artifact" description="' + this.escapeHtml(error.message || 'Artifact unavailable') + '"></lex-empty>';
    }
  };

  var api = {
    mount: function (container, options) {
      options = options || {};
      options.container = container;
      return new WorkspaceArtifactsView(options);
    },
    WorkspaceArtifactsView: WorkspaceArtifactsView,
    extractArtifactList: extractArtifactList,
    unwrapMatterArtifactResponse: unwrapMatterArtifactResponse,
    buildQuery: buildQuery
  };

  global.WorkspaceArtifactsView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
