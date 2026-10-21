'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '../../src');
const editor = fs.readFileSync(path.join(SRC, 'js/file-editor.js'), 'utf8');
const editorCss = fs.readFileSync(path.join(SRC, 'css/file-editor.css'), 'utf8');

describe('File Editor server signature consent contract', () => {
  test('visibly renders the exact packet disclosure and marks missing disclosure packets', () => {
    const renderSource = editor.slice(
      editor.indexOf('function renderSignaturePanel(file, remote)'),
      editor.indexOf('function renderRemotePanels(file)')
    );

    expect(renderSource).toContain('packet.signature_consent_disclosure');
    expect(renderSource).toContain('data-signature-consent-disclosure');
    expect(renderSource).toContain('data-signature-consent-missing');
    expect(renderSource).toContain('disabled aria-disabled="true" title="Electronic signature disclosure unavailable"');
    expect(editorCss).toContain('.office-signature-consent [data-signature-consent-disclosure]');
    expect(editorCss).toContain('white-space: pre-wrap');
  });

  test('refuses an absent disclosure before prompting and submits the packet value unchanged', () => {
    const responseSource = editor.slice(
      editor.indexOf('async function respondToSignaturePacket(file, packetId, signerId, status)'),
      editor.indexOf('function bindEvents()')
    );
    const missingDisclosureGuard = responseSource.indexOf("typeof consentDisclosure !== 'string' || !consentDisclosure.trim()");
    const signaturePrompt = responseSource.indexOf("label: 'Type your legal signature to confirm consent'");
    const consentConfirm = responseSource.indexOf("await Lex.Modal.confirmAsync('Apply the typed signature \"' + signatureText + '\"?', consentDisclosure");

    expect(responseSource).toContain('packet && packet.signature_consent_disclosure');
    expect(responseSource).toContain('consent_disclosure: consentDisclosure');
    // The typed signature and the consent confirmation go through Lex.Modal
    // (no system dialogs); the disclosure is the confirm dialog's message and
    // cancelling either dialog returns before the signer status is updated.
    expect(responseSource).not.toMatch(/window\.(prompt|confirm)/);
    expect(responseSource).toContain('await Lex.Modal.prompt(');
    expect(consentConfirm).toBeGreaterThan(signaturePrompt);
    expect(responseSource).toContain('if (!consented) return;');
    expect(responseSource.indexOf('if (!consented) return;')).toBeLessThan(responseSource.indexOf('service.updateSignerStatus('));
    expect(missingDisclosureGuard).toBeGreaterThan(-1);
    expect(signaturePrompt).toBeGreaterThan(missingDisclosureGuard);
    expect(responseSource).not.toContain('I agree to use an electronic signature');
  });
});
