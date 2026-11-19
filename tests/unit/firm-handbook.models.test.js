'use strict';

const path = require('path');

const models = require(path.join(__dirname, '../../src/js/firm-handbook/firm-handbook.models.js'));

const formatDate = (iso) => 'D(' + String(iso).substring(0, 10) + ')';

describe('member views', () => {
  test('maps a published list row with version and published date', () => {
    const page = models.toMemberPage({
      items: [{ id: 'i1', title: 'Payment schedules', summary: 'How we bill', published_version: { number: 3, published_at: '2026-11-15T10:00:00Z' } }],
      total: 7,
      has_more: true
    }, { formatDate });
    expect(page).toEqual({
      items: [{
        id: 'i1',
        kind: 'text',
        title: 'Payment schedules',
        summary: 'How we bill',
        versionNumber: 3,
        publishedAt: '2026-11-15T10:00:00Z',
        versionLabel: 'Version 3',
        publishedLine: 'Version 3, published D(2026-11-15)',
        createdAt: '',
        ingestionStatus: ''
      }],
      total: 7,
      hasMore: true
    });
  });

  test('a missing total falls back to the row count, and junk payloads give an empty page', () => {
    expect(models.toMemberPage({ items: [{ id: 'a' }] }).total).toBe(1);
    expect(models.toMemberPage(null)).toEqual({ items: [], total: 0, hasMore: false });
  });

  test('the reader view says "Version N, published <date>"', () => {
    const view = models.toReaderView({
      id: 'i1', title: 'Fees', summary: 's', version_number: 2, published_at: '2026-11-01T00:00:00Z', content: 'Body', document_id: 'd1'
    }, { formatDate });
    expect(view.meta).toBe('Version 2, published D(2026-11-01)');
    expect(view.content).toBe('Body');
    expect(view.documentId).toBe('d1');
  });

  test('published line copes with either half missing', () => {
    expect(models.publishedLine(null, '', formatDate)).toBe('');
    expect(models.publishedLine(4, '', formatDate)).toBe('Version 4');
    expect(models.publishedLine(null, '2026-01-02', formatDate)).toBe('Published D(2026-01-02)');
  });
});

describe('admin views and status chips', () => {
  const base = {
    id: 'i1',
    title: 'Fees',
    summary: '',
    source_document_id: 'src-1',
    visibility: { mode: 'restricted', role_ids: ['r1', 'r1', ''], group_ids: ['g1'], user_ids: [] }
  };

  test('a draft shows only Draft', () => {
    const item = models.toManageItem(Object.assign({}, base, { status: 'draft' }));
    expect(item.chips.map((c) => c.label)).toEqual(['Draft']);
    expect(item.visibility).toEqual({ mode: 'restricted', roleIds: ['r1'], groupIds: ['g1'], userIds: [] });
    expect(item.visibilityLabel).toBe('Restricted');
  });

  test('a published item with a newer version shows Unpublished changes', () => {
    const item = models.toManageItem(Object.assign({}, base, { status: 'published', has_unpublished_changes: true }));
    expect(item.chips.map((c) => c.label)).toEqual(['Published', 'Unpublished changes']);
  });

  test('a published item LANA is still reading shows the reading notice', () => {
    const item = models.toManageItem(Object.assign({}, base, {
      status: 'published', published_version: { number: 1, published_at: '2026-11-15', ingestion_status: 'pending' }
    }));
    expect(item.ingestionPending).toBe(true);
    expect(item.chips.map((c) => c.label)).toEqual(['Published', 'LANA is still reading this version']);
  });

  test('an unpublished item and an unknown status read plainly', () => {
    expect(models.toManageItem(Object.assign({}, base, { status: 'unpublished', has_unpublished_changes: true })).chips
      .map((c) => c.label)).toEqual(['Not published']);
    expect(models.toManageItem(Object.assign({}, base, { status: 'weird' })).status).toBe('draft');
  });

  test('organization visibility reads as Everyone in the firm', () => {
    expect(models.toManageItem({ id: 'x', visibility: { mode: 'organization' } }).visibilityLabel).toBe('Everyone in the firm');
    expect(models.toManageItem({ id: 'x' }).visibility.mode).toBe('organization');
  });

  test('versions come newest first and the current one is found', () => {
    const rows = models.toVersionRows([
      { version_number: 1, created_at: '2026-11-01', created_by_name: 'Ann', is_current: false, is_published: true },
      { version_number: 2, created_at: '2026-11-02', created_by_name: 'Ben', is_current: true, is_published: false, signed: true }
    ], { formatDate });
    expect(rows.map((r) => r.label)).toEqual(['Version 2', 'Version 1']);
    expect(models.currentVersion(rows).versionNumber).toBe(2);
    expect(rows[0].createdLabel).toBe('D(2026-11-02)');
    expect(models.currentVersion([])).toBeNull();
    expect(models.toVersionRows({ versions: [{ version_number: 5 }] })[0].versionNumber).toBe(5);
  });

  test('publication history reads live, replaced and unpublished entries', () => {
    const rows = models.toPublicationRows({ publications: [
      { version_number: 1, published_at: '2026-11-01', superseded_at: '2026-11-03', published_by_name: 'Ann' },
      { version_number: 2, published_at: '2026-11-03' },
      { version_number: 3, published_at: '2026-11-05', unpublished_at: '2026-11-06' }
    ] }, { formatDate });
    expect(rows.map((r) => [r.versionNumber, r.state])).toEqual([[3, 'Unpublished'], [2, 'Live'], [1, 'Replaced']]);
    expect(rows[2].line).toBe('Version 1, published D(2026-11-01), by Ann');
    expect(rows[2].endedLine).toBe('Replaced D(2026-11-03)');
  });
});

describe('recipient options', () => {
  test('roles, groups and people become lex-select options, leaving out inactive ones', () => {
    expect(models.roleOptions({ roles: [{ id: 'r1', name: 'paralegal', display_name: 'Paralegal' }, { id: 'r2', name: 'old', is_active: false }] }))
      .toEqual([{ value: 'r1', label: 'Paralegal' }]);
    expect(models.groupOptions({ groups: [{ id: 'g1', name: 'Intake' }] })).toEqual([{ value: 'g1', label: 'Intake' }]);
    expect(models.userOptions({ users: [
      { id: 'u1', first_name: 'Ann', last_name: 'Lee', email: 'ann@firm.test' },
      { id: 'u2', email: 'bob@firm.test' },
      { id: 'u3', first_name: 'Gone', is_active: false }
    ] })).toEqual([
      { value: 'u1', label: 'Ann Lee', description: 'ann@firm.test' },
      { value: 'u2', label: 'bob@firm.test', description: '' }
    ]);
  });

  test('a multi-select value is read from an array, a JSON string or a comma list', () => {
    expect(models.parseMultiValue(['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(models.parseMultiValue('["a","b"]')).toEqual(['a', 'b']);
    expect(models.parseMultiValue('a, b')).toEqual(['a', 'b']);
    expect(models.parseMultiValue('')).toEqual([]);
    expect(models.parseMultiValue('[broken')).toEqual([]);
  });
});

describe('visibility payload and validation', () => {
  test('everyone in the firm sends no recipients even when some were picked', () => {
    expect(models.buildVisibilityPayload({ mode: 'organization', roleIds: ['r1'] }))
      .toEqual({ mode: 'organization', role_ids: [], group_ids: [], user_ids: [] });
  });

  test('restricted sends the chosen roles, groups and people', () => {
    const payload = models.buildVisibilityPayload({ mode: 'restricted', roleIds: '["r1"]', groupIds: ['g1'], userIds: 'u1,u2' });
    expect(payload).toEqual({ mode: 'restricted', role_ids: ['r1'], group_ids: ['g1'], user_ids: ['u1', 'u2'] });
    expect(models.validateVisibility(payload)).toEqual({ valid: true, message: '' });
  });

  test('restricted with nobody selected is blocked with a plain message', () => {
    const result = models.validateVisibility(models.buildVisibilityPayload({ mode: 'restricted' }));
    expect(result.valid).toBe(false);
    expect(result.message).toBe(models.MESSAGES.noRecipients);
  });

  test('more than 200 of a kind is blocked', () => {
    const many = Array.from({ length: 201 }, (_, i) => 'u' + i);
    expect(models.validateVisibility({ mode: 'restricted', role_ids: [], group_ids: [], user_ids: many }).valid).toBe(false);
  });
});

describe('details and create payloads', () => {
  test('title is required and trimmed; long title or summary is refused', () => {
    expect(models.buildDetailsPayload({ title: '  ' })).toMatchObject({ valid: false, field: 'title' });
    expect(models.buildDetailsPayload({ title: 'x'.repeat(501) })).toMatchObject({ valid: false, field: 'title' });
    expect(models.buildDetailsPayload({ title: 'ok', summary: 'y'.repeat(601) })).toMatchObject({ valid: false, field: 'summary' });
    expect(models.buildDetailsPayload({ title: ' Fees ', summary: ' Short ' }))
      .toEqual({ valid: true, message: '', payload: { title: 'Fees', summary: 'Short' } });
  });

  test('create payload asks for a blank document and carries visibility', () => {
    expect(models.buildCreatePayload({ title: 'Fees', summary: '', mode: 'organization' })).toEqual({
      valid: true,
      message: '',
      payload: { title: 'Fees', summary: '', visibility: { mode: 'organization', role_ids: [], group_ids: [], user_ids: [] }, template: 'blank_docx' }
    });
    expect(models.buildCreatePayload({ title: 'Fees', mode: 'restricted' })).toMatchObject({ valid: false, field: 'visibility' });
  });
});

describe('editor link and errors', () => {
  test('editor params come from the create response or the managed item', () => {
    expect(models.editorParams({ editor: { document_id: 'd1', matter_id: 'm1' } })).toEqual({ id: 'd1', matter_id: 'm1' });
    expect(models.editorParams({ sourceDocumentId: 'd2', editorMatterId: '' })).toEqual({ id: 'd2' });
    expect(models.editorParams({})).toBeNull();
  });

  test('VERSION_NOT_READY gets a plain message, from either error shape', () => {
    expect(models.describeError({ status: 409, code: 'VERSION_NOT_READY' })).toBe(models.MESSAGES.versionNotReady);
    expect(models.describeError({ status: 409, data: { error: { code: 'VERSION_NOT_READY' } } })).toBe(models.MESSAGES.versionNotReady);
  });

  test('other errors read plainly, with a fallback', () => {
    expect(models.describeError({ status: 403 })).toBe('You do not have permission to do that.');
    expect(models.describeError({ status: 404 })).toBe('That item is no longer available.');
    expect(models.describeError({ status: 400, message: 'Title is too long' })).toBe('Title is too long');
    expect(models.describeError({ status: 500 }, 'Could not save.')).toBe('Could not save.');
  });
});

describe('copy rules', () => {
  test('no em or en dashes in the messages', () => {
    const all = [];
    Object.values(models.MESSAGES).forEach((m) => { if (typeof m === 'string') all.push(m); else all.push(...Object.values(m)); });
    all.forEach((message) => {
      expect(message.includes('—')).toBe(false);
      expect(message.includes('–')).toBe(false);
    });
  });
});

describe('backend contract additions', () => {
  test('VERSION_NOT_READY reads its reason from error.details', () => {
    const err = (reason) => ({ status: 409, code: 'VERSION_NOT_READY', data: { error: { code: 'VERSION_NOT_READY', message: 'x', details: { reason } } } });
    expect(models.describeError(err('no_version'))).toBe('There is no saved version yet. Open it in the editor and save first.');
    expect(models.describeError(err('not_current'))).toBe('A newer version was saved since you opened this. Refresh and publish the current version.');
    expect(models.describeError(err('processing'))).toBe('LANA is still reading this version. Try again in a minute.');
    expect(models.describeError(err('checksum_mismatch'))).toBe('This version is still being prepared. Wait a minute and try again.');
    expect(models.describeError(err('something_new'))).toBe(models.MESSAGES.versionNotReady);
  });

  test('publish outcome warns plainly when LANA could not start reading', () => {
    expect(models.publishResultMessage({ ingestion_status: 'queued' })).toEqual({ level: 'success', message: models.MESSAGES.published });
    expect(models.publishResultMessage({ ingestion_status: 'enqueue_failed' })).toEqual({ level: 'warning', message: models.MESSAGES.enqueueFailed });
  });

  test('manage items carry created, updated, current version and a failed reading chip', () => {
    const item = models.toManageItem({
      id: 'i1', title: 'Fees', status: 'published', ingestion_status: 'failed', current_version_number: 4,
      published_version: { number: 3, published_at: '2026-11-15' }, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
      editor: { document_id: 'src-1', matter_id: 'ws-1' }
    });
    expect(item.currentVersionNumber).toBe(4);
    expect(item.createdAt).toBe('2026-11-01T00:00:00Z');
    expect(item.updatedAt).toBe('2026-11-02T00:00:00Z');
    expect(item.chips.map((c) => c.label)).toEqual(['Published', 'LANA could not read this version']);
    expect(models.editorParams(item)).toEqual({ id: 'src-1', matter_id: 'ws-1' });
    expect(models.toManageItem({ id: 'x', status: 'published', ingestion_status: 'processing' }).ingestionPending).toBe(true);
  });

  test('member rows carry created_at and the published ingestion status', () => {
    const item = models.toMemberItem({ id: 'i1', created_at: '2026-11-01', published_version: { number: 1, published_at: '2026-11-02', ingestion_status: 'completed' } });
    expect(item.createdAt).toBe('2026-11-01');
    expect(item.ingestionStatus).toBe('completed');
  });

  test('only versions other than the current one can be restored', () => {
    const rows = models.toVersionRows({ versions: [{ version_number: 2, is_current: true }, { version_number: 1, is_current: false }] });
    expect(rows.map((r) => [r.versionNumber, r.canRestore])).toEqual([[2, false], [1, true]]);
  });

  test('history names who unpublished, and never shows a raw user id', () => {
    const rows = models.toPublicationRows({ publications: [
      { version_number: 1, published_at: '2026-11-01', unpublished_at: '2026-11-02', published_by: 'uuid-1', unpublished_by_name: 'Ben' }
    ] }, { formatDate });
    expect(rows[0].line).toBe('Version 1, published D(2026-11-01)');
    expect(rows[0].endedLine).toBe('Unpublished D(2026-11-02) by Ben');
  });

  test('upload create returns the file beside the payload, without the blank template', () => {
    const file = { name: 'Fees.DOCX', size: 1024 };
    expect(models.buildCreatePayload({ title: 'Fees', mode: 'organization', source: 'upload', file })).toEqual({
      valid: true, message: '', file,
      payload: { title: 'Fees', summary: '', visibility: { mode: 'organization', role_ids: [], group_ids: [], user_ids: [] } }
    });
    expect(models.buildCreatePayload({ title: 'Fees', source: 'upload' })).toMatchObject({ valid: false, field: 'file', message: models.MESSAGES.noFile });
  });

  test('uploads must be DOCX, PDF or plain text, up to 100 MB', () => {
    expect(models.validateUploadFile({ name: 'a.pdf', size: 10 }).valid).toBe(true);
    expect(models.validateUploadFile({ name: 'a.txt', size: 10 }).valid).toBe(true);
    expect(models.validateUploadFile({ name: 'a.xlsx', size: 10 }).message).toBe(models.MESSAGES.fileType);
    expect(models.validateUploadFile({ name: 'noext', size: 10 }).message).toBe(models.MESSAGES.fileType);
    expect(models.validateUploadFile({ name: 'a.docx', size: 100 * 1024 * 1024 + 1 }).message).toBe(models.MESSAGES.fileTooLarge);
  });
});
