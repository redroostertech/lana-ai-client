/**
 * Document type labels are backend data (GET /api/v1/document-types). The
 * client keeps no label map: it loads the list once and, for a value the list
 * does not name (or before it loads), shows the key in plain words.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'src');
const MODULE_PATH = path.join(SRC, 'js', 'shared', 'document-type-names.js');

function freshModule() {
  jest.resetModules();
  // eslint-disable-next-line global-require
  return require(MODULE_PATH);
}

function apiReturning(body) {
  return { get: jest.fn(() => Promise.resolve(body)) };
}

describe('humanizeKey (the neutral fallback)', () => {
  const { humanizeKey } = freshModule();
  test.each([
    ['lease_extension_rider', 'Lease extension rider'],
    ['NEW-KIND', 'New kind'],
    ['  spaced__out_  ', 'Spaced out'],
    ['memo', 'Memo']
  ])('%s reads as %s', (key, words) => {
    expect(humanizeKey(key)).toBe(words);
  });
  test.each([null, undefined, '', '   ', '__'])('%p has no label', (value) => {
    expect(humanizeKey(value)).toBeNull();
  });
});

describe('document type names', () => {
  test('before the list loads every value reads as plain words (no built-in label map)', () => {
    const names = freshModule();
    expect(names.documentTypeLabel('order')).toBe('Order');
    expect(names.documentTypeLabel('medical_record')).toBe('Medical record');
    expect(names.documentTypeLabel(null)).toBeNull();
    expect(names.documentTypeLabel('')).toBeNull();
  });

  test('loads GET /api/v1/document-types once and shows the backend label', async () => {
    const names = freshModule();
    const api = apiReturning({ data: [{ key: 'order', label: 'Court order' }, { key: 'memo', label: 'Memo' }] });
    const first = names.load(api);
    const second = names.load(api);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/v1/document-types');
    expect(names.documentTypeLabel('order')).toBe('Court order');
    expect(names.documentTypeLabel(' order ')).toBe('Court order');
    expect(names.documentTypeLabel('lease_extension_rider')).toBe('Lease extension rider');
  });

  test('ignores malformed entries and uses window.api when no client is passed', async () => {
    const names = freshModule();
    const api = apiReturning({ data: [{ key: 'brief', label: 'Short brief' }, { key: 'x' }, null, { label: 'No key' }] });
    global.window = { api };
    try {
      await expect(names.load()).resolves.toBe(true);
    } finally {
      delete global.window;
    }
    expect(names.documentTypeLabel('brief')).toBe('Short brief');
    expect(names.documentTypeLabel('x')).toBe('X');
  });

  test('a failed load keeps the fallback and a later load tries again', async () => {
    const names = freshModule();
    const api = { get: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: [{ key: 'order', label: 'Court order' }] }) };
    await expect(names.load(api)).resolves.toBe(false);
    expect(names.documentTypeLabel('order')).toBe('Order');
    await expect(names.load(api)).resolves.toBe(true);
    expect(names.documentTypeLabel('order')).toBe('Court order');
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('no API client means no request and the fallback', async () => {
    const names = freshModule();
    await expect(names.load(null)).resolves.toBe(false);
    expect(names.documentTypeLabel('court_filing')).toBe('Court filing');
  });
});

describe('metadata formatter reads the loaded label', () => {
  test('formatDocumentType shows the backend label, plain words, or a dash', async () => {
    const context = { console };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(MODULE_PATH, 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(SRC, 'js', 'utils', 'metadata-formatter.js'), 'utf8'), context);
    const formatter = context.window.metadataFormatter;
    expect(formatter.formatDocumentType('order')).toBe('Order');
    await context.window.LanaDocumentTypeNames.load(apiReturning({ data: [{ key: 'order', label: 'Court order' }] }));
    expect(formatter.formatDocumentType('order')).toBe('Court order');
    expect(formatter.formatDocumentType(null)).toBe('—');
  });
});

describe('wiring', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

  test('the client label map is gone', () => {
    expect(fs.existsSync(path.join(SRC, 'js', 'shared', 'document-type-labels.js'))).toBe(false);
  });

  test.each(['file-viewer.html', 'file-editor.html', 'workspaces.html', 'workspace-details.html'])(
    '%s loads document-type-names.js before the code that labels types', (page) => {
      const html = read(page);
      expect(html).not.toContain('document-type-labels.js');
      const at = html.indexOf('js/shared/document-type-names.js');
      expect(at).toBeGreaterThan(-1);
      const user = html.indexOf(page === 'file-editor.html' ? 'js/file-editor.js' : 'js/utils/metadata-formatter.js');
      expect(at).toBeLessThan(user);
    }
  );

  test('router pages that label types load the module', () => {
    const code = read('js/lex/lex-router.pages.js');
    const sandbox = { window: { Lex: {} }, document: { addEventListener: () => {} } };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', code)(sandbox.window, sandbox.document);
    const pages = sandbox.window.Lex._pageDescriptors;
    for (const page of ['workspace-details.html', 'file-editor.html']) {
      expect(pages[page].scripts).toContain('js/shared/document-type-names.js');
    }
  });

  test.each([
    'js/file-viewer-page.js',
    'js/file-editor.js',
    'js/components/document-metadata-viewer.js'
  ])('%s waits for the list before it renders a type', (rel) => {
    expect(read(rel)).toContain('LanaDocumentTypeNames.load(');
  });
});

describe('pickerOptions: the Document Type picker lists what the server returns', () => {
  test('before the list arrives there are no options, so the page keeps its own', () => {
    expect(freshModule().pickerOptions('')).toBeNull();
  });
  test('Auto-detect, then every server type in its order, plus the stored type when the list lacks it', async () => {
    const names = freshModule();
    await names.load(apiReturning({ data: [{ key: 'contract', label: 'Contract' }, { key: 'signed_engagement_letter', label: 'Signed engagement letter' }] }));
    expect(names.pickerOptions('')).toEqual([{ value: '', label: 'Auto-detect' }, { value: 'contract', label: 'Contract' }, { value: 'signed_engagement_letter', label: 'Signed engagement letter' }]);
    expect(names.pickerOptions('police_report').slice(-1)[0]).toEqual({ value: 'police_report', label: 'Police report' });
    expect(names.pickerOptions('contract').length).toBe(3);
  });
});
