/**
 * LANA Briefs handoff prompts (src/js/briefs/briefs-handoff-ui.js). 2026-11-12: a phone's
 * handoff reached the QR fallback twice and nothing showed on this computer, because the
 * standalone app's HandoffLayer was never ported into the client.
 */
const { promptFor } = require('../../../src/js/briefs/briefs-handoff-ui.js');

describe('briefs handoff promptFor', () => {
  test('the QR fallback opens a dialog with the code to scan', () => {
    const prompt = promptFor({ kind: 'qr', handoffId: 'h1', qrText: 'lana://handoff/abc' });
    expect(prompt).toMatchObject({ kind: 'qr', key: 'qr:h1', qrText: 'lana://handoff/abc', heading: 'Scan with your phone' });
  });

  test('the approval question names the phone and keeps the handoff id for the answer', () => {
    const prompt = promptFor({ kind: 'approval', handoffId: 'h2', phoneName: 'iPhone' });
    expect(prompt).toMatchObject({ kind: 'approval', handoffId: 'h2', heading: 'Allow iPhone to send meetings?' });
  });

  test('tone, receiving and failed are toasts; each tone play is its own toast', () => {
    expect(promptFor({ kind: 'tone', handoffId: 'h3', play: 1 })).toMatchObject({ kind: 'toast', level: 'info', text: 'Playing the proximity tone for your phone' });
    expect(promptFor({ kind: 'tone', handoffId: 'h3', play: 2 })).toMatchObject({ kind: 'toast', key: 'tone:h3:2', text: 'Playing the proximity tone again (2 of 3)' });
    expect(promptFor({ kind: 'receiving', handoffId: 'h3' })).toMatchObject({ kind: 'toast', level: 'info' });
    expect(promptFor({ kind: 'failed', handoffId: 'h3', message: 'The handoff did not finish.' })).toMatchObject({ kind: 'toast', level: 'error', text: 'The handoff did not finish.' });
  });

  test('control: idle, received and an unknown view show nothing', () => {
    expect(promptFor({ kind: 'idle' }).kind).toBe('none');
    expect(promptFor({ kind: 'received', handoffId: 'h4', bundles: 1 }).kind).toBe('none');
    expect(promptFor(null).kind).toBe('none');
  });
});
