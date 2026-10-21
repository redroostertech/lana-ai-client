/**
 * The legacy js/components.js Modal (show / confirm / alert) is a facade over
 * Lex.Modal (docs/TABLE-STANDARD.md section 11): no hand-built overlay, same
 * signatures, returns the dialog element, onCancel fires on cancel or close
 * but never after confirm.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_PATH = path.join(__dirname, '../../src/js/components.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

function makeModalElement() {
  const listeners = {};
  return {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    fire: (type) => (listeners[type] || []).forEach((fn) => fn()),
  };
}

function load() {
  const opened = [];
  const Lex = {
    Modal: {
      open: jest.fn((options) => {
        const el = makeModalElement();
        // Mirror Lex.Modal.open: the confirm button runs options.onConfirm.
        el.confirm = () => { el.fire('lex-confirm'); if (options.onConfirm) options.onConfirm(); };
        opened.push({ options, el });
        return el;
      }),
    },
  };
  class FakeNode {}
  const windowStub = { Lex, Node: FakeNode };
  const documentStub = {
    readyState: 'loading',
    addEventListener: () => {},
    getElementById: () => null,
  };
  const sandbox = { window: windowStub, document: documentStub, console, setTimeout };
  // `Modal` is a top-level const; expose it from the script's own scope.
  vm.runInNewContext(source + '\n;this.__Modal = Modal;', sandbox, { filename: SOURCE_PATH });
  return { Modal: sandbox.__Modal, Lex, opened, FakeNode };
}

describe('components.js Modal delegates to Lex.Modal', () => {
  test('source has no hand-built overlay markup for the modal', () => {
    const modalBlock = source.slice(source.indexOf('const Modal = {'), source.indexOf('// Loading Spinner'));
    expect(modalBlock).toContain('window.Lex.Modal.open');
    expect(modalBlock).not.toMatch(/fixed inset-0|createElement\('div'\)|bg-opacity-50/);
  });

  test('confirm keeps its signature, maps type to variant, and returns the dialog', () => {
    const { Modal, opened } = load();
    const onConfirm = jest.fn();
    const result = Modal.confirm('Delete Matter', 'Are you <b>sure</b>?', onConfirm);
    expect(opened).toHaveLength(1);
    const { options, el } = opened[0];
    expect(result).toBe(el);
    expect(options).toEqual(expect.objectContaining({
      heading: 'Delete Matter',
      variant: 'danger',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      hideActions: false,
    }));
    // String content stays trusted HTML, as before.
    expect(options.content).toBe('<p class="lex-modal-body-text">Are you <b>sure</b>?</p>');
    el.confirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test('show runs onCancel on cancel or close, never after confirm', () => {
    const { Modal, opened } = load();
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    Modal.show({ title: 'A', content: 'x', onConfirm, onCancel, type: 'primary' });
    expect(opened[0].options.variant).toBe('default');
    opened[0].el.fire('lex-close');
    opened[0].el.fire('lex-cancel');
    expect(onCancel).toHaveBeenCalledTimes(1);

    Modal.show({ title: 'B', content: 'y', onConfirm, onCancel });
    opened[1].el.confirm();
    opened[1].el.fire('lex-close');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('node content is passed through; alert uses OK and Close', () => {
    const { Modal, opened, FakeNode } = load();
    const node = new FakeNode();
    Modal.show({ title: 'Form', content: node });
    expect(opened[0].options.content).toBe(node);
    Modal.alert('Sync Error', 'Failed');
    expect(opened[1].options).toEqual(expect.objectContaining({ confirmText: 'OK', cancelText: 'Close' }));
  });
});
