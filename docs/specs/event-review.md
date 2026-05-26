# Spec Slice: Event Review Commands

## Behavior

The CLI should let chat and terminal users review existing events without needing to remember exact event names or jump straight to summary/export.

This slice adds:

- `event list`
- `event detail <name>`

## Acceptance Criteria

- `event list` returns all events sorted by name for stable review output.
- `event list --format json` returns event records with ID, name, status, default currency, supported currencies, OCR language metadata, and participant IDs.
- Text `event list` output is concise and includes enough event metadata to choose the next command.
- `event detail <name>` returns the event record plus the same event summary payload used by `event summary`.
- Event participant IDs include people introduced later by linked expenses, not only people passed during `event create`.
- `event detail --format json` stringifies bigint money values the same way as existing JSON commands.
- Missing events fail with a non-zero exit code and a clear `Event not found` message.
