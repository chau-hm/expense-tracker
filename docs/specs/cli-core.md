# Spec Slice: Core CLI Commands

## Behavior

The CLI is the first app surface for OpenClaw/Telegram workflows. It must be non-interactive, deterministic, and able to output JSON for agent integration.

This slice implements the first useful command path:

- `event create`
- `expense add`
- `event settle`

## Acceptance Criteria

- CLI can use a caller-provided SQLite database path.
- `event create` creates an event and includes the default self participant when no people are supplied.
- `expense add` can add a shared expense to an event.
- `event settle` calculates settlement from persisted expenses.
- `--format json` returns machine-readable JSON.
- Text output remains concise.
- Missing or invalid required fields fail with a non-zero exit code.

## Deferred

- Natural language parsing
- Receipt ingestion
- Item list/search/edit/delete CLI
- Telegram/OpenClaw slash-command routing
  