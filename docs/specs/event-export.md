# Spec Slice: Event Export

## Behavior

`event export` returns a complete event payload for backup or agent handoff. It should include enough structured data to reconstruct the current event-level state without reading chat history.

## Acceptance Criteria

- Export includes event metadata.
- Export includes all event items by default, including deleted items.
- Export includes summary.
- Export serializes bigint amounts as strings.
- Export JSON has an explicit `schemaVersion`.
- Missing events return non-zero.

## Deferred

- File output option
- Import command
- Redaction options

