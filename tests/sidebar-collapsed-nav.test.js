const fs = require('fs');
const path = require('path');

const SIDEBAR = path.join(
  __dirname,
  '..',
  'src',
  'js',
  'lex',
  'components',
  'layout',
  'lex-sidebar.js'
);

function readSidebar() {
  return fs.readFileSync(SIDEBAR, 'utf8');
}

describe('LexSidebar collapsed navigation', () => {
  test('collapsed sidebar hides non-primary sections', () => {
    const sidebar = readSidebar();

    expect(sidebar).toContain('data-static-top="${section.isStaticTop ?');
    expect(sidebar).toContain('.lex-sidebar-root[data-collapsed="true"] .lex-sidebar-section[data-static-top="false"]');
    expect(sidebar).toContain('display: none;');
  });

  test('collapsed nav groups become direct links instead of dropdowns', () => {
    const sidebar = readSidebar();

    expect(sidebar).toContain('const defaultChild = item.children.find');
    expect(sidebar).toContain('data-href="${this.escapeHtml(defaultHref)}"');
    expect(sidebar).toContain('.lex-sidebar-root[data-collapsed="true"] .lex-sidebar-nav-chevron');
    expect(sidebar).toContain('if (this.collapsed) {');
    expect(sidebar).toContain("this.emit('sidebar-nav-click'");
  });

  test('collapsed create button opens a create chooser', () => {
    const sidebar = readSidebar();

    expect(sidebar).toContain('_openCollapsedCreateChooser()');
    expect(sidebar).toContain("if (this.collapsed && id === 'new-chat')");
    expect(sidebar).toContain('data-create-choice="chat"');
    expect(sidebar).toContain('data-create-choice="task"');
    expect(sidebar).toContain('data-create-choice="workspace"');
    expect(sidebar).toContain("this._openTasksIndex({ create: true });");
    expect(sidebar).toContain("this._openWorkspacesIndex({ create: true });");
  });
});
