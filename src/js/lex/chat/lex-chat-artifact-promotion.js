/* ===========================================================================
   Lex Chat — artifact promotion contract helpers

   Keeps the renderer presentation-first: the backend advertises available
   actions and returns the canonical document/ingestion result. These helpers
   only validate and normalize that DTO for the chat card.
   ========================================================================== */

(function (global) {
  'use strict';

  function getArtifactId(artifact) {
    if (!artifact || typeof artifact !== 'object') return '';
    return artifact.artifact_id || artifact.id || '';
  }

  function getArtifactIdentity(artifact) {
    var artifactId = getArtifactId(artifact);
    if (artifactId) return 'artifact:' + artifactId;
    if (artifact && artifact.entity_type && artifact.entity_id) {
      return 'entity:' + artifact.entity_type + ':' + artifact.entity_id;
    }
    return '';
  }

  function mergeArtifacts(existing, incoming) {
    var merged = Array.isArray(existing) ? existing.slice() : [];
    var additions = Array.isArray(incoming) ? incoming : [];

    for (var i = 0; i < additions.length; i += 1) {
      var next = additions[i];
      var identity = getArtifactIdentity(next);
      var existingIndex = -1;
      if (identity) {
        for (var j = 0; j < merged.length; j += 1) {
          if (getArtifactIdentity(merged[j]) === identity) {
            existingIndex = j;
            break;
          }
        }
      }

      if (existingIndex === -1) merged.push(next);
      else merged[existingIndex] = Object.assign({}, merged[existingIndex], next);
    }
    return merged;
  }

  function getSaveToDocumentsAction(artifact) {
    if (!artifact || !Array.isArray(artifact.actions)) return null;
    for (var i = 0; i < artifact.actions.length; i += 1) {
      var action = artifact.actions[i];
      if (action && action.id === 'save_to_documents') return action;
    }
    return null;
  }

  function getPersistenceView(artifact) {
    var persistence = artifact && artifact.persistence;
    if (!persistence || typeof persistence !== 'object' || !persistence.status) return null;

    var status = String(persistence.status);
    var message = persistence.message ? String(persistence.message) : '';

    if (status === 'saved_as_draft') {
      return {
        status: status,
        tone: 'draft',
        message: message || 'Draft saved to this matter.'
      };
    }

    if (status === 'promoted') {
      return {
        status: status,
        tone: 'success',
        message: message || 'Saved to Documents.'
      };
    }

    if (status === 'save_failed' || status === 'failed') {
      return {
        status: status,
        tone: 'error',
        message: message || 'This draft was not saved.'
      };
    }

    return {
      status: status,
      tone: 'neutral',
      message: message || 'Artifact persistence status: ' + status.split('_').join(' ')
    };
  }

  function getPromotionRequest(action) {
    if (!action || String(action.method || '').toLowerCase() !== 'post' || !action.endpoint) {
      throw new Error('The save action is unavailable.');
    }
    if (!action.body || action.body.approved !== true) {
      throw new Error('The save action does not contain explicit approval.');
    }
    return {
      endpoint: action.endpoint,
      body: action.body
    };
  }

  function normalizePromotionResponse(response) {
    var data = response && response.data ? response.data : response;
    if (!data || data.promotion_status !== 'promoted') {
      throw new Error('The server did not confirm that this draft was saved to Documents.');
    }

    var documentRecord = data.document;
    if (!documentRecord || !documentRecord.id) {
      throw new Error('The server did not return the saved document.');
    }

    return {
      artifactId: data.artifact_id || '',
      matterId: data.matter_id || '',
      promotionStatus: data.promotion_status,
      document: documentRecord,
      ingestion: data.ingestion || null,
      alreadyPromoted: data.already_promoted === true
    };
  }

  var api = {
    getArtifactId: getArtifactId,
    mergeArtifacts: mergeArtifacts,
    getSaveToDocumentsAction: getSaveToDocumentsAction,
    getPersistenceView: getPersistenceView,
    getPromotionRequest: getPromotionRequest,
    normalizePromotionResponse: normalizePromotionResponse
  };

  global.Lex = global.Lex || {};
  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.ArtifactPromotion = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
