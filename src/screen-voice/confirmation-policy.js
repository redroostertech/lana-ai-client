'use strict';

function actionRequiresConfirmation(action, context = {}, settings = {}) {
  if (!action) return true;
  if (settings.confirmationPolicy === 'always') return action.type !== 'copy';
  if (action.requiresConfirmation) return true;
  if (context.focusedElement?.isPassword) return true;
  if (action.type === 'open_url' || action.type === 'navigate_client') return true;
  if (action.type === 'insert_table') return true;
  if (action.type === 'replace_selection') return !context.selectedText;
  if (action.type === 'insert_text') return settings.confirmationPolicy !== 'never_safe_only';
  return false;
}

function decisionRequiresConfirmation(decision, context, settings) {
  return Boolean(decision?.proposedActions?.some((action) => actionRequiresConfirmation(action, context, settings)));
}

module.exports = { actionRequiresConfirmation, decisionRequiresConfirmation };
