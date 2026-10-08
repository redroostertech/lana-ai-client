/**
 * The renderer ships the vendored pdf.js 3.11.174 (src/js/vendor/pdf.min.js).
 * That release is affected by CVE-2024-4367 unless every getDocument() call
 * passes isEvalSupported: false. This guards each call site in src/.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' ? [] : listSourceFiles(full);
    return /\.(js|html)$/.test(entry.name) && !/\.min\.js$/.test(entry.name) ? [full] : [];
  });
}

describe('vendored pdf.js usage', () => {
  it('disables eval on every pdfjsLib.getDocument call', () => {
    const calls = [];
    for (const file of listSourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      const re = /pdfjsLib\.getDocument\(([^)]*)\)/g;
      let match;
      while ((match = re.exec(text))) calls.push({ file: path.relative(SRC, file), args: match[1] });
    }

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect({ file: call.file, evalDisabled: /isEvalSupported:\s*false/.test(call.args) })
        .toEqual({ file: call.file, evalDisabled: true });
    }
  });
});
