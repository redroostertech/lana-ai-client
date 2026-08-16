# LANA Desktop Deep Links

`lana-ai://` links are handled by Electron in `electron-main.js`. The handler is intentionally allowlisted: callers can open known client routes and forward only route-approved query parameters.

Production builds register `lana-ai://` through the packaged app metadata in `electron-builder.client.json`. macOS development builds use `./install.sh` to install `~/.lana-client/LanaAIDevHelper.app`, which forwards links to a running packaged app when present and otherwise launches this checkout's Electron entry with the deep-link URL.

## Canonical Object Links

Use these when linking to common app objects:

| Target | Deep link |
| --- | --- |
| Workspace / matter | `lana-ai://workspace/<matter-id>` |
| Workspace generated work product | `lana-ai://open?route=workspace-details.html&id=<matter-id>&artifact=<artifact-id>` |
| Document / file | `lana-ai://file/<document-id>` |
| Approval | `lana-ai://approval/<approval-id>` |
| Task | `lana-ai://task/<task-id>` |
| Notification | `lana-ai://notification/<notification-id>` |
| Agent catalog | `lana-ai://agents/catalog` |
| Agent detail | `lana-ai://agent/<agent-slug>` |
| Agent run | `lana-ai://agent-run/<run-id>` |
| Agent activity item | `lana-ai://agent-activity/<activity-id>` |
| Automation library | `lana-ai://automations/library` |
| Automation detail | `lana-ai://automation/<automation-id>` |
| Doc Studio document | `lana-ai://doc-studio/<document-id>` |
| Deck Studio deck | `lana-ai://deck/<deck-id>` |
| Settings section | `lana-ai://settings/<section>` |
| Insights dashboard | `lana-ai://insights/dashboard` |
| Insights predictions | `lana-ai://insights/predictions` |
| Insights module execution | `lana-ai://insights/module-execution?id=<execution-id>` |
| Connector detail | `lana-ai://connector/<connector-id>` |

## Generic Route Links

For less common screens, use:

```text
lana-ai://open?route=<client-route>&<allowed-query-params>
```

Hash-routed sub-apps can use either `hash=` or a URL fragment:

```text
lana-ai://open?route=agents/index.html&hash=run/<run-id>
lana-ai://open?route=automation/index.html&hash=automation/<automation-id>
```

## Phase-One Allowlist

These client routes are supported by the OS protocol handler for this phase:

| Area | Routes |
| --- | --- |
| Core | `dashboard.html`, `workspaces.html`, `workspace-details.html`, `workspace-data.html`, `matters.html`, `matters/timeline.html`, `my-tasks.html`, `action-queue.html`, `notifications.html`, `alerts.html`, `approvals.html`, `approval-detail.html`, `search-results.html`, `search-conversations.html`, `settings-v2.html` |
| Documents | `file-viewer.html`, `drive.html`, `folder.html`, `doc-studio/index.html`, `deck-studio/index.html`, `document-studio-templates.html` |
| Agents | `agents/index.html` with hashes: `catalog`, `activity`, `create`, `tools/browse`, `agent/<slug>`, `run/<run-id>`, `activity/<id>` |
| Automations | `automation/index.html` with hashes: `home`, `library`, `builder`, `runs`, `approvals`, `connectors`, `automation/<automation-id>` |
| Insights | `insights/dashboard.html`, `insights/predictions.html`, `insights/module-execution.html` |
| Integrations | `data-connectors.html`, `integrations/connectors.html`, `integrations/connector-viewer.html`, `integrations/actionstep.html`, `integrations/connector-case.html`, `integrations/connector-communications.html`, `integrations/connector-crm.html`, `integrations/connector-documents.html`, `integrations/connector-financial.html`, `integrations/data_connectors.html`, `integrations/integration-config.html`, `integrations/leadly.html`, `integrations/sync-status.html` |
| Skills and workflows | `skills.html`, `skills-marketplace.html`, `matter-skills.html`, `workflows/active.html`, `workflows/builder.html`, `workflows/dashboard.html`, `workflows/execution-logs.html`, `workflows/follow-up-cadences.html`, `workflows/retargeting.html`, `workflows/templates.html` |
| Admin | `admin/index.html`, `admin/dashboard.html`, `admin/alerts.html`, `admin/analytics.html`, `admin/audit.html`, `admin/billable-hours.html`, `admin/block-billing-rules.html`, `admin/communications.html`, `admin/console.html`, `admin/dashboard-builder.html`, `admin/dashboard-detail.html`, `admin/dashboard-library.html`, `admin/data-visualization.html`, `admin/health.html`, `admin/integrations.html`, `admin/management-boards.html`, `admin/metric-catalog.html`, `admin/metric_detail.html`, `admin/onboarding_management.html`, `admin/organizations.html`, `admin/plugins.html`, `admin/relevance-labeling.html`, `admin/reporting.html`, `admin/roles.html`, `admin/roles_manager.html`, `admin/search-analytics.html`, `admin/session-details.html`, `admin/sessions.html`, `admin/settings.html`, `admin/task-plans.html`, `admin/traces.html`, `admin/updates.html`, `admin/user-details.html`, `admin/users.html`, `admin/workspace-analytics.html` |
| Help and misc | `article.html`, `help.html`, `faq.html`, `docs/api-documentation.html`, `model-pricing.html`, `recordings.html`, `recording-detail.html`, `brainchild/index.html` |

Authentication and error pages are intentionally not part of the public object-link surface. OAuth and connect links remain separate protocol flows:

```text
lana-ai://connect/<org-id>
lana-ai://oauth/callback?provider=<provider>&...
```

## Safety Rules

- Unknown routes are rejected.
- Query parameters are copied only if the destination route declares them.
- Parameter values are capped to avoid oversized OS-level payloads.
- Hashes are supported only for internal app navigation and reject control characters.
