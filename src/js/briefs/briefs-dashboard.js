/**
 * LANA Briefs Dashboard: what the dashboard shows, from the meetings list (meetings.list) and
 * the proposed actions (inbox.list). Plain functions; no DOM. The page
 * (src/briefs/dashboard.js) renders with them; tests/unit/briefs/briefs-dashboard.test.js covers it.
 */
(function (global) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  /** Actions still waiting for the person: not run yet. */
  const WAITING = ['failed', 'needsChoice', 'ready'];
  const ACTION_STATUS = { failed: 'Did not run', needsChoice: 'Needs a choice', ready: 'Ready to confirm' };
  const ACTION_KIND = { note: 'Note', task: 'Task', email: 'Email draft', unsupported: 'Action' };

  function time(iso) {
    const value = iso ? Date.parse(iso) : Number.NaN;
    return Number.isNaN(value) ? null : value;
  }

  function waiting(actions) {
    return (Array.isArray(actions) ? actions : []).filter((action) => WAITING.includes(action.status));
  }

  /**
   * The four numbers under the banner, over the last seven days (meetings, minutes
   * recorded) and right now (actions waiting, meetings with open items).
   */
  function weekStats(meetings, actions, now) {
    const list = Array.isArray(meetings) ? meetings : [];
    const since = (now == null ? Date.now() : now) - WEEK_MS;
    const week = list.filter((meeting) => {
      const at = time(meeting.startedAt);
      return at !== null && at >= since;
    });
    const seconds = week.reduce((sum, meeting) => sum + (Number(meeting.durationSeconds) || 0), 0);
    return {
      meetings: week.length,
      minutes: Math.round(seconds / 60),
      waiting: waiting(actions).length,
      openItems: list.filter((meeting) => (Number(meeting.openIntents) || 0) > 0).length,
    };
  }

  /** "45 min" or "3.5 hr": time recorded, for the metric. */
  function recordedText(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) return `${total} min`;
    const hours = Math.round((total / 60) * 10) / 10;
    return `${hours} hr`;
  }

  /** Newest first, at most `limit`. */
  function recentMeetings(meetings, limit) {
    return (Array.isArray(meetings) ? meetings.slice() : [])
      .sort((a, b) => (time(b.startedAt) || 0) - (time(a.startedAt) || 0))
      .slice(0, limit == null ? 6 : limit);
  }

  /**
   * Needs your attention: actions that did not run first, then ones needing a choice,
   * then ones ready to confirm; at most `limit`. Each with its status and kind as words.
   */
  function attention(actions, limit) {
    return waiting(actions)
      .slice()
      .sort((a, b) => WAITING.indexOf(a.status) - WAITING.indexOf(b.status))
      .slice(0, limit == null ? 6 : limit)
      .map((action) => Object.assign({}, action, {
        statusText: ACTION_STATUS[action.status] || '',
        kindText: ACTION_KIND[action.kind] || 'Action',
        tone: action.status === 'failed' ? 'danger' : action.status === 'needsChoice' ? 'warning' : 'good',
      }));
  }

  /** The banner's line under LANA Briefs. */
  function bannerSubtitle(stats, meetingCount) {
    if (!meetingCount) return 'Record a meeting here, or send one from your phone. Notes and proposed actions appear here.';
    if (stats.waiting === 0) return 'You are all caught up. Every proposed action has been handled.';
    return stats.waiting === 1 ? '1 proposed action is waiting for your review.' : `${stats.waiting} proposed actions are waiting for your review.`;
  }

  /** "Today, 2:30 PM", "Yesterday, 9:05 AM" or "Nov 3, 4:10 PM". */
  function whenText(iso, now) {
    const at = time(iso);
    if (at === null) return '';
    const date = new Date(at);
    const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
    const today = new Date(now == null ? Date.now() : now);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (at >= startOfToday) return `Today, ${clock}`;
    if (at >= startOfToday - DAY_MS) return `Yesterday, ${clock}`;
    return `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date)}, ${clock}`;
  }

  const api = { weekStats, recordedText, recentMeetings, attention, bannerSubtitle, whenText };
  global.BriefsDashboard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
