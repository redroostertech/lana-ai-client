/**
 * The Automate walkthrough pages for <lex-walkthrough> (run by LanaAppWalkthrough).
 * Copy and pictures only; no DOM. Each picture is a simplified, animated copy of the
 * real screen (css/app-walkthrough.css). Illustrations are trusted markup built here.
 */
(function (global) {
  'use strict';

  function pages(icon) {
    return [
      {
        id: 'welcome',
        eyebrow: 'Welcome to Automate',
        title: 'Work that ',
        accent: 'runs itself',
        detail: 'An automation waits for something to happen, then does the next steps for you. The same way, every time.',
        illustration: '<lex-brand-mark class="lex-pop" animation="flow" size="180"></lex-brand-mark>',
      },
      {
        id: 'trigger',
        eyebrow: 'Step 1: Pick a trigger',
        title: 'Choose what ',
        accent: 'starts it',
        detail: 'A trigger is the moment the automation begins: a document is uploaded, a connector finishes syncing, or a set time each day or week.',
        illustration: `<div class="app-tour-choices">
            <div class="app-tour-choice app-tour-choice--picked app-tour-in">${icon('file-plus')}A document is uploaded</div>
            <div class="app-tour-choice app-tour-in app-tour-d1">${icon('refresh-cw')}A connector syncs</div>
            <div class="app-tour-choice app-tour-in app-tour-d2">${icon('clock')}Every day</div>
            <div class="app-tour-choice app-tour-in app-tour-d3">${icon('calendar')}Every week</div>
          </div>`,
      },
      {
        id: 'steps',
        eyebrow: 'Step 2: Say what happens',
        title: 'Then LANA does ',
        accent: 'the steps',
        detail: 'Add what should happen next and where it applies: one matter, or the whole firm. Start from a template and most of this is filled in for you.',
        illustration: `<div class="app-tour-chain">
            <span class="app-tour-chain-pulse"></span>
            <div class="app-tour-step app-tour-in"><span class="app-tour-eyebrow">When</span><span>A document is uploaded</span></div>
            <div class="app-tour-step app-tour-in app-tour-d1"><span class="app-tour-eyebrow">Then</span><span>Log it on the matter</span></div>
            <div class="app-tour-step app-tour-in app-tour-d2"><span class="app-tour-eyebrow">Where</span><span>Every matter</span></div>
          </div>`,
      },
      {
        id: 'connectors',
        eyebrow: 'Step 3: Check your tools',
        title: 'Make sure the data ',
        accent: 'is ready',
        detail: 'Automations read from your connectors. Open Data Connectors from the account menu to see which tools are connected before you turn one on.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">Connectors</span><span class="app-tour-pill">2 ready</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2"><span class="app-tour-row-value">Practice management</span><span class="app-tour-pill"><span class="app-tour-dot"></span>Ready</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3"><span class="app-tour-row-value">Email</span><span class="app-tour-pill"><span class="app-tour-dot"></span>Ready</span></div>
            <div class="app-tour-row app-tour-in app-tour-d4"><span class="app-tour-row-value">Intake forms</span><span class="app-tour-pill app-tour-pill--amber"><span class="app-tour-dot app-tour-dot--live"></span>Needs setup</span></div>
          </div>`,
      },
      {
        id: 'runs',
        eyebrow: 'Step 4: Watch it work',
        title: 'Every run is ',
        accent: 'on the record',
        detail: 'Run History lists each run and what it did. Anything that would send or create something outside LANA waits in Approvals until you say yes.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">Run history</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2"><span class="app-tour-row-value">Document Intake Audit</span><span class="app-tour-pill">Succeeded</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3"><span class="app-tour-row-value">Overdue Invoice Reminder</span><span class="app-tour-pill app-tour-pill--amber">Waiting for approval</span></div>
            <div class="app-tour-row app-tour-in app-tour-d4"><span class="app-tour-row-value">Weekly Status Draft</span><span class="app-tour-pill"><span class="app-tour-dot app-tour-dot--live"></span>Running</span></div>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'Start with ',
        accent: 'a template',
        detail: 'Templates fill in the trigger and steps for you, so you only check the details. You can open this walkthrough again from the Library.',
        illustration: '<lex-brand-mark animation="success" size="170"></lex-brand-mark>',
        actions: [{ id: 'create', label: 'New automation', icon: 'plus', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.AutomateWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
