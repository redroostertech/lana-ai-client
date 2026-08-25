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

  test('repairs duplicate durable IDs already present before terminal enrichment', () => {
    expect(promotion.mergeArtifacts([
      { artifact_id: 'a-1', artifact_name: 'Draft memo' },
      { artifact_id: 'a-1', persistence: { status: 'saved_as_draft' } }
    ], [
      { artifact_id: 'a-1', actions: [{ id: 'save_to_documents' }] }
    ])).toEqual([{
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

  test('opens promoted documents through the live storage download contract', () => {
    const apiClient = {
      baseUrl: 'http://127.0.0.1:8080',
      getFileDownloadUrl: jest.fn((documentId, matterId) =>
        `http://127.0.0.1:8080/api/v1/storage/files/${documentId}/download?matter_id=${matterId}`)
    };

    expect(promotion.getPromotedDocumentDownloadUrl(apiClient, 'd-1', 'm-1', 'token value'))
      .toBe('http://127.0.0.1:8080/api/v1/storage/files/d-1/download?matter_id=m-1&token=token%20value');
    expect(apiClient.getFileDownloadUrl).toHaveBeenCalledWith('d-1', 'm-1');
  });

  test('recognizes private insight context promotion suggestions', () => {
    const artifact = {
      artifact_type: 'context_promotion',
      context_promotion: {
        promotion_id: 'cp-1',
        title: 'Client prefers email',
        insight: 'The client asked for written updates only.',
        matter_name: 'Doe v Smith',
        status: 'pending'
      },
      actions: [
        { id: 'approve_context_promotion' },
        { id: 'dismiss_context_promotion' }
      ]
    };

    expect(promotion.getContextPromotionId(artifact)).toBe('cp-1');
    expect(promotion.getContextPromotionView(artifact)).toMatchObject({
      id: 'cp-1',
      title: 'Client prefers email',
      insight: 'The client asked for written updates only.',
      matterName: 'Doe v Smith',
      tone: 'pending',
      message: 'Private insight. Approve to share with the matter.'
    });
    expect(promotion.getApproveContextPromotionAction(artifact).id).toBe('approve_context_promotion');
    expect(promotion.getDismissContextPromotionAction(artifact).id).toBe('dismiss_context_promotion');
  });

  test('requires explicit approval for context promotion requests', () => {
    expect(promotion.getContextActionRequest({
      method: 'POST',
      endpoint: '/api/v1/context-promotions/cp-1/approve',
      body: { approved: true }
    }, 'approve')).toEqual({
      endpoint: '/api/v1/context-promotions/cp-1/approve',
      body: { approved: true }
    });

    expect(() => promotion.getContextActionRequest({
      method: 'POST',
      endpoint: '/api/v1/context-promotions/cp-1/approve',
      body: {}
    }, 'approve')).toThrow('explicit approval');
  });

  test('does not allow a dismiss action to carry approval', () => {
    expect(promotion.getContextActionRequest({
      method: 'POST',
      endpoint: '/api/v1/context-promotions/cp-1/dismiss',
      body: { dismissed: true }
    }, 'dismiss')).toEqual({
      endpoint: '/api/v1/context-promotions/cp-1/dismiss',
      body: { dismissed: true }
    });

    expect(() => promotion.getContextActionRequest({
      method: 'POST',
      endpoint: '/api/v1/context-promotions/cp-1/dismiss',
      body: { approved: true }
    }, 'dismiss')).toThrow('cannot contain approval');
  });

  test('verifies context promotion action responses', () => {
    expect(promotion.normalizeContextPromotionResponse({
      data: {
        promotion_status: 'promoted',
        matter_id: 'm-1',
        context_ref: { type: 'matter_state', id: 'ref-1' },
        state_revision: 'rev-1',
        already_promoted: false
      }
    }, 'approve')).toEqual({
      promotionStatus: 'promoted',
      matterId: 'm-1',
      contextRef: { type: 'matter_state', id: 'ref-1' },
      stateRevision: 'rev-1',
      alreadyPromoted: false
    });

    expect(promotion.normalizeContextPromotionResponse({
      data: { promotion_status: 'dismissed' }
    }, 'dismiss')).toEqual({ promotionStatus: 'dismissed' });

    expect(() => promotion.normalizeContextPromotionResponse({
      data: { promotion_status: 'pending' }
    }, 'approve')).toThrow('did not confirm');
  });
});
