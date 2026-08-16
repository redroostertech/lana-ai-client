'use strict';

const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(
  path.join(__dirname, '../../src/css/my-tasks.css'),
  'utf8'
);
const pageJs = fs.readFileSync(
  path.join(__dirname, '../../src/js/pages/my-tasks.js'),
  'utf8'
);

describe('my tasks detail layout', () => {
  test('uses matching card shells for main sections and aside detail cards', () => {
    expect(pageJs).toContain('<section class="my-task-issue-section">');
    expect(pageJs).toContain('<section class="my-task-aside-card">');
    expect(css).toContain('.my-task-issue-section {');
    expect(css).toContain('.my-task-aside-card {');
    expect(css).toContain('padding: 1rem 1rem 1.125rem;');
    expect(css).toContain('border-radius: var(--lex-radius-md, 8px);');
    expect(css).toContain('background: var(--lex-bg-primary);');
  });
});
