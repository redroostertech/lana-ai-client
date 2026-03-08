# LANA AI Reporting System - Client Documentation

**Status:** Active | **Version:** 2.0.0 | **Updated:** 2026-03-05

Frontend documentation for the LANA AI Reporting System. The reporting UI renders config-driven reports from backend API responses -- no frontend code changes are needed to add new report modules.

For backend documentation (module engine, module configs, API), see: `LANA-AI/docs/reporting/`

---

## Documentation Index

| Document | What It Covers |
|----------|---------------|
| **[SYSTEM_DESIGN.md](./SYSTEM_DESIGN.md)** | Frontend architecture, page structure, controller, renderers, drilldown system, modals, data flow |
| **[API.md](./API.md)** | API endpoints consumed by the frontend, request/response formats |
| **[CODING_STYLE_GUIDE.md](./CODING_STYLE_GUIDE.md)** | Frontend patterns, component conventions, renderer API, naming rules |

### Tutorials

| Tutorial | What You'll Learn |
|----------|------------------|
| **[tutorials/HOW_TO_EXTEND.md](./tutorials/HOW_TO_EXTEND.md)** | Adding new visualization renderers, new UI features, new modals |
| **[tutorials/HOW_TO_MODIFY.md](./tutorials/HOW_TO_MODIFY.md)** | Changing page layout, updating metric card rendering, adjusting period presets |
| **[tutorials/HOW_TO_DEBUG.md](./tutorials/HOW_TO_DEBUG.md)** | Debugging chart rendering, drilldown issues, API errors, browser console |

---

## Quick Links

| File | Purpose |
|------|---------|
| `src/admin/reporting.html` | Page template (Lex UI components) |
| `src/js/admin/reporting.js` | Page controller (~117 KB IIFE) |
| `src/js/visualizations/renderers/` | 7 ES6 Chart.js renderer files (4 imported, 3 available but not wired up) |
| `src/js/drilldown-renderer.js` | Paginated drilldown table modal |
| `src/js/vendor/chart.js` | Chart.js library |
| `src/js/vendor/jspdf.umd.min.js` | PDF export support |

---

## Key Concept

The frontend is **purely a renderer**. All report logic (metrics, queries, calculations, comparisons) lives on the backend. The frontend:

1. Lists modules from `GET /api/v1/modules`
2. Executes modules via `POST /api/v1/modules/{key}/execute`
3. Renders the response: metric cards, charts, drilldowns, insights

New modules appear automatically -- just add them on the backend.

---

**Created:** 2026-03-05 | **Author:** Red Rooster Technologies
