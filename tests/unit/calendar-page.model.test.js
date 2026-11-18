'use strict';

/**
 * Calendar page model (js/calendar/calendar-page.model.js): agenda events to
 * grid items, busy blocks stay untitled, where a connector event opens, and
 * the coworker picker options.
 */
const fs = require('fs');
const path = require('path');

new Function('window', fs.readFileSync(path.join(__dirname, '../../src/js/time-utils.js'), 'utf8'))(globalThis);
const M = require('../../src/js/calendar/calendar-page.model.js');
const { safeHttpUrl } = require('../../src/js/shared/safe-url.js');

const VIEWER = '11111111-1111-1111-1111-111111111111';
const COWORKER = '22222222-2222-2222-2222-222222222222';

const agenda = {
  time_zone: 'America/New_York',
  time_zone_source: 'user',
  people: [{ user_id: COWORKER, name: 'Sam Coworker' }, { user_id: VIEWER, name: 'Me', is_viewer: true }],
  events: [
    { busy_only: false, id: 'EVENT-1', title: 'Client call', start: '2026-11-18T14:00:00Z', end: '2026-11-18T15:00:00Z',
      is_all_day: false, source: { kind: 'lana', label: 'LANA' }, editable: true, status: 'confirmed',
      organizer: { kind: 'user', user_id: VIEWER, name: 'Me' }, matter: null, user_ids: [VIEWER] },
    { busy_only: false, id: 'cd:abc', title: 'Consult', start: '2026-11-18T16:00:00Z', end: '2026-11-18T17:00:00Z',
      is_all_day: false, source: { kind: 'connector', connector_id: 'leadly', label: 'Leadli', integration_source_id: 'src-1', open_url: null },
      editable: false, status: 'scheduled',
      organizer: { kind: 'source_person', name: 'Pat Intake', email: 'pat@x.test', linked: false, label: 'not linked to a LANA user' },
      user_ids: [COWORKER] },
    { busy_only: true, id: null, title: null, start: '2026-11-18T18:00:00Z', end: '2026-11-18T19:00:00Z', is_all_day: false, user_ids: [COWORKER] }
  ]
};

describe('agenda to grid items', () => {
  const items = M.toGridItems(agenda, VIEWER);

  test('the viewer\'s own event is "mine", with the LANA badge, editable', () => {
    expect(items[0]).toMatchObject({ variant: 'mine', colorSlot: 0, title: 'Client call', readOnly: false, badge: { label: 'LANA', kind: 'lana' } });
  });

  test('a connector event is read only, badged by its app, and names an unlinked organizer with the label', () => {
    expect(items[1]).toMatchObject({ variant: 'coworker', colorSlot: 1, readOnly: true, badge: { label: 'Leadli', kind: 'connector' } });
    expect(items[1].organizer).toBe('Pat Intake (not linked to a LANA user)');
  });

  test('a busy block says Busy and carries no source, organizer or matter', () => {
    expect(items[2]).toMatchObject({ variant: 'busy', title: 'Busy', badge: null, source: null, organizer: '', matter: null, readOnly: true });
    expect(items[2].id).toBe('busy-2');
  });

  test('a busy block never shows a title even if one were sent', () => {
    const [item] = M.toGridItems({ events: [{ busy_only: true, title: 'Leaked', start: 'x', end: 'y', user_ids: [] }] }, VIEWER);
    expect(item.title).toBe('Busy');
  });
});

describe('where a connector event opens', () => {
  const connector = agenda.events[1];

  test('its source link in the browser when it is a safe http(s) link', () => {
    const event = { ...connector, source: { ...connector.source, open_url: 'https://app.example.test/appt/1' } };
    expect(M.openTargetFor(event, { safeHttpUrl })).toEqual({ type: 'external', url: 'https://app.example.test/appt/1' });
  });

  test('never an unsafe link; admins get the connector records instead', () => {
    const event = { ...connector, source: { ...connector.source, open_url: 'javascript:alert(1)' } };
    expect(M.openTargetFor(event, { safeHttpUrl, isAdmin: false })).toBeNull();
    expect(M.openTargetFor(event, { safeHttpUrl, isAdmin: true }))
      .toEqual({ type: 'app', href: 'integrations/connector-viewer.html?sourceId=src-1&connectorId=leadly&tab=data' });
  });

  test('LANA events and busy blocks have no source to open', () => {
    expect(M.openTargetFor(agenda.events[0], { safeHttpUrl, isAdmin: true })).toBeNull();
    expect(M.openTargetFor(agenda.events[2], { safeHttpUrl, isAdmin: true })).toBeNull();
  });
});

describe('coworker picker', () => {
  const people = {
    members: [{ user_id: VIEWER, name: 'Me' }, { user_id: COWORKER, name: 'Sam Coworker', email: 'sam@x.test' }],
    unlinked: [{ id: 'ident-1', name: 'Pat Intake', connector_id: 'leadly', label: 'not linked to a LANA user' }]
  };

  test('lists coworkers, then unlinked people labelled and not selectable', () => {
    expect(M.coworkerOptions(people, VIEWER)).toEqual([
      { value: COWORKER, label: 'Sam Coworker', description: 'sam@x.test' },
      { divider: true },
      { value: 'unlinked:ident-1', label: 'Pat Intake', description: 'not linked to a LANA user', disabled: true, group: 'From connected apps' }
    ]);
  });

  test('unlinked entries are never sent as user ids, and at most 24 coworkers are', () => {
    expect(M.selectedUserIds([COWORKER, 'unlinked:ident-1'])).toEqual([COWORKER]);
    expect(M.selectedUserIds(Array.from({ length: 30 }, (_, i) => 'u' + i))).toHaveLength(24);
  });
});

describe('navigation and labels', () => {
  test('previous and next move by a week or a day', () => {
    expect(M.shiftDay('2026-11-18', 'week', 1)).toBe('2026-11-25');
    expect(M.shiftDay('2026-11-18', 'day', -1)).toBe('2026-11-17');
    expect(M.normalizeView('month')).toBe('week');
  });

  test('range titles', () => {
    expect(M.rangeTitle(['2026-11-15', '2026-11-21'], 'America/New_York')).toBe('Nov 15 to 21, 2026');
    expect(M.rangeTitle(['2026-11-29', '2026-12-05'], 'America/New_York')).toBe('Nov 29 to Dec 5, 2026');
    expect(M.rangeTitle(['2026-12-27', '2027-01-02'], 'UTC')).toBe('Dec 27, 2026 to Jan 2, 2027');
    expect(M.rangeTitle(['2026-11-18'], 'Pacific/Honolulu')).toBe('Wednesday, November 18, 2026');
  });

  test('zone note says whose zone is in use', () => {
    expect(M.zoneNote(agenda)).toBe('Times are shown in your time zone, America/New_York.');
    expect(M.zoneNote({ time_zone: 'America/Denver', time_zone_source: 'firm' })).toContain('firm time zone');
  });
});
