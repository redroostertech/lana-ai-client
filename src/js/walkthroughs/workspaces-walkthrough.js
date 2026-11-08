/**
 * The Workspaces walkthrough pages for <lex-walkthrough> (run by LanaAppWalkthrough).
 * Copy and pictures only; no DOM. Each picture is a simplified, animated copy of the
 * real screen (css/app-walkthrough.css). Illustrations are trusted markup built here.
 */
(function (global) {
  'use strict';

  function pages(icon) {
    const check = `<span class="app-tour-check">${icon('check')}</span>`;
    return [
      {
        id: 'welcome',
        eyebrow: 'Welcome to Workspaces',
        title: 'Every matter, ',
        accent: 'in one place',
        detail: 'Each client matter gets its own workspace, with its notes, documents, tasks and conversations together.',
        illustration: '<lex-brand-mark class="lex-pop" animation="grid" size="180"></lex-brand-mark>',
      },
      {
        id: 'open',
        eyebrow: 'Step 1: Open a workspace',
        title: 'Start from ',
        accent: 'the matter',
        detail: 'Open Workspaces and Matters and pick a matter. Its Summary shows where things stand and what needs attention.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">Workspaces and Matters</span></div>
            <div class="app-tour-row app-tour-in app-tour-d1"><span class="app-tour-row-value">Estate planning intake: Jordan Ellis</span><span class="app-tour-pill">Active</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2 app-tour-row--picked"><span class="app-tour-row-value">Fairweather Revocable Trust funding</span><span class="app-tour-pill">Active</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3"><span class="app-tour-row-value">Morgan guardianship petition</span><span class="app-tour-pill app-tour-pill--muted">On hold</span></div>
          </div>`,
      },
      {
        id: 'board',
        eyebrow: 'Step 2: Work the Board',
        title: 'Move the work ',
        accent: 'forward',
        detail: 'Tasks sit on the Board by status. Drag a card to move it, and split a big task into subtasks so nothing gets lost.',
        illustration: `<div class="app-tour-board app-tour-in">
            <div class="app-tour-column"><span class="app-tour-eyebrow">Pending</span><div class="app-tour-mini-card app-tour-mini-card--moving"><span>Review benefit statement</span><i>M17-3</i></div><div class="app-tour-mini-card"><span>Call the bank</span><i>M17-8</i></div></div>
            <div class="app-tour-column"><span class="app-tour-eyebrow">In progress</span><div class="app-tour-mini-card"><span>Draft trust schedule</span><i>M17-2</i></div></div>
            <div class="app-tour-column"><span class="app-tour-eyebrow">Complete</span><div class="app-tour-mini-card app-tour-mini-card--done"><span>Collect IDs</span><i>M17-1</i></div></div>
          </div>`,
      },
      {
        id: 'suggestions',
        eyebrow: 'Let LANA help',
        title: 'Suggestions, ',
        accent: 'never surprises',
        detail: 'Generate suggestions breaks a task into subtasks while you keep working. You choose which ones to add.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-title">Review benefit statement</span><span class="app-tour-button app-tour-button--lana">${icon('sparkles')}Generate suggestions</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2">${check}<span class="app-tour-row-value">Verify the statement against the contract</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3">${check}<span class="app-tour-row-value">Identify anything missing</span></div>
            <div class="app-tour-row app-tour-in app-tour-d4"><span class="app-tour-check"><span class="app-tour-working"><i></i><i></i><i></i></span></span><span class="app-tour-row-value">Confirm with the client</span></div>
          </div>`,
      },
      {
        id: 'ask',
        eyebrow: 'Ask about the matter',
        title: 'LANA knows ',
        accent: 'the file',
        detail: 'Ask LANA from a workspace, a card or a task. It answers from that matter, not from other clients.',
        illustration: `<div class="app-tour-chat">
            <div class="app-tour-bubble app-tour-bubble--you app-tour-in">What is still open on the Fairweather trust?</div>
            <div class="app-tour-bubble app-tour-bubble--lana app-tour-bubble--typing app-tour-in app-tour-d2"><span class="app-tour-working"><i></i><i></i><i></i></span></div>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'Open your ',
        accent: 'first workspace',
        detail: 'Pick the matter you are working on today. You can open this walkthrough again from the Workspaces home.',
        illustration: '<lex-brand-mark animation="success" size="170"></lex-brand-mark>',
        actions: [{ id: 'open', label: 'Open workspaces', icon: 'folder', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.WorkspacesWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
