/**
 * Unit tests for citation-validator.js
 */

const { validateAndNormalizeCitations } = require('../../src/shared/utils/citation-validator');

describe('Citation Validator', () => {
  describe('validateAndNormalizeCitations', () => {
    test('returns empty array for non-array input', () => {
      expect(validateAndNormalizeCitations(null)).toEqual([]);
      expect(validateAndNormalizeCitations(undefined)).toEqual([]);
      expect(validateAndNormalizeCitations('string')).toEqual([]);
      expect(validateAndNormalizeCitations({})).toEqual([]);
    });

    test('filters out citations with missing required fields', () => {
      const citations = [
        { document_id: 'doc1', filename: 'file1.pdf' }, // Valid
        { document_id: 'doc2' },                        // Missing filename
        { filename: 'file3.pdf' },                      // Missing document_id
        {}                                              // Missing both
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result).toHaveLength(1);
      expect(result[0].document_id).toBe('doc1');
      expect(result[0].filename).toBe('file1.pdf');
    });

    test('normalizes citation structure with defaults', () => {
      const citations = [
        {
          document_id: 'doc1',
          filename: 'file1.pdf',
          page_number: 5
        }
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result[0]).toMatchObject({
        document_id: 'doc1',
        filename: 'file1.pdf',
        page_number: 5,
        page_range: null,
        chunk_id: null,
        bates_number: null,
        exhibit_label: null,
        excerpt: null
      });
      expect(result[0]).toHaveProperty('id');
      expect(result[0].relevance).toBe(0.5); // Default
    });

    test('clamps relevance scores to valid range', () => {
      const citations = [
        { document_id: 'doc1', filename: 'file1.pdf', relevance: -0.5 },
        { document_id: 'doc2', filename: 'file2.pdf', relevance: 1.5 },
        { document_id: 'doc3', filename: 'file3.pdf', relevance: 0.7 }
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result[0].relevance).toBe(0);    // Clamped from -0.5
      expect(result[1].relevance).toBe(1);    // Clamped from 1.5
      expect(result[2].relevance).toBe(0.7);  // Valid, unchanged
    });

    test('deduplicates by document_id + page_number', () => {
      const citations = [
        { document_id: 'doc1', filename: 'file1.pdf', page_number: 5 },
        { document_id: 'doc1', filename: 'file1.pdf', page_number: 5 }, // Duplicate
        { document_id: 'doc1', filename: 'file1.pdf', page_number: 6 }, // Different page
        { document_id: 'doc2', filename: 'file2.pdf', page_number: 5 }  // Different doc
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result).toHaveLength(3); // Duplicate removed
      expect(result[0].page_number).toBe(5);
      expect(result[1].page_number).toBe(6);
      expect(result[2].document_id).toBe('doc2');
    });

    test('preserves all valid citation fields', () => {
      const citations = [
        {
          id: 'cite-1',
          document_id: 'doc1',
          filename: 'contract.pdf',
          page_number: 5,
          page_range: '5-6',
          chunk_id: 'chunk_123',
          bates_number: 'BATES-001',
          exhibit_label: 'Exhibit A',
          relevance: 0.95,
          excerpt: 'This is an excerpt...'
        }
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result[0]).toMatchObject({
        id: 'cite-1',
        document_id: 'doc1',
        filename: 'contract.pdf',
        page_number: 5,
        page_range: '5-6',
        chunk_id: 'chunk_123',
        bates_number: 'BATES-001',
        exhibit_label: 'Exhibit A',
        relevance: 0.95,
        excerpt: 'This is an excerpt...'
      });
    });

    test('generates unique IDs for citations without IDs', () => {
      const citations = [
        { document_id: 'doc1', filename: 'file1.pdf' },
        { document_id: 'doc2', filename: 'file2.pdf' }
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(result[0].id).toBeDefined();
      expect(result[1].id).toBeDefined();
      expect(result[0].id).not.toBe(result[1].id);
    });

    test('converts document_id and filename to strings', () => {
      const citations = [
        { document_id: 123, filename: 456 }
      ];

      const result = validateAndNormalizeCitations(citations);
      expect(typeof result[0].document_id).toBe('string');
      expect(typeof result[0].filename).toBe('string');
      expect(result[0].document_id).toBe('123');
      expect(result[0].filename).toBe('456');
    });
  });
});
