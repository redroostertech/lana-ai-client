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

  function getContextPromotionId(item) {
    if (!item || typeof item !== 'object') return '';
    var promotion = item.context_promotion || item.contextPromotion || item;
    return promotion.promotion_id || promotion.context_promotion_id || promotion.suggestion_id || promotion.id || item.artifact_id || item.id || '';
  }

  function getContextPromotionAction(item, actionId) {
    if (!item || !Array.isArray(item.actions)) return null;
    for (var i = 0; i < item.actions.length; i += 1) {
      var action = item.actions[i];
      if (action && action.id === actionId) return action;
    }
    return null;
  }

  function getApproveContextPromotionAction(item) {
    return getContextPromotionAction(item, 'approve_context_promotion') ||
      getContextPromotionAction(item, 'promote_context');
  }

  function getDismissContextPromotionAction(item) {
    return getContextPromotionAction(item, 'dismiss_context_promotion') ||
      getContextPromotionAction(item, 'reject_context_promotion');
  }

  function getContextPromotionView(item) {
    if (!item || typeof item !== 'object') return null;

    var type = String(item.artifact_type || item.entity_type || item.type || '').toLowerCase();
    var promotion = item.context_promotion || item.contextPromotion || null;
    if (!promotion && type !== 'context_promotion' && type !== 'private_insight_promotion') return null;
    promotion = promotion && typeof promotion === 'object' ? promotion : item;

    var status = String(promotion.status || item.status || 'pending').toLowerCase();
    var title = promotion.title || item.title || item.label || 'Suggested context';
    var insight = promotion.insight || promotion.summary || promotion.body || promotion.description || item.description || '';
    var matterName = promotion.matter_name || promotion.matterName || item.matter_name || item.matterName || '';
    var matterId = promotion.matter_id || promotion.matterId || item.matter_id || item.matterId || '';
    var sourceLabel = promotion.source_label || promotion.sourceLabel || promotion.source || item.source || 'Private chat insight';
    var reason = promotion.reason || promotion.rationale || item.reason || '';
    var sensitivity = promotion.sensitivity_label || promotion.sensitivityLabel || promotion.visibility || 'Private until approved';

    var tone = 'pending';
    var message = 'Private insight. Approve to share with the matter.';
    if (status === 'promoted' || status === 'approved') {
      tone = 'success';
      message = 'Shared with the matter.';
    } else if (status === 'dismissed' || status === 'rejected') {
      tone = 'neutral';
      message = 'Dismissed. Nothing was shared.';
    } else if (status === 'failed' || status === 'error') {
      tone = 'error';
      message = 'Context promotion failed.';
    }

    return {
      id: getContextPromotionId(item),
      status: status,
      tone: tone,
      message: promotion.message || item.message || message,
      title: title,
      insight: insight,
      matterId: matterId,
      matterName: matterName,
      sourceLabel: sourceLabel,
      reason: reason,
      sensitivity: sensitivity
    };
  }

  function getContextActionRequest(action, kind) {
    if (!action || String(action.method || '').toLowerCase() !== 'post' || !action.endpoint) {
      throw new Error('The context action is unavailable.');
    }

    var body = action.body || action.payload || {};
    if (kind === 'approve' && body.approved !== true) {
      throw new Error('The context promotion action does not contain explicit approval.');
    }
    if (kind === 'dismiss' && body.approved === true) {
      throw new Error('Dismiss action cannot contain approval.');
    }

    return {
      endpoint: action.endpoint,
      body: body
    };
  }

  function normalizeContextPromotionResponse(response, kind) {
    var data = response && response.data ? response.data : response;
    data = data || {};
    var status = String(data.promotion_status || data.status || '').toLowerCase();

    if (kind === 'approve') {
      if (status !== 'promoted' && status !== 'approved') {
        throw new Error('The server did not confirm that this insight was shared with the matter.');
      }
      return {
        promotionStatus: status,
        matterId: data.matter_id || '',
        contextRef: data.context_ref || data.contextRef || null,
        stateRevision: data.state_revision || data.stateRevision || null,
        alreadyPromoted: data.already_promoted === true
      };
    }

    if (status !== 'dismissed' && status !== 'rejected') {
      throw new Error('The server did not confirm that this suggestion was dismissed.');
    }
    return {
      promotionStatus: status
    };
  }

  var api = {
    getArtifactId: getArtifactId,
    mergeArtifacts: mergeArtifacts,
    getSaveToDocumentsAction: getSaveToDocumentsAction,
    getPersistenceView: getPersistenceView,
    getPromotionRequest: getPromotionRequest,
    normalizePromotionResponse: normalizePromotionResponse,
    getContextPromotionId: getContextPromotionId,
    getContextPromotionView: getContextPromotionView,
    getApproveContextPromotionAction: getApproveContextPromotionAction,
    getDismissContextPromotionAction: getDismissContextPromotionAction,
    getContextActionRequest: getContextActionRequest,
    normalizeContextPromotionResponse: normalizeContextPromotionResponse
  };

  global.Lex = global.Lex || {};
  global.Lex.Chat = global.Lex.Chat || {};
  global.Lex.Chat.ArtifactPromotion = api;
  global.Lex.Chat.ContextPromotion = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
