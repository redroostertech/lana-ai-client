'use strict';

const artifactsView = require('../../src/js/components/workspace-artifacts-view');

describe('WorkspaceArtifactsView helpers', () => {
  test('extracts artifact lists from supported API envelopes', () => {
    const artifact = { artifact_id: 'a-1' };

    expect(artifactsView.extractArtifactList({ data: { artifacts: [artifact], pagination: { total: 1 } } }))
      .toEqual({ artifacts: [artifact], pagination: { total: 1 } });
    expect(artifactsView.extractArtifactList({ artifacts: [artifact] }))
      .toEqual({ artifacts: [artifact], pagination: null });
    expect(artifactsView.extractArtifactList({ items: [artifact] }))
      .toEqual({ artifacts: [artifact], pagination: null });
    expect(artifactsView.extractArtifactList(null))
      .toEqual({ artifacts: [], pagination: null });
  });

  test('unwraps artifact detail responses without losing nested artifact payloads', () => {
    const artifact = { artifact_id: 'a-1', content: 'Draft' };

    expect(artifactsView.unwrapMatterArtifactResponse({ data: { artifact } })).toBe(artifact);
    expect(artifactsView.unwrapMatterArtifactResponse({ artifact })).toBe(artifact);
    expect(artifactsView.unwrapMatterArtifactResponse(artifact)).toBe(artifact);
  });

  test('builds query strings without empty values', () => {
    expect(artifactsView.buildQuery({
      limit: 25,
      offset: 0,
      search: '',
      sort_by: 'updated_at',
      sort_dir: 'desc'
    })).toBe('limit=25&offset=0&sort_by=updated_at&sort_dir=desc');
  });
});

describe('WorkspaceArtifactsView promotion gate', () => {
  afterEach(() => {
    delete global.Lex;
  });

  test('fails closed when approval confirmation is unavailable', () => {
    const toast = { error: jest.fn() };
    const view = new artifactsView.WorkspaceArtifactsView({
      api: { post: jest.fn() },
      toast
    });
    view.artifacts = [{
      artifact_id: 'a-1',
      actions: [{ id: 'save_to_documents', method: 'POST', endpoint: '/promote', body: { approved: true } }]
    }];

    view.promote('MATT-1', 'a-1');

    expect(toast.error).toHaveBeenCalledWith('Artifact approval support is unavailable.');
  });

  test('handles artifact actions rendered inside the drawer', () => {
    const openDocument = jest.fn();
    const button = {
      getAttribute: jest.fn((name) => {
        if (name === 'data-artifact-action') return 'open-document';
        if (name === 'data-document-id') return 'doc-1';
        return '';
      })
    };
    const view = new artifactsView.WorkspaceArtifactsView({
      container: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        contains: jest.fn(() => false)
      },
      onOpenDocument: openDocument
    });
    view._drawerEl = {
      contains: jest.fn((node) => node === button)
    };

    view._handleClick({
      target: {
        closest: jest.fn(() => button)
      }
    });

    expect(openDocument).toHaveBeenCalledWith('doc-1');
  });

  test('opens a specific artifact using the current matter context', async () => {
    const drawerBody = { innerHTML: '' };
    const drawerEl = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      remove: jest.fn(),
      querySelector: jest.fn(() => drawerBody)
    };
    const api = {
      get: jest.fn().mockResolvedValue({
        data: {
          artifact: {
            artifact_id: 'a-1',
            artifact_name: 'Draft Memo',
            artifact_type: 'memo',
            content: 'Body',
            approvals: {},
            inclusions: []
          }
        }
      })
    };
    const view = new artifactsView.WorkspaceArtifactsView({
      api,
      drawer: { open: jest.fn(() => drawerEl) },
      matter: { matter_id: 'MATT-1' }
    });

    await view.openArtifact('a-1');

    expect(api.get).toHaveBeenCalledWith('/api/v1/matters/MATT-1/artifacts/a-1');
    expect(drawerBody.innerHTML).toContain('Draft Memo');
  });

  test('renders search-aware empty state', () => {
    const list = { innerHTML: '' };
    const view = new artifactsView.WorkspaceArtifactsView({
      container: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        querySelector: jest.fn(() => list)
      }
    });
    view.search = 'demand';
    view.artifacts = [];

    view._renderList();

    expect(list.innerHTML).toContain('No matching artifacts');
  });

  test('renders list load failures in the artifacts surface', async () => {
    const list = { innerHTML: '' };
    const view = new artifactsView.WorkspaceArtifactsView({
      api: { get: jest.fn().mockRejectedValue(new Error('network down')) },
      matter: { matter_id: 'MATT-1' },
      container: {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        querySelector: jest.fn(() => list)
      }
    });

    await expect(view.refresh()).rejects.toThrow('network down');

    expect(list.innerHTML).toContain('Failed to load artifacts');
    expect(list.innerHTML).toContain('network down');
  });

  test('renders failed promotion and promoted document states', () => {
    const view = new artifactsView.WorkspaceArtifactsView();

    const failedRow = view._renderRow({
      artifact_id: 'a-1',
      artifact_name: 'Draft Memo',
      artifact_type: 'memo',
      version: 1,
      promotion_error: 'Queue unavailable',
      persistence: { status: 'failed', tone: 'error', message: 'Save failed' }
    });
    const promotedDrawer = view._renderDrawerContent({
      artifact_id: 'a-2',
      artifact_name: 'Approved Memo',
      artifact_type: 'memo',
      content: 'Body',
      approvals: {},
      inclusions: [],
      document: { id: 'doc-1', filename: 'Approved Memo.md' },
      persistence: { status: 'promoted', tone: 'success', message: 'Saved to Documents' }
    });

    expect(failedRow).toContain('Queue unavailable');
    expect(promotedDrawer).toContain('Saved to Documents as Approved Memo.md');
  });
});
