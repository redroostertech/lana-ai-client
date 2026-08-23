/**
 * Authenticated collaboration and signature workflow client for File Editor.
 *
 * The service deliberately owns no local fallback state. Every method delegates
 * to the authenticated Lana API client and validates the facade response before
 * returning a normalized shape to the page controller.
 */
(function (global) {
  'use strict';

  var DEFAULT_BASE_PATH = '/api/v1/file-editor';
  var COLLABORATOR_PERMISSIONS = ['read', 'write'];
  var SIGNER_STATUSES = ['viewed', 'signed', 'declined'];
  var SIGNATURE_METHODS = ['typed', 'drawn', 'uploaded', 'acknowledgement'];

  function requiredIdentifier(value, label) {
    var id = String(value === undefined || value === null ? '' : value).trim();
    if (!id) throw new TypeError((label || 'Identifier') + ' is required.');
    if (id.length > 512) throw new TypeError((label || 'Identifier') + ' is too long.');
    return id;
  }

  function optionalString(value, label, maxLength) {
    if (value === undefined || value === null) return undefined;
    var text = String(value).trim();
    if (text.length > maxLength) throw new TypeError(label + ' is too long.');
    return text;
  }

  function requiredString(value, label, maxLength) {
    var text = optionalString(value, label, maxLength);
    if (!text) throw new TypeError(label + ' is required.');
    return text;
  }

  function requiredVerbatimString(value, label, maxLength) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(label + ' is required.');
    if (value.length > maxLength) throw new TypeError(label + ' is too long.');
    return value;
  }

  function emailAddress(value) {
    var email = requiredString(value, 'Signer email', 320);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new TypeError('Signer email is invalid.');
    }
    return email;
  }

  function responseData(response) {
    return response && response.data !== undefined && response.data !== null
      ? response.data
      : response;
  }

  function responseObject(response, label) {
    var value = responseData(response);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error((label || 'API') + ' returned an invalid response.');
    }
    return value;
  }

  function responseList(response, keys, label) {
    var value = responseData(response);
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (var i = 0; i < keys.length; i += 1) {
        if (Array.isArray(value[keys[i]])) return value[keys[i]];
      }
    }
    throw new Error((label || 'API') + ' returned an invalid list response.');
  }

  function normalizedPermissions(value) {
    var permissions = Array.isArray(value) ? value : (value ? [value] : []);
    var seen = {};
    return permissions.map(function (permission) {
      var normalized = String(permission || '').trim().toLowerCase();
      if (normalized === 'view') return 'read';
      if (normalized === 'edit') return 'write';
      return normalized;
    }).filter(function (permission) {
      if (!permission || COLLABORATOR_PERMISSIONS.indexOf(permission) === -1 || seen[permission]) return false;
      seen[permission] = true;
      return true;
    });
  }

  function collaboratorInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Collaborator input is required.');
    }
    var targetType = String(input.target_type || input.targetType || 'user').trim().toLowerCase();
    if (['user', 'workspace'].indexOf(targetType) === -1) {
      throw new TypeError('Share target type is invalid.');
    }
    var targetId = requiredIdentifier(
      targetType === 'workspace'
        ? (input.workspace_id || input.workspaceId || input.shared_with_id || input.sharedWithId)
        : (input.user_id || input.userId || input.shared_with_id || input.sharedWithId),
      targetType === 'workspace' ? 'Workspace id' : 'Collaborator user id'
    );
    var requestedPermissions = input.permissions || input.permission;
    var requestedList = Array.isArray(requestedPermissions)
      ? requestedPermissions
      : (requestedPermissions ? [requestedPermissions] : []);
    var invalidPermission = requestedList.some(function (permission) {
      return COLLABORATOR_PERMISSIONS.indexOf(String(permission || '').trim().toLowerCase()) === -1;
    });
    if (invalidPermission) throw new TypeError('Collaborator permission is invalid.');
    var permissions = normalizedPermissions(requestedPermissions);
    if (!permissions.length) permissions = ['read'];
    var payload = { permissions: permissions };
    if (targetType === 'workspace') {
      payload.target_type = 'workspace';
      payload.workspace_id = targetId;
    } else payload.user_id = targetId;
    return payload;
  }

  function normalizeCollaborator(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Collaborator API returned an invalid collaborator.');
    }
    var user = row.user && typeof row.user === 'object' ? row.user : {};
    var id = requiredIdentifier(
      row.id || row.collaborator_id || row.share_id || row.permission_id,
      'Collaborator id'
    );
    var targetType = String(row.target_type || row.shared_with_type || (row.workspace_id ? 'workspace' : 'user')).toLowerCase();
    if (['user', 'workspace'].indexOf(targetType) === -1) targetType = 'user';
    var targetId = requiredIdentifier(
      targetType === 'workspace'
        ? (row.workspace_id || row.target_id || row.shared_with_id)
        : (row.user_id || row.target_id || row.shared_with_id || user.id),
      targetType === 'workspace' ? 'Workspace id' : 'Collaborator user id'
    );
    var firstName = row.first_name || user.first_name || '';
    var lastName = row.last_name || user.last_name || '';
    var name = row.display_name || row.full_name || row.name || user.display_name || user.full_name ||
      [firstName, lastName].join(' ').trim() || row.email || user.email || 'Collaborator';
    var permissions = normalizedPermissions(row.permissions || row.permission);
    var declaredPermission = normalizedPermissions(row.permission)[0];
    var effectivePermission = declaredPermission ||
      (permissions.indexOf('write') !== -1 ? 'write' : (permissions[0] || ''));
    return {
      id: id,
      target_type: targetType,
      target_id: targetId,
      user_id: targetType === 'user' ? targetId : '',
      workspace_id: targetType === 'workspace' ? targetId : '',
      name: String(name),
      email: targetType === 'user' ? String(row.email || user.email || '') : '',
      permissions: permissions,
      permission: effectivePermission,
      shared_at: row.shared_at || row.granted_at || row.created_at || null,
      shared_by: row.shared_by || row.granted_by || row.created_by || null,
      status: row.status ? String(row.status) : null
    };
  }

  function signerInput(input, index) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Signer ' + (index + 1) + ' is invalid.');
    }
    var order = input.signing_order !== undefined ? input.signing_order : input.order;
    if (order !== undefined && (!Number.isInteger(Number(order)) || Number(order) < 1)) {
      throw new TypeError('Signer signing order must be a positive integer.');
    }
    var signer = {
      name: requiredString(input.name, 'Signer name', 255),
      email: emailAddress(input.email)
    };
    var role = optionalString(input.role, 'Signer role', 255);
    if (role) signer.role = role;
    if (order !== undefined) signer.order = Number(order);
    if (input.metadata !== undefined) {
      if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
        throw new TypeError('Signer metadata is invalid.');
      }
      signer.metadata = input.metadata;
    }
    return signer;
  }

  function signaturePacketInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Signature packet input is required.');
    }
    if (!Array.isArray(input.signers) || !input.signers.length) {
      throw new TypeError('At least one signer is required.');
    }
    var payload = {
      signers: input.signers.map(signerInput)
    };
    var title = optionalString(input.subject || input.title, 'Signature packet subject', 1000);
    var message = optionalString(input.message || input.notes, 'Signature packet message', 10000);
    if (title) payload.subject = title;
    if (message) payload.message = message;
    if (input.expires_at !== undefined && input.expires_at !== null && input.expires_at !== '') {
      var expiresAt = new Date(input.expires_at);
      if (!Number.isFinite(expiresAt.getTime())) throw new TypeError('Signature packet expiration is invalid.');
      payload.expires_at = expiresAt.toISOString();
    }
    if (input.metadata !== undefined) {
      if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
        throw new TypeError('Signature packet metadata is invalid.');
      }
      payload.metadata = input.metadata;
    }
    if (input.send !== undefined) {
      if (typeof input.send !== 'boolean') throw new TypeError('Signature packet send flag is invalid.');
      payload.send = input.send;
    }
    return payload;
  }

  function normalizeSigner(row, index) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Signature packet API returned an invalid signer.');
    }
    var id = requiredIdentifier(row.id || row.signer_id, 'Signer id');
    var order = row.signing_order !== undefined ? row.signing_order : row.order;
    return {
      id: id,
      name: requiredString(row.name, 'Signer name', 255),
      email: emailAddress(row.email),
      role: String(row.role || ''),
      signing_order: Number.isFinite(Number(order)) ? Number(order) : index + 1,
      status: String(row.status || 'pending'),
      delivery_status: String(row.delivery_status || 'not_requested'),
      sent_at: row.sent_at || row.invited_at || null,
      delivered_at: row.delivered_at || null,
      viewed_at: row.viewed_at || null,
      signed_at: row.signed_at || null,
      declined_at: row.declined_at || null,
      updated_at: row.updated_at || null
    };
  }

  function packetObject(response) {
    var value = responseObject(response, 'Signature packet API');
    return value.signature_packet || value.packet || value;
  }

  function normalizePacket(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Signature packet API returned an invalid packet.');
    }
    var signers = row.signers === undefined || row.signers === null ? [] : row.signers;
    if (!Array.isArray(signers)) throw new Error('Signature packet API returned invalid signers.');
    var consentDisclosure = row.signature_consent_disclosure !== undefined
      ? row.signature_consent_disclosure
      : row.signatureConsentDisclosure;
    return {
      id: requiredIdentifier(row.id || row.packet_id, 'Signature packet id'),
      document_id: row.document_id ? String(row.document_id) : '',
      title: String(row.title || row.subject || ''),
      message: String(row.message || row.notes || ''),
      status: String(row.status || 'draft'),
      signers: signers.map(normalizeSigner),
      created_by: row.created_by || row.requested_by || null,
      created_at: row.created_at || row.requested_at || null,
      updated_at: row.updated_at || null,
      sent_at: row.sent_at || null,
      completed_at: row.completed_at || null,
      cancelled_at: row.cancelled_at || null,
      expires_at: row.expires_at || null,
      signature_consent_disclosure: typeof consentDisclosure === 'string' ? consentDisclosure : null
    };
  }

  function statusInput(status, input) {
    var value = requiredString(status, 'Signer status', 50).toLowerCase();
    if (SIGNER_STATUSES.indexOf(value) === -1) {
      throw new TypeError('Signer status is invalid.');
    }
    var payload = { status: value };
    if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
      throw new TypeError('Signer status input is invalid.');
    }
    var details = input || {};
    if (value === 'signed') {
      if (details.consent !== true) throw new TypeError('Signer consent is required to sign.');
      payload.consent = true;
      payload.signature_text = requiredString(details.signature_text || details.signatureText, 'Signature text', 1000);
      payload.consent_disclosure = requiredVerbatimString(
        details.consent_disclosure !== undefined ? details.consent_disclosure : details.consentDisclosure,
        'Consent disclosure',
        5000
      );
      if (details.signature_method !== undefined || details.signatureMethod !== undefined) {
        var signatureMethod = requiredString(
          details.signature_method || details.signatureMethod,
          'Signature method',
          50
        ).toLowerCase();
        if (SIGNATURE_METHODS.indexOf(signatureMethod) === -1) {
          throw new TypeError('Signature method is invalid.');
        }
        payload.signature_method = signatureMethod;
      }
    }
    if (value === 'declined') {
      var declineReason = optionalString(
        details.decline_reason !== undefined ? details.decline_reason : details.declineReason,
        'Decline reason',
        2000
      );
      if (declineReason) payload.decline_reason = declineReason;
    }
    return payload;
  }

  function cancelInput(input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Cancel input is invalid.');
    var payload = {};
    var reason = optionalString(input.reason, 'Reason', 2000);
    if (reason) payload.reason = reason;
    return payload;
  }

  function resendInput(input) {
    if (input === undefined || input === null) return {};
    if (typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Resend input is invalid.');
    var payload = {};
    var signerId = input.signer_id !== undefined ? input.signer_id : input.signerId;
    if (signerId !== undefined && signerId !== null && signerId !== '') {
      payload.signer_id = requiredIdentifier(signerId, 'Signer id');
    }
    return payload;
  }

  function basePath(value) {
    var path = String(value || DEFAULT_BASE_PATH).trim();
    if (!path || path.charAt(0) !== '/') throw new TypeError('File Editor API base path must begin with /.');
    return path.replace(/\/+$/, '');
  }

  function create(options) {
    var settings = options || {};
    var rootPath = basePath(settings.basePath);

    function client() {
      var value = settings.api || global.api;
      if (!value || typeof value.get !== 'function' || typeof value.post !== 'function' ||
          typeof value.patch !== 'function' || typeof value.delete !== 'function') {
        throw new Error('Authenticated Lana API client is unavailable.');
      }
      return value;
    }

    function documentPath(documentId, suffix) {
      return rootPath + '/documents/' + encodeURIComponent(requiredIdentifier(documentId, 'Document id')) + (suffix || '');
    }

    function packetPath(documentId, packetId, suffix) {
      return documentPath(
        documentId,
        '/signature-packets/' + encodeURIComponent(requiredIdentifier(packetId, 'Signature packet id')) + (suffix || '')
      );
    }

    return {
      paths: {
        collaborators: function (documentId) { return documentPath(documentId, '/collaborators'); },
        collaborator: function (documentId, collaboratorId) {
          return documentPath(documentId, '/collaborators/' + encodeURIComponent(requiredIdentifier(collaboratorId, 'Collaborator id')));
        },
        signaturePackets: function (documentId) { return documentPath(documentId, '/signature-packets'); },
        signaturePacket: function (documentId, packetId) { return packetPath(documentId, packetId); },
        cancelSignaturePacket: function (documentId, packetId) { return packetPath(documentId, packetId, '/cancel'); },
        resendSignaturePacket: function (documentId, packetId) { return packetPath(documentId, packetId, '/resend'); },
        signerStatus: function (documentId, packetId, signerId) {
          return packetPath(documentId, packetId, '/signers/' + encodeURIComponent(requiredIdentifier(signerId, 'Signer id')) + '/status');
        }
      },

      listCollaborators: async function (documentId) {
        var rows = responseList(await client().get(documentPath(documentId, '/collaborators')), ['collaborators'], 'Collaborator API');
        return { collaborators: rows.map(normalizeCollaborator), total: rows.length };
      },

      addCollaborator: async function (documentId, input) {
        var response = await client().post(documentPath(documentId, '/collaborators'), collaboratorInput(input));
        var value = responseObject(response, 'Collaborator API');
        return normalizeCollaborator(value.collaborator || value.share || value);
      },

      removeCollaborator: async function (documentId, collaboratorId) {
        var id = requiredIdentifier(collaboratorId, 'Collaborator id');
        var response = await client().delete(documentPath(documentId, '/collaborators/' + encodeURIComponent(id)));
        var value = responseObject(response, 'Collaborator API');
        if (value.success === false) throw new Error(value.message || 'Collaborator could not be removed.');
        return { success: true, collaborator_id: String(value.collaborator_id || value.id || id) };
      },

      listSignaturePackets: async function (documentId) {
        var rows = responseList(await client().get(documentPath(documentId, '/signature-packets')), ['signature_packets', 'packets'], 'Signature packet API');
        return { signature_packets: rows.map(normalizePacket), total: rows.length };
      },

      createSignaturePacket: async function (documentId, input) {
        var response = await client().post(documentPath(documentId, '/signature-packets'), signaturePacketInput(input));
        return normalizePacket(packetObject(response));
      },

      getSignaturePacket: async function (documentId, packetId) {
        return normalizePacket(packetObject(await client().get(packetPath(documentId, packetId))));
      },

      cancelSignaturePacket: async function (documentId, packetId, input) {
        var response = await client().post(packetPath(documentId, packetId, '/cancel'), cancelInput(input));
        return normalizePacket(packetObject(response));
      },

      resendSignaturePacket: async function (documentId, packetId, input) {
        var response = await client().post(packetPath(documentId, packetId, '/resend'), resendInput(input));
        return normalizePacket(packetObject(response));
      },

      updateSignerStatus: async function (documentId, packetId, signerId, status, input) {
        var path = packetPath(documentId, packetId, '/signers/' + encodeURIComponent(requiredIdentifier(signerId, 'Signer id')) + '/status');
        var response = await client().patch(path, statusInput(status, input));
        var value = responseObject(response, 'Signature packet API');
        var signer = value.signer || value;
        return normalizeSigner(signer, 0);
      }
    };
  }

  var service = create();
  service.create = create;
  service.DEFAULT_BASE_PATH = DEFAULT_BASE_PATH;

  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  global.LanaFileEditorCollaborationApi = service;
})(typeof window !== 'undefined' ? window : globalThis);
