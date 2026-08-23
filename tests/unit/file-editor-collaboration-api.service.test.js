'use strict';

const path = require('path');

const collaborationApi = require(path.join(
  __dirname,
  '../../src/js/services/file-editor-collaboration-api.service.js'
));

const SERVER_SIGNATURE_DISCLOSURE = '  I consent to sign electronically.\nThis exact disclosure came from the server.  ';

function makeApi(routes) {
  const calls = [];
  const api = {};
  ['get', 'post', 'patch', 'delete'].forEach((method) => {
    api[method] = jest.fn(async (endpoint, payload) => {
      calls.push({ method: method.toUpperCase(), endpoint, payload });
      const key = method.toUpperCase() + ' ' + endpoint;
      const route = routes.find((candidate) => (
        typeof candidate.match === 'string'
          ? candidate.match === key
          : candidate.match.test(key)
      ));
      if (!route) throw new Error('Unrouted call: ' + key);
      return typeof route.reply === 'function'
        ? route.reply({ endpoint, payload })
        : route.reply;
    });
  });
  api.calls = calls;
  return api;
}

function collaborator(overrides = {}) {
  return {
    id: 'share-1',
    user_id: 'user-1',
    display_name: 'Avery Stone',
    email: 'avery@example.com',
    permissions: ['read', 'write'],
    shared_at: '2026-08-21T12:00:00Z',
    ...overrides
  };
}

function packet(overrides = {}) {
  return {
    id: 'packet-1',
    document_id: 'doc-1',
    title: 'NDA signatures',
    status: 'sent',
    signers: [{
      id: 'signer-1',
      name: 'Morgan Lee',
      email: 'morgan@example.com',
      role: 'Client',
      signing_order: 1,
      status: 'sent'
    }],
    created_at: '2026-08-21T12:00:00Z',
    ...overrides
  };
}

describe('LanaFileEditorCollaborationApi endpoint construction', () => {
  test('builds encoded paths from ids and supports a configured base path', () => {
    const service = collaborationApi.create({
      api: makeApi([]),
      basePath: '/custom/file-editor/'
    });

    expect(service.paths.collaborators('doc/1')).toBe('/custom/file-editor/documents/doc%2F1/collaborators');
    expect(service.paths.collaborator('doc/1', 'share/1')).toBe('/custom/file-editor/documents/doc%2F1/collaborators/share%2F1');
    expect(service.paths.signaturePackets('doc/1')).toBe('/custom/file-editor/documents/doc%2F1/signature-packets');
    expect(service.paths.signaturePacket('doc/1', 'packet/1')).toBe('/custom/file-editor/documents/doc%2F1/signature-packets/packet%2F1');
    expect(service.paths.signerStatus('doc/1', 'packet/1', 'signer/1')).toBe('/custom/file-editor/documents/doc%2F1/signature-packets/packet%2F1/signers/signer%2F1/status');
  });

  test('rejects missing identifiers before making a request', async () => {
    const api = makeApi([]);
    const service = collaborationApi.create({ api });

    await expect(service.listCollaborators('')).rejects.toThrow('Document id is required');
    await expect(service.getSignaturePacket('', 'packet-1')).rejects.toThrow('Document id is required');
    await expect(service.getSignaturePacket('doc-1', null)).rejects.toThrow('Signature packet id is required');
    expect(api.calls).toHaveLength(0);
  });
});

describe('LanaFileEditorCollaborationApi collaborators', () => {
  test('lists and normalizes facade collaborators', async () => {
    const api = makeApi([{
      match: 'GET /api/v1/file-editor/documents/doc-1/collaborators',
      reply: { data: { collaborators: [collaborator()] } }
    }]);
    const service = collaborationApi.create({ api });

    await expect(service.listCollaborators('doc-1')).resolves.toEqual({
      collaborators: [{
        id: 'share-1',
        target_type: 'user',
        target_id: 'user-1',
        user_id: 'user-1',
        workspace_id: '',
        name: 'Avery Stone',
        email: 'avery@example.com',
        permissions: ['read', 'write'],
        permission: 'read',
        shared_at: '2026-08-21T12:00:00Z',
        shared_by: null,
        status: null
      }],
      total: 1
    });
  });

  test('adds a collaborator through the authenticated API client', async () => {
    const api = makeApi([{
      match: 'POST /api/v1/file-editor/documents/doc-1/collaborators',
      reply: { collaborator: collaborator({ permissions: ['write'] }) }
    }]);
    const service = collaborationApi.create({ api });

    const result = await service.addCollaborator('doc-1', {
      userId: 'user-1',
      permission: 'write'
    });

    expect(result.id).toBe('share-1');
    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/collaborators',
      { user_id: 'user-1', permissions: ['write'] }
    );
  });

  test('adds and normalizes a first-class workspace share target', async () => {
    const workspace = {
      id: 'share-workspace-1',
      target_type: 'workspace',
      target_id: 'workspace-1',
      workspace_id: 'workspace-1',
      name: 'Phase 5 Review Workspace',
      permissions: ['read', 'write']
    };
    const api = makeApi([{
      match: 'POST /api/v1/file-editor/documents/doc-1/collaborators',
      reply: { data: workspace }
    }]);
    const service = collaborationApi.create({ api });

    const result = await service.addCollaborator('doc-1', {
      target_type: 'workspace',
      workspace_id: 'workspace-1',
      permission: 'write'
    });

    expect(result).toEqual(expect.objectContaining({
      id: 'share-workspace-1',
      target_type: 'workspace',
      target_id: 'workspace-1',
      workspace_id: 'workspace-1',
      user_id: '',
      name: 'Phase 5 Review Workspace',
      permissions: ['read', 'write']
    }));
    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/collaborators',
      { target_type: 'workspace', workspace_id: 'workspace-1', permissions: ['write'] }
    );
  });

  test('removes a collaborator by server id', async () => {
    const api = makeApi([{
      match: 'DELETE /api/v1/file-editor/documents/doc-1/collaborators/share-1',
      reply: { success: true, collaborator_id: 'share-1' }
    }]);
    const service = collaborationApi.create({ api });

    await expect(service.removeCollaborator('doc-1', 'share-1')).resolves.toEqual({
      success: true,
      collaborator_id: 'share-1'
    });
    expect(api.delete).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/collaborators/share-1'
    );
  });

  test('rejects invalid collaborator payloads and malformed lists', async () => {
    const api = makeApi([{
      match: 'GET /api/v1/file-editor/documents/doc-1/collaborators',
      reply: { collaborators: 'not-an-array' }
    }]);
    const service = collaborationApi.create({ api });

    await expect(service.addCollaborator('doc-1', {})).rejects.toThrow('Collaborator user id is required');
    await expect(service.addCollaborator('doc-1', {
      target_type: 'workspace'
    })).rejects.toThrow('Workspace id is required');
    await expect(service.addCollaborator('doc-1', {
      user_id: 'user-1',
      permission: 'share'
    })).rejects.toThrow('Collaborator permission is invalid');
    await expect(service.listCollaborators('doc-1')).rejects.toThrow('invalid list response');
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('LanaFileEditorCollaborationApi signature packets', () => {
  test('lists and retrieves packet state without inventing local rows', async () => {
    const api = makeApi([
      {
        match: 'GET /api/v1/file-editor/documents/doc-1/signature-packets',
        reply: { signature_packets: [packet({ signature_consent_disclosure: SERVER_SIGNATURE_DISCLOSURE })] }
      },
      {
        match: 'GET /api/v1/file-editor/documents/doc-1/signature-packets/packet-1',
        reply: { data: { packet: packet({ signature_consent_disclosure: SERVER_SIGNATURE_DISCLOSURE }) } }
      }
    ]);
    const service = collaborationApi.create({ api });

    const list = await service.listSignaturePackets('doc-1');
    expect(list.total).toBe(1);
    expect(list.signature_packets[0].signers[0]).toMatchObject({
      id: 'signer-1',
      name: 'Morgan Lee',
      status: 'sent'
    });
    expect(list.signature_packets[0].signature_consent_disclosure).toBe(SERVER_SIGNATURE_DISCLOSURE);
    await expect(service.getSignaturePacket('doc-1', 'packet-1')).resolves.toMatchObject({
      id: 'packet-1',
      document_id: 'doc-1',
      status: 'sent',
      signature_consent_disclosure: SERVER_SIGNATURE_DISCLOSURE
    });
  });

  test('creates a packet with validated signers and optional metadata', async () => {
    const api = makeApi([{
      match: 'POST /api/v1/file-editor/documents/doc-1/signature-packets',
      reply: { signature_packet: packet() }
    }]);
    const service = collaborationApi.create({ api });

    await service.createSignaturePacket('doc-1', {
      subject: 'NDA signatures',
      notes: 'Please sign in order.',
      expires_at: '2026-09-01T12:00:00Z',
      metadata: { source: 'file-editor' },
      send: true,
      signers: [{
        name: 'Morgan Lee',
        email: 'morgan@example.com',
        role: 'Client',
        signing_order: 1,
        metadata: { required: true }
      }]
    });

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/signature-packets',
      {
        subject: 'NDA signatures',
        message: 'Please sign in order.',
        expires_at: '2026-09-01T12:00:00.000Z',
        metadata: { source: 'file-editor' },
        send: true,
        signers: [{
          name: 'Morgan Lee',
          email: 'morgan@example.com',
          role: 'Client',
          order: 1,
          metadata: { required: true }
        }]
      }
    );
  });

  test('cancels and resends packet workflows', async () => {
    const api = makeApi([
      {
        match: 'POST /api/v1/file-editor/documents/doc-1/signature-packets/packet-1/cancel',
        reply: { packet: packet({ status: 'cancelled', cancelled_at: '2026-08-21T13:00:00Z' }) }
      },
      {
        match: 'POST /api/v1/file-editor/documents/doc-1/signature-packets/packet-1/resend',
        reply: { packet: packet({ status: 'sent', sent_at: '2026-08-21T14:00:00Z' }) }
      }
    ]);
    const service = collaborationApi.create({ api });

    const cancelled = await service.cancelSignaturePacket('doc-1', 'packet-1', { reason: 'Wrong recipient' });
    expect(cancelled.status).toBe('cancelled');
    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/api/v1/file-editor/documents/doc-1/signature-packets/packet-1/cancel',
      { reason: 'Wrong recipient' }
    );

    const resent = await service.resendSignaturePacket('doc-1', 'packet-1', { signerId: 'signer-1' });
    expect(resent.status).toBe('sent');
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/api/v1/file-editor/documents/doc-1/signature-packets/packet-1/resend',
      { signer_id: 'signer-1' }
    );
  });

  test('updates a signed status with explicit consent and signature proof', async () => {
    const api = makeApi([{
      match: 'PATCH /api/v1/file-editor/documents/doc-1/signature-packets/packet-1/signers/signer-1/status',
      reply: {
        signer: {
          id: 'signer-1',
          name: 'Morgan Lee',
          email: 'morgan@example.com',
          status: 'signed',
          signed_at: '2026-08-21T15:00:00Z'
        }
      }
    }]);
    const service = collaborationApi.create({ api });

    const signer = await service.updateSignerStatus(
      'doc-1',
      'packet-1',
      'signer-1',
      'signed',
      { consent: true, consent_disclosure: SERVER_SIGNATURE_DISCLOSURE, signature_text: 'Morgan Lee', signature_method: 'typed' }
    );

    expect(signer.status).toBe('signed');
    expect(api.patch).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/signature-packets/packet-1/signers/signer-1/status',
      { status: 'signed', consent: true, consent_disclosure: SERVER_SIGNATURE_DISCLOSURE, signature_text: 'Morgan Lee', signature_method: 'typed' }
    );
  });

  test('maps an optional decline reason onto the strict signer status payload', async () => {
    const api = makeApi([{
      match: 'PATCH /api/v1/file-editor/documents/doc-1/signature-packets/packet-1/signers/signer-1/status',
      reply: {
        signer: {
          id: 'signer-1',
          name: 'Morgan Lee',
          email: 'morgan@example.com',
          status: 'declined'
        }
      }
    }]);
    const service = collaborationApi.create({ api });

    await service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'declined', {
      declineReason: 'Terms changed'
    });

    expect(api.patch).toHaveBeenCalledWith(
      '/api/v1/file-editor/documents/doc-1/signature-packets/packet-1/signers/signer-1/status',
      { status: 'declined', decline_reason: 'Terms changed' }
    );
  });

  test('rejects invalid packet and signer state before any network call', async () => {
    const api = makeApi([]);
    const service = collaborationApi.create({ api });

    await expect(service.createSignaturePacket('doc-1', { signers: [] })).rejects.toThrow('At least one signer');
    await expect(service.createSignaturePacket('doc-1', {
      signers: [{ name: 'Morgan', email: 'invalid' }]
    })).rejects.toThrow('Signer email is invalid');
    await expect(service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'unknown')).rejects.toThrow('Signer status is invalid');
    await expect(service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'signed', {
      consent: false,
      signature_text: 'Morgan Lee'
    })).rejects.toThrow('Signer consent is required');
    await expect(service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'signed', {
      consent: true
    })).rejects.toThrow('Signature text is required');
    await expect(service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'signed', {
      consent: true,
      signature_text: 'Morgan Lee'
    })).rejects.toThrow('Consent disclosure is required');
    await expect(service.updateSignerStatus('doc-1', 'packet-1', 'signer-1', 'signed', {
      consent: true,
      consent_disclosure: '   ',
      signature_text: 'Morgan Lee'
    })).rejects.toThrow('Consent disclosure is required');
    expect(api.calls).toHaveLength(0);
  });

  test('rejects malformed packet responses rather than fabricating data', async () => {
    const api = makeApi([{
      match: 'GET /api/v1/file-editor/documents/doc-1/signature-packets/packet-1',
      reply: { packet: { status: 'sent', signers: [] } }
    }]);
    const service = collaborationApi.create({ api });

    await expect(service.getSignaturePacket('doc-1', 'packet-1')).rejects.toThrow('Signature packet id is required');
  });
});

describe('LanaFileEditorCollaborationApi authentication dependency', () => {
  test('fails closed when the authenticated Lana API client is unavailable', async () => {
    const service = collaborationApi.create({ api: {} });
    await expect(service.listCollaborators('doc-1')).rejects.toThrow('Authenticated Lana API client is unavailable');
  });
});
