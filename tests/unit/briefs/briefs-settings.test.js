'use strict';

/** LANA Briefs rows in the client's Settings (src/js/briefs/briefs-settings.js). */
const S = require('../../../src/js/briefs/briefs-settings');

describe('meeting audio retention', () => {
  test('the presets inside the range, as strings for lex-select', () => {
    expect(S.retentionChoices(90, { min: 1, max: 3650 })).toEqual([
      { value: '7', label: '7 days' },
      { value: '30', label: '30 days' },
      { value: '90', label: '90 days' },
      { value: '180', label: '180 days' },
      { value: '365', label: '1 year' },
    ]);
  });

  test('a value set elsewhere is kept as a choice, in order', () => {
    expect(S.retentionChoices(45, { min: 1, max: 3650 }).map((choice) => choice.value)).toEqual(['7', '30', '45', '90', '180', '365']);
  });

  test('presets outside the range are left out', () => {
    expect(S.retentionChoices(30, { min: 14, max: 120 }).map((choice) => choice.value)).toEqual(['30', '90']);
  });
});

describe('background update lease', () => {
  test('hours become labels', () => {
    expect(S.leaseChoices({ leaseHourChoices: [1, 4, 8, 24] })).toEqual([
      { value: '1', label: '1 hour' },
      { value: '4', label: '4 hours' },
      { value: '8', label: '8 hours' },
      { value: '24', label: '24 hours' },
    ]);
  });

  test('no preferences, no choices', () => {
    expect(S.leaseChoices(null)).toEqual([]);
  });
});

describe('proximity check', () => {
  test('the tone is always on; the rest follow the preferences', () => {
    const rows = S.proximityRows({ requireMacClick: true, allowQR: false, allowMacApproval: true });
    expect(rows.map((row) => [row.key, row.checked, row.disabled])).toEqual([
      ['tone', true, true],
      ['requireMacClick', true, false],
      ['allowQR', false, false],
      ['allowMacApproval', true, false],
    ]);
  });

  test('the copy says computer, never a platform name', () => {
    const text = JSON.stringify(S.proximityRows({}));
    expect(text).toContain('this computer');
    expect(text).not.toMatch(/\b(Mac|iPhone|Windows|Android)\b/);
  });
});

describe('speech models', () => {
  const model = (state, extra) => Object.assign({ id: 'transcription', title: 'LANA transcription', detail: 'Transcribes meetings.', sizeText: '410 MB', shared: false, state }, extra);
  const status = (state, extra) => ({
    ask: { id: 'ask', title: 'LANA model', state: { kind: 'ready' } },
    listener: { id: 'listener', title: 'LANA listening', state: { kind: 'notDownloaded' } },
    voice: { id: 'voice', title: 'LANA voice', state: { kind: 'notDownloaded' } },
    transcription: model(state, extra),
  });

  test('only transcription shows (Talk is not in the client yet; the model is LANA managed)', () => {
    expect(S.modelRows(status({ kind: 'notDownloaded' })).map((row) => row.id)).toEqual(['transcription']);
  });

  test('not downloaded: Download, with the size', () => {
    expect(S.modelRows(status({ kind: 'notDownloaded' }))[0]).toMatchObject({ badge: 'Not downloaded', color: 'gray', action: 'download', actionLabel: 'Download', note: 'A one-time download of about 410 MB, kept on this computer.' });
  });

  test('downloading: the percent and Cancel', () => {
    expect(S.modelRows(status({ kind: 'downloading', progress: 0.427 }))[0]).toMatchObject({ badge: 'Downloading 43%', color: 'blue', action: 'remove', actionLabel: 'Cancel', progress: 43 });
  });

  test('ready: Remove download, unless the file is shared', () => {
    expect(S.modelRows(status({ kind: 'ready' }))[0]).toMatchObject({ badge: 'Ready', color: 'green', action: 'remove' });
    expect(S.modelRows(status({ kind: 'ready' }, { shared: true }))[0].action).toBeNull();
  });

  test('failed: the reason and Try again', () => {
    expect(S.modelRows(status({ kind: 'failed', message: 'The connection dropped.' }))[0]).toMatchObject({ color: 'red', action: 'download', actionLabel: 'Try again', note: 'The connection dropped.' });
  });

  test('no status, no rows', () => {
    expect(S.modelRows(null)).toEqual([]);
  });
});

describe('badge colors', () => {
  test('host tones map to lex-badge colors', () => {
    expect(['good', 'warning', 'danger', 'neutral'].map(S.badgeColor)).toEqual(['green', 'yellow', 'red', 'gray']);
  });
});
