// src/js/utils/document-lifecycle.js
// Shared document lifecycle helpers for client-side readiness and summary state.

(function () {
  'use strict';

  function toLower(value) {
    return String(value || '').toLowerCase();
  }

  function toNumber(value) {
    var num = Number(value);
    return isNaN(num) ? 0 : num;
  }

  function trimText(value) {
    return String(value || '').trim();
  }

  function getMetadata(doc) {
    return doc && doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {};
  }

  function isInactive(doc) {
    var status = toLower(doc && doc.status);
    return status === 'cancelled' || status === 'deleted' || status === 'inactive';
  }

  function isNeedsAttention(doc) {
    var status = toLower(doc && doc.status);
    var processingStatus = toLower(doc && doc.processing_status);
    return status === 'failed' || status === 'error' || processingStatus === 'failed' || processingStatus === 'error';
  }

  function hasParsedSignals(doc, metadata) {
    var status = toLower(doc && doc.status);
    var processingStatus = toLower(doc && doc.processing_status);
    var ingestionStage = toLower(metadata.ingestion_stage);

    return Boolean(
      doc && (
        doc.processed_at ||
        metadata.parser_provenance ||
        ingestionStage === 'parsed' ||
        ingestionStage === 'structured' ||
        status === 'text_extracted' ||
        status === 'parsed' ||
        processingStatus === 'parsed'
      )
    );
  }

  function hasIndexedSignals(doc, metadata) {
    var status = toLower(doc && doc.status);
    var processingStatus = toLower(doc && doc.processing_status);
    var ingestionStage = toLower(metadata.ingestion_stage);
    var chunkCount = toNumber(doc && doc.chunk_count);
    var vectorCount = toNumber(doc && doc.vector_count);

    return Boolean(
      doc && (
        doc.ai_indexed_at ||
        chunkCount > 0 ||
        vectorCount > 0 ||
        ingestionStage === 'indexed' ||
        status === 'indexed' ||
        processingStatus === 'indexed'
      )
    );
  }

  function hasSummary(doc) {
    return Boolean(trimText(doc && doc.summary) || (doc && doc.summary_generated_at));
  }

  function isSummaryQueued(doc) {
    var summaryMethod = toLower(doc && doc.summary_method);
    return summaryMethod === 'queued' || summaryMethod === 'pending';
  }

  function getDocumentLifecycle(doc) {
    var metadata = getMetadata(doc);
    var status = toLower(doc && doc.status);
    var processingStatus = toLower(doc && doc.processing_status);
    var ingestionStage = toLower(metadata.ingestion_stage);

    if (isInactive(doc)) return 'inactive';
    if (isNeedsAttention(doc)) return 'needs_attention';
    if (ingestionStage === 'ready' || status === 'completed' || processingStatus === 'completed') return 'ready';
    if (hasIndexedSignals(doc, metadata)) return 'indexed';
    if (hasParsedSignals(doc, metadata)) return 'parsed';
    if (status === 'queued' || status === 'pending' || status === 'uploaded' || processingStatus === 'queued' || processingStatus === 'processing' || status === 'processing') {
      return 'uploaded';
    }
    return 'uploaded';
  }

  function getDocumentSummaryState(doc) {
    if (isInactive(doc) || isNeedsAttention(doc)) return 'unavailable';
    if (hasSummary(doc)) return 'summarized';

    var lifecycle = getDocumentLifecycle(doc);
    if (isSummaryQueued(doc) || lifecycle === 'ready') return 'pending';
    return 'unavailable';
  }

  function getDocumentLifecycleDisplay(doc) {
    var lifecycle = getDocumentLifecycle(doc);
    var summaryState = getDocumentSummaryState(doc);
    var display = {
      state: lifecycle,
      summaryState: summaryState,
      label: 'Uploaded',
      badgeClass: 'bg-blue-100 text-blue-700',
      progressLabel: 'Uploaded, awaiting parsing',
      secondaryLabel: '',
      isReady: false,
      isTerminal: false,
      isInProgress: true,
      isActionableInChat: false
    };

    if (lifecycle === 'inactive') {
      display.label = 'Inactive';
      display.badgeClass = 'bg-gray-100 text-gray-700';
      display.progressLabel = 'Inactive';
      display.secondaryLabel = 'Inactive';
      display.isTerminal = true;
      display.isInProgress = false;
      return display;
    }

    if (lifecycle === 'needs_attention') {
      display.label = 'Needs Attention';
      display.badgeClass = 'bg-red-100 text-red-700';
      display.progressLabel = 'Processing needs attention';
      display.secondaryLabel = 'Lifecycle failed';
      display.isTerminal = true;
      display.isInProgress = false;
      return display;
    }

    if (lifecycle === 'parsed') {
      display.label = 'Parsed';
      display.badgeClass = 'bg-indigo-100 text-indigo-700';
      display.progressLabel = 'Text and layout extracted';
      display.secondaryLabel = 'Ready for indexing';
      return display;
    }

    if (lifecycle === 'indexed') {
      display.label = 'Indexed';
      display.badgeClass = 'bg-amber-100 text-amber-700';
      display.progressLabel = 'Indexed for AI search';
      display.secondaryLabel = 'Searchable and vectorized';
      return display;
    }

    if (summaryState === 'summarized') {
      display.state = 'summarized';
      display.label = 'Summarized';
      display.badgeClass = 'bg-green-100 text-green-700';
      display.progressLabel = 'Ready and summarized';
      display.secondaryLabel = 'AI summary available';
      display.isReady = true;
      display.isTerminal = true;
      display.isInProgress = false;
      display.isActionableInChat = true;
      return display;
    }

    if (lifecycle === 'ready') {
      display.label = 'Ready';
      display.badgeClass = 'bg-green-100 text-green-700';
      display.progressLabel = summaryState === 'pending' ? 'Ready, summary pending' : 'Ready to review';
      display.secondaryLabel = summaryState === 'pending' ? 'Summary pending' : 'Usable in the platform';
      display.isReady = true;
      display.isTerminal = summaryState !== 'pending';
      display.isInProgress = summaryState === 'pending';
      display.isActionableInChat = true;
      return display;
    }

    if (summaryState === 'pending') {
      display.label = 'Ready';
      display.badgeClass = 'bg-green-100 text-green-700';
      display.progressLabel = 'Ready, summary pending';
      display.secondaryLabel = 'Summary pending';
      display.isReady = true;
      display.isInProgress = true;
      display.isActionableInChat = true;
      return display;
    }

    return display;
  }

  function isDocumentReady(doc) {
    return getDocumentLifecycleDisplay(doc).isReady;
  }

  function isSummaryPending(doc) {
    return getDocumentSummaryState(doc) === 'pending';
  }

  function isDocumentActionableInChat(doc) {
    return getDocumentLifecycleDisplay(doc).isActionableInChat;
  }

  function isDocumentTerminal(doc) {
    return getDocumentLifecycleDisplay(doc).isTerminal;
  }

  window.documentLifecycle = {
    getDocumentLifecycle: getDocumentLifecycle,
    getDocumentSummaryState: getDocumentSummaryState,
    getDocumentLifecycleDisplay: getDocumentLifecycleDisplay,
    isDocumentReady: isDocumentReady,
    isSummaryPending: isSummaryPending,
    isDocumentActionableInChat: isDocumentActionableInChat,
    isDocumentTerminal: isDocumentTerminal
  };
})();
