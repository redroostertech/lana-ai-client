# Template-Backed Insights Artifacts

## Purpose

LanaInsights currently has two overlapping product surfaces:

- Dashboards: saved BI views built from selected Metric Catalog keys.
- Firm Reporting: executable JSON module templates that render richer sections, charts, metrics, drilldowns, and report output.

The desired direction is to converge these into one platform model: schema-backed Insights artifacts. A dashboard and a report should both be render modes of the same underlying artifact contract, with the Metric Catalog as the shared foundation for metric definitions, goals, calculation lineage, and drilldown entry points.

This document defines the scope of work and integration plan. It is based on read-only audits of the current frontend, module engine, dashboard persistence flow, metric catalog/goals/drilldowns, and import/template patterns across Insights, Automations, and Agents.

## Product Model

### Working Definitions

- Metric Catalog: canonical index of metric identity, display metadata, goal configuration, usage lineage, and execution availability.
- Metric Definition: the calculation contract for a metric, owned by backend registry JSON, module JSON, or JS calculators.
- Metric Result: the executed value plus period, prior-period comparison, goal state, status, and supporting metadata.
- Visualization Block: a renderable chart, KPI card, table, text block, insight panel, or metric grid.
- Drilldown Spec: the standard row-level explanation contract for a metric, including raw rows, filters, pagination, summaries, breakdown cards, and source metadata.
- Insights Artifact: a versioned JSON composition that references catalog metrics, visual blocks, sections, filters, parameters, drilldowns, and capabilities.
- Dashboard Mode: an interactive, saved, shareable view of an Insights Artifact.
- Report Mode: an executable, exportable, schedulable, or importable view of an Insights Artifact.
- Artifact Package: a portable ZIP or JSON package that can install or upgrade artifacts from Lana, customers, partners, or a future marketplace.

### Core Principle

Dashboards and reports should not be separate visual systems. Reporting has the more complete renderer today, so the middle ground is:

1. Keep Metric Catalog as the shared foundation.
2. Extract the report renderer into a shared Insights artifact renderer.
3. Adapt existing dashboards and reporting modules into that renderer.
4. Introduce a portable artifact schema after adapters prove the runtime contract.
5. Defer DB topology decisions until the product contract is stable.

## Current Code Landscape

### Frontend Surfaces

- `lana-client/src/admin/reporting.html`
- `lana-client/src/js/admin/reporting.js`
- `lana-client/src/admin/dashboard-library.html`
- `lana-client/src/js/admin/dashboard-library.js`
- `lana-client/src/admin/dashboard-detail.html`
- `lana-client/src/js/admin/dashboard-detail.js`
- `lana-client/src/admin/dashboard-builder.html`
- `lana-client/src/js/admin/dashboard-builder.js`
- `lana-client/src/js/admin/metric-catalog.js`
- `lana-client/src/js/shared/metric-card-preview.js`
- `lana-client/src/js/visualizations/chart-factory.js`
- `lana-client/src/js/drilldown-renderer.js`
- `lana-client/src/js/api.js`

Reporting already behaves like an artifact renderer. `reporting.js` executes a module, receives a payload with `ui.sections`, `visualizations`, `metrics`, and `timeSeries`, then dispatches chart and card rendering by visualization type.

Dashboard Detail is lighter. It loads a saved BI dashboard, fetches `/api/v1/modules/dashboard-metric-cards`, filters the response by `layout.metric_keys`, and renders grouped metric cards. The saved dashboard layout is currently an inclusion list, not a complete render schema.

Metric Catalog is the bridge, but it currently mirrors presentation logic. `metric-card-preview.js` explicitly duplicates dashboard/report card rendering behavior, which is a good extraction candidate.

### Backend Surfaces

- `lana-ai-chef/@insights/modules/schemas/dashboard.schema.json`
- `lana-ai-chef/@insights/modules/schemas/metric-registry.schema.json`
- `lana-ai-chef/@insights/modules/core/*.json`
- `lana-ai-chef/@insights/modules/reporting/*.json`
- `lana-ai-chef/@insights/modules/reporting/index.json`
- `lana-ai-chef/@insights/scripts/seed-modules-from-disk.js`
- `lana-ai-chef/src/services/processor/routes/modules.routes.js`
- `lana-ai-chef/src/services/processor/routes/module-drilldown.routes.js`
- `lana-ai-chef/src/services/processor/routes/module-drilldown-export.routes.js`
- `lana-ai-chef/src/services/modules/module-engine.service.js`
- `lana-ai-chef/src/services/modules/module-config.schema.js`
- `lana-ai-chef/src/services/modules/metric-registry.service.js`
- `lana-ai-chef/src/services/modules/metric-insights.service.js`
- `lana-ai-chef/src/services/modules/metric-goals.service.js`
- `lana-ai-chef/src/services/modules/metric-lineage.service.js`
- `lana-ai-chef/src/services/processor/dashboard-widgets/widget-data-resolver.service.js`
- `lana-ai-chef/src/services/processor/business-intelligence/business-intelligence.routes.js`
- `lana-ai-chef/src/services/processor/business-intelligence/business-intelligence.validators.js`
- `lana-ai-chef/src/services/processor/reporting/report-import.routes.js`
- `lana-ai-chef/src/services/processor/reporting/report-import.service.js`
- `lana-ai-chef/src/services/processor/reporting/reporting.validators.js`

The module engine already supports template-backed module JSON. Current module JSON validation passes for the checked-in package, but runtime validation has drifted from the authoring schema. That drift needs to be resolved before marketplace-style artifact imports are trusted.

Dashboard metric cards are catalog-driven. Module reporting is module-execution-driven. Metric detail uses `widgetDataResolver` and returns preview-level raw rows. Generic module drilldowns already support rows, summaries, filters, pagination, breakdown cards, and row inspection, but they are scoped to `moduleKey + metricKey`.

### Existing Dashboard Shape

The admin dashboard builder currently persists a shape like:

```json
{
  "name": "Growth & Pipeline",
  "description": "Growth and pipeline metrics",
  "layout": {
    "dashboard_type": "owner",
    "metric_keys": ["legal_firm.finance.gross_revenue_total"],
    "source": "metric_catalog"
  },
  "filters": {},
  "is_default": false
}
```

Important constraints:

- `metric_keys` is an inclusion list, not a layout model.
- Card order comes from backend metric-card sorting, not selected order.
- Empty `metric_keys` means "show all fetched metrics."
- `dashboard_type` controls the candidate metric universe.
- The detail page has a short-key fallback that can collide on trailing metric names.
- Stale metric keys silently disappear when the metric-card feed no longer returns them.

### Existing Reporting Shape

Module execution returns an artifact-like payload:

```json
{
  "moduleName": "Matter Aging Analysis",
  "moduleDescription": "Analyze matters by age since last contact",
  "period": {},
  "priorPeriod": {},
  "dataSources": [],
  "ui": {
    "sections": []
  },
  "visualizations": [],
  "metrics": [],
  "timeSeries": []
}
```

Visualization blocks currently include types such as:

- `metric_grid`
- `time_series`
- `comparison_chart`
- `pie_chart`
- `funnel_chart`
- `funnel_insight_panels`
- `bubble_chart`
- `grouped_bar_chart`
- `bar_chart`
- `attribution_summary`
- `table`

This is the best starting point for the shared renderer.

## Proposed Artifact Contract

### Logical Shape

```json
{
  "kind": "insights_view",
  "schemaVersion": "1.0.0",
  "artifactKey": "firm_financial_overview",
  "artifactVersion": "1.0.0",
  "mode": "dashboard",
  "name": "Firm Financial Overview",
  "description": "Firm-wide financial health and trend overview",
  "capabilities": ["interactive", "exportable", "schedulable"],
  "dependencies": {
    "metrics": ["legal_firm.finance.gross_revenue_total"],
    "entities": ["matter", "invoice"],
    "connectors": []
  },
  "parameters": {
    "period": {
      "defaultPreset": "last_30_days",
      "compareBy": "monthly"
    }
  },
  "sections": [
    {
      "id": "revenue",
      "title": "Revenue",
      "layout": {
        "type": "grid",
        "columns": 2
      },
      "blocks": [
        {
          "id": "gross_revenue",
          "type": "metric_card",
          "metricKey": "legal_firm.finance.gross_revenue_total",
          "visualization": {
            "type": "kpi_card",
            "comparison": "previous_period",
            "goal": true
          },
          "drilldown": {
            "enabled": true,
            "layout": "standard_table"
          }
        }
      ]
    }
  ]
}
```

### Compatibility Shape For Existing Dashboards

Existing saved dashboards should be adapted without a DB migration in the first implementation phase:

```json
{
  "kind": "insights_view",
  "schemaVersion": "0.compat.dashboard_metric_keys",
  "artifactKey": "dashboard:<dashboard_id>",
  "mode": "dashboard",
  "name": "<dashboard.name>",
  "description": "<dashboard.description>",
  "source": {
    "type": "bi_dashboard",
    "layout": {
      "dashboard_type": "<layout.dashboard_type>",
      "metric_keys": []
    }
  },
  "sections": [
    {
      "id": "metrics",
      "title": "Metrics",
      "blocks": []
    }
  ]
}
```

The adapter should hydrate `blocks` from `/api/v1/modules/dashboard-metric-cards` and preserve existing behavior while allowing Dashboard Detail to use the shared renderer.

## Scope Of Work

### Phase 0: Contract Decisions And Cleanup

1. Name the surviving user-facing primitive.
   Recommended: `Insights Artifact` internally, with `Dashboard` and `Report` as user-facing modes.

2. Confirm that DB consolidation is out of scope for the first pass.
   Existing BI dashboard rows, report definitions, module definitions, and report instances can remain in place while adapters normalize output.

3. Treat `@insights/modules/schemas/dashboard.schema.json` as a module-template schema, not the final dashboard artifact schema.
   The filename is confusing because it describes executable module JSON, not saved user dashboards.

4. Align runtime and authoring validation.
   `module-config.schema.js` has drifted from `dashboard.schema.json`. Resolve this before allowing broader import or marketplace behavior.

### Phase 1: Shared Frontend Renderer

Add new frontend modules under `lana-client/src/js/insights/`:

- `insights-artifact-normalizer.js`
- `insights-artifact-renderer.js`
- `insights-block-registry.js`
- `insights-metric-card.js`
- `insights-table-block.js`
- `insights-period-controls.js`

Responsibilities:

- Normalize module execution, saved dashboard metric cards, imported report output, and one-off metric previews into one artifact view model.
- Render sections and blocks through a single renderer.
- Reuse `ChartFactory` for chart blocks where possible.
- Move metric card presentation out of `reporting.js`, `dashboard-detail.js`, and `metric-card-preview.js`.
- Use `drilldown-renderer.js` as the standard drilldown UI.

First consumers:

- `reporting.js`: module execute result to artifact, then shared renderer.
- `dashboard-detail.js`: saved dashboard plus metric-card feed to artifact, then shared renderer.
- `metric-catalog.js`: selected metric preview to one-section artifact, then shared renderer.

Implementation note: fix `dashboard-detail.html` to explicitly load `js/dashboard/metric-goal-comparison.js` before `dashboard-detail.js` so goal and comparison rendering is deterministic.

### Phase 2: Backend Artifact Adapters

Add backend normalization helpers without changing storage first:

- `moduleExecutionToInsightsArtifact(result)`
- `dashboardMetricCardsToInsightsArtifact(dashboard, metrics)`
- `reportDefinitionToInsightsArtifact(report, executionResult)`
- `metricDetailToInsightsArtifact(metricDetail)`

Candidate location:

- `lana-ai-chef/src/services/modules/insights-artifacts/`

Expose optional normalized responses behind additive API behavior:

- Keep existing `/api/v1/modules/:moduleKey/execute`.
- Add an `artifact=true` query/body flag or sibling endpoint after the adapter is stable.
- Keep existing `/api/v1/modules/dashboard-metric-cards`.
- Add a saved-dashboard artifact endpoint later, for example `/api/v1/business-intelligence/dashboards/:id/artifact`.

This avoids forcing every existing client to switch at once.

### Phase 3: Drilldown Standardization

Make drilldowns catalog-addressable, not only module-addressable.

Current standard route:

- `GET /api/v1/modules/:moduleKey/metrics/:metricKey/drilldown`
- `POST /api/v1/modules/:moduleKey/metrics/:metricKey/drilldown/execute`

Needed abstraction:

```json
{
  "metricKey": "legal_firm.finance.gross_revenue_total",
  "source": {
    "type": "module_metric",
    "moduleKey": "firm_financial_overview",
    "metricKey": "gross_revenue_total"
  },
  "rows": {},
  "summary": {},
  "breakdownCards": [],
  "pagination": {}
}
```

Work items:

- Add a resolver from catalog metric key to module drilldown source.
- Preserve generic module drilldowns as the execution engine.
- Retire bespoke reporting drilldown fallbacks after metrics have proper source refs.
- Resolve the current breakdown-card contract mismatch: either cards remain global while table rows filter, or the backend applies card filters to both table rows and card queries.
- Align export with generic execute fallback before reintroducing export in the shared renderer.

### Phase 4: Portable Artifact Packages

Do not overload the current report importer. Add a new artifact package format:

```json
{
  "manifestVersion": "1.0.0",
  "type": "lana-insights-artifact-package",
  "artifactKey": "firm_financial_overview",
  "artifactType": "insights_view",
  "version": "1.0.0",
  "schemaVersion": "1.0.0",
  "publisher": {
    "name": "Lana AI"
  },
  "minPlatformVersion": "2026.08.0",
  "dependencies": {
    "metrics": [],
    "connectors": [],
    "entities": []
  },
  "entrypoints": {
    "artifact": "artifact.json",
    "module": "modules/firm_financial_overview.json",
    "report": "report/report.json"
  }
}
```

Package behavior:

- Validate by dry run before install.
- Use stable `artifactKey`, never mutable display `name`, as identity.
- Track semver and schema version independently.
- Install idempotently for the same `artifactKey + version`.
- Support conflict policies: `skip`, `upgrade`, `fork`, `replace`, `rollback`.
- Preserve tenant customizations by linking them to `artifactKey + baseVersion`.
- Mark incompatible customizations `needs_review` rather than disabling by report name.
- Store imported assets in org-scoped paths such as `orgs/{orgId}/insights/{artifactKey}/versions/{version}/...`.

Suggested future API surface:

- `GET /api/v1/insights/packages/catalog`
- `POST /api/v1/insights/packages/import`
- `POST /api/v1/insights/packages/:id/dry-run`
- `POST /api/v1/insights/packages/:id/install`
- `POST /api/v1/insights/packages/:id/rollback`

The current `/api/v1/reporting/import` route should remain as a legacy report-definition importer until artifact packages cover the same behavior.

### Phase 5: Dashboard Builder Evolution

The dashboard builder should stop treating `metric_keys` as the artifact. It should evolve to compose schema-backed sections and blocks.

Work items:

- Source available metrics from `/api/v1/modules/metric-catalog`, using execution availability and recommended visual defaults.
- Let users choose visual block type per metric: KPI card, trend chart, bar chart, table, insight panel, text, or grouped metric grid.
- Save section placement, card order, display options, filter bindings, and drilldown behavior.
- Continue writing a compatibility `layout.metric_keys` field until all detail views use the artifact model.
- Add import-from-template and fork-from-template flows.
- Keep resource sharing behavior attached to the instantiated dashboard in the first pass.

### Phase 6: Calculation Governance

Admin-editable calculations should be handled deliberately. Goals can remain editable by `system_admin` and `org_admin`; formulas and SQL should not become free-form UI edits.

Recommended governance model:

- Calculation owners:
  - JS calculator
  - QueryBuilder inline SQL
  - module metric reference
  - declarative spec
  - catalog-only planned metric
  - legacy management-board metric
- Formula, SQL, registry metadata, drilldown query, and lineage changes require PR review or a future governed draft/approve workflow.
- Free-form org override predicates, such as `qualificationRule`, should become structured allowlisted rules before non-engineering users can edit them.
- Every executable metric should expose definition source, usage lineage, goal state, drilldown availability, and last execution result.

## Validation And Safety Prerequisites

Before artifact package installation or broader schema imports:

- Make JSON Schema the runtime source of truth, or generate runtime validators from it.
- Remove or gate stale module registry auto-sync before execution.
- Route metric SQL, visualization custom SQL, drilldown SQL, widget seed SQL, summaries, and breakdown queries through one trusted query executor.
- Make status-expression support real or remove it from the supported schema.
- Make insight-expression support real or narrow the supported schema.
- Ensure visualization blocks either have executable data sources or render clearly as config-only.
- Include resolved drilldown metadata in module execution responses.

## Permissions

Current dashboard access relies on dashboard resource sharing and admin bypass. Reporting uses report permissions. Artifact packages introduce a third concept: template/package access.

Initial recommendation:

- Instantiated dashboards keep dashboard resource sharing.
- Report execution keeps reporting permissions.
- Package import/install requires `reports:write` or a new `insights:install` permission.
- Package catalog read can be broader, but install must validate connector/entity requirements.
- Child widgets/cards/questions must inherit parent dashboard/report access or explicitly validate parent access.

Do not attach end-user permissions only to the template package. Users need permissions on the instantiated artifact they actually open and share.

## Implementation Sequence

1. Add shared frontend artifact renderer behind adapters.
2. Move Reporting onto the renderer with no product behavior change.
3. Move Dashboard Detail onto the renderer with the existing `layout.metric_keys` compatibility adapter.
4. Move Metric Catalog previews onto the renderer.
5. Add backend normalized artifact adapters behind additive endpoints or flags.
6. Standardize drilldown source resolution from Metric Catalog keys.
7. Update Dashboard Builder to create section/block artifacts while still saving compatibility fields.
8. Add artifact package schema, dry-run validator, and install service.
9. Add package catalog/import UI inside LanaInsights.
10. Decide DB topology only after the artifact contract and UI renderer are stable.

## Acceptance Criteria

- A reporting module and a saved dashboard render through the same frontend artifact renderer.
- Existing saved dashboards continue to open and show the same selected metrics.
- Existing reporting modules continue to execute and display the same visual blocks.
- Metric Catalog can answer "where is this metric used" and "how is this metric calculated" from backend lineage and definition data.
- Drilldowns open through the standard drilldown UI from both dashboard and report views.
- Artifact package dry-run reports identity, dependencies, conflicts, schema compatibility, and customization impact.
- Imported artifacts use stable artifact keys and versions instead of mutable report names.
- No first-pass migration requires merging dashboard and reporting DB tables.

## Risks

- `reporting.js` is large and mixes execution, state, rendering, import, export, customizations, and drilldown behavior. Extraction should be incremental.
- Runtime validation drift can cause an artifact to validate in authoring but fail or behave differently during execution.
- Short metric-key fallback in dashboards can collide.
- Metric Catalog currently has legacy and backend-backed sources. The backend registry should become the authority.
- Query safety is inconsistent across metrics, visualizations, and drilldowns.
- Current report import identity is name-based and will not support marketplace-grade upgrades.
- Permission inheritance for dashboard cards/widgets/questions needs review before artifact composition depends on child resources.

## Open Decisions

- Should the internal object be named `insights_view`, `insights_artifact`, or `insights_template`?
- Should package installation create a dashboard, a report, a module, or a generic artifact row first?
- Should dashboard/report mode be a property of one artifact or separate installed instances from one template?
- What semver policy should be enforced for artifact upgrades?
- Should custom UI assets be allowed for marketplace artifacts, or limited to first-party/admin-installed artifacts?
- Should calculation edits ever happen in app UI, or only through a governed repository-backed workflow?

## Recommended Next Step

Start with Phase 1. It is the smallest reversible move that improves the product immediately: dashboards can look like reporting, reporting keeps its richer module behavior, and both flows begin using the same renderer before the data topology is changed.
