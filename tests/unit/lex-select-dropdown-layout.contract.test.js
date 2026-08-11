'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function loadLexSelect() {
  const appendedStyles = [];
  const document = {
    createElement(tag) {
      return { tagName: String(tag || '').toUpperCase(), id: '', textContent: '' };
    },
    head: {
      appendChild(node) {
        appendedStyles.push(node);
      }
    }
  };
  const window = {
    Lex: {
      LexElement: class {
        static get properties() { return {}; }
        escapeHtml(value) {
          return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        }
      },
      defineLex(_name, ctor) {
        window.LexSelect = ctor;
      }
    }
  };

  const formsCode = fs.readFileSync(path.join(SRC, 'js', 'lex', 'lex.forms.js'), 'utf8');
  const selectCode = fs.readFileSync(path.join(SRC, 'js', 'lex', 'components', 'form', 'lex-select.js'), 'utf8');

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', formsCode)(window, document);
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', selectCode)(window, document);

  return { Select: window.LexSelect, appendedStyles };
}

describe('lex-select dropdown layout contract', () => {
  test('dropdown is constrained to the trigger width and wraps long option text', () => {
    const { Select, appendedStyles } = loadLexSelect();
    const select = new Select();
    select._open = true;
    select.searchable = true;
    select.placeholder = 'Choose a template...';
    select.options = [{
      value: 'long-template',
      label: 'Long Template',
      description: 'A very long template description that must wrap inside the dropdown instead of widening the page.'
    }];

    const html = select.render();
    const styles = appendedStyles.map((style) => style.textContent || '').join('\n');
    const dropdownRule = styles.match(/\.lex-select-dropdown \{[\s\S]*?\n\s*\}/)[0];
    const optionRule = styles.match(/\.lex-select-option \{[\s\S]*?\n\s*\}/)[0];
    const labelRule = styles.match(/\.lex-select-option-label \{[\s\S]*?\n\s*\}/)[0];

    expect(html).toContain('lex-select-dropdown--open');
    expect(html).toContain('A very long template description');
    expect(dropdownRule).toContain('width: 100%;');
    expect(dropdownRule).toContain('box-sizing: border-box;');
    expect(dropdownRule).toContain('overflow-x: hidden;');
    expect(dropdownRule).not.toContain('width: max-content;');
    expect(optionRule).toContain('white-space: normal;');
    expect(optionRule).not.toContain('white-space: nowrap;');
    expect(labelRule).toContain('overflow-wrap: anywhere;');
  });
});
