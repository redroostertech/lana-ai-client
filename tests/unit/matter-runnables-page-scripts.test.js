'use strict';

/**
 * Every Lex element the Agents and skills drawer and the makeup dialog create
 * is defined by a script workspace-details.html loads, on both the direct
 * page and the router entry (regression: lex-toggle was never loaded, so the
 * skill toggles did not render).
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const read = (relative) => fs.readFileSync(path.join(SRC, relative), 'utf8');
const MODULES = ['js/shared/matter-runnables-panel.js', 'js/shared/makeup-switch-dialog.js'];

function usedTags() {
  const tags = new Set();
  MODULES.forEach((file) => {
    const source = read(file);
    for (const match of source.matchAll(/createElement\('(lex-[a-z-]+)'\)|<(lex-[a-z-]+)[\s>]/g)) tags.add(match[1] || match[2]);
  });
  return [...tags].sort();
}

function definedBy(scripts) {
  const defined = new Set();
  scripts.forEach((script) => {
    const file = path.join(SRC, script.split('?')[0]);
    if (!fs.existsSync(file)) return;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/define(?:Lex)?\(\s*'(lex-[a-z-]+)'/g)) defined.add(match[1]);
  });
  return defined;
}

describe('workspace-details loads the Lex elements its matter panels use', () => {
  const tags = usedTags();

  test('the panels use lex-toggle among others', () => {
    expect(tags).toEqual(expect.arrayContaining(['lex-toggle', 'lex-badge', 'lex-btn']));
  });

  test('direct page', () => {
    const html = read('workspace-details.html');
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    const defined = definedBy(scripts);
    expect(tags.filter((tag) => !defined.has(tag))).toEqual([]);
  });

  test('router entry plus the shell scripts the router page shares', () => {
    const pages = read('js/lex/lex-router.pages.js');
    const start = pages.indexOf("'workspace-details.html': {");
    const entry = pages.substring(start, pages.indexOf('\n    },', start));
    const routed = [...entry.matchAll(/'(js\/[^']+\.js)'/g)].map((match) => match[1]);
    // Shell scripts every routed page already has (loaded before the router).
    const html = read('workspace-details.html');
    const shell = [...html.substring(0, html.indexOf('lex-page-init.js')).matchAll(/<script src="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((src) => src.indexOf('components/layout/') !== -1 || /lex-(loader|toast|spinner|btn|empty|segmented)\.js/.test(src));
    const defined = definedBy(routed.concat(shell));
    expect(tags.filter((tag) => !defined.has(tag))).toEqual([]);
  });
});
