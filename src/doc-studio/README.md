# Doc Studio

Doc Studio is the Lana client app for generating documents, presentations,
PDF/PPTX exports, shareable viewers, and legal documents with signature capture.

Frontend ownership:

- Canonical client route: `doc-studio/index.html`
- Legacy redirect route: `deck-studio/index.html`
- Shared app switcher id: `doc-studio`

Backend compatibility:

- REST API remains under `/api/v1/deck-studio` to avoid breaking saved clients.
- Viewer links support `/doc-studio/p/:id`; `/deck-studio/p/:id` remains a
  compatibility alias.
- Backend implementation lives in `LANA-AI/src/features/deck-studio/backend`.

Discovery menu schema:

```json
{
  "id": "doc-studio",
  "label": "Doc Studio",
  "description": "Generate decks, legal documents, PDFs, and pages",
  "route": "doc-studio/index.html",
  "colors": ["#2f6f73", "#b56b45", "#17201f", "#f7f4ef"]
}
```
