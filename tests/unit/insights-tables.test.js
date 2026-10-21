const path = require('path');

const SRC = path.join(__dirname, '../../src');

global.window = global;
global.LanaLibraryColumnFilters = require(path.join(SRC, 'js/shared/library-column-filters.js'));
global.LanaRecordTableKit = require(path.join(SRC, 'insights/js/record-table-kit.js'));
const insights = require(path.join(SRC, 'insights/js/insights-tables.js'));
const kit = global.LanaRecordTableKit;

const contact = (id, extra = {}) => ({
  id: 'row-' + id,
  source_created_at: '2026-10-01T10:00:00Z',
  data: Object.assign({ id, name: 'Contact ' + id, email: id + '@example.com', phone: '555-' + id }, extra)
});

const opp = (id, extra = {}, created = '2026-10-02T10:00:00Z') => ({
  id: 'opp-' + id,
  source_created_at: created,
  data: Object.assign({ id, name: 'Opp ' + id, monetaryValue: '1500', status: 'open', contact: { name: 'C ' + id, email: 'c' + id + '@example.com' } }, extra)
});

describe('insights-tables', () => {
  describe('fetchConnectorData', () => {
    test('pages through offset until a short page, without a hidden cap', async () => {
      const total = 1234;
      const calls = [];
      const api = {
        get: async (url) => {
          calls.push(url);
          const q = new URLSearchParams(url.split('?')[1]);
          const offset = Number(q.get('offset'));
          const limit = Number(q.get('limit'));
          const count = Math.max(0, Math.min(limit, total - offset));
          return { data: Array.from({ length: count }, (_, i) => ({ id: offset + i })) };
        }
      };
      insights.resetFetchNotes();
      const result = await insights.fetchConnectorData(api, { entity_type: 'contact', start_date: 'a', end_date: 'b', source: '' });
      expect(result.data).toHaveLength(total);
      expect(result.truncated).toBe(false);
      expect(calls).toHaveLength(3);
      expect(calls[0]).toBe('/api/v1/integrations/connector-data?entity_type=contact&start_date=a&end_date=b&limit=500&offset=0');
      expect(insights.truncatedEntities()).toEqual([]);
      expect(insights.truncationNote()).toBe('');
    });

    test('stops at the bound and records a visible truncation note', async () => {
      const api = { get: async (url) => ({ data: Array.from({ length: Number(new URLSearchParams(url.split('?')[1]).get('limit')) }, () => ({})) }) };
      insights.resetFetchNotes();
      const result = await insights.fetchConnectorData(api, { entity_type: 'opportunity' }, { pageSize: 10, maxRows: 25 });
      expect(result.data).toHaveLength(25);
      expect(result.truncated).toBe(true);
      expect(insights.truncatedEntities()).toEqual(['opportunity']);
      expect(insights.truncationNote()).toContain('first 10,000 opportunities');
      expect(insights.truncationNote()).toContain('role="note"');
      insights.resetFetchNotes();
      expect(insights.truncatedEntities()).toEqual([]);
    });
  });

  describe('specs', () => {
    const keys = Object.keys(insights.SPECS);

    test('there is a row mapper for every spec', () => {
      keys.forEach((key) => expect(typeof insights.rows[key]).toBe('function'));
    });

    test.each(keys)('%s: standard columns, a Created column and a filter on every column', (key) => {
      const spec = insights.SPECS[key];
      expect(spec.id).toMatch(/^insights/);
      expect(spec.columns.every((c) => c.label)).toBe(true);
      const created = spec.columns.filter((c) => c.key === 'created_at');
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ label: 'Created', kind: 'created' });
      expect(spec.columns.some((c) => /Created (At|On|Date)/.test(c.label))).toBe(false);
      const filters = kit.filterOptionsFor(spec, []);
      spec.columns.forEach((c) => expect(filters[c.key]).toBeTruthy());
      const html = kit.markup(spec);
      expect(html).toContain('lex-table--card');
      expect(html).toContain('column-filters');
      expect(html).not.toMatch(/\b(searchable|filterable|compact)\b/);
    });

    test('segment keys point at real columns (or the segments field)', () => {
      Object.keys(insights.SEGMENTS).forEach((key) => {
        const config = insights.SEGMENTS[key];
        const columns = insights.SPECS[key].columns.map((c) => c.key);
        if (!config.match) expect(columns).toContain(config.column);
      });
    });
  });

  describe('row mappers', () => {
    const contacts = [contact('a'), contact('b'), contact('c')];
    const opportunities = [opp('1', { contactId: 'a' }), opp('2', { contactId: 'a', status: 'won', monetaryValue: '500' }), opp('3', { contactId: 'zz' }), opp('4', { contactId: '' })];
    const state = {
      contacts,
      opportunities,
      contactIdsFromOpportunities: new Set(['a', 'zz']),
      allContactIds: new Set(['a', 'b', 'c'])
    };

    test('qualified contacts carry a status code', () => {
      const rows = insights.rows.qlContacts(state);
      expect(rows.map((r) => r.status)).toEqual(['qualified', 'not_qualified', 'not_qualified']);
      expect(rows[0]).toMatchObject({ name: 'Contact a', email: 'a@example.com', created_at: '2026-10-01T10:00:00Z' });
      expect(rows[0]._raw).toBe(contacts[0]);
    });

    test('opportunities flag missing contact records', () => {
      const rows = insights.rows.qlOpportunities(state);
      expect(rows.map((r) => r.contact_record)).toEqual(['found', 'found', 'missing', 'none']);
      expect(rows[0].value).toBe(1500);
    });

    test('contacts with opportunities and unique contact ids', () => {
      const grouped = insights.rows.qlContactOpportunities(state);
      expect(grouped).toHaveLength(1);
      expect(grouped[0]).toMatchObject({ name: 'Contact a', opportunities: 2, total_value: 2000, opportunity_names: 'Opp 1, Opp 2' });
      const unique = insights.rows.qlUniqueContactIds(state);
      expect(unique.map((r) => [r.contact_id, r.contact_record, r.opportunities])).toEqual([['a', 'found', 2], ['zz', 'missing', 1]]);
      expect(unique[1].created_at).toBe('2026-10-02T10:00:00Z');
    });

    test('consultation booking reads calendar attributions', () => {
      const rows = insights.rows.consultationBooking({ allOpportunities: [opp('1', { attributions: [{ medium: 'calendar' }] }), opp('2')] });
      expect(rows.map((r) => r.booking)).toEqual(['booked', 'not_booked']);
    });

    test('response time keeps ISO dates and raw hours', () => {
      const rows = insights.rows.responseTime({ contacts: [
        { id: 'x', name: 'X', email: 'N/A', contactCreatedAt: new Date('2026-10-01T00:00:00Z'), firstConversationTime: new Date('2026-10-01T02:00:00Z'), responseTimeHours: 2, responseStatus: 'Responded', contactMethod: 'TYPE_SMS' },
        { id: 'y', name: 'Y', email: 'y@e.com', contactCreatedAt: new Date('2026-10-01T00:00:00Z'), firstConversationTime: null, responseTimeHours: null, responseStatus: 'Awaiting Response', contactMethod: 'N/A' }
      ] });
      expect(rows[0]).toMatchObject({ email: '', created_at: '2026-10-01T00:00:00.000Z', first_response_at: '2026-10-01T02:00:00.000Z', response_hours: 2, status: 'responded', contact_method: 'TYPE_SMS' });
      expect(rows[1]).toMatchObject({ response_hours: null, status: 'awaiting_response', contact_method: '', first_response_at: '' });
      expect(insights.formatHours(0.5)).toBe('30 mins');
      expect(insights.formatHours(30)).toBe('30.0 hrs');
    });

    test('show rate marks progressed rows inside the showed bucket', () => {
      const rows = insights.rows.showRate({
        showed: [Object.assign(opp('1'), { stageName: 'Consultation Showed' }), Object.assign(opp('2'), { stageName: 'Retained' })],
        noShow: [Object.assign(opp('3'), { stageName: 'No-Show' })],
        cancelled: [], pending: [], other: []
      });
      expect(rows.map((r) => r.attendance)).toEqual(['showed', 'progressed', 'no_show']);
      const filter = insights.segmentFilter('showRate', 'showed');
      expect(filter).toEqual({ column: 'attendance', operator: 'in', value: ['showed', 'progressed'] });
    });

    test('consultations held rows list overlapping segments', () => {
      const rows = insights.rows.consultationsHeld({ allOpportunities: [
        opp('1', { status: 'won', appointmentStatus: 'showed', attributions: [{ medium: 'calendar' }] }),
        opp('2', { status: 'open' })
      ] });
      expect(rows[0].segments).toEqual(['booked', 'confirmed', 'progressed']);
      expect(rows[0].attendance).toBe('confirmed');
      expect(rows[1].segments).toEqual(['not_booked', 'open']);
      const filter = insights.segmentFilter('consultationsHeld', 'progressed');
      expect(filter.operator).toBe('match');
      expect(filter.value.test(rows[0].segments)).toBe(true);
      expect(filter.value.test(rows[1].segments)).toBe(false);
      expect(insights.segmentFilter('consultationsHeld', 'all')).toBeNull();
    });

    test('case value and engagement use the provider created time', () => {
      const cv = insights.rows.caseValue({ opportunities: [opp('1', { status: 'abandoned', createdAt: '2026-09-01T00:00:00Z' })] });
      expect(cv[0]).toMatchObject({ status: 'abandoned', created_at: '2026-09-01T00:00:00Z' });
      const eng = insights.rows.engagement({ opportunities: [
        Object.assign(opp('1', { createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-03T00:00:00Z' }), { daysToEngage: 2 }),
        Object.assign(opp('2'), { daysToEngage: 0 })
      ] });
      expect(eng.map((r) => r.speed)).toEqual(['medium', 'same_day']);
      expect(eng[0]).toMatchObject({ days: 2, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-03T00:00:00Z' });
    });

    test('lead quality and lead source rows', () => {
      const lq = insights.rows.leadQuality({ leads: [{ name: 'A', email: 'N/A', phone: '1', tags: ['x', 'y'], attributions: [{ medium: 'form' }], source: 'contact', qualityScore: 75, created_at: 't' }] });
      expect(lq[0]).toMatchObject({ email: '', tags: 'x, y', attribution: 'form', record_type: 'contact', score: 75, created_at: 't' });
      const ls = insights.rows.leadSource({ records: [contact('a', { company: 'Acme', name: '', firstName: 'Ann', lastName: 'Lee' })] });
      expect(ls[0]).toMatchObject({ name: 'Ann Lee', company: 'Acme', created_at: '2026-10-01T10:00:00Z' });
    });
  });

  describe('distribution tables', () => {
    test('columns come from the visualization, counts sort first', () => {
      const spec = insights.distributionSpec({ title: 'Sources', columns: [{ field: 'label', header: 'Source' }, { field: 'count', header: 'Leads' }, { field: 'value', header: 'Share', format: 'percent' }] }, 'viz-1');
      expect(spec.id).toBe('insightsDistviz-1');
      expect(spec.columns.map((c) => c.kind)).toEqual(['name', 'number', 'percent']);
      expect(spec.sortBy).toBe('count');
      expect(spec.sortDir).toBe('desc');
      const filters = kit.filterOptionsFor(spec, []);
      expect(Object.keys(filters).sort()).toEqual(['count', 'label', 'value']);
      expect(insights.rows.distribution({ rows: [{ label: 'Web', count: 3 }] })[0]).toMatchObject({ id: 'row-0', label: 'Web', count: 3 });
    });
  });
});
