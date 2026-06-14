/**
 * Regression: Lex.Drawer.open ignored the `buttons: [...]` footer API that the
 * Metric Catalog goal/detail/playground drawers depend on, so no footer (and no
 * Save button) ever rendered. The footer markup is built by the pure
 * buildDrawerFooterButtons helper, covered here without a DOM.
 */
const path = require('path');

const { buildDrawerFooterButtons } = require(
  path.join(__dirname, '../../src/js/lex/components/foundation/lex-drawer.js')
);

const esc = (s) => String(s == null ? '' : s)
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

describe('buildDrawerFooterButtons', () => {
  test('renders one button per entry with id, label, and variant class', () => {
    const html = buildDrawerFooterButtons(
      [
        { label: 'Save goal', variant: 'primary', id: 'metricGoalSave' },
        { label: 'Remove', variant: 'danger', id: 'metricGoalRemove' },
        { label: 'Close', variant: 'secondary', id: 'metricGoalClose' },
      ],
      esc
    );
    expect(html).toContain('id="metricGoalSave"');
    expect(html).toContain('lex-drawer-btn--primary');
    expect(html).toContain('Save goal');
    expect(html).toContain('id="metricGoalRemove"');
    expect(html).toContain('lex-drawer-btn--danger');
    expect(html).toContain('id="metricGoalClose"');
    expect(html).toContain('lex-drawer-btn--secondary');
    expect((html.match(/<button/g) || []).length).toBe(3);
  });

  test('unknown or missing variant falls back to secondary', () => {
    const html = buildDrawerFooterButtons(
      [{ label: 'Go', variant: 'not-a-variant', id: 'goBtn' }, { label: 'Plain', id: 'plain' }],
      esc
    );
    expect(html).toContain('lex-drawer-btn--secondary');
    expect(html).not.toContain('not-a-variant');
    expect((html.match(/lex-drawer-btn--secondary/g) || []).length).toBe(2);
  });

  test('escapes id and label through the provided escaper', () => {
    const html = buildDrawerFooterButtons([{ label: '<b>x</b>', id: 'a"b' }], esc);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('id="a&quot;b"');
  });

  test('filters falsy entries and tolerates a non-array / empty input', () => {
    expect(buildDrawerFooterButtons([null, undefined, { label: 'Only', id: 'o' }], esc))
      .toBe('<button type="button" class="lex-drawer-btn lex-drawer-btn--secondary" id="o">Only</button>');
    expect(buildDrawerFooterButtons(null, esc)).toBe('');
    expect(buildDrawerFooterButtons(undefined, esc)).toBe('');
    expect(buildDrawerFooterButtons([], esc)).toBe('');
  });

  test('omits the id attribute when no id is given', () => {
    const html = buildDrawerFooterButtons([{ label: 'NoId' }], esc);
    expect(html).not.toContain('id=');
    expect(html).toContain('>NoId</button>');
  });
});
