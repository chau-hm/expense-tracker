# Spec Slice: Item List, Search, Edit, Delete, Restore

## Behavior

Expense items have stable IDs. Chat and CLI workflows must be able to list/search items before edit/delete/restore. If the requested target is ambiguous, the app must return candidates and avoid mutating data.

This slice is still domain-level and does not touch SQLite, OCR, Telegram, or OpenClaw routing.

## Acceptance Criteria

- List/search returns only active items by default.
- Search can include deleted items through an explicit status filter.
- Search supports event, payer, category, currency, date range, amount range, receipt ID, and text query.
- Search results include enough context for safe selection.
- Edit by exact item ID updates only the targeted item and returns a new collection.
- Delete by exact item ID marks the item as deleted and sets `deletedAt`.
- Restore by exact item ID marks the item as active and clears `deletedAt`.
- Edit/delete/restore of a missing ID fails without mutating the collection.
- Ambiguous natural-language target selection returns candidates and does not mutate the collection.
- Settlement recalculation uses the changed item collection.

## Target Selection

If an exact item ID is provided, the app may mutate after validation. If the user describes an item and multiple candidates match, the app must return candidates. If no candidates match, the app should return a not-found result.

Candidate rows must include:

- item ID
- event
- date
- payer
- amount and currency
- category
- description
- status
- receipt reference if any

