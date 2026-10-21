/**
 * admin-dashboard-tables.js
 * The Recent Users and Recent Matters previews on admin/dashboard.html as
 * client-side lex-tables (docs/TABLE-STANDARD.md). They show the newest few
 * records; "View All" opens the full list, so there is no toolbar.
 *
 * Public API (window.AdminDashboardTables, or module.exports in Node):
 *   - RECENT_LIMIT
 *   - mapUser(user), mapMatter(matter)  -> raw rows
 *   - userRenderers(), matterRenderers() -> lex-table renderers
 *   - userFilters(rows), matterFilters(rows) -> header filters
 *
 * @requires admin-table-kit.js, admin-client-tables.js, lex.utils.js
 */

(function (global) {
  'use strict';

  var RECENT_LIMIT = 5;
  var MATTER_STATUS_COLORS = { active: 'green', open: 'green', pending: 'yellow', on_hold: 'yellow', closed: 'gray', archived: 'gray' };

  function kit() { return global.AdminTableKit; }
  function client() { return global.AdminClientTables; }
  function humanize(value) {
    return global.Lex && global.Lex.Utils ? global.Lex.Utils.humanizeLabel(value) : String(value || '');
  }

  function mapUser(user) {
    var name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || user.email || '';
    return {
      id: String(user.id || user.email || ''),
      name: name,
      email: user.email || '',
      status: user.is_active === false ? 'inactive' : 'active',
      created_at: user.created_at || '',
      _raw: user
    };
  }

  function mapMatter(matter) {
    return {
      id: String(matter.id || matter.matter_id || ''),
      name: matter.name || matter.title || matter.matter_id || '',
      matter_id: matter.matter_id || matter.id || '',
      organization_name: matter.organization_name || '',
      status: matter.status || '',
      created_at: matter.created_at || '',
      _raw: matter
    };
  }

  function textCell(val) {
    var k = kit();
    return val ? '<span class="admin-table-text" title="' + k.esc(val) + '">' + k.esc(val) + '</span>' : k.muted('');
  }

  function userRenderers() {
    var k = kit();
    return {
      name: function (val) { return val ? k.nameCell(val) : k.muted(''); },
      email: textCell,
      status: function (val) { return k.badge(humanize(val), val === 'active' ? 'green' : 'gray'); },
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function matterRenderers() {
    var k = kit();
    return {
      name: function (val, row) { return row && row.matter_id ? k.matterLink(row.matter_id, val) : k.nameCell(val); },
      organization_name: textCell,
      status: function (val) { return val ? k.badge(humanize(val), MATTER_STATUS_COLORS[val] || 'gray') : k.muted(''); },
      created_at: function (val) { return k.timeCell(val); }
    };
  }

  function userFilters(rows) {
    var c = client();
    return {
      name: { text: true, placeholder: 'Name contains...' },
      email: { text: true, placeholder: 'Email contains...' },
      status: { options: kit().labelOptions(['active', 'inactive']) },
      created_at: c.dateFilter()
    };
  }

  function matterFilters(rows) {
    var c = client();
    return {
      name: { text: true, placeholder: 'Matter contains...' },
      organization_name: { options: c.valueOptions(rows, 'organization_name', String) },
      status: { options: c.valueOptions(rows, 'status') },
      created_at: c.dateFilter()
    };
  }

  var moduleApi = {
    RECENT_LIMIT: RECENT_LIMIT,
    mapUser: mapUser,
    mapMatter: mapMatter,
    userRenderers: userRenderers,
    matterRenderers: matterRenderers,
    userFilters: userFilters,
    matterFilters: matterFilters
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = moduleApi;
  }
  if (global) {
    global.AdminDashboardTables = moduleApi;
  }
})(typeof window !== 'undefined' ? window : this);
