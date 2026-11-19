'use strict';

// The file editor uses lex-select, not native <select>, and lex-change drives
// its toolbar. (The matter skill step builder that shared this file is retired
// with the Skills pages: skills are automations, in the Automate app.)

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('file-editor.js select markup', () => {
  const editor = read('js/file-editor.js');

  test('no native selects remain', () => {
    expect(editor).not.toMatch(/<select[\s>]/);
  });

  test('file editor toolbar selects are lex-selects driven by lex-change, keeping the caret', () => {
    ['formatBlock', 'fontName', 'fontSize'].forEach((command) => {
      expect(editor).toContain(`lexSelectHtml('class="office-format-select${command === 'fontSize' ? ' office-format-select-narrow' : ''}" data-command="${command}"`);
      expect(editor).toContain(`lex-select[data-command="${command}"]`);
    });
    expect(editor).toContain("document.addEventListener('lex-change', function (event) {");
    expect(editor).toContain("if (embedCommandTarget.matches('lex-select')) event.preventDefault();");
    expect(editor).toContain("lexSelectHtml('id=\"officeMetaDocType\" label=\"Document Type\"'");
  });

  test('host pages load lex-select', () => {
    ['file-editor.html'].forEach((page) => {
      expect(read(page)).toContain('<script src="js/lex/components/form/lex-select.js"></script>');
    });
  });
});
