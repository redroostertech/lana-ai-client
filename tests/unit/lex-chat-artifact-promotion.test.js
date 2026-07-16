'use strict';

const promotion = require('../../src/js/lex/chat/lex-chat-artifact-promotion');

describe('Lex chat artifact promotion contract', () => {
  test('uses only the backend save_to_documents action descriptor', () => {
    const action = {
      id: 'save_to_documents',
      method: 'POST',
      endpoint: '/api/v1/agentic/artifacts/a-1/promote',
      requires_confirmation: true
    };
    const artifact = { actions: [{ id: 'download' }, action] };

    expect(promotion.getSaveToDocumentsAction(artifact)).toBe(action);
    expect(promotion.getSaveToDocumentsAction({ actions: [{ id: 'download' }] })).toBeNull();
  });

  test('merges realtime and terminal copies of the same saved artifact once', () => {
    const first = {
      artifact_id: 'a-1',
      artifact_name: 'Draft memo',
      persistence: { status: 'saved_as_draft' }
    };
    const terminal = {
      artifact_id: 'a-1',
      actions: [{ id: 'save_to_documents' }]
    };

    expect(promotion.mergeArtifacts([first], [terminal])).toEqual([{
      artifact_id: 'a-1',
      artifact_name: 'Draft memo',
      persistence: { status: 'saved_as_draft' },
      actions: [{ id: 'save_to_documents' }]
    }]);
  });

  test('renders the backend draft persistence message truthfully', () => {
    expect(promotion.getPersistenceView({
      persistence: {
        status: 'saved_as_draft',
        message: 'Draft saved to this matter.'
      }
    })).toEqual({
      status: 'saved_as_draft',
      tone: 'draft',
      message: 'Draft saved to this matter.'
    });
  });

  test('uses the exact confirmation-gated request body advertised by the backend', () => {
    const body = { approved: true, filename: 'Client-approved memo.md' };
    expect(promotion.getPromotionRequest({
      method: 'POST',
      endpoint: '/api/v1/matters/MATT-1/artifacts/a-1/promote',
      body
    })).toEqual({
      endpoint: '/api/v1/matters/MATT-1/artifacts/a-1/promote',
      body
    });

    expect(() => promotion.getPromotionRequest({
      method: 'POST',
      endpoint: '/api/v1/matters/MATT-1/artifacts/a-1/promote',
      body: { approved: false }
    })).toThrow('explicit approval');
  });

  test('does not invent persistence state when the backend omitted it', () => {
    expect(promotion.getPersistenceView({})).toBeNull();
  });

  test('accepts only a promoted result with a canonical document', () => {
    expect(promotion.normalizePromotionResponse({
      data: {
        artifact_id: 'a-1',
        matter_id: 'm-1',
        promotion_status: 'promoted',
        document: { id: 'd-1', filename: 'Draft NDA.docx', status: 'processing' },
        ingestion: { job_id: 'j-1', status: 'queued' },
        already_promoted: false
      }
    })).toEqual({
      artifactId: 'a-1',
      matterId: 'm-1',
      promotionStatus: 'promoted',
      document: { id: 'd-1', filename: 'Draft NDA.docx', status: 'processing' },
      ingestion: { job_id: 'j-1', status: 'queued' },
      alreadyPromoted: false
    });
  });

  test('rejects HTTP-success payloads that do not confirm promotion', () => {
    expect(() => promotion.normalizePromotionResponse({ data: { promotion_status: 'pending' } }))
      .toThrow('did not confirm');
    expect(() => promotion.normalizePromotionResponse({
      data: { promotion_status: 'promoted', document: null }
    })).toThrow('did not return the saved document');
  });

  test('preserves already-promoted idempotency truth', () => {
    const result = promotion.normalizePromotionResponse({
      data: {
        artifact_id: 'a-1',
        promotion_status: 'promoted',
        document: { id: 'd-1', filename: 'Draft NDA.docx' },
        already_promoted: true
      }
    });

    expect(result.alreadyPromoted).toBe(true);
    expect(result.document.id).toBe('d-1');
  });
});
