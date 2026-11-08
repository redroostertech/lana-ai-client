/**
 * The Insights walkthrough pages for <lex-walkthrough> (run by LanaAppWalkthrough).
 * Copy and pictures only; no DOM. Each picture is a simplified, animated copy of the
 * real screen (css/app-walkthrough.css). Illustrations are trusted markup built here.
 */
(function (global) {
  'use strict';

  function pages(icon) {
    return [
      {
        id: 'welcome',
        eyebrow: 'Welcome to Insights',
        title: "Your firm's numbers, ",
        accent: 'in one place',
        detail: 'Insights turns the data in your connected systems into dashboards you can read at a glance.',
        illustration: '<lex-brand-mark class="lex-pop" animation="chart" size="180"></lex-brand-mark>',
      },
      {
        id: 'connect',
        eyebrow: 'Step 1: Connect your data',
        title: 'It starts with ',
        accent: 'your systems',
        detail: 'Insights reads from the tools your firm already uses, like intake, billing and practice management. Connect each one once, in Connectors.',
        illustration: `<div class="app-tour-pair">
            <div class="app-tour-sources">
              <div class="app-tour-source app-tour-in">${icon('inbox')}Intake</div>
              <div class="app-tour-source app-tour-in app-tour-d1">${icon('briefcase')}Practice management</div>
              <div class="app-tour-source app-tour-in app-tour-d2">${icon('layers')}Billing</div>
            </div>
            <div class="app-tour-stream app-tour-in app-tour-d3"></div>
            <div class="app-tour-in app-tour-d3"><lex-brand-mark animation="chart" size="110"></lex-brand-mark></div>
          </div>`,
      },
      {
        id: 'dashboards',
        eyebrow: 'Step 2: Open a dashboard',
        title: 'Start with ',
        accent: 'the ready ones',
        detail: 'Ready-made dashboards cover owner performance, departments and attorneys. The ones you open most show up first.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-title">Owner Performance</span><span class="app-tour-pill app-tour-pill--muted">This month</span></div>
            <div class="app-tour-kpis app-tour-in app-tour-d2">
              <div class="app-tour-kpi"><span>New matters</span><strong>18</strong></div>
              <div class="app-tour-kpi"><span>Consultations</span><strong>42</strong></div>
              <div class="app-tour-kpi"><span>Collected</span><strong>$86k</strong></div>
            </div>
            <div class="app-tour-bars app-tour-in app-tour-d3"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          </div>`,
      },
      {
        id: 'build',
        eyebrow: 'Step 3: Build your own',
        title: 'Pick the numbers ',
        accent: 'you care about',
        detail: 'Use Create dashboard to choose the measures that matter to you and lay them out your way.',
        illustration: `<div class="app-tour-card app-tour-in">
            <div class="app-tour-card-head"><span class="app-tour-eyebrow">New dashboard</span></div>
            <div class="app-tour-grid">
              <div class="app-tour-tile app-tour-tile--wide app-tour-in app-tour-d2">Revenue by month</div>
              <div class="app-tour-tile app-tour-in app-tour-d3">Win rate</div>
              <div class="app-tour-tile app-tour-in app-tour-d4">Open matters</div>
              <div class="app-tour-slot app-tour-in app-tour-d4"></div>
              <div class="app-tour-slot app-tour-in app-tour-d5"></div>
            </div>
          </div>`,
      },
      {
        id: 'ask',
        eyebrow: 'Have a question?',
        title: 'Ask LANA ',
        accent: 'about the numbers',
        detail: 'Use Ask LANA about the numbers to get a plain-language answer about what you are looking at.',
        illustration: `<div class="app-tour-chat">
            <div class="app-tour-bubble app-tour-bubble--you app-tour-in">Why are consultations down this month?</div>
            <div class="app-tour-bubble app-tour-bubble--lana app-tour-bubble--typing app-tour-in app-tour-d2"><span class="app-tour-working"><i></i><i></i><i></i></span></div>
            <div class="app-tour-actions app-tour-in app-tour-d3"><span class="app-tour-button app-tour-button--lana">${icon('sparkles')}Ask LANA about the numbers</span></div>
          </div>`,
      },
      {
        id: 'ready',
        eyebrow: 'All set',
        title: 'Open your ',
        accent: 'first dashboard',
        detail: 'Start with one of the dashboards below, or build your own. You can open this walkthrough again from the Insights home.',
        illustration: '<lex-brand-mark animation="success" size="170"></lex-brand-mark>',
        actions: [{ id: 'create', label: 'Create dashboard', icon: 'plus', variant: 'primary' }],
      },
    ];
  }

  const api = { pages };
  global.InsightsWalkthrough = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
