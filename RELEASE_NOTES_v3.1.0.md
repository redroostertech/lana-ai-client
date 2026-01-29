## Lana AI Client v3.1.0

**Release Date:** January 2026
**Tag:** v3.1.0

---

## Highlights

This release introduces conflict detection and similar matters analysis, a comprehensive audit event classification system, admin health dashboards, management boards with analytics, and significant session resilience improvements for the Electron desktop client.

---

## New Features

### Conflict Detection & Similar Matters
- Add conflict detection engine to flag potential conflicts across matters
- Add similar matters widget for surfacing related cases during matter creation and chat
- Integrate conflict detection UI into chat and matters pages

### Audit Event Classification
- Implement comprehensive audit event classification system for granular activity tracking
- Categorize and label audit events across the platform

### Health Dashboard
- Add admin health dashboard with storage utilization and token tracking
- Audit log fixes and UI cleanup for the admin panel

### Management Boards & Analytics
- Add management boards page with board components and configuration UI
- Add analytics module with activity heatmap and session tracking
- Add session tracking CSS and session tracker module for Electron
- Add metrics catalog configuration for analytics
- Temporarily hide Management Boards from admin navigation pending finalization

### Leadly Integration Enhancements
- Add date range picker to Leadly integration dashboard
- Add refresh button improvements for Leadly data sync

### Google Drive Integration
- Add Google Drive connector support with document browsing and file viewer
- Update connector documents page for Google Drive compatibility

### Session & Authentication Resilience
- Add automatic token refresh mechanism to prevent session expiration
- Clear session and redirect to login on unreachable server
- Preserve navigation parameters across login redirects
- Add localStorage fallback for server URL resolution

### Reports Navigation
- Add Reports sidebar navigation entry to module execution insights

### User Management
- Display `role_display_name` in user details drawer

---

## Improvements

### UI/UX Enhancements
- Fix dropdown caret overlap with `.select-standard` CSS component across admin plugins, sessions, users, matters, and timeline pages
- Fix dropdown caret UI in New Matter modal
- Fix tagging ID display to show clean `@Name` format instead of raw IDs
- Update copyright year to 2026 across all authentication and error pages
- Update password minimum length from 12 to 8 characters in admin user management

### Build Process
- Fix version string inconsistency between Electron and web builds
- Update build scripts for consistent versioning

---

## Bug Fixes

- Fix citation click handlers breaking with special characters in document titles
- Fix broken conversation menu three-dot modal
- Fix chat deletion UI refresh bug (conversation list not updating after delete)
- Fix content formatting and paste handling in chat input
- Fix document chunking issues in storage and matters pages
- Fix ActionStep dashboard job filtering and add cancel confirmation modal
- Fix redirect to login on missing server URL instead of throwing unhandled error
- Remove duplicate `session-tracker:start` IPC handler in Electron main process
- Improve error message parsing in API client for clearer error display

---

## Technical Changes

- Add session tracker module (`js/session/session-tracker.js`) for Electron
- Add Electron preload script updates for session tracking IPC
- Add metrics catalog JSON configuration (`config/metrics-catalog.json`)
- Add management board components module
- Add conflict detection and similar matters JavaScript modules
- Add JSON rendering test file

---

## Breaking Changes

None

---

## Upgrade Instructions

1. Download the appropriate installer for your platform:
   - **macOS (Apple Silicon):** `LanaAI--genesis--3.1.0-arm64.dmg`
   - **macOS (Intel):** `LanaAI--genesis--3.1.0-x64.dmg`
   - **Windows:** `LanaAI--genesis--3.1.0-setup.exe`
   - **Linux:** `LanaAI--genesis--3.1.0.AppImage` or `.deb`

2. Install the new version (it will replace the previous installation)

3. The app will automatically connect to your configured server

---

## Contributors

Red Rooster Technologies Team

---

## Full Changelog

See commits between v3.0.0 and v3.1.0: https://github.com/redroostertech/lana-ai-client/compare/v3.0.0...v3.1.0
