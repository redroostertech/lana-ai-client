/**
 * makeup-switch-dialog.js
 * The matter header "Makeup" dialog (design 4.1, 7.3, decisions 6 and 7):
 * lists the makeups the organization can assign, offers the opt-in version
 * upgrade, requires a reason and sends PUT /matters/:matter_id/makeup. A
 * 409 MAKEUP_SWITCH_IN_PROGRESS is resent unchanged a few times with a
 * growing wait. A 503 MAKEUP_SWITCH_INCOMPLETE, an answer with
 * effects.status 'incomplete', or a switch still in progress after the
 * resends keeps the dialog open with "Finish setup", which resends the same
 * body (the server finishes the steps).
 *
 * Thin DOM over shared/makeup-switch.js; transport is
 * api/matter-makeup-api.client.js. Styles: css/matter-runnables.css.
 *
 * Public API (window.LanaMakeupSwitchDialog):
 *   - open(deps) -> lex-modal
 *     deps: { client, matterId (code), makeup (view model), onSwitched(), notify(kind, text),
 *             retry?: { delays, wait } (tests shorten the in-progress resends) }
 */

(function (global) {
  'use strict';

  function model() { return global.LanaMakeupSwitch; }

  function notify(deps, kind, message) {
    if (deps.notify) { deps.notify(kind, message); return; }
    var toast = global.Lex && global.Lex.Toast;
    if (toast && toast[kind]) toast[kind](message);
  }

  // Relabels a lex-btn without replacing its rendered button.
  function relabel(node, label) {
    var utils = global.Lex && global.Lex.Utils;
    if (utils && typeof utils.setLexButtonText === 'function') utils.setLexButtonText(node, label);
    else node.textContent = label;
  }

  function open(deps) {
    var Lex = global.Lex;
    var current = model().currentMakeup(deps.makeup);
    var modal = Lex.Modal.open({
      heading: 'Matter makeup',
      size: 'md',
      content: '<div class="makeup-switch">' +
        '<p class="makeup-switch__current" data-makeup-current></p>' +
        '<p class="makeup-switch__explain" data-makeup-explain></p>' +
        '<div class="makeup-switch__upgrade" data-makeup-upgrade hidden>' +
          '<p class="makeup-switch__upgrade-text" data-makeup-upgrade-text></p>' +
          '<lex-btn size="sm" variant="secondary" data-makeup-action="upgrade">Use the newer version</lex-btn>' +
        '</div>' +
        '<lex-select data-makeup-select label="Makeup" placeholder="Loading..." disabled></lex-select>' +
        '<p class="makeup-switch__plan" data-makeup-plan></p>' +
        '<lex-textarea data-makeup-reason label="Reason for the change" required rows="3" placeholder="Kept in the matter history"></lex-textarea>' +
        '</div>' +
        '<lex-btn data-slot="footer" variant="secondary" data-makeup-action="cancel">Cancel</lex-btn>' +
        '<lex-btn data-slot="footer" variant="primary" data-makeup-action="save" disabled>Change makeup</lex-btn>'
    });
    var q = function (selector) { return modal.querySelector(selector); };
    var state = { list: [], plan: { kind: 'none' }, resend: null };

    q('[data-makeup-current]').textContent = current
      ? 'This matter uses ' + current.name + (current.version ? ', version ' + current.version : '') + '.'
      : 'This matter has no makeup yet.';
    q('[data-makeup-explain]').textContent = model().EXPLANATION;
    var offer = model().upgradeOffer(current);
    if (offer) {
      q('[data-makeup-upgrade]').hidden = false;
      q('[data-makeup-upgrade-text]').textContent = offer.text;
    }

    function refreshPlan() {
      if (state.resend) return;
      var select = q('[data-makeup-select]');
      state.plan = model().switchPlan(current, select ? select.value : '', state.list);
      var plan = q('[data-makeup-plan]');
      if (plan) plan.textContent = state.plan.text || '';
      var save = q('[data-makeup-action="save"]');
      if (save) {
        if (state.plan.kind === 'none') save.setAttribute('disabled', '');
        else save.removeAttribute('disabled');
        relabel(save, state.plan.kind === 'upgrade' ? 'Upgrade' : 'Change makeup');
      }
    }

    modal.addEventListener('lex-change', function (event) {
      if (event.target && event.target.hasAttribute && event.target.hasAttribute('data-makeup-select')) refreshPlan();
    });

    modal.addEventListener('click', function (event) {
      var action = event.target.closest && event.target.closest('[data-makeup-action]');
      if (!action || action.hasAttribute('disabled')) return;
      var kind = action.getAttribute('data-makeup-action');
      if (kind === 'cancel') {
        modal.removeAfterClose();
        // A recorded switch shows its new tabs even if its setup is left unfinished.
        if (state.resend && deps.onSwitched) deps.onSwitched();
        return;
      }
      if (kind === 'upgrade') {
        var select = q('[data-makeup-select]');
        if (select && current) { select.value = current.key; refreshPlan(); }
        return;
      }
      if (kind !== 'save') return;
      var body = state.resend;
      if (!body) {
        var reason = q('[data-makeup-reason]');
        var checked = model().switchBody(state.plan, reason ? reason.value : '');
        if (!checked.ok) { notify(deps, 'error', checked.error); return; }
        body = checked.body;
      }
      // Only the same body finishes a recorded switch or waits out another one.
      function offerFinish(message) {
        state.resend = body;
        var select = q('[data-makeup-select]');
        var why = q('[data-makeup-reason]');
        if (select) select.disabled = true;
        if (why) why.disabled = true;
        var plan = q('[data-makeup-plan]');
        if (plan) plan.textContent = message;
        relabel(action, 'Finish setup');
      }
      action.loading = true;
      model().sendSwitch(function (sent) { return deps.client.switchMakeup(deps.matterId, sent); }, body, deps.retry).then(function (response) {
        action.loading = false;
        var result = model().switchResultView(response, state.plan);
        if (result.incomplete) {
          offerFinish(result.text);
          notify(deps, 'warning', result.text);
          return;
        }
        modal.removeAfterClose();
        notify(deps, 'success', result.text);
        if (deps.onSwitched) deps.onSwitched();
      }).catch(function (error) {
        action.loading = false;
        if (model().needsFinish(error)) offerFinish(model().switchErrorMessage(error));
        notify(deps, 'error', model().switchErrorMessage(error));
      });
    });

    deps.client.listMakeups().then(function (response) {
      var select = q('[data-makeup-select]');
      if (!select || !select.isConnected) return;
      state.list = model().makeupList(response);
      select.options = model().makeupOptions(state.list, current);
      select.disabled = state.list.length === 0;
      select.placeholder = state.list.length ? 'Choose a makeup' : 'No makeups available';
      if (current) select.value = current.key;
      refreshPlan();
    }).catch(function () {
      var select = q('[data-makeup-select]');
      if (!select) return;
      select.placeholder = 'Makeups could not be loaded';
    });

    return modal;
  }

  global.LanaMakeupSwitchDialog = { open: open };
})(typeof window !== 'undefined' ? window : globalThis);
