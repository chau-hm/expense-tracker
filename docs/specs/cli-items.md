# Spec Slice: Item CLI Commands

## Behavior

The CLI must let agent workflows list/search candidate items before editing or deleting them. Mutating commands require exact stable item IDs.

This slice implements:

- `item list`
- `item search`
- `item edit`
- `item delete`
- `item restore`

## Acceptance Criteria

- `item list` shows active items by default.
- `item search` can filter by event, text, category, currency, and status.
- JSON item output serializes bigint amounts as strings.
- `item edit <id>` updates the exact item and persists the change.
- `item delete <id>` soft-deletes the exact item and excludes it from settlement.
- `item restore <id>` restores the exact item and includes it in settlement again.
- Missing item IDs return non-zero and do not mutate data.
- Mutating commands do not accept fuzzy targets.

