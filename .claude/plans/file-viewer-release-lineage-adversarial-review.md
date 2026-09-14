# File Viewer release lineage adversarial review

## Scope

- Remove the 20-release predecessor correctness boundary from File Viewer lineage loading.
- Preserve the exact immediate predecessor used by Show changes for releases beyond the first page.
- Distinguish a missing or failed release edit-batch detail request from a valid empty batch.
- Verify release-list metadata reports the real lineage total.
- Add regression coverage without changing service processes or using browser debugging protocols.

## Implementation

1. Add exact predecessor identity to every server release row before pagination and prefer it in the shared review datasource.
2. Page through the complete release lineage so older versions remain selectable in the release rail and arbitrary comparisons.
3. Carry `failed` through release change groups and render an explicit unavailable state in the change rail and comparison surface.
4. Add a repository count query and return the true release total from the backend service.
5. Add focused unit tests for more than 20 releases, batch-detail failure, predecessor behavior, and release totals.

## Deferred gap

The current compare endpoint is text-only. Aggregating intermediate edit batches does not produce a true formatting state comparison because formatting changes may cancel or overlap. A correct arbitrary non-adjacent formatting diff requires deterministic DOCX formatting extraction in the server comparison substrate. This review will document that as a follow-up rather than ship a misleading approximation.
