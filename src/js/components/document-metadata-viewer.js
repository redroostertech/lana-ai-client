// src/js/components/document-metadata-viewer.js
// Reusable component for displaying document metadata and AI summaries

class DocumentMetadataViewer {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);

    if (!this.container) {
      throw new Error(`Container with ID "${containerId}" not found`);
    }

    // Options with defaults
    this.options = {
      showLayoutToggle: options.showLayoutToggle !== false, // Default: true
      defaultLayout: options.defaultLayout || 'split', // 'preview-only', 'split', 'metadata-only'
      collapseSections: options.collapseSections !== false, // Default: true
      showEmptySections: options.showEmptySections === true, // Default: false
      truncateSummary: options.truncateSummary !== false, // Default: true
      summaryMaxLength: options.summaryMaxLength || 1000, // Increased from 300 to 1000 characters
      entitiesMaxItems: options.entitiesMaxItems || 10,
      autoRefreshInterval: options.autoRefreshInterval || null, // Default: no auto-refresh
      onMetadataLoaded: options.onMetadataLoaded || null, // Callback when metadata loads
      onError: options.onError || null // Callback on error
    };

    // State
    this.currentDocumentId = null;
    this.metadata = null;
    this.isLoading = false;
    this.expandedSections = new Set(['summary', 'legal', 'entities', 'processing']); // All expanded by default
    this.showFullSummary = false;
    this.expandedEntities = new Set();
    this.autoRefreshTimer = null;

    // Initialize
    this.render();
  }

  /**
   * Load and display metadata for a document
   * @param {string} documentId - Document UUID
   * @param {boolean} forceRefresh - Skip cache and fetch fresh data
   */
  async loadMetadata(documentId, forceRefresh = false) {
    if (!documentId) {
      this.showError('Document ID is required');
      return;
    }

    this.currentDocumentId = documentId;
    this.isLoading = true;
    this.showFullSummary = false; // Reset on new document
    this.render();

    try {
      // Fetch metadata using metadata service
      const metadata = await window.metadataService.fetchMetadata(documentId, forceRefresh);
      this.metadata = metadata;
      this.isLoading = false;

      this.render();

      // Call callback if provided
      if (this.options.onMetadataLoaded) {
        this.options.onMetadataLoaded(metadata);
      }

      // Start auto-refresh if enabled
      if (this.options.autoRefreshInterval) {
        var shouldRefresh = true;
        if (window.documentLifecycle && typeof window.documentLifecycle.isDocumentTerminal === 'function') {
          shouldRefresh = !window.documentLifecycle.isDocumentTerminal(metadata);
        } else {
          shouldRefresh = metadata.processing_status === 'processing';
        }

        if (shouldRefresh) {
          this.startAutoRefresh();
        } else {
          this.stopAutoRefresh();
        }
      }

    } catch (error) {
      console.error('[DocumentMetadataViewer] Load failed:', error);
      this.isLoading = false;
      this.showError(error.message || 'Failed to load document metadata');

      // Call error callback if provided
      if (this.options.onError) {
        this.options.onError(error);
      }
    }
  }

  /**
   * Refresh metadata for current document
   */
  async refresh() {
    if (!this.currentDocumentId) return;
    await this.loadMetadata(this.currentDocumentId, true);
  }

  /**
   * Start auto-refresh timer
   */
  startAutoRefresh() {
    if (!this.options.autoRefreshInterval) return;

    this.stopAutoRefresh(); // Clear existing timer

    this.autoRefreshTimer = setInterval(async () => {
      var shouldRefresh = this.currentDocumentId && this.metadata;
      if (shouldRefresh && window.documentLifecycle && typeof window.documentLifecycle.isDocumentTerminal === 'function') {
        shouldRefresh = !window.documentLifecycle.isDocumentTerminal(this.metadata);
      } else if (shouldRefresh) {
        shouldRefresh = this.metadata.processing_status === 'processing';
      }

      if (shouldRefresh) {
        console.log('[DocumentMetadataViewer] Auto-refreshing...');
        await this.refresh();
      } else {
        // Stop auto-refresh if processing complete
        this.stopAutoRefresh();
      }
    }, this.options.autoRefreshInterval);
  }

  /**
   * Stop auto-refresh timer
   */
  stopAutoRefresh() {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  /**
   * Toggle section expanded/collapsed
   * @param {string} sectionId - Section identifier
   */
  toggleSection(sectionId) {
    if (this.expandedSections.has(sectionId)) {
      this.expandedSections.delete(sectionId);
    } else {
      this.expandedSections.add(sectionId);
    }
    this.render();
  }

  /**
   * Toggle summary expanded/collapsed
   */
  toggleSummary() {
    this.showFullSummary = !this.showFullSummary;
    this.render();
  }

  /**
   * Toggle entity group expanded/collapsed
   * @param {string} groupName - Entity group name
   */
  toggleEntities(groupName) {
    if (this.expandedEntities.has(groupName)) {
      this.expandedEntities.delete(groupName);
    } else {
      this.expandedEntities.add(groupName);
    }
    this.render();
  }

  /**
   * Show error message
   * @param {string} message - Error message
   */
  showError(message) {
    this.metadata = null;
    this.errorMessage = message;
    this.render();
  }

  /**
   * Clear current metadata
   */
  clear() {
    this.currentDocumentId = null;
    this.metadata = null;
    this.isLoading = false;
    this.errorMessage = null;
    this.stopAutoRefresh();
    this.render();
  }

  /**
   * Destroy component and clean up
   */
  destroy() {
    // Stop auto-refresh timer
    this.stopAutoRefresh();

    // Remove all event listeners before clearing innerHTML
    // This prevents memory leaks from orphaned listeners
    const sectionHeaders = this.container.querySelectorAll('[data-section]');
    sectionHeaders.forEach(header => {
      // Clone and replace to remove all listeners
      const newHeader = header.cloneNode(true);
      header.parentNode.replaceChild(newHeader, header);
    });

    const summaryToggle = this.container.querySelector('[data-toggle-summary]');
    if (summaryToggle) {
      const newToggle = summaryToggle.cloneNode(true);
      summaryToggle.parentNode.replaceChild(newToggle, summaryToggle);
    }

    const entityButtons = this.container.querySelectorAll('[data-expand-entities]');
    entityButtons.forEach(button => {
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);
    });

    // Clear DOM
    this.container.innerHTML = '';

    // Clear state
    this.currentDocumentId = null;
    this.metadata = null;
    this.expandedSections.clear();
    this.expandedEntities.clear();
  }

  /**
   * Render the component
   */
  render() {
    if (this.isLoading) {
      this.renderLoading();
    } else if (this.errorMessage) {
      this.renderError();
    } else if (!this.metadata) {
      this.renderEmpty();
    } else {
      this.renderMetadata();
    }
  }

  /**
   * Render loading state
   */
  renderLoading() {
    this.container.innerHTML = `
      <div class="metadata-viewer">
        <div class="metadata-viewer__loading">
          <div class="metadata-viewer__spinner"></div>
          <p style="margin-top: 1rem;">Loading metadata...</p>
        </div>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError() {
    this.container.innerHTML = `
      <div class="metadata-viewer">
        <div class="metadata-viewer__error">
          <div style="display: flex; align-items: center;">
            <svg class="metadata-viewer__error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <div>
              <strong>Error loading metadata</strong>
              <p style="margin-top: 0.25rem;">${this.errorMessage}</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render empty state
   */
  renderEmpty() {
    this.container.innerHTML = `
      <div class="metadata-viewer">
        <div class="metadata-viewer__empty">
          <svg class="metadata-viewer__empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
          </svg>
          <p>Select a document to view metadata</p>
        </div>
      </div>
    `;
  }

  /**
   * Render metadata content
   */
  renderMetadata() {
    const sections = [];

    // Lifecycle section
    if (this.hasLifecycleMetadata() || this.options.showEmptySections) {
      sections.push(this.renderProcessingSection());
    }

    // AI Summary section
    if (this.metadata.summary || !this.options.showEmptySections) {
      sections.push(this.renderSummarySection());
    }

    // Legal Metadata section
    if (this.hasLegalMetadata() || this.options.showEmptySections) {
      sections.push(this.renderLegalMetadataSection());
    }

    // Extracted Entities section
    if (this.hasExtractedEntities() || this.options.showEmptySections) {
      sections.push(this.renderEntitiesSection());
    }

    this.container.innerHTML = `
      <div class="metadata-viewer">
        <div class="metadata-viewer__header">
          <h3 class="metadata-viewer__title">Document Metadata</h3>
        </div>
        <div class="metadata-viewer__content">
          ${sections.join('')}
        </div>
      </div>
    `;

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Check if document has any legal metadata
   */
  hasLegalMetadata() {
    const fields = ['case_number', 'case_name', 'bates_number', 'exhibit_label',
                    'document_type', 'privilege_status', 'author', 'recipient',
                    'date_created', 'date_received'];
    return window.metadataFormatter.hasAnyPopulatedFields(this.metadata, fields);
  }

  /**
   * Check if document has lifecycle metadata
   */
  hasLifecycleMetadata() {
    if (!this.metadata) return false;
    const nested = this.metadata.metadata || {};
    return Boolean(
      this.metadata.processing_status ||
      this.metadata.processing_triggered_by ||
      this.metadata.processing_triggered_at ||
      this.metadata.processing_completed_at ||
      this.metadata.chunk_count ||
      this.metadata.vector_count ||
      this.metadata.ai_indexed_at ||
      this.metadata.summary_generated_at ||
      this.metadata.summary_method ||
      nested.ingestion_stage ||
      nested.parser_provenance
    );
  }

  /**
   * Check if document has extracted entities
   */
  hasExtractedEntities() {
    if (!this.metadata.extracted_entities) return false;
    const entities = window.metadataFormatter.formatExtractedEntities(this.metadata.extracted_entities);
    return entities.caseNumbers.length > 0 ||
           entities.organizations.length > 0 ||
           entities.people.length > 0 ||
           entities.dates.length > 0 ||
           entities.locations.length > 0;
  }

  /**
   * Render AI Summary section
   */
  renderSummarySection() {
    const isExpanded = this.expandedSections.has('summary');
    const summary = this.metadata.summary;
    const summaryState = window.metadataFormatter.formatSummaryState(this.metadata);

    if (!summary) {
      return `
        <div class="metadata-section">
          <div class="metadata-section__header" data-section="summary">
            <h4 class="metadata-section__title">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              AI Summary
            </h4>
            <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
          <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
            <p class="metadata-field__value--empty">${summaryState.text}</p>
          </div>
        </div>
      `;
    }

    const { text: summaryText, isTruncated } = window.metadataFormatter.truncateText(
      summary,
      this.showFullSummary ? 999999 : this.options.summaryMaxLength
    );

    // Render markdown for the summary text
    const summaryHtml = this.renderMarkdown(summaryText);

    return `
      <div class="metadata-section">
        <div class="metadata-section__header" data-section="summary">
          <h4 class="metadata-section__title">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            AI Summary
          </h4>
          <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
        <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
          <div class="metadata-summary">
            <div class="metadata-summary__text ${this.showFullSummary ? '' : 'truncated'}">${summaryHtml}</div>
            ${isTruncated && this.options.truncateSummary ? `
              <button class="metadata-summary__toggle" data-toggle-summary>
                ${this.showFullSummary ? 'Show Less' : 'Show More'}
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render Legal Metadata section
   */
  renderLegalMetadataSection() {
    const isExpanded = this.expandedSections.has('legal');

    const fields = [
      { label: 'Case Number', value: this.metadata.case_number },
      { label: 'Case Name', value: this.metadata.case_name },
      { label: 'Bates Number', value: this.metadata.bates_number },
      { label: 'Exhibit Label', value: this.metadata.exhibit_label },
      { label: 'Document Type', value: window.metadataFormatter.formatDocumentType(this.metadata.document_type) },
      { label: 'Author', value: this.metadata.author },
      { label: 'Recipient', value: this.metadata.recipient },
      { label: 'Date Created', value: window.metadataFormatter.formatDate(this.metadata.date_created) },
      { label: 'Date Received', value: window.metadataFormatter.formatDate(this.metadata.date_received) }
    ];

    // Filter out empty fields
    const populatedFields = fields.filter(f => f.value && f.value !== '—');

    // Privilege status badge
    const privilegeStatus = window.metadataFormatter.formatPrivilegeStatus(this.metadata.privilege_status);

    const fieldsHtml = populatedFields.length > 0 ? populatedFields.map(field => `
      <div class="metadata-field">
        <div class="metadata-field__label">${field.label}:</div>
        <div class="metadata-field__value">${this.escapeHtml(field.value)}</div>
      </div>
    `).join('') : '<p class="metadata-field__value--empty">No legal metadata extracted</p>';

    return `
      <div class="metadata-section">
        <div class="metadata-section__header" data-section="legal">
          <h4 class="metadata-section__title">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"></path>
            </svg>
            Metadata
          </h4>
          <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
        <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
          ${privilegeStatus.text ? `
            <div class="metadata-field">
              <div class="metadata-field__label">Privilege Status:</div>
              <div class="metadata-field__value">
                <span class="metadata-badge metadata-badge--privileged">
                  <svg class="metadata-badge__icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
                  </svg>
                  ${privilegeStatus.text}
                </span>
              </div>
            </div>
          ` : ''}
          ${fieldsHtml}
        </div>
      </div>
    `;
  }

  /**
   * Render Extracted Entities section
   */
  renderEntitiesSection() {
    const isExpanded = this.expandedSections.has('entities');
    const entities = window.metadataFormatter.formatExtractedEntities(this.metadata.extracted_entities);

    const hasEntities = entities.caseNumbers.length > 0 ||
                        entities.organizations.length > 0 ||
                        entities.people.length > 0 ||
                        entities.dates.length > 0 ||
                        entities.locations.length > 0;

    if (!hasEntities) {
      return `
        <div class="metadata-section">
          <div class="metadata-section__header" data-section="entities">
            <h4 class="metadata-section__title">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
              </svg>
              Extracted Entities
            </h4>
            <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
          <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
            <p class="metadata-field__value--empty">No entities extracted</p>
          </div>
        </div>
      `;
    }

    const renderEntityGroup = (label, items, type) => {
      if (items.length === 0) return '';

      const maxItems = this.options.entitiesMaxItems;
      const isExpanded = this.expandedEntities.has(type);
      const displayItems = isExpanded ? items : items.slice(0, maxItems);
      const hasMore = items.length > maxItems;

      return `
        <div class="metadata-entities__group">
          <div class="metadata-entities__label">${label}:</div>
          <div class="metadata-entities__list">
            ${displayItems.map(item => {
              const className = type === 'people' ? 'metadata-entities__item--person' :
                                type === 'organizations' ? 'metadata-entities__item--org' :
                                type === 'locations' ? 'metadata-entities__item--location' :
                                '';
              const displayText = typeof item === 'object' ? `${item.name} (${item.role})` : item;
              return `<span class="metadata-entities__item ${className}">${this.escapeHtml(displayText)}</span>`;
            }).join('')}
            ${hasMore && !isExpanded ? `
              <span class="metadata-entities__more" data-expand-entities="${type}">
                +${items.length - maxItems} more
              </span>
            ` : ''}
          </div>
        </div>
      `;
    };

    return `
      <div class="metadata-section">
        <div class="metadata-section__header" data-section="entities">
          <h4 class="metadata-section__title">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"></path>
            </svg>
            Extracted Entities
          </h4>
          <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
        <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
          <div class="metadata-entities">
            ${renderEntityGroup('Case Numbers', entities.caseNumbers, 'caseNumbers')}
            ${renderEntityGroup('Organizations', entities.organizations, 'organizations')}
            ${renderEntityGroup('People', entities.people, 'people')}
            ${renderEntityGroup('Dates', entities.dates, 'dates')}
            ${renderEntityGroup('Locations', entities.locations, 'locations')}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render Document Lifecycle section
   */
  renderProcessingSection() {
    const isExpanded = this.expandedSections.has('processing');
    const lifecycle = window.metadataFormatter.formatDocumentLifecycle(this.metadata);
    const summaryState = window.metadataFormatter.formatSummaryState(this.metadata);
    const trigger = window.metadataFormatter.formatProcessingTrigger(this.metadata.processing_triggered_by);
    const startTime = window.metadataFormatter.formatTimestamp(this.metadata.processing_triggered_at);
    const endTime = window.metadataFormatter.formatTimestamp(this.metadata.processing_completed_at);
    const duration = window.metadataFormatter.formatDuration(
      this.metadata.processing_triggered_at,
      this.metadata.processing_completed_at
    );
    const nested = this.metadata.metadata || {};

    const fields = [
      { label: 'Lifecycle', value: lifecycle.label },
      { label: 'Lifecycle Detail', value: lifecycle.progressLabel },
      { label: 'Summary', value: summaryState.text },
      { label: 'Triggered By', value: trigger },
      { label: 'Started', value: startTime },
      { label: 'Completed', value: endTime },
      { label: 'Duration', value: duration },
      { label: 'Page Count', value: this.metadata.page_count ? `${this.metadata.page_count} pages` : null },
      { label: 'Chunks Generated', value: this.metadata.chunk_count ? `${this.metadata.chunk_count} chunks` : null },
      { label: 'Embeddings', value: this.metadata.vector_count ? `${this.metadata.vector_count} vectors` : null },
      { label: 'AI Indexed At', value: window.metadataFormatter.formatTimestamp(this.metadata.ai_indexed_at) },
      { label: 'Ingestion Stage', value: nested.ingestion_stage || null },
      { label: 'Parser Provenance', value: nested.parser_provenance || null },
      { label: 'Summary Method', value: window.metadataFormatter.formatSummaryMethod(this.metadata.summary_method) }
    ].filter(f => f.value && f.value !== '—');
    const badgeState = lifecycle.state === 'ready' || lifecycle.state === 'summarized'
      ? 'completed'
      : (lifecycle.state === 'parsed' || lifecycle.state === 'indexed' ? 'processing'
        : (lifecycle.state === 'needs_attention' ? 'failed' : 'pending'));

    return `
      <div class="metadata-section">
        <div class="metadata-section__header" data-section="processing">
          <h4 class="metadata-section__title">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
            Document Lifecycle
          </h4>
          <svg class="metadata-section__toggle ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
          </svg>
        </div>
        <div class="metadata-section__content ${isExpanded ? '' : 'collapsed'}">
          <div class="metadata-field">
            <div class="metadata-field__label">Status:</div>
            <div class="metadata-field__value">
              <span class="metadata-badge metadata-badge--${badgeState}">
                ${lifecycle.isInProgress ? `
                  <svg class="metadata-badge__icon animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                  </svg>
                ` : ''}
                ${lifecycle.label}
              </span>
            </div>
          </div>
          ${lifecycle.summaryState === 'pending' ? `
            <div class="metadata-field">
              <div class="metadata-field__label">Summary:</div>
              <div class="metadata-field__value" style="color: #d97706;">
                Summary pending
              </div>
            </div>
          ` : ''}
          ${this.metadata.processing_status === 'failed' && this.metadata.processing_error ? `
            <div class="metadata-field">
              <div class="metadata-field__label">Error:</div>
              <div class="metadata-field__value" style="color: #dc2626;">
                ${this.escapeHtml(this.metadata.processing_error)}
              </div>
            </div>
          ` : ''}
          ${fields.map(field => `
            <div class="metadata-field">
              <div class="metadata-field__label">${field.label}:</div>
              <div class="metadata-field__value">${this.escapeHtml(field.value)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners to rendered elements
   */
  attachEventListeners() {
    // Section toggle listeners
    this.container.querySelectorAll('[data-section]').forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = header.getAttribute('data-section');
        this.toggleSection(sectionId);
      });
    });

    // Summary toggle listener
    const summaryToggle = this.container.querySelector('[data-toggle-summary]');
    if (summaryToggle) {
      summaryToggle.addEventListener('click', () => this.toggleSummary());
    }

    // Entity expansion listeners
    this.container.querySelectorAll('[data-expand-entities]').forEach(button => {
      button.addEventListener('click', () => {
        const type = button.getAttribute('data-expand-entities');
        this.toggleEntities(type);
      });
    });
  }

  /**
   * Render markdown text to HTML
   * Falls back to escapeHtml if marked library is not available
   * @param {string} text - Markdown text to render
   * @returns {string} - Rendered HTML
   */
  renderMarkdown(text) {
    // Handle non-string values
    if (text === null || text === undefined) return '';
    if (typeof text !== 'string') text = String(text);

    // If marked is available, use it to render markdown
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      try {
        // Use parse for block-level markdown (with <p> tags, line breaks, etc.)
        return marked.parse(text);
      } catch (e) {
        console.warn('[DocumentMetadataViewer] Error rendering markdown:', e);
        return this.escapeHtml(text);
      }
    }

    // Fallback: escape HTML if marked is not available
    return this.escapeHtml(text);
  }

  /**
   * Escape HTML to prevent XSS
   * @param {string} text - Text to escape
   * @returns {string} - Escaped HTML
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Export to window for global access
window.DocumentMetadataViewer = DocumentMetadataViewer;
