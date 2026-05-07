// src/agents/sidebar-config.js
//
// Shared sidebar configuration for the LanaAgents app shell. Each
// agents page (catalog, detail, run, activity) calls
// `getAgentsAppSections({ activeId })` after `<lex-app>` is ready and
// passes the result to `els.shell.setSections(sections)`. This keeps
// the sidebar nav consistent across all pages within the agents app.
//
// Icon choices: 'bot' and 'workflow' are both registered in
// `src/js/lex/lex.icons.js` (see lex-app.js around lines 740/743 for
// the prior dynamic-menu usage that established this convention).

(function (global) {
  'use strict';

  const SIDEBAR_NAV_ITEMS = [
    { id: 'catalog',  label: 'Catalog',  icon: 'bot',      href: 'index.html' },
    { id: 'activity', label: 'Activity', icon: 'workflow', href: 'agentic-tasks.html' }
  ];

  function getAgentsAppSections(/* { activeId } */) {
    return [
      {
        id: 'navigation',
        items: SIDEBAR_NAV_ITEMS.slice()
      }
    ];
  }

  global.LanaAgentsApp = global.LanaAgentsApp || {};
  global.LanaAgentsApp.getAgentsAppSections = getAgentsAppSections;
  global.LanaAgentsApp.SIDEBAR_NAV_ITEMS = SIDEBAR_NAV_ITEMS.slice();
})(typeof window !== 'undefined' ? window : globalThis);
