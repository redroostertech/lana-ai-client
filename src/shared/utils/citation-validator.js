'use strict';

function clampRelevance(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return Math.max(0, Math.min(1, num));
}

function citationKey(citation) {
  return `${citation.document_id}:${citation.page_number === null || citation.page_number === undefined ? '' : citation.page_number}`;
}

function validateAndNormalizeCitations(citations) {
  if (!Array.isArray(citations)) return [];

  const seen = new Set();
  const normalized = [];

  citations.forEach((citation, index) => {
    if (!citation || citation.document_id === undefined || citation.document_id === null || citation.filename === undefined || citation.filename === null) {
      return;
    }

    const item = {
      id: citation.id ? String(citation.id) : `citation-${index + 1}-${String(citation.document_id)}`,
      document_id: String(citation.document_id),
      filename: String(citation.filename),
      page_number: citation.page_number === undefined ? null : citation.page_number,
      page_range: citation.page_range || null,
      chunk_id: citation.chunk_id || null,
      bates_number: citation.bates_number || null,
      exhibit_label: citation.exhibit_label || null,
      relevance: clampRelevance(citation.relevance),
      excerpt: citation.excerpt || null
    };

    const key = citationKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(item);
  });

  return normalized;
}

module.exports = { validateAndNormalizeCitations };
