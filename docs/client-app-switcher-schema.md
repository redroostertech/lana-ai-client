# Client App Switcher Schema

The login flow stores the discovery response field `enabled_apps` as `enabledApps`
inside `localStorage.lana_saved_server`. The sidebar app switcher renders from
that array.

Each enabled app may be a string id or an object:

```json
{
  "id": "doc-studio",
  "label": "Doc Studio",
  "description": "Generate decks, legal documents, PDFs, and pages",
  "route": "doc-studio/index.html",
  "colors": ["#2f6f73", "#b56b45", "#17201f", "#f7f4ef"]
}
```

Known catalog ids:

- `lana-works`
- `lana-agents`
- `lana-insights`
- `doc-studio`

Aliases such as `deck-studio`, `documents`, `business-intelligence`, and
`insights` are normalized by the sidebar, but discovery should prefer the
canonical ids above.
