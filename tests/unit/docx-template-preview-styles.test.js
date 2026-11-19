'use strict';

// The template preview overlay (DocxTemplateModal.previewTemplate) built its
// markup with inline styles, the failed-load message included. Its look now
// lives in css/docx-template-modal.css, loaded wherever the modal is.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const modal = read('js/services/docx-template-modal.js');

function previewBlock() {
  const start = modal.indexOf("overlay.id = 'dtm-template-preview-overlay';");
  const end = modal.indexOf('DocxTemplateModal.prototype.generate');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return modal.slice(start, end);
}

test('the preview overlay and its failed-load message carry no inline style', () => {
  const block = previewBlock();
  expect(block).not.toMatch(/style=|style\.cssText/);
  expect(block).toContain("'<div class=\"dtm-preview-error\">Failed to load preview: '");
});

test('every class the preview uses is defined in docx-template-modal.css', () => {
  const css = read('css/docx-template-modal.css');
  const classesInMarkup = [...previewBlock().matchAll(/class(?:Name)?\s*=\s*\\?["']([^"'\\]+)/g)].flatMap((m) => m[1].split(/\s+/));
  expect(classesInMarkup.length).toBeGreaterThan(0);
  for (const name of classesInMarkup) {
    expect({ name, defined: css.includes(`.${name}`) }).toEqual({ name, defined: true });
  }
});

test.each([
  ['file-viewer.html'],
  ['workspace-details.html']
])('%s loads the stylesheet', (page) => {
  expect(read(page)).toContain('css/docx-template-modal.css');
});

test('the workspace route loads the stylesheet with the modal', () => {
  const pages = read('js/lex/lex-router.pages.js');
  const route = pages.slice(pages.indexOf("'js/services/docx-template-modal.js'"));
  expect(route.slice(0, route.indexOf('],', route.indexOf('stylesheets')) )).toContain("'css/docx-template-modal.css'");
});
