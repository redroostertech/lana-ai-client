/**
 * The Data Connectors walkthrough pages for <lex-walkthrough> (run by
 * LanaAppWalkthrough). Copy and pictures only; no DOM. Each picture is a simplified,
 * animated copy of the real screen (css/app-walkthrough.css).
 */
(function (global) {
  'use strict';

  function pages(icon) {
    return [
      {
        id: 'welcome',
        eyebrow: 'Welcome to Data Connectors',
        title: 'Your systems, ',
        accent: 'working together',
        detail: 'A connector links LANA to a tool your firm already uses, so its data is ready when you need it.',
        illustration: '<lex-brand-mark class="lex-pop" animation="connect" size="180"></lex-brand-mark>',
      },
      {
        id: 'find',
        eyebrow: 'Step 1: Find your tool',
        title: 'Pick it from ',
        accent: 'the list',
        detail: 'Search the list for your practice management, CRM, email or billing tool, then choose Connect.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-search app-tour-in app-tour-d1">${icon('search')}<span>practice</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2"><span class="app-tour-row-value">Practice management</span><span class="app-tour-button app-tour-button--primary">Connect</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3"><span class="app-tour-row-value">Practice billing</span><span class="app-tour-pill">Connected</span></div>
          </div>`,
      },
      {
        id: 'allow',
        eyebrow: 'Step 2: Allow access',
        title: 'Sign in ',
        accent: 'once',
        detail: 'Most tools open their own sign-in page so you can approve access. A few ask for an API key instead.',
        illustration: `<div class="app-tour-pair">
            <div class="app-tour-end app-tour-in">${icon('lock')}<span>Your tool</span></div>
            <div class="app-tour-in app-tour-d1"><lex-brand-mark animation="sync" size="110"></lex-brand-mark></div>
            <div class="app-tour-end app-tour-in app-tour-d2">${icon('check')}<span>Connected</span></div>
          </div>`,
      },
      {
        id: 'status',
        eyebrow: 'Step 3: Check the status',
        title: 'See what is ',
        accent: 'connected',
        detail: 'Each connector says Connected or Not connected. If one says Needs attention, reconnect it. Use Manage accounts to add another login or pick the default one.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">Your connectors</span></div>
            <div class="app-tour-row app-tour-in app-tour-d2"><span class="app-tour-row-value">Practice management</span><span class="app-tour-pill"><span class="app-tour-dot"></span>Connected</span></div>
            <div class="app-tour-row app-tour-in app-tour-d3"><span class="app-tour-row-value">Email</span><span class="app-tour-pill"><span class="app-tour-dot"></span>Connected</span></div>
            <div class="app-tour-row app-tour-in app-tour-d4"><span class="app-tour-row-value">Intake forms</span><span class="app-tour-pill app-tour-pill--muted"><span class="app-tour-dot app-tour-dot--live"></span>Not connected</span></div>
          </div>`,
      },
      {
        id: 'use',
        eyebrow: 'Step 4: Use the data',
        title: 'Ready for ',
        accent: 'every app',
        detail: 'Connected data feeds chat, Insights and Automate. Open a connector to see its own dashboard.',
        illustration: `<div class="app-tour-chain">
            <span class="app-tour-chain-pulse"></span>
            <div class="app-tour-step app-tour-in"><span class="app-tour-eyebrow">From</span><span>Your connected tools</span></div>
            <div class="app-tour-step app-tour-in app-tour-d1"><span class="app-tour-eyebrow">Into</span><span>LANA, kept in sync</span></div>
            <div class="app-tour-step app-tour-in app-tour-d2"><span class="app-tour-eyebrow">Used by</span><span>Chat, Insights, Automate</span></div>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'Connect your ',
        accent: 'first tool',
        detail: 'Start with the system your team uses most. You can open this walkthrough again from the top of this page.',
        illustration: '<lex-brand-mark animation="success" size="170"></lex-brand-mark>',
        actions: [{ id: 'browse', label: 'Browse connectors', icon: 'plug', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.ConnectorsWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
