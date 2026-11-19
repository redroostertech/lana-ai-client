'use strict';

const path = require('path');

const service = require(path.join(__dirname, '../../src/js/services/firm-handbook-api.service.js'));

function makeClient(reply) {
  const calls = [];
  const handler = (method) => jest.fn(async (endpoint, body) => {
    calls.push(body === undefined ? { method, endpoint } : { method, endpoint, body });
    return typeof reply === 'function' ? reply(method, endpoint, body) : reply;
  });
  return { get: handler('GET'), post: handler('POST'), patch: handler('PATCH'), delete: handler('DELETE'), calls };
}

describe('LanaFirmHandbookApi member calls', () => {
  test('lists published items with limit, offset and search, skipping empty values', async () => {
    const client = makeClient({ items: [], total: 0, has_more: false });
    const api = service.create(client);
    await api.listPublished({ limit: 20, offset: 40, search: 'payment plans' });
    await api.listPublished({ limit: 20, offset: 0, search: '' });
    expect(client.calls).toEqual([
      { method: 'GET', endpoint: '/api/v1/firm-handbook/items?limit=20&offset=40&search=payment%20plans' },
      { method: 'GET', endpoint: '/api/v1/firm-handbook/items?limit=20&offset=0' }
    ]);
  });

  test('reads one item by an encoded id', async () => {
    const client = makeClient({ id: 'a/b' });
    await service.create(client).getPublished('a/b');
    expect(client.calls[0]).toEqual({ method: 'GET', endpoint: '/api/v1/firm-handbook/items/a%2Fb' });
  });

  test('refuses to build an item path without an id', () => {
    const api = service.create(makeClient({}));
    expect(() => api.getPublished('')).toThrow('A handbook item id is required.');
    expect(() => api.publish(null, 1)).toThrow('A handbook item id is required.');
  });

  test('unwraps a { data } envelope and passes a bare body through', async () => {
    const wrapped = service.create(makeClient({ success: true, data: { id: 'x' } }));
    const bare = service.create(makeClient({ id: 'y' }));
    await expect(wrapped.getPublished('x')).resolves.toEqual({ id: 'x' });
    await expect(bare.getPublished('y')).resolves.toEqual({ id: 'y' });
  });

  test('a structured item keeps its own data field (it is not an envelope)', async () => {
    const item = { id: 'wh', kind: 'work_hours', title: 'Work hours', data: { days: { monday: null } } };
    await expect(service.create(makeClient(item)).getPublished('wh')).resolves.toEqual(item);
    await expect(service.create(makeClient(item)).saveVersion('wh', item.data, false)).resolves.toEqual(item);
  });

  test('passes API errors through untouched, so callers can read status and code', async () => {
    const error = Object.assign(new Error('Not ready'), { status: 409, code: 'VERSION_NOT_READY' });
    const client = makeClient(() => { throw error; });
    await expect(service.create(client).publish('i1', 3)).rejects.toBe(error);
  });

  test('uses window.api when no client is given, and says so when there is none', () => {
    const api = service.create();
    expect(() => api.listPublished()).toThrow('The API client is unavailable.');
  });
});

describe('LanaFirmHandbookApi admin calls', () => {
  test('sends each management call to the contract path and method', async () => {
    const client = makeClient({});
    const api = service.create(client);
    const visibility = { mode: 'organization', role_ids: [], group_ids: [], user_ids: [] };
    await api.listManaged();
    await api.createItem({ title: 'Fees', summary: '', visibility, template: 'blank_docx' });
    await api.updateItem('i1', { title: 'Fees 2026' });
    await api.listVersions('i1');
    await api.publish('i1', '3');
    await api.unpublish('i1');
    await api.deleteItem('i1');
    await api.listPublications('i1');
    expect(client.calls).toEqual([
      { method: 'GET', endpoint: '/api/v1/firm-handbook/manage/items' },
      { method: 'POST', endpoint: '/api/v1/firm-handbook/items', body: { title: 'Fees', summary: '', visibility, template: 'blank_docx' } },
      { method: 'PATCH', endpoint: '/api/v1/firm-handbook/items/i1', body: { title: 'Fees 2026' } },
      { method: 'GET', endpoint: '/api/v1/firm-handbook/items/i1/versions' },
      { method: 'POST', endpoint: '/api/v1/firm-handbook/items/i1/publish', body: { version_number: 3 } },
      { method: 'POST', endpoint: '/api/v1/firm-handbook/items/i1/unpublish', body: {} },
      { method: 'DELETE', endpoint: '/api/v1/firm-handbook/items/i1' },
      { method: 'GET', endpoint: '/api/v1/firm-handbook/items/i1/publications' }
    ]);
  });

  test('loads the visibility recipients from roles, groups and the admin user picker', async () => {
    const client = makeClient({});
    const api = service.create(client);
    await api.listRoles();
    await api.listGroups();
    await api.listUsers();
    expect(client.calls.map((c) => c.endpoint)).toEqual([
      '/api/v1/rbac/roles?limit=200',
      '/api/v1/groups?limit=200',
      '/api/v1/admin/users?page=1&page_size=1000'
    ]);
  });
});

describe('LanaFirmHandbookApi uploads and restore', () => {
  test('create with a file sends multipart: file, title, summary and visibility as a JSON string', async () => {
    const client = makeClient({ id: 'i9' });
    const file = new File(['hello'], 'Fees.txt', { type: 'text/plain' });
    const visibility = { mode: 'restricted', role_ids: ['r1'], group_ids: [], user_ids: [] };
    await service.create(client).createItem({ title: 'Fees', summary: 'Short', visibility }, file);
    const call = client.calls[0];
    expect(call.method).toBe('POST');
    expect(call.endpoint).toBe('/api/v1/firm-handbook/items');
    expect(call.body).toBeInstanceOf(FormData);
    expect(call.body.get('file').name).toBe('Fees.txt');
    expect(call.body.get('title')).toBe('Fees');
    expect(call.body.get('summary')).toBe('Short');
    expect(JSON.parse(call.body.get('visibility'))).toEqual(visibility);
    expect(call.body.get('template')).toBeNull();
  });

  test('restore posts to the storage restore route with the workspace', async () => {
    const client = makeClient({ status: 'success' });
    const api = service.create(client);
    await api.restoreVersion('src 1', 2, 'ws-1');
    await api.restoreVersion('src-1', '3');
    expect(client.calls).toEqual([
      { method: 'POST', endpoint: '/api/v1/storage/files/src%201/versions/2/restore?matter_id=ws-1', body: { matter_id: 'ws-1' } },
      { method: 'POST', endpoint: '/api/v1/storage/files/src-1/versions/3/restore', body: {} }
    ]);
    expect(() => api.restoreVersion('', 2)).toThrow('A handbook document id is required.');
    expect(() => api.restoreVersion('src-1', 0)).toThrow('A version number is required.');
  });
});
