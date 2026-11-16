/**
 * agents-dashboard-model.js
 * Pure view model for the Agents home, ranked the way LANA Orcestr8's
 * Control Center ranks its home: what needs the person (approvals,
 * questions, runs that stopped), then what is working now, then recent
 * outcomes. The server (GET /api/v1/agent-runs/dashboard) decides what is in
 * each list and in what order; this module only words and filters it.
 *
 * Classic script (window.AgentsDashboardModel) so Jest can require it.
 */
(function (global) {
  'use strict';

  var NEEDS_TABS = [
    { value: 'all', label: 'All' },
    { value: 'approval', label: 'Approvals' },
    { value: 'question', label: 'Questions' },
    { value: 'stopped', label: 'Stopped' }
  ];

  function humanize(value) {
    var text = String(value || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  function agentOf(item) {
    return (item && item.agent_name) || '';
  }

  function needsTabCounts(items) {
    var counts = { all: 0, approval: 0, question: 0, stopped: 0 };
    (items || []).forEach(function (item) {
      counts.all += 1;
      if (Object.prototype.hasOwnProperty.call(counts, item.attention)) counts[item.attention] += 1;
    });
    return counts;
  }

  function filterNeeds(items, tab) {
    var list = items || [];
    if (!tab || tab === 'all' || !NEEDS_TABS.some(function (entry) { return entry.value === tab; })) return list.slice();
    return list.filter(function (item) { return item.attention === tab; });
  }

  function needSentence(item) {
    var agent = agentOf(item);
    var who = agent || 'An agent';
    if (item.attention === 'approval') return who + ' has work ready for your approval';
    if (item.attention === 'question') return who + ' has a question for you';
    if (item.attention === 'stopped') return who + ' stopped before finishing';
    return who + ' needs you';
  }

  function workingLine(item) {
    var queued = item.status === 'queued';
    return {
      who: agentOf(item) || 'An agent',
      what: item.title || 'a task',
      step: humanize(item.activity) || (queued ? 'Waiting to start' : 'Getting started')
    };
  }

  function countLabel(count, capped) {
    var value = Number(count) || 0;
    return String(value) + (capped ? '+' : '');
  }

  var moduleApi = {
    NEEDS_TABS: NEEDS_TABS,
    needsTabCounts: needsTabCounts,
    filterNeeds: filterNeeds,
    needSentence: needSentence,
    workingLine: workingLine,
    countLabel: countLabel
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AgentsDashboardModel = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
