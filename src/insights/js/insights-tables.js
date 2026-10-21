/**
 * insights-tables.js
 * The record tables inside the Insights metric drill-downs, shared by
 * insights/dashboard.html and insights/module-execution.html (which carry the
 * same drill-downs). Each table is a standard lex-table built by
 * LanaRecordTableKit (js/record-table-kit.js); this module holds the column
 * specs, the row mappers (raw values only, formatting in renderers) and the
 * connector-data loader. See docs/TABLE-STANDARD.md.
 *
 * The drill-downs compute their metrics in the browser from
 * /api/v1/integrations/connector-data, so their tables are client-side: the
 * whole record set is loaded (paged through offset, no hidden cap) and the
 * table sorts, filters and pages it. If a set is larger than MAX_ROWS the
 * table says so in a visible note.
 *
 * Public API (window.LanaInsightsTables, or module.exports in Node):
 *   - PAGE_SIZE, MAX_ROWS
 *   - fetchConnectorData(api, params, options) -> Promise<{ data, count, truncated }>
 *   - resetFetchNotes(), truncatedEntities()   -> what the last loads cut off
 *   - truncationNote(entities)                 -> visible note HTML ('' when none)
 *   - rows: { leadSource, qlContacts, qlOpportunities, qlContactOpportunities,
 *             qlUniqueContactIds, consultationBooking, responseTime, leadQuality,
 *             showRate, caseValue, consultationsHeld, engagement, distribution }
 *   - SPECS                                   -> lex-table specs by key
 *   - SEGMENTS                                -> summary-card filters by key
 *   - distributionSpec(viz, uniqueId)
 *   - segmentFilter(key, segment)             -> { column, operator, value } | null
 *   - render(container, key, input, options)  -> Promise of the kit controller
 *   - renderDistribution(container, viz, tableData, uniqueId) -> Promise
 */

(function (global) {
  'use strict';

  var PAGE_SIZE = 500;
  var MAX_ROWS = 10000;
  var CONNECTOR_DATA_PATH = '/api/v1/integrations/connector-data';

  function kit() {
    if (global && global.LanaRecordTableKit) return global.LanaRecordTableKit;
    if (typeof require === 'function') {
      try { return require('./record-table-kit.js'); } catch (_error) { return null; }
    }
    return null;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ---------------------------------------------------------------------------
  // Loading: every connector-data row in the period, paged through offset
  // ---------------------------------------------------------------------------

  var truncated = {};

  function resetFetchNotes() { truncated = {}; }

  function truncatedEntities() { return Object.keys(truncated); }

  /**
   * Every connector-data record matching params ({ entity_type, source,
   * start_date, end_date }), PAGE_SIZE at a time, up to options.maxRows.
   * The endpoint pages by limit/offset but returns no total, so paging stops
   * on a short page. Resolves to { data, count, truncated } (the old single
   * response's shape, so callers keep reading .data).
   */
  async function fetchConnectorData(api, params, options) {
    var opts = options || {};
    var pageSize = Number(opts.pageSize) || PAGE_SIZE;
    var maxRows = Number(opts.maxRows) || MAX_ROWS;
    var base = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && value !== '') base.set(key, String(value));
    });
    var rows = [];
    var cut = false;
    for (var offset = 0; offset < maxRows; offset += pageSize) {
      var query = new URLSearchParams(base);
      var limit = Math.min(pageSize, maxRows - offset);
      query.set('limit', String(limit));
      query.set('offset', String(offset));
      var response = await api.get(CONNECTOR_DATA_PATH + '?' + query.toString());
      var page = (response && Array.isArray(response.data)) ? response.data : [];
      rows = rows.concat(page);
      if (page.length < limit) break;
      if (offset + limit >= maxRows) { cut = true; break; }
    }
    if (cut) truncated[(params && params.entity_type) || 'record'] = true;
    return { data: rows, count: rows.length, truncated: cut };
  }

  function truncationNote(entities) {
    var list = entities || truncatedEntities();
    if (!list.length) return '';
    var names = list.map(function (name) {
      var text = String(name);
      return /y$/.test(text) ? text.slice(0, -1) + 'ies' : text + 's';
    }).join(', ');
    return '<div class="mb-3 rounded-lg border px-3 py-2 text-sm" role="note" ' +
      'style="border-color: var(--lex-status-warning-border, #FEC84B); background: var(--lex-status-warning-bg, #FFFAEB); color: var(--lex-status-warning-text, #B54708)">' +
      'Showing the first ' + MAX_ROWS.toLocaleString('en-US') + ' ' + esc(names) +
      ' in this period. Narrow the period to see every record, and read the metrics here as based on those records.</div>';
  }

  // ---------------------------------------------------------------------------
  // Record helpers
  // ---------------------------------------------------------------------------

  function data(record) { return (record && record.data) || {}; }

  function joinName(first, last) {
    return [first, last].filter(function (part) { return part; }).join(' ');
  }

  function contactRecordName(contact) {
    var d = data(contact);
    return d.contactName || d.name || joinName(d.firstName, d.lastName) || '';
  }

  function oppContact(opp) { return data(opp).contact || {}; }

  function oppContactName(opp) {
    var c = oppContact(opp);
    return c.name || joinName(c.firstName, c.lastName) || '';
  }

  function money(value) {
    var n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  function hasCalendarBooking(opp) {
    var attributions = data(opp).attributions;
    return Array.isArray(attributions) && attributions.some(function (attr) { return attr && attr.medium === 'calendar'; });
  }

  function iso(value) {
    if (!value) return '';
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    return String(value);
  }

  function recordId(record, index, prefix) {
    var id = record && (record.id || data(record).id);
    return id != null && id !== '' ? String(id) : (prefix || 'row') + '-' + index;
  }

  // ---------------------------------------------------------------------------
  // Row mappers (raw values; the original record is kept as _raw)
  // ---------------------------------------------------------------------------

  var rows = {
    // Lead source bar drill-down: contacts from one source.
    leadSource: function (input) {
      return ((input && input.records) || []).map(function (lead, index) {
        var d = data(lead);
        return {
          id: recordId(lead, index, 'lead'),
          name: contactRecordName(lead),
          email: d.email || '',
          phone: d.phone || '',
          company: d.company || d.companyName || '',
          created_at: lead.source_created_at || '',
          _raw: lead
        };
      });
    },

    // Qualified leads: contacts, qualified when an opportunity names them.
    qlContacts: function (input) {
      var linked = (input && input.contactIdsFromOpportunities) || new Set();
      return ((input && input.contacts) || []).map(function (contact, index) {
        var d = data(contact);
        return {
          id: recordId(contact, index, 'contact'),
          name: contactRecordName(contact),
          email: d.email || '',
          phone: d.phone || '',
          status: linked.has(d.id) ? 'qualified' : 'not_qualified',
          created_at: contact.source_created_at || '',
          _raw: contact
        };
      });
    },

    // Qualified leads: opportunities, and whether their contact record exists.
    qlOpportunities: function (input) {
      var known = (input && input.allContactIds) || new Set();
      return ((input && input.opportunities) || []).map(function (opp, index) {
        var d = data(opp);
        var contactId = d.contactId || '';
        return {
          id: recordId(opp, index, 'opp'),
          name: d.name || '',
          contact: oppContactName(opp),
          value: money(d.monetaryValue),
          status: d.status || '',
          contact_record: !contactId ? 'none' : (known.has(contactId) ? 'found' : 'missing'),
          created_at: opp.source_created_at || '',
          _raw: opp
        };
      });
    },

    // Qualified leads: one row per contact that has opportunities.
    qlContactOpportunities: function (input) {
      var opps = (input && input.opportunities) || [];
      var linked = (input && input.contactIdsFromOpportunities) || new Set();
      var byContact = groupByContact(opps);
      return ((input && input.contacts) || [])
        .filter(function (contact) { return linked.has(data(contact).id); })
        .map(function (contact, index) {
          var d = data(contact);
          var list = byContact[d.id] || [];
          return {
            id: recordId(contact, index, 'contact'),
            name: contactRecordName(contact),
            email: d.email || '',
            opportunity_names: list.map(function (opp) { return data(opp).name || ''; }).filter(Boolean).join(', '),
            opportunities: list.length,
            total_value: list.reduce(function (sum, opp) { return sum + money(data(opp).monetaryValue); }, 0),
            created_at: contact.source_created_at || '',
            _raw: contact
          };
        });
    },

    // Qualified leads: every contact id opportunities reference, with or
    // without a contact record.
    qlUniqueContactIds: function (input) {
      var opps = (input && input.opportunities) || [];
      var linked = (input && input.contactIdsFromOpportunities) || new Set();
      var byContact = groupByContact(opps);
      var contactMap = new Map(((input && input.contacts) || []).map(function (c) { return [data(c).id, c]; }));
      var out = [];
      linked.forEach(function (contactId) {
        var contact = contactMap.get(contactId);
        var list = byContact[contactId] || [];
        var earliest = list.map(function (opp) { return opp.source_created_at || ''; }).filter(Boolean).sort()[0] || '';
        out.push({
          id: String(contactId),
          contact_id: String(contactId),
          name: contact ? contactRecordName(contact) : '',
          email: contact ? (data(contact).email || '') : '',
          contact_record: contact ? 'found' : 'missing',
          opportunities: list.length,
          total_value: list.reduce(function (sum, opp) { return sum + money(data(opp).monetaryValue); }, 0),
          created_at: contact ? (contact.source_created_at || earliest) : earliest,
          _raw: contact || null
        });
      });
      return out;
    },

    // Lead -> consultation booking: open opportunities, booked when an
    // attribution came from a calendar.
    consultationBooking: function (input) {
      return ((input && input.allOpportunities) || []).map(function (opp, index) {
        var d = data(opp);
        return {
          id: recordId(opp, index, 'opp'),
          name: d.name || '',
          contact: oppContactName(opp) || d.name || '',
          email: oppContact(opp).email || '',
          value: money(d.monetaryValue),
          booking: hasCalendarBooking(opp) ? 'booked' : 'not_booked',
          status: d.status || '',
          created_at: opp.source_created_at || '',
          _raw: opp
        };
      });
    },

    // Lead response time: the page's computed lead list.
    responseTime: function (input) {
      return ((input && input.contacts) || []).map(function (lead, index) {
        var hours = lead.responseTimeHours;
        return {
          id: lead.id != null ? String(lead.id) : 'lead-' + index,
          name: lead.name && lead.name !== 'N/A' ? lead.name : '',
          email: lead.email && lead.email !== 'N/A' ? lead.email : '',
          contact_method: lead.contactMethod && lead.contactMethod !== 'N/A' ? lead.contactMethod : '',
          first_response_at: iso(lead.firstConversationTime),
          response_hours: hours === null || hours === undefined || !Number.isFinite(Number(hours)) ? null : Number(hours),
          status: lead.responseStatus === 'Responded' ? 'responded' : 'awaiting_response',
          lead_source: lead.leadSource || '',
          created_at: iso(lead.contactCreatedAt),
          _raw: lead
        };
      });
    },

    // Lead quality score: the page's scored lead list.
    leadQuality: function (input) {
      return ((input && input.leads) || []).map(function (lead, index) {
        var tags = Array.isArray(lead.tags) ? lead.tags : [];
        var attributions = Array.isArray(lead.attributions) ? lead.attributions : [];
        var first = attributions[0] || null;
        return {
          id: 'lead-' + index,
          name: lead.name && lead.name !== 'N/A' ? lead.name : '',
          email: lead.email && lead.email !== 'N/A' ? lead.email : '',
          phone: lead.phone && lead.phone !== 'N/A' ? lead.phone : '',
          tags: tags.join(', '),
          attribution: first ? String(first.medium || first.source || 'unknown') : '',
          record_type: lead.source || '',
          score: Number(lead.qualityScore) || 0,
          created_at: lead.created_at || '',
          _raw: lead
        };
      });
    },

    // Consultation show-up rate: the page's stage buckets.
    showRate: function (input) {
      var state = input || {};
      var out = [];
      function add(list, attendance) {
        (list || []).forEach(function (opp) {
          var d = data(opp);
          var stage = opp.stageName || '';
          var value = attendance;
          if (attendance === 'showed' && !/Showed|Complete/.test(stage)) value = 'progressed';
          out.push({
            id: recordId(opp, out.length, 'opp'),
            name: d.name || '',
            contact: oppContactName(opp),
            email: oppContact(opp).email || '',
            value: money(d.monetaryValue),
            stage: stage,
            attendance: value,
            created_at: opp.source_created_at || '',
            _raw: opp
          });
        });
      }
      add(state.showed, 'showed');
      add(state.noShow, 'no_show');
      add(state.cancelled, 'cancelled');
      add(state.pending, 'pending');
      add(state.other, 'other');
      return out;
    },

    // Average case value: opportunities with a value.
    caseValue: function (input) {
      return ((input && input.opportunities) || []).map(function (opp, index) {
        var d = data(opp);
        var status = d.status || '';
        return {
          id: recordId(opp, index, 'opp'),
          name: d.name || '',
          contact: oppContactName(opp) || d.name || '',
          email: oppContact(opp).email || '',
          value: money(d.monetaryValue),
          status: ['open', 'won', 'lost'].indexOf(status) === -1 ? (status || 'other') : status,
          source: d.source || '',
          created_at: d.createdAt || opp.source_created_at || '',
          _raw: opp
        };
      });
    },

    // Consultations held: the segments overlap (a won opportunity can also
    // be booked), so each row lists every segment it belongs to.
    consultationsHeld: function (input) {
      return ((input && input.allOpportunities) || []).map(function (opp, index) {
        var d = data(opp);
        var booked = hasCalendarBooking(opp);
        var status = d.status || '';
        var segments = [booked ? 'booked' : 'not_booked'];
        if (d.appointmentStatus === 'showed') segments.push('confirmed');
        if (status === 'won' || status === 'active') segments.push('progressed');
        if (status === 'open') segments.push('open');
        var attendance = d.appointmentStatus === 'showed' ? 'confirmed'
          : (status === 'won' || status === 'active') ? 'progressed'
            : booked ? 'booked' : 'no_booking';
        return {
          id: recordId(opp, index, 'opp'),
          name: d.name || '',
          contact: oppContactName(opp),
          email: oppContact(opp).email || '',
          value: money(d.monetaryValue),
          calendar: booked ? 'yes' : 'no',
          attendance: attendance,
          status: status,
          created_at: opp.source_created_at || '',
          segments: segments,
          _raw: opp
        };
      });
    },

    // Time to engagement: the page's engaged opportunities.
    engagement: function (input) {
      return ((input && input.opportunities) || []).map(function (opp, index) {
        var d = data(opp);
        var days = Number(opp.daysToEngage);
        var speed = days === 0 ? 'same_day' : days <= 1 ? 'fast' : days <= 3 ? 'medium' : 'slow';
        return {
          id: recordId(opp, index, 'opp'),
          name: d.name || '',
          contact: oppContactName(opp),
          email: oppContact(opp).email || '',
          value: money(d.monetaryValue),
          status: d.status || '',
          days: Number.isFinite(days) ? days : null,
          speed: Number.isFinite(days) ? speed : '',
          updated_at: d.updatedAt || '',
          created_at: d.createdAt || opp.source_created_at || '',
          _raw: opp
        };
      });
    },

    // Distribution visualization rows (label / count / value), as given.
    distribution: function (input) {
      return ((input && input.rows) || []).map(function (row, index) {
        var out = { id: 'row-' + index, _raw: row };
        Object.keys(row || {}).forEach(function (key) { if (key !== 'id') out[key] = row[key]; });
        return out;
      });
    }
  };

  function groupByContact(opps) {
    var byContact = {};
    (opps || []).forEach(function (opp) {
      var contactId = data(opp).contactId;
      if (!contactId) return;
      (byContact[contactId] = byContact[contactId] || []).push(opp);
    });
    return byContact;
  }

  // ---------------------------------------------------------------------------
  // Specs
  // ---------------------------------------------------------------------------

  var OPP_STATUS_COLORS = { open: 'blue', won: 'green', lost: 'red', abandoned: 'gray', active: 'indigo', other: 'gray' };

  var VALUE_RANGES = [
    { value: 'zero', label: 'No value', min: null, max: 0.01 },
    { value: 'under_1k', label: 'Under $1,000', min: 0.01, max: 1000 },
    { value: '1k_5k', label: '$1,000 – $5,000', min: 1000, max: 5000 },
    { value: '5k_10k', label: '$5,000 – $10,000', min: 5000, max: 10000 },
    { value: 'over_10k', label: 'Over $10,000', min: 10000, max: null }
  ];

  var COUNT_RANGES = [
    { value: 'one', label: '1', min: 1, max: 2 },
    { value: '2_5', label: '2 – 5', min: 2, max: 6 },
    { value: 'over_5', label: 'More than 5', min: 6, max: null }
  ];

  var HOURS_RANGES = [
    { value: 'under_1h', label: 'Under 1 hour', min: null, max: 1 },
    { value: '1_24h', label: '1 – 24 hours', min: 1, max: 24 },
    { value: '24_48h', label: '24 – 48 hours', min: 24, max: 48 },
    { value: 'over_48h', label: 'Over 48 hours', min: 48, max: null },
    { value: 'none', label: 'No response yet' }
  ];

  var SCORE_RANGES = [
    { value: 'high', label: '75 – 100', min: 75, max: null },
    { value: 'mid', label: '50 – 74', min: 50, max: 75 },
    { value: 'low', label: 'Under 50', min: null, max: 50 }
  ];

  var DAY_RANGES = [
    { value: 'same_day', label: 'Same day', min: null, max: 0.0000001 },
    { value: 'one_day', label: 'Up to 1 day', min: 0.0000001, max: 1.0000001 },
    { value: 'three_days', label: '1 – 3 days', min: 1.0000001, max: 3.0000001 },
    { value: 'longer', label: 'More than 3 days', min: 3.0000001, max: null }
  ];

  var CONTACT_METHOD_LABELS = {
    TYPE_EMAIL: 'Email',
    TYPE_CALL: 'Phone call',
    TYPE_SMS: 'Text/SMS',
    TYPE_INSTAGRAM: 'Instagram',
    TYPE_PHONE: 'Phone',
    TYPE_FACEBOOK: 'Facebook',
    TYPE_WHATSAPP: 'WhatsApp',
    TYPE_WEBCHAT: 'Web chat'
  };

  function formatHours(hours) {
    if (hours === null || hours === undefined || hours === '') return '';
    var n = Number(hours);
    if (!Number.isFinite(n)) return '';
    if (n < 1) {
      var minutes = Math.round(n * 60);
      return minutes + ' min' + (minutes !== 1 ? 's' : '');
    }
    return n.toFixed(1) + ' hrs';
  }

  function mutedCell() {
    var k = kit();
    return k ? k.muted('') : '<span>—</span>';
  }

  var col = {
    name: function (key, label) { return { key: key, label: label, kind: 'name' }; },
    contact: function () { return { key: 'contact', label: 'Contact', kind: 'text', width: '18%' }; },
    email: function () { return { key: 'email', label: 'Email', kind: 'email', width: '20%' }; },
    phone: function () { return { key: 'phone', label: 'Phone', kind: 'text', width: '140px' }; },
    value: function (key, label) { return { key: key || 'value', label: label || 'Value', kind: 'currency', width: '120px', ranges: VALUE_RANGES }; },
    oppStatus: function () {
      return {
        key: 'status', label: 'Status', kind: 'badge', width: '120px', colors: OPP_STATUS_COLORS,
        options: [
          { value: 'open', label: 'Open' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' },
          { value: 'abandoned', label: 'Abandoned' }, { value: 'active', label: 'Active' }, { value: 'other', label: 'Other' }
        ]
      };
    },
    created: function () { return { key: 'created_at', label: 'Created', kind: 'created' }; }
  };

  function opportunityBase(id, title, extra) {
    return {
      id: id,
      title: title,
      noun: ['opportunity', 'opportunities'],
      light: true,
      sortBy: 'created_at',
      sortDir: 'desc',
      searchPlaceholder: 'Search by opportunity, contact or email...',
      searchKeys: 'name,contact,email',
      emptyText: 'No opportunities in this period',
      filteredEmptyText: 'No matching opportunities. Try a different search or clear the filters.',
      minWidth: (extra && extra.minWidth) || 960,
      columns: (extra && extra.columns) || []
    };
  }

  var SPECS = {
    leadSource: {
      id: 'insightsLeadSourceTable', title: 'Leads', noun: ['lead', 'leads'], light: true,
      sortBy: 'created_at', sortDir: 'desc', minWidth: 820,
      searchPlaceholder: 'Search by name, email, phone or company...', searchKeys: 'name,email,phone,company',
      emptyText: 'No leads found for this source.',
      columns: [col.name('name', 'Name'), col.email(), col.phone(), { key: 'company', label: 'Company', kind: 'text', width: '18%' }, col.created()]
    },
    qlContacts: {
      id: 'insightsQlContactsTable', title: 'Contacts', noun: ['contact', 'contacts'], light: true,
      sortBy: 'created_at', sortDir: 'desc', minWidth: 860,
      searchPlaceholder: 'Search by name, email or phone...', searchKeys: 'name,email,phone',
      emptyText: 'No contacts in this period',
      columns: [
        col.name('name', 'Name'), col.email(), col.phone(),
        { key: 'status', label: 'Status', kind: 'badge', width: '140px', colors: { qualified: 'green', not_qualified: 'yellow' },
          options: [{ value: 'qualified', label: 'Qualified' }, { value: 'not_qualified', label: 'Not qualified' }] },
        col.created()
      ]
    },
    qlOpportunities: opportunityBase('insightsQlOpportunitiesTable', 'Opportunities', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.value(), col.oppStatus(),
        { key: 'contact_record', label: 'Contact record', kind: 'badge', width: '150px',
          colors: { found: 'green', missing: 'red', none: 'gray' },
          options: [{ value: 'found', label: 'Found' }, { value: 'missing', label: 'Missing' }, { value: 'none', label: 'No contact' }],
          labels: { none: 'No contact' } },
        col.created()
      ]
    }),
    qlContactOpportunities: {
      id: 'insightsQlContactOppsTable', title: 'Contacts with opportunities', noun: ['contact', 'contacts'], light: true,
      sortBy: 'opportunities', sortDir: 'desc', minWidth: 960,
      searchPlaceholder: 'Search by contact, email or opportunity...', searchKeys: 'name,email,opportunity_names',
      emptyText: 'No contacts with opportunities in this period',
      columns: [
        col.name('name', 'Contact'), col.email(),
        { key: 'opportunity_names', label: 'Opportunities', kind: 'text', width: '24%' },
        { key: 'opportunities', label: 'Count', kind: 'number', width: '90px', ranges: COUNT_RANGES },
        col.value('total_value', 'Total value'),
        col.created()
      ]
    },
    qlUniqueContactIds: {
      id: 'insightsQlUniqueIdsTable', title: 'Unique contact IDs', noun: ['contact ID', 'contact IDs'], light: true,
      sortBy: 'opportunities', sortDir: 'desc', minWidth: 1000,
      searchPlaceholder: 'Search by name, email or contact ID...', searchKeys: 'contact_id,name,email',
      emptyText: 'No contact IDs referenced by opportunities',
      columns: [
        { key: 'name', label: 'Name', kind: 'name', render: function (value) {
          return value ? kit().cells.name(value) : '<span class="rtk-name" style="color: var(--lex-status-danger-text, #B42318)">Missing contact</span>';
        } },
        { key: 'contact_id', label: 'Contact ID', kind: 'code', width: '200px' },
        col.email(),
        { key: 'contact_record', label: 'Contact record', kind: 'badge', width: '150px',
          colors: { found: 'green', missing: 'red' }, options: [{ value: 'found', label: 'Found' }, { value: 'missing', label: 'Missing' }] },
        { key: 'opportunities', label: 'Opportunities', kind: 'number', width: '130px', ranges: COUNT_RANGES },
        col.value('total_value', 'Total value'),
        col.created()
      ]
    },
    consultationBooking: opportunityBase('insightsBookingTable', 'Open opportunities', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.email(), col.value(),
        { key: 'booking', label: 'Booking', kind: 'badge', width: '130px', colors: { booked: 'green', not_booked: 'yellow' },
          options: [{ value: 'booked', label: 'Booked' }, { value: 'not_booked', label: 'Not booked' }] },
        col.oppStatus(), col.created()
      ],
      minWidth: 1100
    }),
    responseTime: {
      id: 'insightsResponseTimeTable', title: 'Leads', noun: ['lead', 'leads'], light: true,
      sortBy: 'response_hours', sortDir: 'asc', minWidth: 1120,
      searchPlaceholder: 'Search by name or email...', searchKeys: 'name,email',
      emptyText: 'No leads in this period',
      columns: [
        col.name('name', 'Contact'), col.email(),
        { key: 'first_response_at', label: 'First response', kind: 'datetime', width: '176px' },
        { key: 'contact_method', label: 'Contact method', kind: 'enum', width: '140px', labels: CONTACT_METHOD_LABELS },
        { key: 'response_hours', label: 'Response time', kind: 'number', width: '140px', ranges: HOURS_RANGES,
          render: function (value) {
            var text = formatHours(value);
            if (!text) return mutedCell();
            var n = Number(value);
            var color = n <= 24 ? 'var(--lex-status-success-text, #067647)' : n <= 48 ? 'var(--lex-status-warning-text, #B54708)' : 'var(--lex-status-danger-text, #B42318)';
            return '<span class="rtk-num" style="font-weight:600;color:' + color + '">' + esc(text) + '</span>';
          } },
        { key: 'status', label: 'Status', kind: 'badge', width: '170px', colors: { responded: 'green', awaiting_response: 'yellow' },
          options: [{ value: 'responded', label: 'Responded' }, { value: 'awaiting_response', label: 'Awaiting response' }] },
        col.created()
      ]
    },
    leadQuality: {
      id: 'insightsLeadQualityTable', title: 'Leads', noun: ['lead', 'leads'], light: true,
      sortBy: 'score', sortDir: 'desc', minWidth: 1180,
      searchPlaceholder: 'Search by name, email, phone or tags...', searchKeys: 'name,email,phone,tags',
      emptyText: 'No leads in this period',
      columns: [
        col.name('name', 'Name'), col.email(), col.phone(),
        { key: 'tags', label: 'Tags', kind: 'text', width: '16%' },
        { key: 'attribution', label: 'Source', kind: 'enum', width: '120px' },
        { key: 'record_type', label: 'Record', kind: 'enum', width: '120px',
          options: [{ value: 'contact', label: 'Contact' }, { value: 'opportunity', label: 'Opportunity' }] },
        { key: 'score', label: 'Score', kind: 'number', width: '100px', ranges: SCORE_RANGES,
          render: function (value) {
            var n = Number(value) || 0;
            var color = n >= 75 ? 'green' : n >= 50 ? 'yellow' : 'red';
            return '<lex-badge label="' + n + '/100" color="' + color + '"></lex-badge>';
          } },
        col.created()
      ]
    },
    showRate: opportunityBase('insightsShowRateTable', 'Booked consultations', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.email(), col.value(),
        { key: 'stage', label: 'Current stage', kind: 'text', width: '160px' },
        { key: 'attendance', label: 'Attendance', kind: 'badge', width: '170px',
          colors: { showed: 'green', progressed: 'indigo', no_show: 'red', cancelled: 'yellow', pending: 'blue', other: 'gray' },
          labels: { showed: 'Showed', progressed: 'Showed (progressed)', no_show: 'No-show', cancelled: 'Cancelled', pending: 'Booked (pending)', other: 'Other' },
          options: [
            { value: 'showed', label: 'Showed' }, { value: 'progressed', label: 'Showed (progressed)' },
            { value: 'no_show', label: 'No-show' }, { value: 'cancelled', label: 'Cancelled' },
            { value: 'pending', label: 'Booked (pending)' }, { value: 'other', label: 'Other' }
          ] },
        col.created()
      ],
      minWidth: 1180
    }),
    caseValue: opportunityBase('insightsCaseValueTable', 'Opportunities with a value', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.email(), col.value(), col.oppStatus(),
        { key: 'source', label: 'Source', kind: 'text', width: '140px' },
        col.created()
      ],
      minWidth: 1100
    }),
    consultationsHeld: opportunityBase('insightsConsultationsHeldTable', 'Opportunities', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.email(), col.value(),
        { key: 'calendar', label: 'Calendar booking', kind: 'badge', width: '150px', colors: { yes: 'blue', no: 'gray' },
          options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
        { key: 'attendance', label: 'Attendance', kind: 'badge', width: '160px',
          colors: { confirmed: 'green', progressed: 'indigo', booked: 'blue', no_booking: 'gray' },
          labels: { confirmed: 'Confirmed showed', no_booking: 'No booking' },
          options: [
            { value: 'confirmed', label: 'Confirmed showed' }, { value: 'progressed', label: 'Progressed' },
            { value: 'booked', label: 'Booked' }, { value: 'no_booking', label: 'No booking' }
          ] },
        col.oppStatus(), col.created()
      ],
      minWidth: 1240
    }),
    engagement: opportunityBase('insightsEngagementTable', 'Engaged opportunities', {
      columns: [
        col.name('name', 'Opportunity'), col.contact(), col.email(), col.value(), col.oppStatus(),
        { key: 'updated_at', label: 'Last update', kind: 'relative', width: '130px' },
        { key: 'days', label: 'Days to engage', kind: 'number', width: '140px', ranges: DAY_RANGES,
          render: function (value) {
            if (value === null || value === undefined || value === '') return mutedCell();
            return '<span class="rtk-num">' + esc(Number(value).toFixed(2)) + ' days</span>';
          } },
        { key: 'speed', label: 'Speed', kind: 'badge', width: '120px',
          colors: { same_day: 'green', fast: 'blue', medium: 'yellow', slow: 'red' },
          labels: { same_day: 'Same day', fast: 'Fast', medium: 'Medium', slow: 'Slow' },
          options: [{ value: 'same_day', label: 'Same day' }, { value: 'fast', label: 'Fast' }, { value: 'medium', label: 'Medium' }, { value: 'slow', label: 'Slow' }] },
        col.created()
      ],
      minWidth: 1280
    })
  };
  SPECS.engagement.sortBy = 'days';

  /**
   * Summary-card filters per table. Each card value maps to a filter in the
   * table's own state, so the table's Clear filters resets it.
   */
  var SEGMENTS = {
    qlContacts: { column: 'status', values: { qualified: ['qualified'], not_qualified: ['not_qualified'] } },
    qlOpportunities: { column: 'contact_record', values: { missing_contacts: ['missing'] } },
    consultationBooking: { column: 'booking', values: { booked: ['booked'], not_booked: ['not_booked'] } },
    responseTime: { column: 'status', values: { responded: ['responded'], awaiting_response: ['awaiting_response'] } },
    showRate: { column: 'attendance', values: { showed: ['showed', 'progressed'], no_show: ['no_show'], cancelled: ['cancelled'], pending: ['pending'] } },
    caseValue: { column: 'status', values: { open: ['open'], won: ['won'], lost: ['lost'] } },
    consultationsHeld: { column: 'segments', match: true, values: { booked: ['booked'], not_booked: ['not_booked'], confirmed: ['confirmed'], progressed: ['progressed'], open: ['open'] } },
    engagement: { column: 'speed', values: { same_day: ['same_day'], fast: ['fast'], medium: ['medium'], slow: ['slow'] } }
  };

  /** The table filter a summary card applies, or null for "all". */
  function segmentFilter(key, segment) {
    var config = SEGMENTS[key];
    if (!config || !segment || segment === 'all') return null;
    var values = config.values[segment];
    if (!values) return null;
    if (config.match) {
      return {
        column: config.column,
        operator: 'match',
        value: { values: values.slice(), test: function (cell) { return Array.isArray(cell) && values.some(function (v) { return cell.indexOf(v) !== -1; }); } }
      };
    }
    return { column: config.column, operator: 'in', value: values.slice() };
  }

  function applySegment(table, key, segment) {
    var config = SEGMENTS[key];
    if (!table || !config) return;
    var filter = segmentFilter(key, segment);
    if (filter) table.addFilter(filter.column, filter.operator, filter.value);
    else table.removeFilter(config.column);
  }

  /** Spec for a distribution visualization (label / count / value rows). */
  function distributionSpec(viz, uniqueId) {
    var v = viz || {};
    var columns = (v.columns || [
      { field: 'label', header: 'Label' },
      { field: 'count', header: 'Count' },
      { field: 'value', header: 'Value', format: 'percent' }
    ]).map(function (c, index) {
      var kind = c.format === 'percent' ? 'percent'
        : c.format === 'currency' ? 'currency'
          : (c.field === 'count' || c.format === 'number') ? 'number'
            : index === 0 ? 'name' : 'text';
      return { key: c.field, label: c.header || c.field, kind: kind, width: index === 0 ? '' : '140px' };
    });
    var first = columns[0] ? columns[0].key : '';
    var countColumn = columns.filter(function (c) { return c.kind === 'number'; })[0];
    return {
      id: 'insightsDist' + String(uniqueId || '').replace(/[^A-Za-z0-9_-]/g, ''),
      title: v.title || 'Table',
      noun: ['row', 'rows'],
      light: true,
      sortBy: countColumn ? countColumn.key : first,
      sortDir: countColumn ? 'desc' : 'asc',
      minWidth: 480,
      searchPlaceholder: 'Search...',
      emptyText: 'No data available',
      columns: columns
    };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /**
   * Mounts (or re-filters) a drill-down table in container. input is the
   * page's state object for that drill-down (window.qualifiedLeadsData etc.);
   * calling again with the same container, key and input only applies the
   * summary-card segment, so card clicks keep the table's search and sort.
   * options = { segment, title }
   */
  function render(container, key, input, options) {
    var opts = options || {};
    var k = kit();
    if (!container || !k || !SPECS[key] || !rows[key]) return Promise.resolve(null);
    var current = container.__insightsTable;
    if (current && current.key === key && current.input === input) {
      return current.promise.then(function (controller) {
        if (controller) applySegment(controller.table, key, opts.segment);
        return controller;
      });
    }
    var spec = Object.assign({}, SPECS[key], opts.title ? { title: opts.title } : {});
    var note = truncationNote();
    var host = container;
    if (note) {
      container.innerHTML = note + '<div data-insights-table-host></div>';
      host = container.querySelector('[data-insights-table-host]');
    }
    var promise = k.mount(host, spec, { rows: rows[key](input) }).then(function (controller) {
      applySegment(controller.table, key, opts.segment);
      return controller;
    });
    container.__insightsTable = { key: key, input: input, promise: promise };
    return promise;
  }

  function renderDistribution(container, viz, tableData, uniqueId) {
    var k = kit();
    if (!container || !k) return Promise.resolve(null);
    return k.mount(container, distributionSpec(viz, uniqueId), { rows: rows.distribution({ rows: tableData }) });
  }

  var moduleApi = {
    PAGE_SIZE: PAGE_SIZE,
    MAX_ROWS: MAX_ROWS,
    fetchConnectorData: fetchConnectorData,
    resetFetchNotes: resetFetchNotes,
    truncatedEntities: truncatedEntities,
    truncationNote: truncationNote,
    formatHours: formatHours,
    rows: rows,
    SPECS: SPECS,
    SEGMENTS: SEGMENTS,
    segmentFilter: segmentFilter,
    distributionSpec: distributionSpec,
    render: render,
    renderDistribution: renderDistribution
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.LanaInsightsTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : globalThis);
