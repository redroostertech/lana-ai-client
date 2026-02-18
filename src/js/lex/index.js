/* ==========================================================================
   Lex UI — Index
   Barrel file that ensures core is loaded and exposes the Lex namespace.
   Include this after lex.core.js for a single entry point.
   ========================================================================== */

(function (global) {
  'use strict';

  if (!global.Lex || !global.Lex.LexElement) {
    console.error('[Lex] lex.core.js must be loaded before index.js');
    return;
  }

  // Re-export for convenience — everything is already on window.Lex
  // This file serves as a verification that the core loaded correctly.
  const parts = ['core'];
  if (global.Lex.Icons) parts.push('icons (' + global.Lex.Icons.count + ')');
  if (global.Lex.LexDataSource) parts.push('data');
  if (global.Lex.LexDataPipeline) parts.push('pipeline');
  if (global.Lex.SchemaRegistry) parts.push('ai');
  if (global.Lex.TokenBudget) parts.push('budget');
  if (global.Lex.Orchestrator) parts.push('orchestrator');
  if (global.Lex.ActionBridge) parts.push('bridge');
  if (global.Lex.ActivityContext) parts.push('context');
  console.log('[Lex UI] v' + global.Lex.version + ' — ' + parts.join(', '));

})(typeof window !== 'undefined' ? window : globalThis);
