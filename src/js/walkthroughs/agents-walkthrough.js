/**
 * The Agents walkthrough pages for <lex-walkthrough> (run by LanaAppWalkthrough).
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
        eyebrow: 'Welcome to Agents',
        title: 'Hand off the work ',
        accent: 'you repeat',
        detail: 'An agent is a helper you set up once. Give it a job and it works through the steps for you, then shows you what it made.',
        illustration: '<lex-brand-mark class="lex-pop" animation="orbit" size="180"></lex-brand-mark>',
      },
      {
        id: 'build',
        eyebrow: 'Step 1: Build',
        title: 'Say what you want ',
        accent: 'done',
        detail: 'Pick a starting point, or describe the result in your own words. Then choose what the agent may use. It can only use what you allow.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">New agent</span><span class="app-tour-pill app-tour-pill--muted">Draft</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2">${check}<span class="app-tour-row-label">Its job</span><span class="app-tour-row-value">Prepare a weekly follow-up list</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3">${check}<span class="app-tour-row-label">It may use</span><span class="app-tour-row-value app-tour-chips"><span class="app-tour-chip">Matters</span><span class="app-tour-chip">Tasks</span><span class="app-tour-chip">Documents</span></span></div>
            <div class="app-tour-row app-tour-in app-tour-d4">${check}<span class="app-tour-row-label">It may not</span><span class="app-tour-row-value app-tour-chips"><span class="app-tour-chip app-tour-chip--off">Send email</span></span></div>
          </div>`,
      },
      {
        id: 'run',
        eyebrow: 'Step 2: Run',
        title: 'Give it a ',
        accent: 'task',
        detail: 'Type what you need and start the run. You can watch every step as it happens, or set it to run on a schedule, like every Monday.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-title">Weekly follow-up list</span><span class="app-tour-pill"><span class="app-tour-dot app-tour-dot--live"></span>Working now</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2">${check}<span class="app-tour-row-value">Read 24 open tasks</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3">${check}<span class="app-tour-row-value">Grouped them by matter</span></div>
            <div class="app-tour-row app-tour-in app-tour-d4"><span class="app-tour-check"><span class="app-tour-working"><i></i><i></i><i></i></span></span><span class="app-tour-row-value">Writing the list</span></div>
            <div class="app-tour-progress app-tour-in app-tour-d5"><span></span></div>
          </div>`,
      },
      {
        id: 'review',
        eyebrow: 'Step 3: Review',
        title: 'Nothing applies until ',
        accent: 'you approve',
        detail: 'When an agent needs an answer or an approval, it stops and waits for you. Open Outcomes to see what it made and every step it took.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">Outcome</span><span class="app-tour-pill app-tour-pill--amber">Ready for approval</span></div>
            <span class="app-tour-title app-tour-in app-tour-d2">Weekly follow-up list</span>
            <p class="app-tour-detail app-tour-in app-tour-d2">12 follow-ups across 5 matters, sorted by due date.</p>
            <div class="app-tour-actions app-tour-in app-tour-d3"><span class="app-tour-button app-tour-button--primary">${icon('check')}Approve</span><span class="app-tour-button">Open</span></div>
          </div>`,
      },
      {
        id: 'claude',
        eyebrow: 'Already use Claude?',
        title: 'Bring your agent ',
        accent: 'with you',
        detail: 'Choose Bring one from Claude and pick your CLAUDE.md or JSON file. LANA turns it into an agent you can review before it runs.',
        illustration: `<div class="app-tour-pair">
            <div class="app-tour-end app-tour-in">${icon('file-text')}<span>Your Claude file</span></div>
            <div class="app-tour-in app-tour-d1"><lex-brand-mark animation="sync" size="110"></lex-brand-mark></div>
            <div class="app-tour-end app-tour-in app-tour-d2">${icon('bot')}<span>A LANA agent</span></div>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'Build your ',
        accent: 'first agent',
        detail: 'Start with one small job you do every week. You can come back to this walkthrough any time from the Agents home.',
        illustration: '<lex-brand-mark animation="success" size="170"></lex-brand-mark>',
        actions: [{ id: 'create', label: 'Build an agent', icon: 'plus', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.AgentsWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
