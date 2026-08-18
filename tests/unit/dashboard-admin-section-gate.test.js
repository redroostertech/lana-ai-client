/**
 * Regression: dashboard sections whose data sits behind the API permission
 * middleware must be hidden from non-admins, not rendered with "-" placeholders
 * that never resolve.
 *
 * Observed against the live API with a plain "User" role token:
 *   403 /api/v1/dashboard-widgets              Permission required: dashboard:read
 *   403 /api/v1/admin/health/storage           One of the following permissions
 *                                              required: admin:access, org:manage
 *   403 /api/v1/activity/organization/*        Only admins can view organization-wide ...
 *
 * The gate is role-based (org_admin / system_admin), matching Lex.Auth.
 */
const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relativePath), 'utf8');
}

describe('dashboard admin section gate', () => {
  const source = read('src/js/dashboard/dashboard.js');

  test('defines the gate and keys it on the admin role helper', () => {
    expect(source).toContain('function applyAdminSectionGate()');
    // canViewStatus is the local alias for Lex.Auth.canViewSystemStatus,
    // i.e. system_admin || org_admin || organization_admin.
    expect(source).toMatch(/applyAdminSectionGate\(\)\s*\{\s*var isAdmin = canViewStatus\(\);/);
  });

  test('canViewStatus is bound to the org/system admin helper', () => {
    expect(source).toContain('var canViewStatus  = Lex.Auth.canViewSystemStatus;');
  });

  test('hides the stat tile row and the Activity Overview card', () => {
    const gate = source.slice(
      source.indexOf('function applyAdminSectionGate()'),
      source.indexOf('function heartbeatAppEnabled()')
    );

    expect(gate).toContain("hide('ccZoneE')");
    expect(gate).toContain("hide('userProductivityWidget')");
    // The metric detail panel only opens from a Zone E tile, so it goes too.
    expect(gate).toContain("hide('ccDetailPanel')");
  });

  test('returns early for admins so nothing is hidden', () => {
    const gate = source.slice(
      source.indexOf('function applyAdminSectionGate()'),
      source.indexOf('function heartbeatAppEnabled()')
    );

    expect(gate).toMatch(/if \(isAdmin\) return true;/);
  });

  test('runs before the zone fan-out so sections never flash empty', () => {
    const gateCall = source.indexOf('applyAdminSectionGate()');
    const fanOut = source.indexOf('var zoneResults = await Promise.allSettled');

    expect(gateCall).toBeGreaterThan(-1);
    expect(fanOut).toBeGreaterThan(gateCall);
  });

  test('skips the activity requests that feed the hidden card', () => {
    expect(source).toContain('showAdminSections ? loadUserProductivity(null) : Promise.resolve()');
    expect(source).toContain('showAdminSections ? loadActivityForUser(null) : Promise.resolve()');
  });

  test('still runs renderZoneE, which supplies the Zone A matters count', () => {
    // Zone E's container is hidden but its fetch must survive: zoneResults[1]
    // is read for the matters pill.
    expect(source).toContain('renderZoneE(),              // 1 — pipeline stats');
    expect(source).not.toMatch(/showAdminSections \? renderZoneE\(\)/);
  });
});

describe('signals row collapses when the Activity Overview is gated away', () => {
  const css = read('src/css/dashboard-command-center.css');

  test('drops to a single full-width column', () => {
    expect(css).toContain('.cc-signals-row:has(> #userProductivityWidget.hidden)');
    expect(css).toContain('.cc-signals-row:has(> #ccZoneFBillable.hidden)');
  });

  test('does not collapse on the default-hidden Data Pulse container', () => {
    // #ccZoneFRight ships with the `hidden` attribute in normal operation, so a
    // bare `:has(> .hidden)` would wrongly collapse the row for everyone.
    expect(css).not.toMatch(/\.cc-signals-row:has\(>\s*\.hidden\s*\)/);
    expect(css).not.toMatch(/\.cc-signals-row:has\(>\s*\[hidden\]\s*\)/);
  });
});

describe('Data Connectors is admin-only in every menu', () => {
  test('dynamic menu gates all app-context variants on ADMIN_ROLES', () => {
    const menu = read('src/js/menu.js');
    const entries = menu.match(/\{ id: 'connectors',[^}]*\}/g) || [];

    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry) => {
      expect(entry).toContain('requiredRoles: ADMIN_ROLES');
    });
  });

  test('settings dropdown and topbar menu gate it on showAdmin', () => {
    const app = read('src/js/lex/components/layout/lex-app.js');

    // Both pushes must sit inside a showAdmin branch.
    const sidebarPush = /if \(showAdmin\) \{\s*(?:\/\/[^\n]*\n\s*)*menuItems\.push\(\{ id: 'connectors'/;
    const topbarPush = /if \(showAdmin\) \{\s*topbarMenuItems\.push\(\{ id: 'connectors'/;

    expect(app).toMatch(sidebarPush);
    expect(app).toMatch(topbarPush);
  });
});
