# Lana AI Client v3.0.0 Release Notes

**Release Date:** January 2025
**Tag:** v3.0.0

---

## Highlights

This major release brings significant improvements to conversation management, insights dashboards, document editing, and the Electron desktop client experience.

---

## New Features

### Conversation Management
- Add conversation management modals to all pages (settings, admin, help, FAQ, articles)
- Implement matter conversation creation and navigation flow
- Update conversation search to use backend semantic search
- Fix menu scrolling to only scroll conversation list

### Insights & Analytics Dashboards
- Implement comprehensive drilldown insights rendering with interactive tables
- Add horizontal bar charts, pie charts, and time-series visualizations
- Add Data Quality Insights section to qualified leads modal
- Make all insight cards clickable with table filtering
- Add full-screen drilldown modals
- Implement cell-level tooltips with popover for drilldown tables
- Add markdown rendering support to help text modals
- Support conditional bar coloring and improved tooltips

### Document Editor (Tiptap)
- Implement Tiptap editor with Notion-style UX for document templates
- Add comprehensive table support (insert, delete rows/columns)
- Add hyperlink button to bubble menu
- Implement browser-based print-to-PDF solution
- Add PDF and Word document download functionality

### Integrations
- Add Burst API configuration and storage
- Implement Leadly CRM integration with job history and pipeline view
- Add Funnels, Funnel Pages, and Calendar Groups sync options
- Enhance ActionStep integration with detailed pipeline and auto-configuration
- Create generic integration configuration page for registry-based connectors
- Add directory browser UI for ActionStep connector configuration

### Help & Support
- Add comprehensive Help & Support system with FAQ and contact form
- Add chat UX improvements and help system

### Desktop Client (Electron)
- Add back/forward navigation hotkeys
- Add professional loading screen to prevent FOUC (Flash of Unstyled Content)
- Implement pure HTML/CSS preloader with local-first Tailwind loading
- Add Electron build icons for multi-platform distribution
- Store Burst API key and configuration in electron storage
- Fix Electron file:// protocol relative path resolution

---

## Improvements

### UI/UX Enhancements
- Make module dropdown 100% JSON-driven
- Consolidate insights reports into unified Reports page with category tags
- Add Learn More button and module info modal to execution dashboard
- Reorganize menu: Move Workflows to Main section, rename Module Execution to Reports
- Add selection chips for document editor AI features
- Replace horizontal bar chart with custom flow funnel visualization
- Add password visibility toggle to settings page
- Update password requirement to 8 characters

### Data Display
- Support showValueWithLegend flag in badge renderer
- Add response speed badge colors to renderer
- Show legend text instead of raw numbers in badge columns
- Fix decimal precision for avg response time metric
- Add description support to pie chart visualizations

### Pagination & Search
- Add page number buttons to Job History pagination
- Fix pagination showing '1 to 0' when there are 0 results
- Replace debounced search with Search button for better control
- Update Job History pagination to 25 items per page

---

## Bug Fixes

- Fix orphaned document viewer to use modal + add .docx library support
- Fix matter name display for LANA matters
- Fix ActionStep dashboard to display ready documents count
- Fix tailwind-loader.js path calculation bug
- Fix loading spinner not hiding when drilldown data loads
- Fix help modal to support new helpText structure
- Fix qualified_leads drilldown to use Set union for accurate count
- Remove API limits from drilldown functions to match metric calculations
- Fix audit logs pagination and UI display issues
- Fix CSV icon not showing in matter details
- Fix JavaScript errors after Leadly card reorganization

---

## Technical Changes

- Add bundled electron files, icons, docs, and tests
- Add macOS code signing entitlements file
- Implement extensible connector schema system with frontend renderers
- Add chunked file uploader for large file uploads
- Filter connector catalog by is_active field
- Add comprehensive console logging for debugging

---

## Breaking Changes

None

---

## Upgrade Instructions

1. Download the appropriate installer for your platform:
   - **macOS (Apple Silicon):** `LanaAI--genesis--3.0.0-arm64.dmg`
   - **macOS (Intel):** `LanaAI--genesis--3.0.0-x64.dmg`
   - **Windows:** `LanaAI--genesis--3.0.0-setup.exe`
   - **Linux:** `LanaAI--genesis--3.0.0.AppImage` or `.deb`

2. Install the new version (it will replace the previous installation)

3. The app will automatically connect to your configured server

---

## Contributors

Red Rooster Technologies Team

---

## Full Changelog

See commits between v2.0.0 and v3.0.0:
```
git log v2.0.0..v3.0.0 --oneline
```
