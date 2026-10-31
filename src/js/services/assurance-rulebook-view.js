/* Rulebook presentation helpers. The application service owns rule content, verification and adoption. */
(function (global) {
  'use strict';
  var jurisdictions = [
    { value: 'US-AL', label: 'Alabama' }, { value: 'US-FL', label: 'Florida' },
    { value: 'US-GA', label: 'Georgia' }, { value: 'US-IN', label: 'Indiana' }
  ];
  var verificationBadges = {
    O: { label: 'Official source', color: 'green', reviewFlag: false },
    'O-2025': { label: 'Official source (2025 text)', color: 'green', reviewFlag: false },
    S: { label: 'Secondary source: review flag', color: 'yellow', reviewFlag: true },
    C: { label: 'Cited, not re-checked: review flag', color: 'yellow', reviewFlag: true },
    U: { label: 'Unverified: review flag', color: 'red', reviewFlag: true }
  };
  var severityBadges = { blocking: { label: 'Blocking', color: 'red' }, warning: { label: 'Warning', color: 'yellow' }, info: { label: 'Information', color: 'blue' } };
  var kindLabels = { LAW: 'Law', PRACTICE: 'Firm practice' };
  var reviewFlagNotice = 'Rules marked Unverified (U) or Secondary (S, C) are review flags for a professional to check against the cited source. They are not legal conclusions.';

  function isJurisdiction(code) { return jurisdictions.some(function (entry) { return entry.value === code; }); }
  function jurisdictionLabel(code) { var entry = jurisdictions.find(function (item) { return item.value === code; }); return entry ? entry.label + ' (' + entry.value + ')' : String(code || 'Unknown jurisdiction'); }
  function verificationBadge(code) {
    var badge = verificationBadges[code];
    return badge ? { code: code, label: badge.label, color: badge.color, reviewFlag: badge.reviewFlag } : { code: code || '', label: 'Verification not reported: review flag', color: 'red', reviewFlag: true };
  }
  function severityBadge(severity) { return severityBadges[severity] || { label: 'Severity not reported', color: 'gray' }; }
  function kindLabel(kind) { return kindLabels[kind] || 'Kind not reported'; }
  function ruleTitle(rule) { return rule ? rule.title || rule.label || rule.predicate || '' : ''; }
  function ruleLabel(rule) { if (!rule) return ''; var title = ruleTitle(rule); return rule.id && rule.id !== title ? rule.id + ' · ' + title : title; }

  /** Starter responses use the assurance envelope; accept the bare document as well. */
  function unwrapStarter(response, jurisdiction) {
    var starter = response && response.record && Array.isArray(response.record.rules) ? response.record : response;
    if (!starter || !Array.isArray(starter.rules) || !Array.isArray(starter.modules || [])) throw new Error('The server did not return a starter rulebook.');
    if (jurisdiction && starter.jurisdiction !== jurisdiction) throw new Error('The server returned a starter rulebook for a different jurisdiction.');
    return starter;
  }

  /** Groups in the server's module order; rules for modules not listed stay visible in a trailing group. */
  function groupRules(rulebook) {
    var modules = (rulebook && rulebook.modules) || [];
    var rules = (rulebook && rulebook.rules) || [];
    var groups = modules.map(function (module) { return { module: module, rules: [] }; });
    var other = { module: { id: '', title: 'Other rules' }, rules: [] };
    rules.forEach(function (rule) {
      var group = groups.find(function (entry) { return entry.module.id === rule.module; });
      (group || other).rules.push(rule);
    });
    return groups.concat(other.rules.length ? [other] : []).filter(function (group) { return group.rules.length; });
  }
  function reviewFlagCount(rulebook) { return ((rulebook && rulebook.rules) || []).filter(function (rule) { return verificationBadge(rule.verification).reviewFlag; }).length; }
  function summary(rulebook) {
    if (!rulebook) return '';
    var rules = rulebook.rules || [];
    var groups = groupRules(rulebook).length;
    return rules.length + ' rule' + (rules.length === 1 ? '' : 's') + ' in ' + groups + ' module' + (groups === 1 ? '' : 's') + ' · ' + reviewFlagCount(rulebook) + ' review flag' + (reviewFlagCount(rulebook) === 1 ? '' : 's');
  }

  /** Display mode only; Core enforces estate-assurance:rulebook-publish on adoption. */
  function viewMode(adopted, actions) {
    if (adopted) return 'adopted';
    return actions && actions.publishRulebook === true ? 'adopt' : 'preview';
  }
  function accessExplanation(mode) {
    if (mode === 'adopted') return 'The firm has adopted this rulebook. Targets reference its rules.';
    if (mode === 'adopt') return 'No firm rulebook is adopted. Preview the starter rulebook for a jurisdiction, review its flags, and adopt it with your rationale.';
    return 'No firm rulebook is adopted. You can preview the starter rulebook, but adopting it requires the rulebook publishing permission. Ask a firm administrator who holds it.';
  }

  function adoptState(input) {
    if (input.mode !== 'adopt') return { enabled: false, reason: accessExplanation(input.mode) };
    if (input.pending) return { enabled: false, reason: 'Recover the pending change before adopting a rulebook.' };
    if (input.busy) return { enabled: false, reason: 'A request is already in progress.' };
    if (!input.canPersist) return { enabled: false, reason: 'Scoped recovery is unavailable. Adoption is read-only.' };
    if (!isJurisdiction(input.jurisdiction)) return { enabled: false, reason: 'Choose a jurisdiction to preview.' };
    if (!input.starter || input.starter.jurisdiction !== input.jurisdiction) return { enabled: false, reason: 'Preview the starter rulebook for this jurisdiction before adopting it.' };
    return { enabled: true, reason: '' };
  }
  /** Builds the exact adopt body. The request id is added by the shared command mailbox. */
  function adoptCommand(input) {
    if (input.adopted) throw new Error('The firm already has an adopted rulebook.');
    if (!isJurisdiction(input.jurisdiction)) throw new Error('Choose a jurisdiction to preview.');
    if (!input.starter || input.starter.jurisdiction !== input.jurisdiction) throw new Error('Preview the starter rulebook for this jurisdiction before adopting it.');
    var rationale = String(input.rationale || '').trim();
    if (!rationale) throw new Error('Explain the basis for adopting this rulebook.');
    return { jurisdiction: input.jurisdiction, expectedVersion: 0, rationale: rationale };
  }
  function adoptErrorMessage(error) {
    if (error && error.status === 409) return 'The firm rulebook changed since this page loaded. Refresh and review the current rulebook before adopting.';
    if (error && error.status === 403) return 'Adopting a firm rulebook requires the rulebook publishing permission.';
    return null;
  }

  function ruleForTarget(rulebooks, target) {
    var ref = target && target.rulebook_ref;
    var rulebook = ref && (rulebooks || []).find(function (entry) { return entry.id === ref.id; });
    if (!rulebook) return null;
    var ruleId = target.rule_id || (target.rule_ref && target.rule_ref.id);
    return (rulebook.rules || []).find(function (rule) { return ruleId ? rule.id === ruleId : rule.predicate === target.predicate; }) || null;
  }
  function citationUrl(url) {
    try { var parsed = new URL(String(url || '')); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null; } catch (error) { return null; }
  }

  function openExternal(url) {
    if (global.electronAPI && typeof global.electronAPI.openExternal === 'function') global.electronAPI.openExternal(url);
    else global.open(url, '_blank', 'noopener,noreferrer');
  }
  function badge(label, color) { var element = document.createElement('lex-badge'); element.label = label; element.color = color; element.size = 'sm'; return element; }
  function text(tag, value, className) { var element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element; }
  /** Read-only DOM for a rulebook; every value is rendered as text. */
  function renderRules(host, rulebook) {
    host.replaceChildren();
    var groups = groupRules(rulebook);
    if (!groups.length) { host.appendChild(text('p', 'This rulebook has no rules to show.', 'assurance-muted')); return; }
    groups.forEach(function (group) {
      var section = document.createElement('section'); section.className = 'assurance-rulebook-module';
      section.appendChild(text('h3', group.module.title || group.module.id, 'assurance-rulebook-heading'));
      if (group.module.version || group.module.status) section.appendChild(text('p', [group.module.version && 'Version ' + group.module.version, group.module.status].filter(Boolean).join(' · '), 'assurance-muted'));
      group.rules.forEach(function (rule) {
        var row = document.createElement('article'); row.className = 'assurance-record';
        row.appendChild(text('strong', ruleLabel(rule)));
        var badges = document.createElement('div'); badges.className = 'assurance-rulebook-badges';
        var verification = verificationBadge(rule.verification);
        var severity = severityBadge(rule.severity);
        badges.append(badge(kindLabel(rule.kind), 'indigo'), badge(verification.label + (verification.code ? ' (' + verification.code + ')' : ''), verification.color), badge(severity.label, severity.color));
        row.appendChild(badges);
        if (rule.summary) row.appendChild(text('p', rule.summary));
        if (rule.firm_override) row.appendChild(text('p', 'Firm override: ' + (typeof rule.firm_override === 'string' ? rule.firm_override : 'recorded'), 'assurance-muted'));
        (rule.citations || []).forEach(function (citation) {
          var url = citationUrl(citation.url);
          var cite = citation.cite + (citation.verification ? ' (' + verificationBadge(citation.verification).label + ')' : '');
          if (!url) { row.appendChild(text('p', cite, 'assurance-references')); return; }
          var link = text('a', cite, 'assurance-source-link'); link.href = url; link.rel = 'noopener noreferrer';
          link.addEventListener('click', function (event) { event.preventDefault(); openExternal(url); });
          row.appendChild(link);
        });
        section.appendChild(row);
      });
      host.appendChild(section);
    });
  }

  var exported = {
    jurisdictions: jurisdictions, reviewFlagNotice: reviewFlagNotice, isJurisdiction: isJurisdiction, jurisdictionLabel: jurisdictionLabel,
    verificationBadge: verificationBadge, severityBadge: severityBadge, kindLabel: kindLabel, ruleTitle: ruleTitle, ruleLabel: ruleLabel,
    unwrapStarter: unwrapStarter, groupRules: groupRules, reviewFlagCount: reviewFlagCount, summary: summary, viewMode: viewMode,
    accessExplanation: accessExplanation, adoptState: adoptState, adoptCommand: adoptCommand, adoptErrorMessage: adoptErrorMessage,
    ruleForTarget: ruleForTarget, citationUrl: citationUrl, renderRules: renderRules
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else global.AssuranceRulebookView = exported;
})(typeof window !== 'undefined' ? window : globalThis);
