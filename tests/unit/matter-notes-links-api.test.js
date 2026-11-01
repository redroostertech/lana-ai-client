'use strict';

const MatterNotesAPIClient = require('../../src/js/api/matter-notes-api.client.js');
const MatterLinksAPIClient = require('../../src/js/api/matter-links-api.client.js');

function fakeApi(overrides = {}) {
  return {
    get: jest.fn(async () => ({ status: 'success', data: { notes: [], total: 0, hasMore: false } })),
    post: jest.fn(async () => ({ id: 'link-1' })),
    delete: jest.fn(async () => ({})),
    getMatter: jest.fn(async () => ({ matter: { contacts: [{ id: 'c1', display_name: 'Ada' }] } })),
    getMatterDocuments: jest.fn(async () => ({ documents: [{ id: 'd1', filename: 'will.pdf' }] })),
    getMatterTasks: jest.fn(async () => ({ tasks: [{ id: 't1', title: 'Call bank' }] })),
    ...overrides,
  };
}

describe('MatterNotesAPIClient list filters', () => {
  // requestWithTimeout races each request against a 30 s timer it never clears.
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

  test('listNotes sends ?label= and ?unlinked=true', async () => {
    const api = fakeApi();
    await new MatterNotesAPIClient(api).listNotes('MATT-1', { limit: 10, label: 'fact', unlinked: true });
    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/notes?limit=10&label=fact&unlinked=true');
  });

  test('listNotes without filters keeps the old query', async () => {
    const api = fakeApi();
    await new MatterNotesAPIClient(api).listNotes('MATT-1', { limit: 10, label: '', unlinked: false });
    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/notes?limit=10');
  });

  test('loadAllNotes passes the filters through', async () => {
    const api = fakeApi();
    await new MatterNotesAPIClient(api).loadAllNotes('MATT-1', { label: 'evidence' });
    expect(api.get.mock.calls[0][0]).toContain('label=evidence');
  });
});

describe('MatterLinksAPIClient', () => {
  test('createLink posts to the matter links route', async () => {
    const api = fakeApi();
    await new MatterLinksAPIClient(api, { matterId: 'MATT-1' })
      .createLink({ kind: 'matter_note', id: 'n1' }, 'contact', { id: 'c1' });
    expect(api.post).toHaveBeenCalledWith('/api/v1/matters/MATT-1/links', {
      link_type: 'about', source: { kind: 'matter_note', id: 'n1' }, target: { kind: 'contact', id: 'c1' },
    });
  });

  test('removeLink deletes by link id', async () => {
    const api = fakeApi();
    await new MatterLinksAPIClient(api, { matterId: 'MATT-1' }).removeLink('l9');
    expect(api.delete).toHaveBeenCalledWith('/api/v1/matters/MATT-1/links/l9');
  });

  const targetsPage = (kind, targets, extra = {}) => ({ status: 'success', data: { kind, targets, next_cursor: null, available: true, ...extra } });

  test('loadCandidates reads every kind from the Core link target lookup, never the assurance lookups', async () => {
    const api = fakeApi({ get: jest.fn(async (path) => {
      const kind = new URL('http://x' + path).searchParams.get('kind');
      return targetsPage(kind, [{ kind, id: kind + '-1', label: kind + ' one', target: { kind, id: kind + '-1' } }]);
    }) });
    const client = new MatterLinksAPIClient(api, { matterId: 'MATT-1' });
    for (const kind of ['matter_asset', 'contact', 'document', 'rulebook_rule']) {
      expect((await client.loadCandidates(kind)).map((c) => c.target)).toEqual([{ kind, id: kind + '-1' }]);
    }
    expect(api.get.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/matters/MATT-1/links/targets?kind=matter_asset&limit=50',
      '/api/v1/matters/MATT-1/links/targets?kind=contact&limit=50',
      '/api/v1/matters/MATT-1/links/targets?kind=document&limit=50',
      '/api/v1/matters/MATT-1/links/targets?kind=rulebook_rule&limit=50',
    ]);
    expect(api.get.mock.calls.some((c) => c[0].includes('implementation-assurance'))).toBe(false);
    expect(api.getMatter).not.toHaveBeenCalled();
    expect(api.getMatterDocuments).not.toHaveBeenCalled();
  });

  test('loadCandidates follows next_cursor, and an unavailable kind is empty with its reason', async () => {
    const pages = [
      targetsPage('contact', [{ kind: 'contact', id: 'c1', label: 'Ada', target: { kind: 'contact', id: 'c1' } }], { next_cursor: 'c1' }),
      targetsPage('contact', [{ kind: 'contact', id: 'c2', label: 'Grace', target: { kind: 'contact', id: 'c2' } }]),
    ];
    const api = fakeApi({ get: jest.fn(async () => pages.shift()) });
    const client = new MatterLinksAPIClient(api, { matterId: 'M' });
    expect((await client.loadCandidates('contact')).map((c) => c.label)).toEqual(['Ada', 'Grace']);
    expect(api.get.mock.calls[1][0]).toBe('/api/v1/matters/M/links/targets?kind=contact&limit=50&cursor=c1');

    const off = fakeApi({ get: jest.fn(async () => targetsPage('rulebook_rule', [], { available: false, reason: 'Rulebooks are not turned on for this organization.' })) });
    const offClient = new MatterLinksAPIClient(off, { matterId: 'M' });
    expect(await offClient.loadCandidates('rulebook_rule')).toEqual([]);
    expect(offClient.unavailableReason('rulebook_rule')).toBe('Rulebooks are not turned on for this organization.');
    expect(offClient.unavailableReason('contact')).toBe('');
  });

  test('createLink sends the lookup target as is (rule pin, document release)', async () => {
    const api = fakeApi();
    const client = new MatterLinksAPIClient(api, { matterId: 'MATT-1' });
    await client.createLink({ kind: 'matter_note', id: 'n1' }, 'rulebook_rule', { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 2 });
    await client.createLink({ kind: 'matter_note', id: 'n1' }, 'document', { kind: 'document', id: 'd1', release_id: 'rel-1' });
    expect(api.post.mock.calls.map((c) => c[1].target)).toEqual([
      { kind: 'rulebook_rule', id: 'mod.area.slug', record_id: 'rb-1', version: 2 },
      { kind: 'document', id: 'd1', release_id: 'rel-1' },
    ]);
  });

  test('a refusal rejects with the api error so the caller can word it', async () => {
    const refusal = Object.assign(new Error('A agent_run cannot be linked here'), { status: 422, code: 'LINK_KIND_NOT_LINKABLE' });
    const api = fakeApi({ post: jest.fn(async () => { throw refusal; }) });
    await expect(new MatterLinksAPIClient(api, { matterId: 'M' }).createLink({ kind: 'matter_note', id: 'n1' }, 'contact', { id: 'c1' }))
      .rejects.toBe(refusal);
  });

  test('a failed lookup is empty, not an error', async () => {
    const api = fakeApi({ get: jest.fn(async () => { throw Object.assign(new Error('Server error'), { status: 500 }); }) });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await new MatterLinksAPIClient(api, { matterId: 'MATT-1' }).loadCandidates('matter_asset')).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
