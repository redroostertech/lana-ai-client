'use strict';

/**
 * Firm Handbook page: wiring contract plus a boot of the real controller and
 * Lex components in JSDOM against a stubbed API, for a member and an admin.
 * Behaviour of the pure halves is covered by firm-handbook.models.test.js and
 * firm-handbook-api.service.test.js.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const page = read('firm-handbook.html');
const controller = read('js/firm-handbook.js');
const css = read('css/firm-handbook.css');

const COMPONENTS = [
  'js/time-utils.js',
  'js/lex/lex.core.js',
  'js/lex/lex.icons.js',
  'js/lex/lex.data.js',
  'js/lex/lex.forms.js',
  'js/lex/lex.utils.js',
  'js/lex/lex.auth.js',
  'js/lex/components/foundation/lex-toast.js',
  'js/lex/components/foundation/lex-btn.js',
  'js/lex/components/foundation/lex-empty.js',
  'js/lex/components/form/lex-segmented.js',
  'js/lex/components/form/lex-toggle.js',
  'js/lex/components/foundation/lex-banner.js',
  'js/lex/components/foundation/lex-badge.js',
  'js/lex/components/foundation/lex-modal.js',
  'js/lex/components/foundation/lex-drawer.js',
  'js/lex/components/foundation/lex-tabs.js',
  'js/lex/components/form/lex-input.js',
  'js/lex/components/form/lex-textarea.js',
  'js/lex/components/form/lex-select.js',
  'js/lex/components/data/lex-table.js'
];

const tick = (w, ms) => new Promise((resolve) => w.setTimeout(resolve, ms || 30));

function templateContent() {
  const start = page.indexOf('<template id="page-content">') + '<template id="page-content">'.length;
  return page.slice(start, page.indexOf('</template>'));
}

const MANAGED = {
  items: [
    {
      id: 'i1', title: 'Payment schedules', summary: 'How we bill', status: 'published', has_unpublished_changes: true,
      source_document_id: 'src-1', editor: { document_id: 'src-1', matter_id: 'hb-matter' },
      published_version: { number: 2, published_at: '2026-11-10T00:00:00Z' }, ingestion_status: 'completed',
      current_version_number: 3, created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-12T09:00:00Z',
      visibility: { mode: 'organization', role_ids: [], group_ids: [], user_ids: [] }
    },
    {
      id: 'i2', title: 'Intake rules', summary: '', status: 'draft', has_unpublished_changes: false,
      source_document_id: 'src-2', visibility: { mode: 'restricted', role_ids: ['r1'], group_ids: [], user_ids: [] }
    }
  ]
};

const windows = [];
afterEach(() => { while (windows.length) windows.pop().close(); });

function boot({ roles, routes }) {
  const dom = new JSDOM('<!doctype html><body><main id="lex-main-content"></main></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/firm-handbook.html'
  });
  const w = dom.window;
  const calls = [];
  const respond = async (method, endpoint, body) => {
    calls.push({ method, endpoint, body });
    for (const [match, reply] of routes) {
      if ((method + ' ' + endpoint).startsWith(match)) {
        if (reply instanceof Error) throw reply;
        return typeof reply === 'function' ? reply(body) : reply;
      }
    }
    throw new Error('Unrouted ' + method + ' ' + endpoint);
  };
  w.api = {
    get: (e) => respond('GET', e),
    post: (e, b) => respond('POST', e, b),
    patch: (e, b) => respond('PATCH', e, b),
    delete: (e) => respond('DELETE', e),
    user: { id: 'u1', roles }
  };
  w.localStorage.setItem('user', JSON.stringify({ id: 'u1', roles }));
  w.navigations = [];
  COMPONENTS.forEach((rel) => w.eval(read(rel)));
  w.Lex.Nav = { go: (p, o) => w.navigations.push({ path: p, options: o }), getParams: () => new w.URLSearchParams('') };
  w.document.getElementById('lex-main-content').innerHTML = templateContent();
  w.eval(read('js/services/firm-handbook-api.service.js'));
  w.eval(read('js/firm-handbook/firm-handbook.models.js'));
  w.eval(read('js/firm-handbook/firm-handbook-structured.models.js'));
  w.eval(read('js/firm-handbook/firm-handbook-structured-forms.js'));
  w.eval(read('js/firm-handbook.js'));
  windows.push(w);
  return { w, calls };
}

const memberRoutes = () => [
  ['GET /api/v1/firm-handbook/items?', { items: [{ id: 'i1', title: 'Payment schedules', summary: 'How we bill', published_version: { number: 2, published_at: '2026-11-10T00:00:00Z' } }], total: 1, has_more: false }],
  ['GET /api/v1/firm-handbook/items/i1', { id: 'i1', title: 'Payment schedules', summary: 'How we bill', version_number: 2, published_at: '2026-11-10T00:00:00Z', content: 'Pay in three parts.', document_id: 'snap-1' }]
];

describe('firm handbook page wiring', () => {
  test('the page has its own script and stylesheet, and no inline styles', () => {
    expect(page).toContain('href="css/firm-handbook.css"');
    expect(page).toContain('src="js/firm-handbook.js"');
    expect(page).not.toContain('style=');
    expect(page).not.toContain('<style');
  });

  test('models and service load after lex-page-init and before the controller; auth-guard is last', () => {
    const init = page.indexOf('js/lex/lex-page-init.js');
    const service = page.indexOf('js/services/firm-handbook-api.service.js');
    const models = page.indexOf('js/firm-handbook/firm-handbook.models.js');
    const ctrl = page.indexOf('src="js/firm-handbook.js"');
    expect(init).toBeGreaterThan(-1);
    expect(init).toBeLessThan(service);
    expect(service).toBeLessThan(ctrl);
    expect(models).toBeLessThan(ctrl);
    expect(page.slice(page.lastIndexOf('<script src='))).toContain('js/auth-guard.js');
  });

  test('every Lex component the template uses loads before lex-page-init', () => {
    const init = page.indexOf('js/lex/lex-page-init.js');
    ['lex-drawer.js', 'lex-tabs.js', 'lex-table.js', 'lex-select.js', 'lex-textarea.js', 'lex-input.js', 'lex-badge.js', 'lex-modal.js', 'lex-segmented.js']
      .forEach((file) => {
        const at = page.indexOf(file);
        expect(at).toBeGreaterThan(-1);
        expect(at).toBeLessThan(init);
      });
  });

  test('the Administration page has a role gated Firm Handbook card linking to the page', () => {
    const admin = read('admin/index.html');
    const start = admin.indexOf('title="Firm Handbook"');
    expect(start).toBeGreaterThan(-1);
    const card = admin.slice(start, admin.indexOf('</lex-action-card>', start));
    expect(card).toContain('data-href="firm-handbook.html"');
    expect(card).toContain('data-admin-roles="system_admin,org_admin,organization_admin"');
    expect(card).not.toContain('data-release');
    expect(start).toBeGreaterThan(admin.indexOf('title="Run Books"'));
  });

  test('the page is registered as a deep link with an item id', () => {
    expect(read('js/lex/lex-nav.js')).toContain("'firm-handbook.html':                     { id: 'string' }");
  });

  test('management is shown on the shared admin role helper, never decided by the page alone', () => {
    expect(controller).toContain('Lex.Auth.isAdmin()');
  });

  test('copy and styles: no em or en dashes, and colours come from tokens', () => {
    [page, controller, css].forEach((source) => {
      expect(source.includes('—')).toBe(false);
      expect(source.includes('–')).toBe(false);
      expect(source.includes(' Mac')).toBe(false);
      expect(source.includes('iPhone')).toBe(false);
    });
    expect(css.includes('#fff')).toBe(false);
    expect(css.includes('rgb(')).toBe(false);
  });
});

describe('firm handbook page for a member', () => {
  test('lists published items, hides management, and opens the reader with version and date', async () => {
    const { w, calls } = boot({ roles: ['user'], routes: memberRoutes() });
    await tick(w, 80);
    const doc = w.document;
    expect(calls.some((c) => c.endpoint === '/api/v1/firm-handbook/items?limit=20&offset=0')).toBe(true);
    expect(calls.some((c) => c.endpoint.includes('/manage/'))).toBe(false);
    expect(doc.getElementById('fhNewBtn').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('fhManagePanel').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('fhTabs').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('fhPublishedCount').textContent).toBe('1 item');
    expect(doc.getElementById('fhPublishedTable').textContent).toContain('Payment schedules');

    doc.getElementById('fhPublishedTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i1' } } }));
    await tick(w, 30);
    const drawer = doc.getElementById('fhReaderDrawer');
    expect(drawer.open).toBe(true);
    expect(drawer.heading).toBe('Payment schedules');
    expect(doc.getElementById('fhReaderMeta').textContent.startsWith('Version 2, published ')).toBe(true);
    expect(doc.getElementById('fhReaderContent').textContent).toBe('Pay in three parts.');
  });

  test('a structured item reads as the server\'s own words (one renderer), not a summary rebuilt from its data', async () => {
    const words = 'The firm\'s work hours, in the firm\'s time zone:\nMonday: 9:00 AM to 5:00 PM\nSunday: closed';
    const { w } = boot({ roles: ['user'], routes: [
      ['GET /api/v1/firm-handbook/items/wh', { id: 'wh', kind: 'work_hours', title: 'Work hours', version_number: 1, published_at: '2026-11-10T00:00:00Z',
        content: words, data: { days: { monday: { start: '09:00', end: '17:00' } } }, document_id: 'snap-wh' }],
      ...memberRoutes()
    ] });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhPublishedTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'wh' } } }));
    await tick(w, 30);
    expect(doc.getElementById('fhReaderDrawer').heading).toBe('Work hours');
    expect(doc.getElementById('fhReaderContent').textContent).toBe(words);
    expect(doc.getElementById('fhReaderContent').classList.contains('hidden')).toBe(false);
  });

  test('a failed list shows a plain error instead of breaking the page', async () => {
    const error = Object.assign(new Error('nope'), { status: 500 });
    const { w } = boot({ roles: ['user'], routes: [['GET /api/v1/firm-handbook/items?', error]] });
    await tick(w, 80);
    expect(w.document.getElementById('fhPublishedTable').textContent)
      .toContain('The handbook could not be loaded. Check your connection and try again.');
  });
});

describe('firm handbook page for an admin', () => {
  function adminRoutes(extra) {
    return (extra || []).concat(memberRoutes(), [
      ['GET /api/v1/firm-handbook/manage/items', MANAGED],
      ['GET /api/v1/rbac/roles', { roles: [{ id: 'r1', name: 'paralegal', display_name: 'Paralegal' }] }],
      ['GET /api/v1/groups', { groups: [{ id: 'g1', name: 'Intake' }] }],
      ['GET /api/v1/admin/users', { users: [{ id: 'u9', first_name: 'Ann', last_name: 'Lee', email: 'ann@firm.test' }] }]
    ]);
  }

  test('shows the manage list with status chips and the New item button', async () => {
    const { w } = boot({ roles: ['org_admin'], routes: adminRoutes() });
    await tick(w, 80);
    const doc = w.document;
    expect(doc.getElementById('fhNewBtn').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('fhManagePanel').classList.contains('hidden')).toBe(false);
    expect(doc.getElementById('fhPublishedPanel').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('fhManageCount').textContent).toBe('2 items');
    const table = doc.getElementById('fhManageTable');
    const labels = Array.from(table.querySelectorAll('lex-badge')).map((b) => b.getAttribute('label'));
    expect(labels).toEqual(expect.arrayContaining(['Published', 'Unpublished changes', 'Draft']));
  });

  test('create blocks restricted with nobody chosen, then sends the item', async () => {
    const { w, calls } = boot({
      roles: ['system_admin'],
      routes: adminRoutes([['POST /api/v1/firm-handbook/items', { id: 'i2', source_document_id: 'src-2', editor: { document_id: 'src-2', matter_id: 'hb-matter' } }]])
    });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhNewBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 30);
    expect(doc.getElementById('fhCreateDrawer').open).toBe(true);
    doc.getElementById('fhCreateTitle').value = 'Intake rules';
    doc.getElementById('fhCreateMode').setAttribute('value', 'restricted');
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 30);
    expect(doc.getElementById('fhCreateError').textContent)
      .toBe('Choose at least one role, group or person, or make it visible to everyone in the firm.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    doc.getElementById('fhCreateMode').setAttribute('value', 'organization');
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 80);
    const post = calls.find((c) => c.method === 'POST');
    expect(post.endpoint).toBe('/api/v1/firm-handbook/items');
    expect(post.body).toEqual({
      title: 'Intake rules', summary: '', template: 'blank_docx',
      visibility: { mode: 'organization', role_ids: [], group_ids: [], user_ids: [] }
    });
    // The new item opens for management.
    expect(doc.getElementById('fhManageDrawer').open).toBe(true);
  });

  test('a work hours item: the type picker shows the days grid, a bad day is refused, then kind and data are sent', async () => {
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([
        ['GET /api/v1/firm-handbook/types', { types: [
          { kind: 'text', label: 'Text', cardinality: 'many' },
          { kind: 'work_hours', label: 'Work hours', cardinality: 'one', description: 'The days and times your firm works.' },
          { kind: 'followup_rule', label: 'Follow-up rule', cardinality: 'many' }
        ] }],
        ['POST /api/v1/firm-handbook/items', { id: 'wh1', kind: 'work_hours', item: {} }]
      ])
    });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhNewBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 30);
    const kind = doc.getElementById('fhCreateKind');
    kind.value = 'work_hours';
    kind.dispatchEvent(new w.CustomEvent('lex-change', { bubbles: true, detail: { value: 'work_hours' } }));
    await tick(w, 30);
    const grid = doc.getElementById('fhCreateStructured');
    expect(grid.querySelectorAll('.fh-wh-row')).toHaveLength(7);
    expect(doc.querySelector('[data-kind-section="text"]').classList.contains('hidden')).toBe(true);
    expect(doc.getElementById('fhCreateTitle').value).toBe('Work hours');

    const monday = grid.querySelector('.fh-wh-row[data-day="monday"]');
    monday.querySelector('[data-wh-end]').value = '07:00';
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 30);
    expect(doc.getElementById('fhCreateError').textContent).toBe('On Monday, the end time must be after the start time.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    monday.querySelector('[data-wh-end]').value = '17:00';
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 80);
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body).toMatchObject({ kind: 'work_hours', title: 'Work hours', publish: false });
    expect(post.body.data.days.monday).toEqual({ start: '08:00', end: '17:00' });
    expect(post.body.data.days.sunday).toBeNull();
    expect(post.body.template).toBeUndefined();
  });

  test('work hours are for everyone: the viewer picker hides for that type and the item is sent as everyone (control: a rule keeps it)', async () => {
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([
        ['GET /api/v1/firm-handbook/types', { types: [
          { kind: 'text', label: 'Text', cardinality: 'many', fixed_visibility: null },
          { kind: 'work_hours', label: 'Work hours', cardinality: 'one', fixed_visibility: 'organization' },
          { kind: 'followup_rule', label: 'Follow-up rule', cardinality: 'many', fixed_visibility: null }
        ] }],
        ['POST /api/v1/firm-handbook/items', { id: 'wh1', kind: 'work_hours', item: {} }]
      ])
    });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhNewBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 30);
    const kind = doc.getElementById('fhCreateKind');
    const pick = (value) => { kind.value = value; kind.dispatchEvent(new w.CustomEvent('lex-change', { bubbles: true, detail: { value } })); };
    const box = doc.querySelector('[data-visibility="create"]');
    pick('followup_rule');
    await tick(w, 30);
    expect(box.classList.contains('hidden')).toBe(false);
    pick('work_hours');
    await tick(w, 30);
    expect(box.classList.contains('hidden')).toBe(true);
    doc.getElementById('fhCreateMode').setAttribute('value', 'restricted');
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 80);
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body.visibility).toEqual({ mode: 'organization', role_ids: [], group_ids: [], user_ids: [] });
  });

  test('publish asks first, sends the current version, and explains VERSION_NOT_READY plainly', async () => {
    const notReady = Object.assign(new Error('Conflict'), {
      status: 409, code: 'VERSION_NOT_READY',
      data: { error: { code: 'VERSION_NOT_READY', message: 'Not ready', details: { reason: 'processing' } } }
    });
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([
        ['GET /api/v1/firm-handbook/items/i1/versions', [
          { version_number: 3, created_at: '2026-11-12', is_current: true, is_published: false },
          { version_number: 2, created_at: '2026-11-10', is_current: false, is_published: true }
        ]],
        ['POST /api/v1/firm-handbook/items/i1/publish', notReady]
      ])
    });
    await tick(w, 80);
    const doc = w.document;
    const confirms = [];
    w.Lex.Modal.confirmAsync = (title, message, options) => { confirms.push({ title, message, options }); return Promise.resolve(true); };
    const toasts = [];
    w.Lex.Toast.error = (m) => toasts.push(m);

    doc.getElementById('fhManageTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i1' } } }));
    await tick(w, 30);
    expect(doc.getElementById('fhManageDrawer').heading).toBe('Payment schedules');

    doc.getElementById('fhPublishBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 80);
    expect(confirms[0].title).toBe('Publish version 3?');
    expect(calls.find((c) => c.endpoint.endsWith('/publish')).body).toEqual({ version_number: 3 });
    expect(toasts[0]).toBe('LANA is still reading this version. Try again in a minute.');
  });

  test('Open in editor goes to the file editor with the source document and workspace', async () => {
    const { w } = boot({ roles: ['org_admin'], routes: adminRoutes() });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhManageTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i1' } } }));
    await tick(w, 30);
    doc.getElementById('fhOpenEditorBtn').dispatchEvent(new w.Event('click'));
    expect(w.navigations).toEqual([{ path: 'file-editor.html', options: { params: { id: 'src-1', matter_id: 'hb-matter' } } }]);
  });

  test('saving restricted visibility sends the chosen recipients', async () => {
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([['PATCH /api/v1/firm-handbook/items/i2', {}]])
    });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhManageTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i2' } } }));
    await tick(w, 60);
    expect(doc.getElementById('fhEditMode').value).toBe('restricted');
    doc.getElementById('fhEditGroups').setAttribute('value', JSON.stringify(['g1']));
    doc.getElementById('fhSaveVisibilityBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 60);
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.body).toEqual({ visibility: { mode: 'restricted', role_ids: ['r1'], group_ids: ['g1'], user_ids: [] } });
  });

  test('the manage list has a Created column filled from created_at', async () => {
    const { w } = boot({ roles: ['org_admin'], routes: adminRoutes() });
    await tick(w, 80);
    const table = w.document.getElementById('fhManageTable');
    expect(table.getAttribute('columns').split(',')).toContain('created_at');
    expect(table.getAttribute('labels').split(',')).toContain('Created');
    expect(table.querySelector('time[datetime="2026-11-01T09:00:00Z"]')).not.toBeNull();
  });

  test('a 403 on the manage list says plainly who can manage', async () => {
    const forbidden = Object.assign(new Error('Permission required: knowledge:manage'), { status: 403 });
    const { w } = boot({ roles: ['org_admin'], routes: adminRoutes().map((r) => (r[0] === 'GET /api/v1/firm-handbook/manage/items' ? [r[0], forbidden] : r)) });
    await tick(w, 80);
    expect(w.document.getElementById('fhManageTable').textContent).toContain('Only firm admins can manage the handbook.');
  });

  test('publish warns plainly when LANA could not start reading', async () => {
    const { w } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([
        ['GET /api/v1/firm-handbook/items/i1/versions', { versions: [{ version_number: 3, is_current: true, is_published: false }] }],
        ['POST /api/v1/firm-handbook/items/i1/publish', { published_version_number: 3, ingestion_status: 'enqueue_failed' }]
      ])
    });
    await tick(w, 80);
    const doc = w.document;
    w.Lex.Modal.confirmAsync = () => Promise.resolve(true);
    const warnings = [];
    w.Lex.Toast.warning = (m) => warnings.push(m);
    doc.getElementById('fhManageTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i1' } } }));
    await tick(w, 30);
    doc.getElementById('fhPublishBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 80);
    expect(warnings[0]).toContain('Published, but LANA could not start reading it.');
  });

  test('Restore on an older version asks first, then calls the storage restore route', async () => {
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([
        ['GET /api/v1/firm-handbook/items/i1/versions', { versions: [
          { version_number: 3, is_current: true, is_published: false },
          { version_number: 2, is_current: false, is_published: true }
        ] }],
        ['POST /api/v1/storage/files/src-1/versions/2/restore', { status: 'success', current_version: 2 }]
      ])
    });
    await tick(w, 80);
    const doc = w.document;
    const confirms = [];
    w.Lex.Modal.confirmAsync = (title) => { confirms.push(title); return Promise.resolve(true); };
    doc.getElementById('fhManageTable').dispatchEvent(new w.CustomEvent('row-click', { bubbles: true, detail: { row: { id: 'i1' } } }));
    await tick(w, 30);
    doc.getElementById('fhManageTabs').dispatchEvent(new w.CustomEvent('tab-change', { bubbles: true, detail: { tab: 'versions' } }));
    await tick(w, 60);
    const buttons = doc.querySelectorAll('#fhVersionsList [data-restore-version]');
    expect(Array.from(buttons).map((b) => b.getAttribute('data-restore-version'))).toEqual(['2']);
    buttons[0].dispatchEvent(new w.Event('click', { bubbles: true }));
    await tick(w, 80);
    expect(confirms).toEqual(['Restore version 2?']);
    const restore = calls.find((c) => c.endpoint.includes('/restore'));
    expect(restore).toEqual({ method: 'POST', endpoint: '/api/v1/storage/files/src-1/versions/2/restore?matter_id=hb-matter', body: { matter_id: 'hb-matter' } });
  });

  test('create from an upload sends the chosen file as multipart', async () => {
    const { w, calls } = boot({
      roles: ['org_admin'],
      routes: adminRoutes([['POST /api/v1/firm-handbook/items', { id: 'i3', source_document_id: 'src-3', editor: { document_id: 'src-3', matter_id: 'hb-matter' } }]])
    });
    await tick(w, 80);
    const doc = w.document;
    doc.getElementById('fhNewBtn').dispatchEvent(new w.Event('click'));
    await tick(w, 30);
    doc.getElementById('fhCreateTitle').value = 'Pricing';
    doc.getElementById('fhCreateSource').setAttribute('value', 'upload');
    doc.getElementById('fhCreateSource').dispatchEvent(new w.CustomEvent('lex-change', { bubbles: true, detail: { value: 'upload' } }));
    await tick(w, 10);
    expect(doc.getElementById('fhCreateUpload').classList.contains('hidden')).toBe(false);

    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 30);
    expect(doc.getElementById('fhCreateError').textContent).toBe('Choose a file to upload.');

    const input = doc.getElementById('fhCreateFileInput');
    const file = new w.File(['rates'], 'Pricing.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change'));
    expect(doc.getElementById('fhCreateFileName').textContent).toBe('Pricing.pdf');
    doc.getElementById('fhCreateDrawer').dispatchEvent(new w.CustomEvent('lex-confirm'));
    await tick(w, 80);
    const post = calls.find((c) => c.method === 'POST');
    expect(post.body instanceof w.FormData).toBe(true);
    expect(post.body.get('file').name).toBe('Pricing.pdf');
    expect(post.body.get('title')).toBe('Pricing');
  });
});
