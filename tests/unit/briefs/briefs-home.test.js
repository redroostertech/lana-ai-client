'use strict';

/** LANA Briefs Home rules (src/js/briefs/briefs-home.js). */
const H = require('../../../src/js/briefs/briefs-home');

const NOW = Date.parse('2026-11-06T15:00:00');
const meeting = (id, iso, minutes, openIntents = 0) => ({ id, title: id, startedAt: new Date(iso).toISOString(), durationSeconds: minutes * 60, openIntents, unreadActions: 0, attestationMethod: 'acoustic' });
const meetings = [
  meeting('a', '2026-11-06T10:00:00', 45, 2),
  meeting('b', '2026-11-04T09:00:00', 30),
  meeting('c', '2026-10-20T09:00:00', 60, 1),
];
const action = (id, status, kind = 'note') => ({ id, meetingID: 'a', meetingTitle: 'a', kind, title: id, destination: 'Clio', status });
const actions = [action('r', 'ready'), action('x', 'executed'), action('f', 'failed', 'email'), action('n', 'needsChoice', 'task')];

describe('Briefs Home', () => {
  test('the week: meetings and minutes in the last seven days, waiting actions, meetings with open items', () => {
    expect(H.weekStats(meetings, actions, NOW)).toEqual({ meetings: 2, minutes: 75, waiting: 3, openItems: 2 });
    expect(H.weekStats(null, null, NOW)).toEqual({ meetings: 0, minutes: 0, waiting: 0, openItems: 0 });
  });

  test('recorded time reads minutes, then hours to one place', () => {
    expect(H.recordedText(45)).toBe('45 min');
    expect(H.recordedText(75)).toBe('1.3 hr');
    expect(H.recordedText(120)).toBe('2 hr');
    expect(H.recordedText(-3)).toBe('0 min');
  });

  test('recent meetings are newest first and limited', () => {
    expect(H.recentMeetings(meetings, 2).map((item) => item.id)).toEqual(['a', 'b']);
    expect(H.recentMeetings(meetings).length).toBe(3);
  });

  test('attention puts failures first and leaves out what already ran', () => {
    const list = H.attention(actions);
    expect(list.map((item) => item.id)).toEqual(['f', 'n', 'r']);
    expect(list[0]).toMatchObject({ statusText: 'Did not run', kindText: 'Email draft', tone: 'danger' });
    expect(list[1]).toMatchObject({ statusText: 'Needs a choice', kindText: 'Task', tone: 'warning' });
    expect(list[2]).toMatchObject({ statusText: 'Ready to confirm', kindText: 'Note', tone: 'good' });
    expect(H.attention(actions, 1).length).toBe(1);
  });

  test('the banner line', () => {
    expect(H.bannerSubtitle({ waiting: 0 }, 0)).toContain('Record a meeting here');
    expect(H.bannerSubtitle({ waiting: 0 }, 3)).toBe('You are all caught up. Every proposed action has been handled.');
    expect(H.bannerSubtitle({ waiting: 1 }, 3)).toBe('1 proposed action is waiting for your review.');
    expect(H.bannerSubtitle({ waiting: 4 }, 3)).toBe('4 proposed actions are waiting for your review.');
  });

  test('when: today, yesterday, or the date', () => {
    expect(H.whenText(new Date('2026-11-06T10:00:00').toISOString(), NOW)).toBe('Today, 10:00 AM');
    expect(H.whenText(new Date('2026-11-05T21:30:00').toISOString(), NOW)).toBe('Yesterday, 9:30 PM');
    expect(H.whenText(new Date('2026-10-20T09:00:00').toISOString(), NOW)).toBe('Oct 20, 9:00 AM');
    expect(H.whenText('nope', NOW)).toBe('');
  });
});
