'use strict';

// Real Lex button, decision block and chat interaction rendering. The shell,
// model and API are absent; send records only the bound approval reply.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><main id="thread"></main></body></html>');
    await page.addStyleTag({ path: path.join(root, 'src/css/lex-tokens.css') });
    await page.addStyleTag({ content: 'body { margin: 16px; font-family: sans-serif; } main { max-width: 650px; margin: auto; }' });
    for (const file of ['time-utils.js', 'lex/lex.core.js', 'lex/lex.icons.js', 'lex/lex.utils.js',
      'lex/components/foundation/lex-btn.js', 'lex/lex.ai.js', 'lex/blocks/decision.block.js', 'lex/chat/lex-chat.js']) {
      await page.addScriptTag({ path: path.join(root, 'src/js', file) });
    }
    await page.evaluate(() => {
      const prototype = Lex.Chat.LexChat.prototype;
      const chat = { _buildDOM() {}, _bindChildEvents() {}, _initSource() {} };
      prototype.connected.call(chat); // installs the actual component stylesheet
      chat._threadEl = { _container: document.querySelector('#thread'), scrollToBottom() {} };
      chat.conversationId = 'fixture-conversation';
      chat._runtimeApprovalDetails = prototype._runtimeApprovalDetails;
      chat.send = async (label, reply) => { window.sent = { label, reply }; return true; };
      window.exactArgs = { action: 'update', task_id: 'task-exact', fields: {
        title: 'Review intake', description: 'Full note line.\n'.repeat(300) + 'LAST VALUE',
        unknown_field: '<img src=x onerror="window.injected=true">', recipients: ['first', { id: 'recipient-2' }] } };
      window.before = JSON.stringify(window.exactArgs);
      prototype._insertRuntimeInteraction.call(chat, { id: 'approval-exact', task_id: 'run-exact', kind: 'approval', status: 'pending',
        prompt: 'LANA wants to update a task.\n\nTask id: task-exact\nSome details are shortened. Review the full change before approving.',
        approval: { action: { arguments: { ...window.exactArgs, credential: 'PRIVATE_SECRET' }, arguments_sha256: 'unchanged-binding' },
          review: { schema_version: 'lana.approval-review.v1', arguments: { ...window.exactArgs, credential: '[hidden]' } } } });
    });
    const toggle = page.getByRole('button', { name: 'Review full change', exact: true });
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await page.getByRole('button', { name: 'Hide full change', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.lex-chat-approval-values').evaluate(node => node.textContent.includes('LAST VALUE')), true);
    assert.equal(await page.locator('.lex-chat-approval-values img').count(), 0);
    assert.equal(await page.locator('.lex-chat-approval-values').evaluate(node => node.textContent.includes('PRIVATE_SECRET')), false);
    assert.equal(await page.locator('.lex-chat-approval-values').evaluate(node => node.textContent.includes('[hidden]')), true);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(await page.evaluate(() => JSON.stringify(window.exactArgs) === window.before), true);
    for (const [name, width] of [['wide', 1000], ['narrow', 390]]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: '/tmp/lana-runtime-approval-' + name + '.png', fullPage: true });
    }
    await page.getByRole('button', { name: 'Hide full change', exact: true }).click();
    await page.getByRole('button', { name: 'Review full change', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.lex-chat-approval-values').isVisible(), true);
    await page.getByRole('region', { name: 'Full change details' }).focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.lex-chat-approval-values').scrollTop > 0);
    await page.locator('.lex-dec-card').first().click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.sent), { label: 'Approve', reply: {
      runtimeTaskId: 'run-exact', runtimeReply: { interaction_id: 'approval-exact', value: { decision: 'approve' } } } });
    assert.equal(await page.evaluate(() => JSON.stringify(window.exactArgs) === window.before), true);
    assert.deepEqual(errors, []);
    console.log('PASS: actual Lex full review, safe complete values, narrow/wide, keyboard, exact bound reply.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
