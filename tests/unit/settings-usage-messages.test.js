'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'js', 'pages', 'settings-usage.js'), 'utf8');

// Runs settings-usage.js against the Usage card markup with a stubbed api.
async function renderUsage(productivity) {
  const ids = ['sv2-estimated-tokens', 'sv2-token-breakdown', 'sv2-message-count', 'sv2-message-detail',
    'sv2-conversation-count', 'sv2-conversation-detail', 'sv2-upload-count', 'sv2-upload-detail', 'sv2-usage-status'];
  const dom = new JSDOM(`<section id="sv2-section-usage">${ids.map((id) => `<span id="${id}"></span>`).join('')}</section>`,
    { runScripts: 'outside-only' });
  dom.window.api = {
    getMyProductivity: async () => ({ productivity }),
    getMyConversationUsageSummary: async () => ({ pagination: { total: 3 } }),
    getStorageUsage: async () => ({})
  };
  dom.window.eval(SCRIPT);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const text = (id) => dom.window.document.getElementById(id).textContent;
  return { count: text('sv2-message-count'), detail: text('sv2-message-detail') };
}

describe('Settings > Usage messages card', () => {
  test('shows sent and received when the server splits messages', async () => {
    const shown = await renderUsage({ period: '30days', messages_sent: 1200, messages_received: 1150, total_messages_sent: 0 });
    expect(shown.count).toBe('2,350');
    expect(shown.detail).toBe('1,200 sent · 1,150 received');
  });

  test('falls back to the single count from servers that do not split', async () => {
    const shown = await renderUsage({ period: '30days', total_messages_sent: 42 });
    expect(shown.count).toBe('42');
    expect(shown.detail).toBe('In selected period');
  });
});
